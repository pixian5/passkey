import Foundation

struct PasswordAccount: Codable, Identifiable, Hashable {
    let id: UUID
    let accountId: String
    let canonicalSite: String
    let usernameAtCreate: String
    var isPinned: Bool?
    var pinnedSortOrder: Int64?
    var regularSortOrder: Int64?
    var folderId: UUID?
    var folderIds: [UUID]?
    var sites: [String]
    var username: String
    var password: String
    var totpSecret: String
    var recoveryCodes: String
    var note: String
    var passkeyCredentialIds: [String]
    var usernameUpdatedAtMs: Int64
    var passwordUpdatedAtMs: Int64
    var totpUpdatedAtMs: Int64
    var recoveryCodesUpdatedAtMs: Int64
    var noteUpdatedAtMs: Int64
    var passkeyUpdatedAtMs: Int64
    var updatedAtMs: Int64
    var isDeleted: Bool
    var deletedAtMs: Int64?
    var lastOperatedDeviceName: String
    var createdAtMs: Int64

    mutating func touchUpdatedAt(_ nowMs: Int64, deviceName: String) {
        updatedAtMs = nowMs
        lastOperatedDeviceName = deviceName
    }

    var resolvedFolderIds: [UUID] {
        let source: [UUID]
        if let folderIds, !folderIds.isEmpty {
            source = folderIds
        } else if let folderId {
            source = [folderId]
        } else {
            source = []
        }
        return Array(Set(source)).sorted { $0.uuidString < $1.uuidString }
    }

    mutating func setResolvedFolderIds(_ ids: [UUID]) {
        let normalized = Array(Set(ids)).sorted { $0.uuidString < $1.uuidString }
        folderIds = normalized
        folderId = normalized.first
    }

    func isInFolder(_ id: UUID) -> Bool {
        resolvedFolderIds.contains(id)
    }
}

extension PasswordAccount {
    private enum CodingKeys: String, CodingKey {
        case id
        case recordId
        case accountId
        case canonicalSite
        case usernameAtCreate
        case isPinned
        case pinnedSortOrder
        case regularSortOrder
        case folderId
        case folderIds
        case sites
        case username
        case password
        case totpSecret
        case recoveryCodes
        case note
        case passkeyCredentialIds
        case usernameUpdatedAtMs
        case passwordUpdatedAtMs
        case totpUpdatedAtMs
        case recoveryCodesUpdatedAtMs
        case noteUpdatedAtMs
        case passkeyUpdatedAtMs
        case updatedAtMs
        case isDeleted
        case deletedAtMs
        case lastOperatedDeviceName
        case createdAtMs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)

        let explicitId = try container.decodeIfPresent(UUID.self, forKey: .id)
        let recordIdRaw = try container.decodeIfPresent(String.self, forKey: .recordId)
        let parsedRecordId = recordIdRaw
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .flatMap(UUID.init(uuidString:))

        id = explicitId ?? parsedRecordId ?? UUID()

        let decodedSites = try container.decodeIfPresent([String].self, forKey: .sites)
            ?? []
        let normalizedSites = Array(
            Set(decodedSites.map(DomainUtils.normalize).filter { !$0.isEmpty })
        ).sorted()

        let decodedUpdatedAt = try container.decodeIfPresent(Int64.self, forKey: .updatedAtMs)
        let decodedCreatedAt = try container.decodeIfPresent(Int64.self, forKey: .createdAtMs)
        let createdAt = decodedCreatedAt ?? decodedUpdatedAt ?? nowMs
        let updatedAt = decodedUpdatedAt ?? createdAt

        let decodedUsername = try container.decodeIfPresent(String.self, forKey: .username)
            ?? ""
        let canonical = try container.decodeIfPresent(String.self, forKey: .canonicalSite)
            ?? DomainUtils.etldPlusOne(for: normalizedSites.first ?? "")

