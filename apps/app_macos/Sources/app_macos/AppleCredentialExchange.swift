import AppKit
import AuthenticationServices
import Foundation
import SwiftUI

struct CredentialExchangeImportResult {
    let accounts: [PasswordAccount]
    let passkeys: [PasskeyRecord]
    let skippedPasskeyCount: Int
}

enum CredentialExchangeError: LocalizedError {
    case unsupportedSystem
    case missingPresentationAnchor
    case missingImportToken
    case invalidBase64URL(String)
    case unsupportedAlgorithm(Int)
    case missingPrivateKey(String)
    case invalidPrivateKey(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedSystem:
            return "当前系统不支持 Apple Credential Exchange"
        case .missingPresentationAnchor:
            return "没有可用于显示系统迁移授权的窗口"
        case .missingImportToken:
            return "系统没有提供 Credential Exchange 导入令牌"
        case .invalidBase64URL(let field):
            return "Credential Exchange 字段不是有效 base64url: \(field)"
        case .unsupportedAlgorithm(let alg):
            return "不支持的 passkey 算法: \(alg)"
        case .missingPrivateKey(let id):
            return "通行密钥缺少私钥，无法导出: \(id)"
        case .invalidPrivateKey(let id):
            return "通行密钥私钥无法转换为 PKCS#8: \(id)"
        }
    }
}

@available(macOS 26.0, *)
enum AppleCredentialExchangeMapper {
    static let exporterRelyingPartyIdentifier = "com.pass.desktop"
    static let exporterDisplayName = "PassMac"

    static func exportData(
        accounts: [PasswordAccount],
        passkeys: [PasskeyRecord],
        formatVersion: ASExportedCredentialData.FormatVersion
    ) throws -> ASExportedCredentialData {
        let activeAccounts = accounts.filter { !$0.isDeleted }
        var passkeysById: [String: PasskeyRecord] = [:]
        for passkey in passkeys {
            let id = passkey.credentialIdB64u.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty else { continue }
            passkeysById[id] = passkey
        }

        var exportedPasskeyIDs = Set<String>()
        var items = try activeAccounts.map { account in
            exportedPasskeyIDs.formUnion(account.passkeyCredentialIds)
            let credentials = try exportCredentials(for: account, passkeysById: passkeysById)
            return ASImportableItem(
                id: stableDataID("item|\(account.accountId)"),
                created: dateFromMs(account.createdAtMs),
                lastModified: dateFromMs(account.updatedAtMs),
                title: accountTitle(account),
                subtitle: account.sites.first,
                favorite: account.isPinned ?? false,
                scope: scope(for: account.sites),
                credentials: credentials,
                tags: []
            )
        }

        // Preserve passkeys that are not currently linked from an active
        // account instead of silently dropping them during a full export.
        for passkey in passkeysById.values.sorted(by: { $0.credentialIdB64u < $1.credentialIdB64u }) {
            let credentialID = passkey.credentialIdB64u.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !exportedPasskeyIDs.contains(credentialID) else { continue }
            let relyingParty = DomainUtils.normalize(passkey.rpId)
            let displayTitle = passkey.displayName.isEmpty
                ? (passkey.userName.isEmpty ? relyingParty : passkey.userName)
                : passkey.displayName
            items.append(
                ASImportableItem(
                    id: stableDataID("orphan-passkey-item|\(credentialID)"),
                    created: dateFromMs(passkey.createdAtMs),
                    lastModified: dateFromMs(passkey.updatedAtMs),
                    title: displayTitle,
                    subtitle: relyingParty,
                    favorite: false,
                    scope: scope(for: [relyingParty]),
                    credentials: [.passkey(try exportPasskey(passkey))],
                    tags: []
                )
            )
        }

        let account = ASImportableAccount(
            id: stableDataID("account|\(exporterRelyingPartyIdentifier)"),
            userName: exporterDisplayName,
            email: "",
            collections: [],
            items: items
        )

        return ASExportedCredentialData(
            accounts: [account],
            formatVersion: formatVersion,
            exporterRelyingPartyIdentifier: exporterRelyingPartyIdentifier,
            exporterDisplayName: exporterDisplayName,
            timestamp: Date()
        )
    }

