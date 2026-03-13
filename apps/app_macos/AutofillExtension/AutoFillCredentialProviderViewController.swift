import AuthenticationServices
import SwiftUI

final class AutoFillCredentialProviderViewController: ASCredentialProviderViewController {
    private let repository = PassSharedAccountRepository()
    private var hostingController: NSHostingController<AutoFillCredentialListView>?
    private var domains: [String] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        configureHostingIfNeeded()
        renderCandidates()
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        domains = serviceIdentifiers.compactMap(resolveDomain(from:))
        renderCandidates()
    }

    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        if let account = repository.account(recordIdentifier: credentialIdentity.recordIdentifier) {
            complete(with: account)
            return
        }
        domains = [resolveDomain(from: credentialIdentity.serviceIdentifier)].compactMap { $0 }
        renderCandidates()
    }

    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        guard let account = repository.account(recordIdentifier: credentialIdentity.recordIdentifier) else {
            let error = NSError(
                domain: ASExtensionErrorDomain,
                code: ASExtensionError.userInteractionRequired.rawValue
            )
            extensionContext.cancelRequest(withError: error)
            return
        }
        complete(with: account)
    }

    private func configureHostingIfNeeded() {
        guard hostingController == nil else { return }
        let controller = NSHostingController(
            rootView: AutoFillCredentialListView(
                accounts: [],
                onSelect: { [weak self] account in
                    self?.complete(with: account)
                },
                onCancel: { [weak self] in
                    self?.cancel()
                }
            )
        )
        hostingController = controller
        addChild(controller)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: view.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    private func renderCandidates() {
        configureHostingIfNeeded()
        let accounts = repository.matchingAccounts(domains: domains)
        hostingController?.rootView = AutoFillCredentialListView(
            accounts: accounts,
            onSelect: { [weak self] account in
                self?.complete(with: account)
            },
            onCancel: { [weak self] in
                self?.cancel()
            }
        )
    }

    private func complete(with account: PasswordAccount) {
        let credential = ASPasswordCredential(user: account.username, password: account.password)
        extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
    }

    private func cancel() {
        let error = NSError(
            domain: ASExtensionErrorDomain,
            code: ASExtensionError.userCanceled.rawValue
        )
        extensionContext.cancelRequest(withError: error)
    }

    private func resolveDomain(from identifier: ASCredentialServiceIdentifier) -> String? {
        switch identifier.type {
        case .domain:
            return DomainUtils.normalize(identifier.identifier)
        case .URL:
            return DomainUtils.normalize(URL(string: identifier.identifier)?.host ?? identifier.identifier)
        case .app:
            return nil
        @unknown default:
            return DomainUtils.normalize(identifier.identifier)
        }
    }
}

private struct AutoFillCredentialListView: View {
    let accounts: [PasswordAccount]
    let onSelect: (PasswordAccount) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Pass 自动填充")
                    .font(.system(size: 18, weight: .semibold))
                Spacer()
                Button("取消", action: onCancel)
            }

            if accounts.isEmpty {
                Text("没有找到可自动填充的账号。")
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                List(accounts, id: \.accountId) { account in
                    Button {
                        onSelect(account)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(account.username)
                                .font(.system(size: 14, weight: .semibold))
                            Text(account.sites.joined(separator: "  "))
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.inset)
            }
        }
        .padding(16)
        .frame(minWidth: 420, minHeight: 320)
    }
}
