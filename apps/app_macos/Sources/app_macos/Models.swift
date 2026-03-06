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
    var usernameUpdatedAtMs: Int64
    var passwordUpdatedAtMs: Int64
    var totpUpdatedAtMs: Int64
    var recoveryCodesUpdatedAtMs: Int64
    var noteUpdatedAtMs: Int64
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
            usernameUpdatedAtMs: nowMs,
            passwordUpdatedAtMs: nowMs,
            totpUpdatedAtMs: nowMs,
            recoveryCodesUpdatedAtMs: nowMs,
            noteUpdatedAtMs: nowMs,
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
}