    static func importData(
        _ exportedData: ASExportedCredentialData,
        deviceName: String
    ) throws -> CredentialExchangeImportResult {
        var importedAccounts: [PasswordAccount] = []
        var importedPasskeys: [PasskeyRecord] = []
        var skippedPasskeyCount = 0

        for exportedAccount in exportedData.accounts {
            for item in exportedAccount.items {
                let scopeSites = sites(from: item.scope)
                let itemPasskeys = item.credentials.compactMap { credential -> PasskeyRecord? in
                    guard case .passkey(let passkey) = credential else { return nil }
                    do {
                        return try importPasskey(passkey, item: item)
                    } catch {
                        skippedPasskeyCount += 1
                        return nil
                    }
                }
                importedPasskeys.append(contentsOf: itemPasskeys)

                let basicAuthentication = item.credentials.compactMap { credential -> ASImportableCredential.BasicAuthentication? in
                    guard case .basicAuthentication(let value) = credential else { return nil }
                    return value
                }.first

                guard basicAuthentication != nil || !itemPasskeys.isEmpty else { continue }
                let firstPasskey = itemPasskeys.first
                let primarySite = scopeSites.first ?? firstPasskey?.rpId ?? "import.local"
                let username = basicAuthentication?.userName?.value ?? firstPasskey?.userName ?? item.title
                let password = basicAuthentication?.password?.value ?? ""
                var account = AccountFactory.create(
                    site: primarySite,
                    username: username,
                    password: password,
                    deviceName: deviceName,
                    createdAt: item.created ?? Date()
                )
                account.sites = Array(Set((scopeSites.isEmpty ? [primarySite] : scopeSites).map(DomainUtils.normalize).filter { !$0.isEmpty })).sorted()
                account.note = note(from: item.credentials)
                account.passkeyCredentialIds = itemPasskeys.map(\.credentialIdB64u).sorted()
                account.passkeyUpdatedAtMs = Int64((item.lastModified ?? item.created ?? Date()).timeIntervalSince1970 * 1000)
                account.passkeyUpdatedDeviceName = deviceName
                account.updatedAtMs = max(account.updatedAtMs, account.passkeyUpdatedAtMs)
                importedAccounts.append(account)
            }
        }

        return CredentialExchangeImportResult(
            accounts: importedAccounts,
            passkeys: importedPasskeys,
            skippedPasskeyCount: skippedPasskeyCount
        )
    }

    private static func exportCredentials(
        for account: PasswordAccount,
        passkeysById: [String: PasskeyRecord]
    ) throws -> [ASImportableCredential] {
        var credentials: [ASImportableCredential] = []
        if !account.username.isEmpty || !account.password.isEmpty {
            credentials.append(
                .basicAuthentication(
                    ASImportableCredential.BasicAuthentication(
                        userName: ASImportableEditableField(
                            id: stableDataID("field|user|\(account.accountId)"),
                            fieldType: .string,
                            value: account.username,
                            label: "username"
                        ),
                        password: ASImportableEditableField(
                            id: stableDataID("field|password|\(account.accountId)"),
                            fieldType: .concealedString,
                            value: account.password,
                            label: "password"
                        )
                    )
                )
            )
        }

        if !account.note.isEmpty {
            credentials.append(
                .note(
                    ASImportableCredential.Note(
                        content: ASImportableEditableField(
                            id: stableDataID("field|note|\(account.accountId)"),
                            fieldType: .string,
                            value: account.note,
                            label: "note"
                        )
                    )
                )
            )
        }

        for credentialId in account.passkeyCredentialIds {
            guard let passkey = passkeysById[credentialId] else { continue }
            credentials.append(.passkey(try exportPasskey(passkey)))
        }
        return credentials
    }

    private static func exportPasskey(_ passkey: PasskeyRecord) throws -> ASImportableCredential.Passkey {
        let credentialID = try base64URLDecode(passkey.credentialIdB64u, field: "credentialIdB64u")
        let userHandle = try base64URLDecode(passkey.userHandleB64u, field: "userHandleB64u")
        guard let privateJwk = passkey.privateJwk?.objectValue else {
            throw CredentialExchangeError.missingPrivateKey(passkey.credentialIdB64u)
        }
        let keyData: Data
        switch passkey.alg {
        case -7:
            keyData = try PKCS8Codec.encodeP256PrivateKey(privateJwk)
        case -257:
            keyData = try PKCS8Codec.encodeRSAPrivateKey(privateJwk)
        default:
            throw CredentialExchangeError.unsupportedAlgorithm(passkey.alg)
        }
        return ASImportableCredential.Passkey(
            credentialID: credentialID,
            relyingPartyIdentifier: DomainUtils.normalize(passkey.rpId),
            userName: passkey.userName,
            userDisplayName: passkey.displayName.isEmpty ? passkey.userName : passkey.displayName,
            userHandle: userHandle,
            key: keyData
        )
    }

