import Foundation

final class PassSharedAccountRepository {
    private let decoder = JSONDecoder()
    private lazy var sqliteStore = LocalSQLiteStore(databaseURL: PassSharedData.databaseURL())

    func loadAccounts() -> [PasswordAccount] {
        PassSharedData.migrateLegacyStoreToSharedContainerIfNeeded()

        if let data = try? sqliteStore.readData(for: "accounts"),
           let decoded = try? decoder.decode([PasswordAccount].self, from: data) {
            return decoded
        }

        let legacyURL = PassSharedData.accountsLegacyJSONURL()
        guard let data = try? Data(contentsOf: legacyURL),
              let decoded = try? decoder.decode([PasswordAccount].self, from: data) else {
            return []
        }
        return decoded
    }

    func account(recordIdentifier: String?) -> PasswordAccount? {
        let normalized = String(recordIdentifier ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return nil }
        return loadAccounts().first { $0.accountId == normalized }
    }

    func matchingAccounts(domains: [String]) -> [PasswordAccount] {
        let normalizedDomains = Set(domains.map(DomainUtils.normalize).filter { !$0.isEmpty })
        let accounts = loadAccounts()
            .filter { !$0.isDeleted && !$0.username.isEmpty && !$0.password.isEmpty }

        guard !normalizedDomains.isEmpty else {
            return accounts.sorted { lhs, rhs in
                if lhs.updatedAtMs != rhs.updatedAtMs {
                    return lhs.updatedAtMs > rhs.updatedAtMs
                }
                return lhs.accountId < rhs.accountId
            }
        }

        let filtered = accounts.filter { account in
            account.sites.contains { site in
                normalizedDomains.contains(where: { DomainUtils.isSameSite(site, $0) || DomainUtils.normalize(site) == $0 })
            }
        }
        return filtered.sorted { lhs, rhs in
            if lhs.updatedAtMs != rhs.updatedAtMs {
                return lhs.updatedAtMs > rhs.updatedAtMs
            }
            return lhs.accountId < rhs.accountId
        }
    }
}
