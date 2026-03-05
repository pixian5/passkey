import Foundation

struct PasswordAccount: Codable, Identifiable, Hashable {
    let id: UUID
    let accountId: String
    let canonicalSite: String
    let usernameAtCreate: String
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
}

enum AccountFactory {
    static func create(
        site: String,
        username: String,
        password: String,
        deviceName: String,
        createdAt: Date = Date()
    ) -> PasswordAccount {
        let normalizedSite = DomainUtils.normalize(site)
        let canonicalSite = DomainUtils.etldPlusOne(for: normalizedSite)
        let accountId = "\(canonicalSite)\(timestamp(createdAt))\(username)"
        let nowMs = Int64(createdAt.timeIntervalSince1970 * 1000)
        return PasswordAccount(
            id: UUID(),
            accountId: accountId,
            canonicalSite: canonicalSite,
            usernameAtCreate: username,
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