        accountId = try container.decode(String.self, forKey: .accountId)
        canonicalSite = canonical
        usernameAtCreate = try container.decodeIfPresent(String.self, forKey: .usernameAtCreate)
            ?? decodedUsername
        isPinned = try container.decodeIfPresent(Bool.self, forKey: .isPinned)
        pinnedSortOrder = try container.decodeIfPresent(Int64.self, forKey: .pinnedSortOrder)
        regularSortOrder = try container.decodeIfPresent(Int64.self, forKey: .regularSortOrder)
        folderId = try container.decodeIfPresent(UUID.self, forKey: .folderId)
        folderIds = try container.decodeIfPresent([UUID].self, forKey: .folderIds)
        sites = normalizedSites
        username = decodedUsername
        password = try container.decodeIfPresent(String.self, forKey: .password) ?? ""
        totpSecret = try container.decodeIfPresent(String.self, forKey: .totpSecret) ?? ""
        recoveryCodes = try container.decodeIfPresent(String.self, forKey: .recoveryCodes) ?? ""
        note = try container.decodeIfPresent(String.self, forKey: .note) ?? ""
        passkeyCredentialIds = Array(
            Set((try container.decodeIfPresent([String].self, forKey: .passkeyCredentialIds) ?? [])
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty })
        ).sorted()
        usernameUpdatedAtMs = try container.decodeIfPresent(Int64.self, forKey: .usernameUpdatedAtMs) ?? createdAt
        passwordUpdatedAtMs = try container.decodeIfPresent(Int64.self, forKey: .passwordUpdatedAtMs) ?? createdAt
        totpUpdatedAtMs = try container.decodeIfPresent(Int64.self, forKey: .totpUpdatedAtMs) ?? createdAt
        recoveryCodesUpdatedAtMs = try container.decodeIfPresent(Int64.self, forKey: .recoveryCodesUpdatedAtMs) ?? createdAt
        noteUpdatedAtMs = try container.decodeIfPresent(Int64.self, forKey: .noteUpdatedAtMs) ?? createdAt
        passkeyUpdatedAtMs = try container.decodeIfPresent(Int64.self, forKey: .passkeyUpdatedAtMs) ?? createdAt
        updatedAtMs = updatedAt
        isDeleted = try container.decodeIfPresent(Bool.self, forKey: .isDeleted) ?? false
        deletedAtMs = try container.decodeIfPresent(Int64.self, forKey: .deletedAtMs)
        lastOperatedDeviceName = try container.decodeIfPresent(String.self, forKey: .lastOperatedDeviceName)
            ?? "MacDevice"
        createdAtMs = createdAt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(id.uuidString.lowercased(), forKey: .recordId)
        try container.encode(accountId, forKey: .accountId)
        try container.encode(canonicalSite, forKey: .canonicalSite)
        try container.encode(usernameAtCreate, forKey: .usernameAtCreate)
        try container.encode(isPinned, forKey: .isPinned)
        try container.encode(pinnedSortOrder, forKey: .pinnedSortOrder)
        try container.encode(regularSortOrder, forKey: .regularSortOrder)
        try container.encode(folderId, forKey: .folderId)
        try container.encode(folderIds, forKey: .folderIds)
        try container.encode(sites, forKey: .sites)
        try container.encode(username, forKey: .username)
        try container.encode(password, forKey: .password)
        try container.encode(totpSecret, forKey: .totpSecret)
        try container.encode(recoveryCodes, forKey: .recoveryCodes)
        try container.encode(note, forKey: .note)
        try container.encode(passkeyCredentialIds, forKey: .passkeyCredentialIds)
        try container.encode(usernameUpdatedAtMs, forKey: .usernameUpdatedAtMs)
        try container.encode(passwordUpdatedAtMs, forKey: .passwordUpdatedAtMs)
        try container.encode(totpUpdatedAtMs, forKey: .totpUpdatedAtMs)
        try container.encode(recoveryCodesUpdatedAtMs, forKey: .recoveryCodesUpdatedAtMs)
        try container.encode(noteUpdatedAtMs, forKey: .noteUpdatedAtMs)
        try container.encode(passkeyUpdatedAtMs, forKey: .passkeyUpdatedAtMs)
        try container.encode(updatedAtMs, forKey: .updatedAtMs)
        try container.encode(isDeleted, forKey: .isDeleted)
        try container.encode(deletedAtMs, forKey: .deletedAtMs)
        try container.encode(lastOperatedDeviceName, forKey: .lastOperatedDeviceName)
        try container.encode(createdAtMs, forKey: .createdAtMs)
    }
}