    private static func importPasskey(
        _ passkey: ASImportableCredential.Passkey,
        item: ASImportableItem
    ) throws -> PasskeyRecord {
        let decodedKey = try PKCS8Codec.decodePrivateKey(passkey.key)
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let createdAt = item.created.map { Int64($0.timeIntervalSince1970 * 1000) } ?? nowMs
        let updatedAt = item.lastModified.map { Int64($0.timeIntervalSince1970 * 1000) } ?? createdAt
        return PasskeyRecord(
            credentialIdB64u: base64URLEncode(passkey.credentialID),
            rpId: DomainUtils.normalize(passkey.relyingPartyIdentifier),
            userName: passkey.userName,
            displayName: passkey.userDisplayName.isEmpty ? passkey.userName : passkey.userDisplayName,
            userHandleB64u: base64URLEncode(passkey.userHandle),
            alg: decodedKey.alg,
            signCount: 0,
            privateJwk: .object(decodedKey.privateJwk),
            publicJwk: decodedKey.publicJwk.map(JSONValue.object),
            createdAtMs: createdAt,
            updatedAtMs: updatedAt,
            lastUsedAtMs: nil,
            mode: "managed",
            createCompatMethod: decodedKey.alg == -257 ? "rs256" : "standard"
        )
    }

    private static func scope(for sites: [String]) -> ASImportableCredentialScope? {
        let urls = sites
            .map(DomainUtils.normalize)
            .filter { !$0.isEmpty }
            .compactMap { URL(string: "https://\($0)") }
        return urls.isEmpty ? nil : ASImportableCredentialScope(urls: urls)
    }

    private static func sites(from scope: ASImportableCredentialScope?) -> [String] {
        guard let scope else { return [] }
        return Array(Set(scope.urls.compactMap { DomainUtils.normalize($0.host ?? "") }.filter { !$0.isEmpty })).sorted()
    }

    private static func note(from credentials: [ASImportableCredential]) -> String {
        credentials.compactMap { credential in
            guard case .note(let note) = credential else { return nil }
            return note.content.value
        }.joined(separator: "\n")
    }

    private static func accountTitle(_ account: PasswordAccount) -> String {
        if !account.canonicalSite.isEmpty { return account.canonicalSite }
        if let site = account.sites.first, !site.isEmpty { return site }
        return account.username.isEmpty ? account.accountId : account.username
    }

    private static func dateFromMs(_ value: Int64) -> Date {
        Date(timeIntervalSince1970: TimeInterval(value) / 1000)
    }

    private static func stableDataID(_ text: String) -> Data {
        Data(text.utf8)
    }
}

@MainActor
extension AccountStore {
    func exportToAppleCredentialExchange() {
        guard #available(macOS 26.0, *) else {
            statusMessage = CredentialExchangeError.unsupportedSystem.localizedDescription
            return
        }
        guard let window = NSApp.keyWindow ?? NSApp.mainWindow else {
            statusMessage = CredentialExchangeError.missingPresentationAnchor.localizedDescription
            return
        }

        Task { @MainActor in
            do {
                let manager = ASCredentialExportManager(presentationAnchor: window)
                statusMessage = "Apple Credential Exchange 正在请求导出授权..."
                let options = try await manager.requestExport()
                let data = try AppleCredentialExchangeMapper.exportData(
                    accounts: accounts,
                    passkeys: passkeys,
                    formatVersion: options.formatVersion
                )
                statusMessage = "Apple Credential Exchange 正在交给系统迁移..."
                try await manager.exportCredentials(data)
                statusMessage = "Apple Credential Exchange 导出完成：\(data.accounts.first?.items.count ?? 0) 条项目"
            } catch {
                statusMessage = "Apple Credential Exchange 导出失败: \(error.localizedDescription)"
            }
        }
    }

    func handleAppleCredentialExchangeActivity(_ userActivity: NSUserActivity) {
        guard #available(macOS 26.0, *) else {
            statusMessage = CredentialExchangeError.unsupportedSystem.localizedDescription
            return
        }
        guard userActivity.activityType == ASCredentialExchangeActivity else { return }
        guard let token = credentialExchangeImportToken(from: userActivity) else {
            statusMessage = CredentialExchangeError.missingImportToken.localizedDescription
            return
        }

        Task { @MainActor in
            do {
                let manager = ASCredentialImportManager()
                let exportedData = try await manager.importCredentials(token: token)
                let result = try AppleCredentialExchangeMapper.importData(
                    exportedData,
                    deviceName: deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? "MacDevice"
                        : deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
                )
                mergeCredentialExchangeImport(result)
            } catch {
                statusMessage = "Apple Credential Exchange 导入失败: \(error.localizedDescription)"
            }
        }
    }

    private func credentialExchangeImportToken(from userActivity: NSUserActivity) -> UUID? {
        guard #available(macOS 26.0, *) else { return nil }
        let raw = userActivity.userInfo?[ASCredentialImportToken]
        if let uuid = raw as? UUID { return uuid }
        if let string = raw as? String { return UUID(uuidString: string) }
        return nil
    }
}

