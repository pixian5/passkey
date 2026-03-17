import Foundation

enum CredentialIdentitySync {
    static func replaceCredentialIdentities(accounts: [PasswordAccount]) {
        // Default desktop build keeps the plain app path lightweight.
        // Signed AutoFill integration is isolated in project.autofill.yml.
        _ = accounts
    }
}