enum AccountFactory {
    static func create(
        site: String,
        accountIdSite: String? = nil,
        username: String,
        password: String,
        deviceName: String,
        createdAt: Date = Date()
    ) -> PasswordAccount {
        let normalizedSite = DomainUtils.normalize(site)
        let canonicalSite = DomainUtils.etldPlusOne(for: normalizedSite)
        let normalizedIdSite = DomainUtils.normalize(accountIdSite ?? "")
        let idSite = normalizedIdSite.isEmpty ? canonicalSite : normalizedIdSite
        let accountId = "\(idSite)-\(timestamp(createdAt))-\(username)"
        let nowMs = Int64(createdAt.timeIntervalSince1970 * 1000)
        return PasswordAccount(
            id: UUID(),
            accountId: accountId,
            canonicalSite: canonicalSite,
            usernameAtCreate: username,
            isPinned: false,
            pinnedSortOrder: nil,
            regularSortOrder: nil,
            folderId: nil,
            folderIds: [],
            sites: [normalizedSite].sorted(),
            username: username,
            password: password,
            totpSecret: "",
            recoveryCodes: "",
            note: "",
            passkeyCredentialIds: [],
            usernameUpdatedAtMs: nowMs,
            passwordUpdatedAtMs: nowMs,
            totpUpdatedAtMs: nowMs,
            recoveryCodesUpdatedAtMs: nowMs,
            noteUpdatedAtMs: nowMs,
            passkeyUpdatedAtMs: nowMs,
            updatedAtMs: nowMs,
            isDeleted: false,
            deletedAtMs: nil,
            lastOperatedDeviceName: deviceName,
            createdAtMs: nowMs
        )
    }

    private static func timestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyMMddHHmmss"
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
}

struct AccountFolder: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    let createdAtMs: Int64
    var updatedAtMs: Int64
}

extension AccountFolder {
    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case createdAtMs
        case updatedAtMs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "未命名文件夹"
        createdAtMs = try container.decodeIfPresent(Int64.self, forKey: .createdAtMs)
            ?? Int64(Date().timeIntervalSince1970 * 1000)
        updatedAtMs = try container.decodeIfPresent(Int64.self, forKey: .updatedAtMs)
            ?? createdAtMs
    }
}

struct OperationHistoryEntry: Codable, Identifiable, Hashable {
    let id: UUID
    let timestampMs: Int64
    let category: HistoryEntryCategory
    let operationId: UUID
    let operationTitle: String?
    let action: String
    let accountId: String?
    let fieldKey: String?
    let oldValue: String?
    let newValue: String?
    let accountBefore: PasswordAccount?
    let accountAfter: PasswordAccount?

    init(
        id: UUID,
        timestampMs: Int64,
        category: HistoryEntryCategory = .local,
        operationId: UUID = UUID(),
        operationTitle: String? = nil,
        action: String,
        accountId: String? = nil,
        fieldKey: String? = nil,
        oldValue: String? = nil,
        newValue: String? = nil,
        accountBefore: PasswordAccount? = nil,
        accountAfter: PasswordAccount? = nil
    ) {
        self.id = id
        self.timestampMs = timestampMs
        self.category = category
        self.operationId = operationId
        self.operationTitle = operationTitle
        self.action = action
        self.accountId = accountId
        self.fieldKey = fieldKey
        self.oldValue = oldValue
        self.newValue = newValue
        self.accountBefore = accountBefore
        self.accountAfter = accountAfter
    }
}