struct AppleCredentialExchangeActivityModifier: ViewModifier {
    @ObservedObject var store: AccountStore

    func body(content: Content) -> some View {
        if #available(macOS 26.0, *) {
            content.onContinueUserActivity(ASCredentialExchangeActivity) { userActivity in
                store.handleAppleCredentialExchangeActivity(userActivity)
            }
        } else {
            content
        }
    }
}

private struct DecodedPrivateKey {
    let alg: Int
    let privateJwk: [String: JSONValue]
    let publicJwk: [String: JSONValue]?
}

private enum PKCS8Codec {
    private static let oidEcPublicKey: [UInt64] = [1, 2, 840, 10045, 2, 1]
    private static let oidPrime256v1: [UInt64] = [1, 2, 840, 10045, 3, 1, 7]
    private static let oidRsaEncryption: [UInt64] = [1, 2, 840, 113549, 1, 1, 1]

    static func encodeP256PrivateKey(_ jwk: [String: JSONValue]) throws -> Data {
        guard let d = try dataField(jwk, "d"),
              let x = try dataField(jwk, "x"),
              let y = try dataField(jwk, "y")
        else {
            throw CredentialExchangeError.invalidPrivateKey("ES256")
        }
        let publicKey = Data([0x04]) + x.leftPadded(to: 32) + y.leftPadded(to: 32)
        let ecPrivateKey = DER.sequence([
            DER.integer(Data([0x01])),
            DER.octetString(d.leftPadded(to: 32)),
            DER.contextSpecific(1, DER.bitString(publicKey)),
        ])
        let algorithm = DER.sequence([
            DER.objectIdentifier(oidEcPublicKey),
            DER.objectIdentifier(oidPrime256v1),
        ])
        return DER.sequence([
            DER.integer(Data([0x00])),
            algorithm,
            DER.octetString(ecPrivateKey),
        ])
    }

    static func encodeRSAPrivateKey(_ jwk: [String: JSONValue]) throws -> Data {
        let names = ["n", "e", "d", "p", "q", "dp", "dq", "qi"]
        let values = try names.map { name -> Data in
            guard let value = try dataField(jwk, name) else {
                throw CredentialExchangeError.invalidPrivateKey("RSA")
            }
            return value.trimLeadingZeros()
        }
        let rsaPrivateKey = DER.sequence(
            [DER.integer(Data([0x00]))] + values.map(DER.integer)
        )
        let algorithm = DER.sequence([
            DER.objectIdentifier(oidRsaEncryption),
            DER.null(),
        ])
        return DER.sequence([
            DER.integer(Data([0x00])),
            algorithm,
            DER.octetString(rsaPrivateKey),
        ])
    }

    static func decodePrivateKey(_ pkcs8: Data) throws -> DecodedPrivateKey {
        var reader = DERReader(pkcs8)
        var info = try reader.readSequence()
        _ = try info.readInteger()
        var algorithm = try info.readSequence()
        let algorithmOID = try algorithm.readObjectIdentifier()
        if algorithmOID == oidEcPublicKey {
            let curveOID = try algorithm.readObjectIdentifier()
            guard curveOID == oidPrime256v1 else {
                throw CredentialExchangeError.invalidPrivateKey("P-256")
            }
            let privateBytes = try info.readOctetString()
            return try decodeP256PrivateKey(privateBytes)
        }
        if algorithmOID == oidRsaEncryption {
            if !algorithm.isAtEnd {
                _ = try? algorithm.readNull()
            }
            return try decodeRSAPrivateKey(try info.readOctetString())
        }
        throw CredentialExchangeError.invalidPrivateKey("unknown")
    }

