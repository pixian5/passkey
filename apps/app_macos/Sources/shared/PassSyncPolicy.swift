import Foundation

/// Cross-client sync policy constants. Keep numeric and string values aligned
/// with `core/pass_core/js/sync_policy.js`.
enum PassSyncPolicy {
    static let defaultDeviceName = "PassDevice"

    static let fixedNewAccountFolderName = "新账号"
    static let fixedNewAccountFolderId = UUID(uuidString: "F16A2C4E-4A2A-43D5-A670-3F1767D41001")!

    /// Multi-label public suffixes used by DomainUtils.etldPlusOne (not a full PSL).
    static let etld2Suffixes: Set<String> = [
        "com.cn",
        "net.cn",
        "org.cn",
        "gov.cn",
        "edu.cn",
        "co.uk",
        "org.uk",
        "ac.uk",
        "gov.uk",
        "com.au",
        "net.au",
        "org.au",
        "com.br",
        "com.mx",
        "co.jp",
        "or.jp",
        "ne.jp",
        "co.kr",
        "co.in",
        "com.hk",
        "com.tw",
        "com.sg",
        "co.nz",
        "org.nz",
        "com.ar",
        "com.tr",
        "co.za",
        "com.ua",
    ]

    static let syncOutboxMaxAttempts = 12
    static let syncOutboxBaseDelaySeconds = 5
    static let syncOutboxMaxDelaySeconds = 60 * 60
    static let syncPushConflictMaxAttempts = 3

    static func syncOutboxRetryDelaySeconds(attempts: Int) -> Int {
        let exponent = max(0, min(attempts - 1, 8))
        let delay = syncOutboxBaseDelaySeconds * (1 << exponent)
        return min(syncOutboxMaxDelaySeconds, delay)
    }

    static func normalizeDeviceName(_ value: String?) -> String {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? defaultDeviceName : trimmed
    }
}