enum HistoryEntryCategory: String, Codable, CaseIterable, Hashable {
    case local
    case sync

    var menuTitle: String {
        switch self {
        case .local:
            return "本地的历史记录"
        case .sync:
            return "同步的历史记录"
        }
    }

    var operationPrefix: String {
        switch self {
        case .local:
            return "本地"
        case .sync:
            return "同步"
        }
    }
}

extension OperationHistoryEntry {
    private enum CodingKeys: String, CodingKey {
        case id
        case timestampMs
        case category
        case operationId
        case operationTitle
        case action
        case accountId
        case fieldKey
        case oldValue
        case newValue
        case accountBefore
        case accountAfter
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        timestampMs = try container.decodeIfPresent(Int64.self, forKey: .timestampMs)
            ?? Int64(Date().timeIntervalSince1970 * 1000)
        category = try container.decodeIfPresent(HistoryEntryCategory.self, forKey: .category) ?? .local
        operationId = try container.decodeIfPresent(UUID.self, forKey: .operationId) ?? UUID()
        operationTitle = try container.decodeIfPresent(String.self, forKey: .operationTitle)
        action = try container.decodeIfPresent(String.self, forKey: .action) ?? ""
        accountId = try container.decodeIfPresent(String.self, forKey: .accountId)
        fieldKey = try container.decodeIfPresent(String.self, forKey: .fieldKey)
        oldValue = try container.decodeIfPresent(String.self, forKey: .oldValue)
        newValue = try container.decodeIfPresent(String.self, forKey: .newValue)
        accountBefore = try container.decodeIfPresent(PasswordAccount.self, forKey: .accountBefore)
        accountAfter = try container.decodeIfPresent(PasswordAccount.self, forKey: .accountAfter)
    }
}

struct PasskeyRecord: Codable, Hashable {
    var credentialIdB64u: String
    var rpId: String
    var userName: String
    var displayName: String
    var userHandleB64u: String
    var alg: Int
    var signCount: Int
    var privateJwk: JSONValue?
    var publicJwk: JSONValue?
    var createdAtMs: Int64
    var updatedAtMs: Int64
    var lastUsedAtMs: Int64?
    var mode: String
    var createCompatMethod: String?
}

enum JSONValue: Codable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        if let container = try? decoder.singleValueContainer() {
            if container.decodeNil() {
                self = .null
                return
            }
            if let value = try? container.decode(Bool.self) {
                self = .bool(value)
                return
            }
            if let value = try? container.decode(Double.self) {
                self = .number(value)
                return
            }
            if let value = try? container.decode(String.self) {
                self = .string(value)
                return
            }
        }

        if let object = try? decoder.container(keyedBy: DynamicCodingKey.self) {
            var value: [String: JSONValue] = [:]
            for key in object.allKeys {
                value[key.stringValue] = try object.decode(JSONValue.self, forKey: key)
            }
            self = .object(value)
            return
        }

        var unkeyed = try decoder.unkeyedContainer()
        var values: [JSONValue] = []
        while !unkeyed.isAtEnd {
            values.append(try unkeyed.decode(JSONValue.self))
        }
        self = .array(values)
    }

    func encode(to encoder: Encoder) throws {
        switch self {
        case .string(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .number(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .bool(let value):
            var container = encoder.singleValueContainer()
            try container.encode(value)
        case .null:
            var container = encoder.singleValueContainer()
            try container.encodeNil()
        case .object(let value):
            var container = encoder.container(keyedBy: DynamicCodingKey.self)
            for (key, item) in value {
                guard let codingKey = DynamicCodingKey(stringValue: key) else { continue }
                try container.encode(item, forKey: codingKey)
            }
        case .array(let values):
            var container = encoder.unkeyedContainer()
            for value in values {
                try container.encode(value)
            }
        }
    }
}

private struct DynamicCodingKey: CodingKey {
    let stringValue: String
    init?(stringValue: String) {
        self.stringValue = stringValue
    }

    let intValue: Int? = nil
    init?(intValue: Int) {
        return nil
    }
}