    private static func decodeP256PrivateKey(_ ecPrivateKey: Data) throws -> DecodedPrivateKey {
        var reader = DERReader(ecPrivateKey)
        var sequence = try reader.readSequence()
        _ = try sequence.readInteger()
        let d = try sequence.readOctetString().leftPadded(to: 32)
        var publicJwk: [String: JSONValue]?
        while !sequence.isAtEnd {
            let item = try sequence.readAny()
            if item.tag == 0xA1 {
                var publicReader = DERReader(item.value)
                let publicKey = try publicReader.readBitString()
                if publicKey.count == 65, publicKey.first == 0x04 {
                    let x = publicKey.subdata(in: 1..<33)
                    let y = publicKey.subdata(in: 33..<65)
                    publicJwk = [
                        "kty": .string("EC"),
                        "crv": .string("P-256"),
                        "x": .string(base64URLEncode(x)),
                        "y": .string(base64URLEncode(y)),
                        "ext": .bool(true),
                    ]
                }
            }
        }

        var privateJwk = publicJwk ?? [
            "kty": .string("EC"),
            "crv": .string("P-256"),
        ]
        privateJwk["d"] = .string(base64URLEncode(d))
        privateJwk["ext"] = .bool(true)
        privateJwk["key_ops"] = .array([.string("sign")])
        return DecodedPrivateKey(alg: -7, privateJwk: privateJwk, publicJwk: publicJwk)
    }

    private static func decodeRSAPrivateKey(_ rsaPrivateKey: Data) throws -> DecodedPrivateKey {
        var reader = DERReader(rsaPrivateKey)
        var sequence = try reader.readSequence()
        _ = try sequence.readInteger()
        let fields = try (0..<8).map { _ in try sequence.readInteger().trimLeadingZeros() }
        let names = ["n", "e", "d", "p", "q", "dp", "dq", "qi"]
        var privateJwk: [String: JSONValue] = [
            "kty": .string("RSA"),
            "alg": .string("RS256"),
            "ext": .bool(true),
            "key_ops": .array([.string("sign")]),
        ]
        for (name, value) in zip(names, fields) {
            privateJwk[name] = .string(base64URLEncode(value))
        }
        let publicJwk: [String: JSONValue] = [
            "kty": .string("RSA"),
            "alg": .string("RS256"),
            "n": .string(base64URLEncode(fields[0])),
            "e": .string(base64URLEncode(fields[1])),
            "ext": .bool(true),
        ]
        return DecodedPrivateKey(alg: -257, privateJwk: privateJwk, publicJwk: publicJwk)
    }

    private static func dataField(_ jwk: [String: JSONValue], _ key: String) throws -> Data? {
        guard let value = jwk[key]?.stringValue else { return nil }
        return try base64URLDecode(value, field: key)
    }
}

private enum DER {
    static func sequence(_ values: [Data]) -> Data {
        tagged(0x30, values.reduce(Data(), +))
    }

    static func integer(_ value: Data) -> Data {
        var body = value.trimLeadingZeros()
        if body.isEmpty { body = Data([0x00]) }
        if let first = body.first, first & 0x80 != 0 {
            body.insert(0x00, at: 0)
        }
        return tagged(0x02, body)
    }

    static func bitString(_ value: Data) -> Data {
        tagged(0x03, Data([0x00]) + value)
    }

    static func octetString(_ value: Data) -> Data {
        tagged(0x04, value)
    }

    static func null() -> Data {
        Data([0x05, 0x00])
    }

    static func objectIdentifier(_ components: [UInt64]) -> Data {
        guard components.count >= 2 else { return tagged(0x06, Data()) }
        var body = Data([UInt8(components[0] * 40 + components[1])])
        for component in components.dropFirst(2) {
            body.append(contentsOf: base128(component))
        }
        return tagged(0x06, body)
    }

    static func contextSpecific(_ number: UInt8, _ value: Data) -> Data {
        tagged(0xA0 + number, value)
    }

    private static func tagged(_ tag: UInt8, _ value: Data) -> Data {
        Data([tag]) + length(value.count) + value
    }

    private static func length(_ count: Int) -> Data {
        if count < 128 { return Data([UInt8(count)]) }
        var bytes: [UInt8] = []
        var value = count
        while value > 0 {
            bytes.insert(UInt8(value & 0xFF), at: 0)
            value >>= 8
        }
        return Data([0x80 | UInt8(bytes.count)] + bytes)
    }

