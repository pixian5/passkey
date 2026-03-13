import Foundation

#if canImport(AuthenticationServices)
import AuthenticationServices

enum CredentialIdentitySync {
    static func replaceCredentialIdentities(accounts: [PasswordAccount]) {
        guard #available(macOS 14.0, *) else { return }
        let identities = accounts
            .filter { !$0.isDeleted && !$0.username.isEmpty && !$0.password.isEmpty }
            .flatMap { account in
                account.sites.map { site -> ASPasswordCredentialIdentity in
                    let identifier = ASCredentialServiceIdentifier(
                        identifier: DomainUtils.normalize(site),
                        type: .domain
                    )
                    return ASPasswordCredentialIdentity(
                        serviceIdentifier: identifier,
                        user: account.username,
                        recordIdentifier: account.accountId
                    )
                }
            }

        ASCredentialIdentityStore.shared.replaceCredentialIdentities(identities) { _, _ in
        }
    }
}
#else
enum CredentialIdentitySync {
    static func replaceCredentialIdentities(accounts: [PasswordAccount]) {
    }
}
#endif