    private static func base128(_ value: UInt64) -> [UInt8] {
        var parts = [UInt8(value & 0x7F)]
        var next = value >> 7
        while next > 0 {
            parts.insert(UInt8(next & 0x7F) | 0x80, at: 0)
            next >>= 7
        }
        return parts
    }
}

private struct DERItem {
    let tag: UInt8
    let value: Data
}

private struct DERReader {
    private let data: Data
    private var offset: Int = 0

    var isAtEnd: Bool { offset >= data.count }

    init(_ data: Data) {
        self.data = data
    }

    mutating func readSequence() throws -> DERReader {
        let item = try readExpected(0x30)
        return DERReader(item.value)
    }

    mutating func readInteger() throws -> Data {
        try readExpected(0x02).value
    }

    mutating func readOctetString() throws -> Data {
        try readExpected(0x04).value
    }

    mutating func readBitString() throws -> Data {
        let value = try readExpected(0x03).value
        guard value.first == 0x00 else {
            throw CredentialExchangeError.invalidPrivateKey("bitstring")
        }
        return value.dropFirstData()
    }

    mutating func readNull() throws {
        _ = try readExpected(0x05)
    }

    mutating func readObjectIdentifier() throws -> [UInt64] {
        let value = try readExpected(0x06).value
        guard let first = value.first else { return [] }
        var components: [UInt64] = [UInt64(first / 40), UInt64(first % 40)]
        var current: UInt64 = 0
        for byte in value.dropFirst() {
            current = (current << 7) | UInt64(byte & 0x7F)
            if byte & 0x80 == 0 {
                components.append(current)
                current = 0
            }
        }
        return components
    }

    mutating func readAny() throws -> DERItem {
        guard offset < data.count else {
            throw CredentialExchangeError.invalidPrivateKey("DER EOF")
        }
        let tag = data[offset]
        offset += 1
        let length = try readLength()
        guard offset + length <= data.count else {
            throw CredentialExchangeError.invalidPrivateKey("DER length")
        }
        let value = data.subdata(in: offset..<(offset + length))
        offset += length
        return DERItem(tag: tag, value: value)
    }

    private mutating func readExpected(_ tag: UInt8) throws -> DERItem {
        let item = try readAny()
        guard item.tag == tag else {
            throw CredentialExchangeError.invalidPrivateKey("DER tag")
        }
        return item
    }

    private mutating func readLength() throws -> Int {
        guard offset < data.count else {
            throw CredentialExchangeError.invalidPrivateKey("DER length EOF")
        }
        let first = data[offset]
        offset += 1
        if first & 0x80 == 0 { return Int(first) }
        let byteCount = Int(first & 0x7F)
        guard byteCount > 0, byteCount <= 4, offset + byteCount <= data.count else {
            throw CredentialExchangeError.invalidPrivateKey("DER long length")
        }
        var value = 0
        for _ in 0..<byteCount {
            value = (value << 8) | Int(data[offset])
            offset += 1
        }
        return value
    }
}

private func base64URLDecode(_ value: String, field: String) throws -> Data {
    var normalized = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "-", with: "+")
        .replacingOccurrences(of: "_", with: "/")
    let remainder = normalized.count % 4
    if remainder > 0 {
        normalized.append(String(repeating: "=", count: 4 - remainder))
    }
    guard let data = Data(base64Encoded: normalized) else {
        throw CredentialExchangeError.invalidBase64URL(field)
    }
    return data
}

private func base64URLEncode(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private extension JSONValue {
    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    var objectValue: [String: JSONValue]? {
        guard case .object(let value) = self else { return nil }
        return value
    }
}

private extension Data {
    func trimLeadingZeros() -> Data {
        var index = startIndex
        while index < endIndex - 1, self[index] == 0 {
            index = self.index(after: index)
        }
        return subdata(in: index..<endIndex)
    }

    func leftPadded(to length: Int) -> Data {
        if count >= length { return suffixData(length) }
        return Data(repeating: 0, count: length - count) + self
    }

    func suffixData(_ count: Int) -> Data {
        guard self.count > count else { return self }
        return subdata(in: (endIndex - count)..<endIndex)
    }

    func dropFirstData() -> Data {
        subdata(in: index(after: startIndex)..<endIndex)
    }
}
