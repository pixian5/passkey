import AppKit
import SwiftUI
import UniformTypeIdentifiers

private enum AccountSidebarFilter: Hashable {
    case all
    case passkeys
    case totp
    case recycle
    case folder(UUID)

    var pinScopeKey: String {
        switch self {
        case .all:
            return "all"
        case .passkeys:
            return "passkeys"
        case .totp:
            return "totp"
        case .recycle:
            return "recycle"
        case let .folder(folderId):
            return "folder:\(folderId.uuidString.lowercased())"
        }
    }

    var pinScopeLabel: String {
        switch self {
        case .all:
            return "全部"
        case .passkeys:
            return "通行密钥"
        case .totp:
            return "验证码"
        case .recycle:
            return "回收站"
        case .folder:
            return "当前文件夹"
        }
    }
}

private enum AccountSearchField: CaseIterable, Hashable {
    case username
    case sites
    case note
    case password

    var title: String {
        switch self {
        case .username:
            return "用户名"
        case .sites:
            return "站点别名"
        case .note:
            return "备注"
        case .password:
            return "密码"
        }
    }
}

struct ContentView: View {
    @ObservedObject var store: AccountStore
    @Environment(\.openWindow) private var openWindow
    @State private var selectedSidebarFilter: AccountSidebarFilter = .all
    @State private var accountSearchText: String = ""
    @State private var useAllSearchFields: Bool = true
    @State private var selectedSearchFields: Set<AccountSearchField> = []
    @State private var showSearchFieldPopover: Bool = false
    @State private var selectedAccountIds: Set<UUID> = []
    @State private var selectionAnchorAccountId: UUID?
    @State private var showCreateFolderSheet: Bool = false
    @State private var newFolderName: String = ""
    @State private var showMoveToFolderSheet: Bool = false
    @State private var showAddSitesToFolderSheet: Bool = false
    @State private var showFolderDedupSheet: Bool = false
    @State private var addSitesTargetFolderId: UUID?
    @State private var dedupTargetFolderId: UUID?
    @State private var addSitesText: String = ""
    @State private var addSitesAutoAddEnabled: Bool = true
    @State private var pendingMoveAccountIds: [UUID] = []
    @State private var moveFolderCheckedIds: Set<UUID> = []
    @State private var showHistoryPopup: Bool = false
    @State private var draggingAccountIds: [UUID] = []
    @State private var localKeyDownMonitor: Any?

    var body: some View {
        let allAccounts = store.accounts
        let activeAccounts = allAccounts.filter { !$0.isDeleted }
        let deletedAccounts = allAccounts.filter(\.isDeleted)
        let passkeyAccounts = activeAccounts.filter(accountHasPasskey)
        let totpAccounts = activeAccounts.filter { !$0.totpSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let accounts = filteredAccounts(from: allAccounts)
        let editingAccount = store.accountForEditing()
        let isEditingAccount = editingAccount != nil

        return ZStack {
            HStack(spacing: 0) {
                sidebar(
                    activeCount: activeAccounts.count,
                    passkeyCount: passkeyAccounts.count,
                    totpCount: totpAccounts.count,
                    recycleCount: deletedAccounts.count
                )
                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Button {
                            showSearchFieldPopover.toggle()
                        } label: {
                            Image(systemName: "line.3.horizontal.decrease.circle")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("设置搜索字段")
                        .popover(isPresented: $showSearchFieldPopover, arrowEdge: .bottom) {
                            searchFieldPopover
                        }

                        TextField(searchPlaceholder, text: $accountSearchText)
                            .textFieldStyle(.plain)
                            .font(store.textFont(size: store.scaledTextSize(15)))
                        if !accountSearchText.isEmpty {
                            Button {
                                accountSearchText = ""
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.secondary.opacity(0.11))
                    )

                    if accounts.isEmpty {
                        Text("暂无账号")
                            .foregroundStyle(.secondary)
                    } else {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 6) {
                                ForEach(accounts) { account in
                                    accountRow(account)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 8)
                                        .background(
                                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                                .fill(
                                                    selectedAccountIds.contains(account.id)
                                                        ? Color.accentColor.opacity(0.18)
                                                        : Color.clear
                                                )
                                        )
                                        .overlay {
                                            SecondaryClickSelectionCatcher {
                                                _ = adoptContextMenuSelection(for: account.id)
                                            }
                                        }
                                        .contentShape(Rectangle())
                                        .onTapGesture {
                                            handleAccountRowTap(
                                                account.id,
                                                orderedAccountIds: accounts.map(\.id)
                                            )
                                        }
                                        .applyIf(!isEditingAccount) { view in
                                            view
                                                .onDrag {
                                                    beginDragging(account.id, orderedAccountIds: accounts.map(\.id))
                                                    return NSItemProvider(object: account.id.uuidString as NSString)
                                                }
                                                .onDrop(of: [UTType.text], isTargeted: nil) { _ in
                                                    return handleAccountReorderDrop(targetAccountId: account.id)
                                                }
                                        }
                                        .contextMenu {
                                            Button("编辑") {
                                                selectOnlyAccountIfNoMultiModifier(account.id)
                                                store.beginEditing(account)
                                            }

                                            Divider()

                                            if !account.isDeleted {
                                                let targetIds = contextMenuTargetAccountIds(for: account.id)
                                                let targetCount = targetIds.count

                                                Button(store.accountIsPinned(account, scopeKey: selectedSidebarFilter.pinScopeKey) ? "取消置顶" : "置顶") {
                                                    selectOnlyAccountIfNoMultiModifier(account.id)
                                                    store.togglePin(
                                                        for: account,
                                                        scopeKey: selectedSidebarFilter.pinScopeKey,
                                                        scopeLabel: scopeLabel(for: selectedSidebarFilter)
                                                    )
                                                }

                                                Button("放入文件夹") {
                                                    prepareMoveToFolder(from: account.id)
                                                }
                                                .disabled(store.folders.isEmpty)

                                                Divider()

                                                Button(targetCount > 1 ? "删除选中账号 (\(targetCount))" : "删除", role: .destructive) {
                                                    let ids = adoptContextMenuSelection(for: account.id)
                                                    if ids.count > 1 {
                                                        store.moveToRecycleBin(accountIds: ids)
                                                    } else {
                                                        store.moveToRecycleBin(for: account)
                                                    }
                                                }
                                            } else {
                                                let targetIds = contextMenuTargetAccountIds(for: account.id)
                                                let targetCount = targetIds.count

                                                Button(targetCount > 1 ? "恢复选中账号 (\(targetCount))" : "恢复账号") {
                                                    let ids = adoptContextMenuSelection(for: account.id)
                                                    if ids.count > 1 {
                                                        store.restoreFromRecycleBin(accountIds: ids)
                                                    } else {
                                                        store.restoreFromRecycleBin(for: account)
                                                    }
                                                }
                                                Button(targetCount > 1 ? "永久删除选中账号 (\(targetCount))" : "永久删除", role: .destructive) {
                                                    let ids = adoptContextMenuSelection(for: account.id)
                                                    if ids.count > 1 {
                                                        store.permanentlyDeleteFromRecycleBin(accountIds: ids)
                                                    } else {
                                                        store.permanentlyDeleteFromRecycleBin(account)
                                                    }
                                                }
                                            }
                                        }
                                }
                            }
                        }
                        .allowsHitTesting(!isEditingAccount)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(16)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .frame(minWidth: 1180, minHeight: 700, alignment: .topLeading)
            .onAppear {
                installLocalKeyDownMonitor()
            }
            .onDisappear {
                removeLocalKeyDownMonitor()
            }
            .onChange(of: selectedSidebarFilter) { _ in
                selectedAccountIds.removeAll()
                selectionAnchorAccountId = nil
            }
            .onChange(of: store.selectAllAccountsSignal) { _ in
                selectAllVisibleAccounts()
            }
            .onChange(of: accounts.map(\.id)) { ids in
                selectedAccountIds = selectedAccountIds.intersection(Set(ids))
                if let anchor = selectionAnchorAccountId, !ids.contains(anchor) {
                    selectionAnchorAccountId = selectedAccountIds.first
                }
            }
            .sheet(isPresented: $showCreateFolderSheet) {
                createFolderSheet
            }

            if showAddSitesToFolderSheet {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showAddSitesToFolderSheet = false
                    }

                addSitesToFolderSheet
                    .padding(26)
            }

            if showMoveToFolderSheet {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showMoveToFolderSheet = false
                    }

                moveToFolderSheet
                    .padding(26)
            }

            if showFolderDedupSheet {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showFolderDedupSheet = false
                    }

                folderDedupSheet
                    .padding(26)
            }

            if showHistoryPopup {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showHistoryPopup = false
                    }
                    .zIndex(2)

                HistoryPopup(
                    store: store,
                    accountId: editingAccount?.accountId
                ) {
                    showHistoryPopup = false
                }
                .padding(26)
                .zIndex(2)
            }

            if let editingAccount {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .onTapGesture {
                        store.cancelEditing()
                    }
                    .zIndex(1)

                AccountEditPopup(
                    store: store,
                    editingAccount: editingAccount,
                    showHistoryPopup: $showHistoryPopup
                )
                .padding(26)
                .zIndex(1)
            }

        }
        .onChange(of: isEditingAccount) { editing in
            if !editing {
                showHistoryPopup = false
            }
        }
    }

    private func sidebar(
        activeCount: Int,
        passkeyCount: Int,
        totpCount: Int,
        recycleCount: Int
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sidebarItem(title: "全部 (\(activeCount))", selected: selectedSidebarFilter == .all) {
                selectedSidebarFilter = .all
            }
            .contextMenu {
                Button("新建账号") {
                    openWindow(id: "create-account")
                }
            }
            sidebarItem(title: "通行密钥 (\(passkeyCount))", selected: selectedSidebarFilter == .passkeys) {
                selectedSidebarFilter = .passkeys
            }
            .contextMenu {
                Button("新建账号") {
                    openWindow(id: "create-account")
                }
            }
            sidebarItem(title: "验证码 (\(totpCount))", selected: selectedSidebarFilter == .totp) {
                selectedSidebarFilter = .totp
            }
            .contextMenu {
                Button("新建账号") {
                    openWindow(id: "create-account")
                }
            }
            sidebarItem(title: "回收站 (\(recycleCount))", selected: selectedSidebarFilter == .recycle) {
                selectedSidebarFilter = .recycle
            }
            .contextMenu {
                Button("清空回收站", role: .destructive) {
                    confirmAndClearRecycleBin()
                }
                .disabled(recycleCount == 0)
            }

            Divider()

            HStack {
                Text("文件夹 (\(store.folders.count))")
                .font(store.textFont(size: store.scaledTextSize(13), weight: .semibold))
                Spacer()
                Button("新建") {
                    newFolderName = ""
                    showCreateFolderSheet = true
                }
                .font(store.buttonFont(size: max(12, CGFloat(store.uiButtonFontSize - 4))))
                .buttonStyle(.bordered)
            }
            .contentShape(Rectangle())
            .contextMenu {
                Button("新建账号") {
                    openWindow(id: "create-account")
                }
            }

            if store.folders.isEmpty {
                Text("暂无文件夹")
                    .font(store.textFont(size: store.scaledTextSize(12)))
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(store.folders) { folder in
                            sidebarItem(
                                title: "\(folder.name) (\(activeFolderAccountCount(folder.id)))",
                                selected: selectedSidebarFilter == .folder(folder.id)
                            ) {
                                selectedSidebarFilter = .folder(folder.id)
                            }
                            .onDrop(of: [UTType.text], isTargeted: nil) { _ in
                                handleDropToFolder(folder.id)
                            }
                            .contextMenu {
                                Button("加入指定网站全部账号") {
                                    addSitesTargetFolderId = folder.id
                                    addSitesText = store.folderRuleSites(for: folder.id).joined(separator: "\n")
                                    addSitesAutoAddEnabled = store.folderRuleSites(for: folder.id).isEmpty
                                        ? true
                                        : store.folderRuleAutoAddEnabled(for: folder.id)
                                    showAddSitesToFolderSheet = true
                                }

                                Button("文件夹内去重") {
                                    dedupTargetFolderId = folder.id
                                    showFolderDedupSheet = true
                                }

                                if folder.id == AccountStore.fixedNewAccountFolderId {
                                    Divider()
                                    Button("固定文件夹不可删除") {}
                                        .disabled(true)
                                } else {
                                    Divider()
                                    Button("删除文件夹", role: .destructive) {
                                        if selectedSidebarFilter == .folder(folder.id) {
                                            selectedSidebarFilter = .all
                                        }
                                        store.deleteFolder(id: folder.id)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer()
        }
        .padding(12)
        .frame(width: 220, alignment: .topLeading)
    }

    private func sidebarItem(title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(store.textFont(size: store.scaledTextSize(14), weight: selected ? .semibold : .regular))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(selected ? Color.accentColor.opacity(0.18) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .overlay {
            SecondaryClickSelectionCatcher {
                action()
            }
        }
    }

    private func accountRow(_ account: PasswordAccount) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button {
                    selectOnlyAccountIfNoMultiModifier(account.id)
                    store.beginEditing(account)
                } label: {
                    Text(account.accountId)
                        .font(store.textFont(size: store.scaledTextSize(17), weight: .semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .foregroundStyle(.primary)
                }
                .buttonStyle(.plain)
                .help("点击打开编辑")
                if store.accountIsPinned(account, scopeKey: selectedSidebarFilter.pinScopeKey) {
                    Image(systemName: "pin.fill")
                        .font(store.textFont(size: store.scaledTextSize(12)))
                        .foregroundStyle(.orange)
                }
                if account.isDeleted {
                    Text("已删除")
                        .font(store.textFont(size: store.scaledTextSize(11)))
                        .foregroundStyle(.red)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.red.opacity(0.12))
                        .clipShape(Capsule())
                }
            }

            Button {
                selectOnlyAccountIfNoMultiModifier(account.id)
                copyToPasteboard(account.username, successMessage: "用户名已复制")
            } label: {
                Text("用户名: \(account.username)")
                    .font(store.textFont(size: store.scaledTextSize(15)))
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .help("点击复制用户名")

            Button {
                selectOnlyAccountIfNoMultiModifier(account.id)
                copyToPasteboard(account.sites.joined(separator: "\n"), successMessage: "站点别名已复制")
            } label: {
                Text("站点别名: \(account.sites.joined(separator: "  "))")
                    .font(store.textFont(size: store.scaledTextSize(12)))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .help("点击复制站点别名")

            if let passkeySummary = passkeySummaryText(for: account) {
                Text(passkeySummary)
                    .font(store.textFont(size: store.scaledTextSize(12)))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            let secret = account.totpSecret.trimmingCharacters(in: .whitespacesAndNewlines)
            if !secret.isEmpty {
                TotpRowView(
                    store: store,
                    account: account,
                    onSelect: { selectOnlyAccountIfNoMultiModifier(account.id) },
                    onCopy: { code in
                        copyTotpCode(code)
                    }
                )
            }
        }
        .padding(.vertical, 4)
        .textSelection(.enabled)
    }

    private func filteredAccounts(from allAccounts: [PasswordAccount]) -> [PasswordAccount] {
        let scopedAccounts: [PasswordAccount]
        switch selectedSidebarFilter {
        case .all:
            scopedAccounts = allAccounts.filter { !$0.isDeleted }
        case .passkeys:
            scopedAccounts = allAccounts.filter {
                !$0.isDeleted && accountHasPasskey($0)
            }
        case .totp:
            scopedAccounts = allAccounts.filter {
                !$0.isDeleted && !$0.totpSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
        case .recycle:
            scopedAccounts = allAccounts.filter(\.isDeleted)
        case .folder(let folderId):
            scopedAccounts = allAccounts.filter { !$0.isDeleted && $0.isInFolder(folderId) }
        }
        let sortedScoped = store.displaySortedAccounts(scopedAccounts, scopeKey: selectedSidebarFilter.pinScopeKey)

        let query = accountSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty {
            return sortedScoped
        }

        return sortedScoped.filter { account in
            accountMatchesSearch(account, query: query)
        }
    }

    private var searchPlaceholder: String {
        switch selectedSidebarFilter {
        case .all:
            return "搜索全部账号（输入即搜）"
        case .passkeys:
            return "搜索通行密钥账号（输入即搜）"
        case .totp:
            return "搜索验证码账号（输入即搜）"
        case .recycle:
            return "搜索回收站账号（输入即搜）"
        case .folder:
            return "搜索当前文件夹账号（输入即搜）"
        }
    }

    private func accountMatchesSearch(_ account: PasswordAccount, query: String) -> Bool {
        let needle = query.lowercased()
        if needle.isEmpty {
            return true
        }

        var haystacks: [String] = []
        if useAllSearchFields || selectedSearchFields.contains(.username) {
            haystacks.append(account.username)
            haystacks.append(account.usernameAtCreate)
        }
        if useAllSearchFields || selectedSearchFields.contains(.sites) {
            haystacks.append(account.sites.joined(separator: " "))
            haystacks.append(account.canonicalSite)
        }
        if useAllSearchFields || selectedSearchFields.contains(.note) {
            haystacks.append(account.note)
        }
        if useAllSearchFields || selectedSearchFields.contains(.password) {
            haystacks.append(account.password)
        }
        if haystacks.isEmpty {
            return false
        }

        return haystacks.contains { value in
            value.lowercased().contains(needle)
        }
    }

    private var searchFieldPopover: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(
                "全部",
                isOn: Binding(
                    get: { useAllSearchFields },
                    set: { enabled in
                        if enabled {
                            useAllSearchFields = true
                            selectedSearchFields = []
                        } else {
                            useAllSearchFields = false
                        }
                    }
                )
            )
            .toggleStyle(.checkbox)
            .font(store.textFont(size: store.scaledTextSize(13), weight: .semibold))

            Divider()

            ForEach(AccountSearchField.allCases, id: \.self) { field in
                Toggle(
                    field.title,
                    isOn: Binding(
                        get: { selectedSearchFields.contains(field) },
                        set: { enabled in
                            if enabled {
                                useAllSearchFields = false
                                selectedSearchFields.insert(field)
                            } else {
                                selectedSearchFields.remove(field)
                            }
                        }
                    )
                )
                .toggleStyle(.checkbox)
                .font(store.textFont(size: store.scaledTextSize(13)))
            }
        }
        .padding(14)
        .frame(width: 220, alignment: .leading)
    }

    private func accountHasPasskey(_ account: PasswordAccount) -> Bool {
        if !account.passkeyCredentialIds.isEmpty {
            return true
        }
        return matchedPasskeys(for: account).first != nil
    }

    private func passkeySummaryText(for account: PasswordAccount) -> String? {
        guard accountHasPasskey(account) else { return nil }
        if let passkey = matchedPasskeys(for: account).first {
            return "通行密钥 RP ID: \(passkey.rpId) 用户名: \(passkey.userName)"
        }

        let fallbackRpId = DomainUtils.normalize(account.sites.first ?? account.canonicalSite)
        let fallbackUserName = account.username.trimmingCharacters(in: .whitespacesAndNewlines)
        return "通行密钥 RP ID: \(fallbackRpId.isEmpty ? "-" : fallbackRpId) 用户名: \(fallbackUserName)"
    }

    private func matchedPasskeys(for account: PasswordAccount) -> [PasskeyRecord] {
        let linkedIds = Set(
            account.passkeyCredentialIds
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        )

        let byLinkedIds = store.passkeys.filter { passkey in
            linkedIds.contains(passkey.credentialIdB64u.trimmingCharacters(in: .whitespacesAndNewlines))
        }

        if !byLinkedIds.isEmpty {
            return byLinkedIds.sorted { lhs, rhs in
                if lhs.updatedAtMs != rhs.updatedAtMs {
                    return lhs.updatedAtMs > rhs.updatedAtMs
                }
                return lhs.credentialIdB64u < rhs.credentialIdB64u
            }
        }

        let username = account.username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !username.isEmpty else { return [] }

        let accountSites = Set(account.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
        guard !accountSites.isEmpty else { return [] }
        let accountEtld1 = Set(accountSites.map { DomainUtils.etldPlusOne(for: $0) }.filter { !$0.isEmpty })

        let fallbackMatched = store.passkeys.filter { passkey in
            let passkeyUsername = passkey.userName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard passkeyUsername == username else { return false }
            let passkeyRpId = DomainUtils.normalize(passkey.rpId)
            guard !passkeyRpId.isEmpty else { return false }
            if accountSites.contains(passkeyRpId) {
                return true
            }
            let passkeyEtld1 = DomainUtils.etldPlusOne(for: passkeyRpId)
            return !passkeyEtld1.isEmpty && accountEtld1.contains(passkeyEtld1)
        }

        return fallbackMatched.sorted { lhs, rhs in
            if lhs.updatedAtMs != rhs.updatedAtMs {
                return lhs.updatedAtMs > rhs.updatedAtMs
            }
            return lhs.credentialIdB64u < rhs.credentialIdB64u
        }
    }

    private func prepareMoveToFolder(from contextAccountId: UUID) {
        if store.folders.isEmpty {
            store.statusMessage = "请先创建文件夹"
            return
        }

        var ids = selectedAccountIds
        if !ids.contains(contextAccountId) {
            ids = [contextAccountId]
            selectedAccountIds = ids
        }
        guard !ids.isEmpty else {
            store.statusMessage = "未选择账号"
            return
        }

        pendingMoveAccountIds = Array(ids)
        moveFolderCheckedIds = Set(
            store.checkedFolderIdsForAccounts(accountIds: pendingMoveAccountIds)
        )
        showMoveToFolderSheet = true
    }

    private var createFolderSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("新建文件夹")
                .font(store.textFont(size: store.scaledTextSize(17), weight: .semibold))
            TextField("文件夹名称", text: $newFolderName)
                .textFieldStyle(.roundedBorder)

            HStack {
                Spacer()
                Button("取消") {
                    showCreateFolderSheet = false
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)

                Button("创建") {
                    store.createFolder(named: newFolderName)
                    showCreateFolderSheet = false
                }
                .font(store.buttonFont())
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 420)
    }

    private var addSitesToFolderSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("指定网站全部账号")
                .font(store.textFont(size: store.scaledTextSize(18), weight: .semibold))

            Text("每行输入一个站点，系统会把“全部账号”里包含这些站点别名的账号全部加入当前文件夹。")
                .font(store.textFont(size: store.scaledTextSize(12)))
                .foregroundStyle(.secondary)

            TextEditor(text: $addSitesText)
                .font(store.textFont(size: store.scaledTextSize(13)))
                .frame(width: 420, height: 180)
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color(NSColor.textBackgroundColor))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
                )

            Toggle("后续自动加入", isOn: $addSitesAutoAddEnabled)
                .font(store.textFont(size: store.scaledTextSize(13)))

            HStack {
                Spacer()
                Button("取消") {
                    showAddSitesToFolderSheet = false
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)

                Button("加入文件夹") {
                    guard let folderId = addSitesTargetFolderId else {
                        showAddSitesToFolderSheet = false
                        return
                    }
                    let lines = addSitesText
                        .split(whereSeparator: \.isNewline)
                        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
                    store.configureFolderSiteRules(
                        folderId: folderId,
                        siteInputs: lines,
                        autoAdd: addSitesAutoAddEnabled
                    )
                    showAddSitesToFolderSheet = false
                }
                .font(store.buttonFont())
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(width: 500)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
        .shadow(radius: 18)
    }

    private var moveToFolderSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("放入文件夹")
                .font(store.textFont(size: store.scaledTextSize(17), weight: .semibold))
            Text("已选账号: \(pendingMoveAccountIds.count) 个")
                .font(store.textFont(size: store.scaledTextSize(12)))
                .foregroundStyle(.secondary)

            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(store.folders) { folder in
                        let checked = moveFolderCheckedIds.contains(folder.id)
                        Button {
                            if checked {
                                moveFolderCheckedIds.remove(folder.id)
                            } else {
                                moveFolderCheckedIds.insert(folder.id)
                            }
                            store.applyFolderSelection(
                                accountIds: pendingMoveAccountIds,
                                checkedFolderIds: Array(moveFolderCheckedIds)
                            )
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: checked ? "checkmark.square.fill" : "square")
                                    .foregroundStyle(checked ? Color.accentColor : Color.secondary)
                                Text(folder.name)
                                    .font(store.textFont(size: store.scaledTextSize(15)))
                                Spacer()
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(Color.secondary.opacity(0.08))
                        )
                    }
                }
            }
            .frame(minHeight: 220)

            HStack {
                Spacer()
                Button("关闭") {
                    showMoveToFolderSheet = false
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
            }
        }
        .padding(18)
        .frame(width: 500)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
        .shadow(radius: 18)
    }

    private var folderDedupGroups: [FolderDuplicateAccountGroup] {
        guard let dedupTargetFolderId else { return [] }
        return store.duplicateAccountGroups(inFolder: dedupTargetFolderId)
    }

    private var folderDedupSheet: some View {
        let folderName = dedupTargetFolderId.map(store.folderName(for:)) ?? "文件夹"
        let groups = folderDedupGroups

        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(folderName) 内去重")
                        .font(store.textFont(size: store.scaledTextSize(18), weight: .semibold))
                }
                Spacer()
                Button("关闭") {
                    showFolderDedupSheet = false
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
            }

            Text("按站点别名和用户名分组，组内已按最新账号在上方排序。")
                .font(store.textFont(size: store.scaledTextSize(12)))
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                Button("保留全部最新账号") {
                    guard let dedupTargetFolderId else { return }
                    store.keepLatestDuplicateAccounts(inFolder: dedupTargetFolderId)
                }
                .font(store.buttonFont())
                .buttonStyle(.borderedProminent)
                .disabled(groups.isEmpty)

                Button("保留全部最早账号") {
                    guard let dedupTargetFolderId else { return }
                    store.keepEarliestDuplicateAccounts(inFolder: dedupTargetFolderId)
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
                .disabled(groups.isEmpty)

                Spacer()

                Text("重复组: \(groups.count)")
                    .font(store.textFont(size: store.scaledTextSize(12)))
                    .foregroundStyle(.secondary)
            }

            if groups.isEmpty {
                VStack(alignment: .center, spacing: 10) {
                    Text("当前文件夹暂无重复账号")
                        .font(store.textFont(size: store.scaledTextSize(16), weight: .semibold))
                    Text("这里会把站点别名和用户名都相同的账号放在同一组。")
                        .font(store.textFont(size: store.scaledTextSize(12)))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 260)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(groups) { group in
                            dedupGroupCard(group)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.regularMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(Color.secondary.opacity(0.18), lineWidth: 1)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                .frame(minHeight: 360)
            }
        }
        .padding(18)
        .frame(width: 860)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
        .shadow(radius: 18)
    }

    @ViewBuilder
    private func dedupGroupCard(_ group: FolderDuplicateAccountGroup) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    copyToPasteboard(group.siteAliases.joined(separator: "\n"), successMessage: "站点别名已复制")
                } label: {
                    Text(group.siteAliases.joined(separator: ", "))
                        .font(store.textFont(size: store.scaledTextSize(15), weight: .semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)

                HStack(spacing: 4) {
                    Text("用户名：")
                    Button {
                        copyToPasteboard(group.usernameDisplay, successMessage: "用户名已复制")
                    } label: {
                        Text(group.usernameDisplay)
                    }
                    .buttonStyle(.plain)
                    Text("· \(group.accounts.count) 个账号")
                }
                .font(store.textFont(size: store.scaledTextSize(12)))
                .foregroundStyle(.secondary)
            }

            ForEach(Array(group.accounts.enumerated()), id: \.element.id) { index, account in
                dedupAccountCard(group: group, index: index, account: account)
            }
        }
    }

    @ViewBuilder
    private func dedupAccountCard(group: FolderDuplicateAccountGroup, index: Int, account: PasswordAccount) -> some View {
        let passwordValue = dedupCopyValue(account.password)
        let totpCode = store.currentTotpCode(for: account)
        let siteAliasesCopyValue = account.sites
            .map(DomainUtils.normalize)
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        let siteAliasesText = account.sites.joined(separator: ", ")

        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Button {
                    store.beginEditing(account)
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(account.accountId)
                            .font(store.textFont(size: store.scaledTextSize(13), weight: .medium))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if let passwordValue {
                    dedupCopyLine(
                        label: "密码",
                        value: passwordValue,
                        successMessage: "密码已复制",
                        primary: true
                    )
                }

                if let totpCode {
                    dedupCopyLine(
                        label: "TOTP",
                        value: formattedTotpCode(totpCode),
                        copyValue: totpCode,
                        successMessage: "验证码已复制",
                        primary: true
                    )
                }

                Text("更新时间：\(store.displayTime(account.updatedAtMs))")
                    .font(store.textFont(size: store.scaledTextSize(12)))
                    .foregroundStyle(.secondary)
                Text("创建时间：\(store.displayTime(account.createdAtMs))")
                    .font(store.textFont(size: store.scaledTextSize(12)))
                    .foregroundStyle(.secondary)
                if !siteAliasesCopyValue.isEmpty {
                    dedupCopyLine(
                        label: "站点别名",
                        value: siteAliasesText,
                        copyValue: siteAliasesCopyValue,
                        successMessage: "站点别名已复制",
                        primary: false
                    )
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 8) {
                if index == 0 {
                    Text("最新")
                        .font(store.textFont(size: store.scaledTextSize(11), weight: .semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.accentColor.opacity(0.14))
                        .clipShape(Capsule())
                } else if index == group.accounts.count - 1 {
                    Text("最早")
                        .font(store.textFont(size: store.scaledTextSize(11), weight: .semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.secondary.opacity(0.14))
                        .clipShape(Capsule())
                }

                Button("仅保留此账号") {
                    guard let dedupTargetFolderId else { return }
                    store.keepOnlyDuplicateAccount(inFolder: dedupTargetFolderId, accountIdToKeep: account.id)
                }
                .font(store.buttonFont(size: max(12, CGFloat(store.uiButtonFontSize - 3))))
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.black.opacity(0.06), lineWidth: 1)
        }
    }

    @ViewBuilder
    private func dedupCopyLine(
        label: String,
        value: String,
        copyValue: String? = nil,
        successMessage: String,
        primary: Bool
    ) -> some View {
        HStack(spacing: 4) {
            Text("\(label)：")
            Button {
                copyToPasteboard(copyValue ?? value, successMessage: successMessage)
            } label: {
                Text(value)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
        }
        .font(store.textFont(size: store.scaledTextSize(12)))
        .foregroundStyle(primary ? Color.primary : Color.secondary)
    }

    private func dedupCopyValue(_ value: String) -> String? {
        let normalized = value
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.isEmpty ? nil : normalized
    }

    private func activeFolderAccountCount(_ folderId: UUID) -> Int {
        store.accounts.filter { !$0.isDeleted && $0.isInFolder(folderId) }.count
    }

    private func beginDragging(_ accountId: UUID, orderedAccountIds _: [UUID]) {
        guard store.accountForEditing() == nil else {
            draggingAccountIds = []
            return
        }
        if !selectedAccountIds.contains(accountId) {
            selectedAccountIds = [accountId]
            selectionAnchorAccountId = accountId
        }
        draggingAccountIds = Array(selectedAccountIds)
        if draggingAccountIds.isEmpty {
            draggingAccountIds = [accountId]
        }
    }

    private func handleAccountReorderDrop(targetAccountId: UUID) -> Bool {
        guard store.accountForEditing() == nil else {
            draggingAccountIds = []
            return false
        }
        guard let sourceAccountId = draggingAccountIds.first else {
            return false
        }
        draggingAccountIds = []
        guard sourceAccountId != targetAccountId else {
            return false
        }
        store.moveAccountBefore(
            sourceId: sourceAccountId,
            targetId: targetAccountId,
            scopeKey: selectedSidebarFilter.pinScopeKey
        )
        return true
    }

    private func scopeLabel(for filter: AccountSidebarFilter) -> String {
        switch filter {
        case let .folder(folderId):
            return store.folderName(for: folderId)
        default:
            return filter.pinScopeLabel
        }
    }

    private func handleDropToFolder(_ folderId: UUID) -> Bool {
        guard store.accountForEditing() == nil else {
            draggingAccountIds = []
            return false
        }
        guard !draggingAccountIds.isEmpty else {
            return false
        }
        let ids = draggingAccountIds
        draggingAccountIds = []
        store.addAccountsToFolder(accountIds: ids, folderId: folderId)
        return true
    }

    private func formattedTotpCode(_ code: String) -> String {
        guard code.count == 6 else { return code }
        let prefix = code.prefix(3)
        let suffix = code.suffix(3)
        return "\(prefix) \(suffix)"
    }

    private func copyTotpCode(_ code: String) {
        copyToPasteboard(code, successMessage: "验证码已复制")
    }

    private func copyToPasteboard(_ value: String, successMessage: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(value, forType: .string)
        store.statusMessage = successMessage
    }

    private func installLocalKeyDownMonitor() {
        guard localKeyDownMonitor == nil else { return }
        localKeyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            guard flags.contains(.command) else {
                return event
            }

            let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
            guard key == "a" else {
                return event
            }

            // In main list, Cmd+A always selects all visible accounts (all/folder/recycle/current filter).
            // Keep text select-all behavior only in popup/forms.
            if showCreateFolderSheet || showMoveToFolderSheet || showFolderDedupSheet || store.accountForEditing() != nil {
                return event
            }

            store.triggerSelectAllAccounts()
            return nil
        }
    }

    private func removeLocalKeyDownMonitor() {
        if let monitor = localKeyDownMonitor {
            NSEvent.removeMonitor(monitor)
            localKeyDownMonitor = nil
        }
    }

    private func handleAccountRowTap(_ accountId: UUID, orderedAccountIds: [UUID]) {
        let flags = (
            NSApp.currentEvent?.modifierFlags
            ?? NSEvent.modifierFlags
        ).intersection(.deviceIndependentFlagsMask)

        if flags.contains(.shift) {
            let anchor = selectionAnchorAccountId ?? selectedAccountIds.first ?? accountId
            if let anchorIndex = orderedAccountIds.firstIndex(of: anchor),
               let targetIndex = orderedAccountIds.firstIndex(of: accountId)
            {
                let lower = min(anchorIndex, targetIndex)
                let upper = max(anchorIndex, targetIndex)
                selectedAccountIds = Set(orderedAccountIds[lower...upper])
            } else {
                selectedAccountIds = [accountId]
            }
            if selectionAnchorAccountId == nil {
                selectionAnchorAccountId = anchor
            }
            return
        }

        if flags.contains(.command) {
            if selectedAccountIds.contains(accountId) {
                selectedAccountIds.remove(accountId)
            } else {
                selectedAccountIds.insert(accountId)
            }
            selectionAnchorAccountId = accountId
            return
        }

        selectedAccountIds = [accountId]
        selectionAnchorAccountId = accountId
    }

    private func selectOnlyAccountIfNoMultiModifier(_ accountId: UUID) {
        let flags = NSApp.currentEvent?.modifierFlags.intersection(.deviceIndependentFlagsMask) ?? []
        if flags.contains(.shift) || flags.contains(.command) {
            return
        }
        if selectedAccountIds != [accountId] {
            selectedAccountIds = [accountId]
            selectionAnchorAccountId = accountId
        }
    }

    private func contextMenuTargetAccountIds(for accountId: UUID) -> Set<UUID> {
        if selectedAccountIds.contains(accountId), !selectedAccountIds.isEmpty {
            return selectedAccountIds
        }
        return [accountId]
    }

    private func adoptContextMenuSelection(for accountId: UUID) -> Set<UUID> {
        let targetIds = contextMenuTargetAccountIds(for: accountId)
        if selectedAccountIds != targetIds {
            selectedAccountIds = targetIds
        }
        selectionAnchorAccountId = accountId
        return targetIds
    }

    private func selectAllVisibleAccounts() {
        let ids = filteredAccounts(from: store.accounts).map(\.id)
        selectedAccountIds = Set(ids)
        selectionAnchorAccountId = ids.first
    }

    private func confirmAndClearRecycleBin() {
        let deletedCount = store.accounts.filter(\.isDeleted).count
        guard deletedCount > 0 else {
            store.statusMessage = "回收站为空"
            return
        }

        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "清空回收站"
        alert.informativeText = "将永久删除回收站中的 \(deletedCount) 条账号，此操作不可恢复。"
        alert.addButton(withTitle: "清空")
        alert.addButton(withTitle: "取消")

        if alert.runModal() == .alertFirstButtonReturn {
            store.permanentlyDeleteAllFromRecycleBin()
        }
    }

}

private extension View {
    @ViewBuilder
    func applyIf<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
        if condition {
            transform(self)
        } else {
            self
        }
    }
}

private struct SecondaryClickSelectionCatcher: NSViewRepresentable {
    let onSecondaryClick: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onSecondaryClick: onSecondaryClick)
    }

    func makeNSView(context: Context) -> NSView {
        let view = SecondaryClickPassthroughView()
        view.onSecondaryClick = context.coordinator.onSecondaryClick
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        (nsView as? SecondaryClickPassthroughView)?.onSecondaryClick = context.coordinator.onSecondaryClick
    }

    final class Coordinator {
        let onSecondaryClick: () -> Void

        init(onSecondaryClick: @escaping () -> Void) {
            self.onSecondaryClick = onSecondaryClick
        }
    }
}

private final class SecondaryClickPassthroughView: NSView {
    var onSecondaryClick: (() -> Void)?

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard bounds.contains(point), let event = NSApp.currentEvent else {
            return nil
        }

        switch event.type {
        case .rightMouseDown:
            return self
        case .leftMouseDown where event.modifierFlags.contains(.control):
            return self
        default:
            return nil
        }
    }

    override func mouseDown(with event: NSEvent) {
        if event.modifierFlags.contains(.control) {
            onSecondaryClick?()
        }
        if let nextResponder {
            nextResponder.mouseDown(with: event)
        } else {
            super.mouseDown(with: event)
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        onSecondaryClick?()
        if let nextResponder {
            nextResponder.rightMouseDown(with: event)
        } else {
            super.rightMouseDown(with: event)
        }
    }

    override func otherMouseDown(with event: NSEvent) {
        if let nextResponder {
            nextResponder.otherMouseDown(with: event)
        } else {
            super.otherMouseDown(with: event)
        }
    }
}

private struct TotpRowView: View {
    @ObservedObject var store: AccountStore
    let account: PasswordAccount
    let onSelect: () -> Void
    let onCopy: (String) -> Void

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            if let code = store.currentTotpCode(for: account, at: context.date) {
                Button {
                    onSelect()
                    onCopy(code)
                } label: {
                    Text("验证码: \(formatted(code)) (剩余 \(store.totpRemainingSeconds(at: context.date))s)")
                        .font(store.textFont(size: store.scaledTextSize(15)).monospacedDigit())
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .help("点击复制验证码")
            } else {
                Text("验证码: TOTP 密钥无效")
                    .font(store.textFont(size: store.scaledTextSize(12)))
                    .foregroundStyle(.red)
            }
        }
    }

    private func formatted(_ code: String) -> String {
        guard code.count == 6 else { return code }
        let prefix = code.prefix(3)
        let suffix = code.suffix(3)
        return "\(prefix) \(suffix)"
    }
}

private struct HistoryPopup: View {
    @ObservedObject var store: AccountStore
    let accountId: String?
    let onClose: () -> Void

    private var visibleEntries: [OperationHistoryEntry] {
        guard let accountId, !accountId.isEmpty else {
            return store.historyEntries
        }
        let prefix = "\(accountId)："
        return store.historyEntries.filter {
            $0.accountId == accountId || $0.action.hasPrefix(prefix)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(accountId.map { "历史记录 \($0)" } ?? "历史记录")
                    .font(store.textFont(size: store.scaledTextSize(17), weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button("清空") {
                    if let accountId, !accountId.isEmpty {
                        store.clearHistoryEntries(forAccountId: accountId)
                    } else {
                        store.clearHistoryEntries()
                    }
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
                .disabled(visibleEntries.isEmpty)
                Button("关闭") {
                    onClose()
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
            }

            if visibleEntries.isEmpty {
                Text("暂无历史记录")
                    .font(store.textFont(size: store.scaledTextSize(17)))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 220, alignment: .center)
            } else {
                List(visibleEntries) { entry in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .top, spacing: 8) {
                            Text(store.displayTime(entry.timestampMs))
                                .font(store.textFont(size: store.scaledTextSize(12), weight: .semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                            if store.canRevertHistoryEntry(entry) {
                                Button("回退") {
                                    store.revertHistoryEntry(entry)
                                }
                                .font(store.buttonFont(size: max(12, CGFloat(store.uiButtonFontSize - 4))))
                                .buttonStyle(.bordered)
                            }
                        }
                        historyContent(for: entry)
                    }
                    .padding(.vertical, 4)
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
                .frame(minHeight: 300)
            }
        }
        .padding(18)
        .frame(maxWidth: 860)
        .frame(minWidth: 760, minHeight: 460, alignment: .topLeading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
        .shadow(radius: 18)
    }

    @ViewBuilder
    private func historyContent(for entry: OperationHistoryEntry) -> some View {
        if entry.fieldKey == "note" {
            Text(noteHistoryText(for: entry))
                .font(store.textFont(size: store.scaledTextSize(14)))
                .textSelection(.enabled)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(formattedAction(entry.action))
                .font(store.textFont(size: store.scaledTextSize(14)))
                .textSelection(.enabled)
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func noteHistoryText(for entry: OperationHistoryEntry) -> String {
        """
        原备注：
        \(displayValue(entry.oldValue))
        新备注：
        \(displayValue(entry.newValue))
        """
    }

    private func displayValue(_ value: String?) -> String {
        let normalized = value?
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return normalized.isEmpty ? "(空)" : normalized
    }

    private func formattedAction(_ action: String) -> String {
        let trimmed = action.trimmingCharacters(in: .whitespacesAndNewlines)
        let content: String
        if let accountId, trimmed.hasPrefix("\(accountId)：") {
            content = String(trimmed.dropFirst(accountId.count + 1))
        } else {
            content = trimmed
        }
        return content.replacingOccurrences(
            of: "改为",
            with: "改为：\n",
            options: .literal,
            range: content.range(of: "改为")
        )
    }
}

private struct RecycleBinPopup: View {
    @ObservedObject var store: AccountStore
    let deletedAccounts: [PasswordAccount]
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("回收站")
                    .font(store.textFont(size: store.scaledTextSize(17), weight: .semibold))
                Spacer()
                Button("关闭") {
                    onClose()
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
            }

            HStack(spacing: 8) {
                Button("全部恢复") {
                    store.restoreAllFromRecycleBin()
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
                .disabled(deletedAccounts.isEmpty)

                Button("全部永久删除") {
                    store.permanentlyDeleteAllFromRecycleBin()
                }
                .font(store.buttonFont())
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(deletedAccounts.isEmpty)

                Spacer()
            }

            if deletedAccounts.isEmpty {
                Text("回收站为空")
                    .font(store.textFont(size: store.scaledTextSize(17)))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 220, alignment: .center)
            } else {
                List(deletedAccounts) { account in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(account.accountId)
                            .font(store.textFont(size: store.scaledTextSize(15), weight: .semibold))
                            .textSelection(.enabled)
                        Text("用户名: \(account.username)")
                            .font(store.textFont(size: store.scaledTextSize(12)))
                        Text("站点别名: \(account.sites.joined(separator: "  "))")
                            .font(store.textFont(size: store.scaledTextSize(11)))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.tail)

                        HStack(spacing: 8) {
                            Button("恢复账号") {
                                store.restoreFromRecycleBin(for: account)
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)

                            Button("永久删除") {
                                store.permanentlyDeleteFromRecycleBin(account)
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.borderedProminent)
                            .tint(.red)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listStyle(.inset(alternatesRowBackgrounds: true))
                .frame(minHeight: 300)
            }
        }
        .padding(18)
        .frame(maxWidth: 860)
        .frame(minWidth: 760, minHeight: 460, alignment: .topLeading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
        .shadow(radius: 18)
    }
}

private struct AccountEditPopup: View {
    @ObservedObject var store: AccountStore
    let editingAccount: PasswordAccount
    @Binding var showHistoryPopup: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("网站: \(editingAccount.canonicalSite) | 用户名: \(editingAccount.username)")
                    .font(store.textFont(size: store.scaledTextSize(17), weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(accountLevelHelpText)
                Spacer()
                Button("历史记录") {
                    showHistoryPopup = true
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
                Button("保存编辑") {
                    store.saveEditing()
                }
                .font(store.buttonFont())
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)

                Button("取消编辑") {
                    store.cancelEditing()
                }
                .font(store.buttonFont())
                .buttonStyle(.bordered)
            }

            ScrollView {
                VStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("站点别名（每行一个站点，共用同一套账号密码）")
                            .font(store.textFont(size: store.scaledTextSize(11)))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .help(accountLevelHelpText)
                        TextEditor(text: $store.editSitesText)
                            .font(store.textFont(size: store.scaledTextSize(17)))
                            .frame(minHeight: 84, maxHeight: 130)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                            )
                    }

                    HStack {
                        Text("用户名")
                            .frame(width: 80, alignment: .leading)
                            .help(fieldHelpText(editingAccount.usernameUpdatedAtMs, editingAccount.usernameUpdatedDeviceName))
                        TextField("用户名", text: $store.editUsername)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    HStack {
                        Text("密码")
                            .frame(width: 80, alignment: .leading)
                            .help(fieldHelpText(editingAccount.passwordUpdatedAtMs, editingAccount.passwordUpdatedDeviceName))
                        TextField("密码", text: $store.editPassword)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("TOTP")
                                .frame(width: 80, alignment: .leading)
                                .help(fieldHelpText(editingAccount.totpUpdatedAtMs, editingAccount.totpUpdatedDeviceName))
                            TextField("TOTP 种子密钥", text: $store.editTotpSecret)
                                .textFieldStyle(.roundedBorder)
                                .frame(maxWidth: .infinity)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        HStack {
                            Text("")
                                .frame(width: 80, alignment: .leading)
                            HStack(spacing: 8) {
                                Button("粘贴原始密钥") {
                                    store.pasteEditTotpRawSecretFromClipboard()
                                }
                                .buttonStyle(.bordered)

                                Button("粘贴完整otpauth URI") {
                                    store.pasteEditTotpURIFromClipboard()
                                }
                                .buttonStyle(.bordered)

                                Button("粘贴二维码") {
                                    store.pasteEditTotpQRCodeFromClipboard()
                                }
                                .buttonStyle(.bordered)

                                Spacer()
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("恢复码")
                            .frame(width: 80, alignment: .leading)
                            .help(fieldHelpText(editingAccount.recoveryCodesUpdatedAtMs, editingAccount.recoveryCodesUpdatedDeviceName))
                        TextEditor(text: $store.editRecoveryCodes)
                            .font(store.textFont(size: store.scaledTextSize(17)))
                            .frame(minHeight: 84, maxHeight: 120)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                            )
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("备注")
                            .frame(width: 80, alignment: .leading)
                            .help(fieldHelpText(editingAccount.noteUpdatedAtMs, editingAccount.noteUpdatedDeviceName))
                        TextEditor(text: $store.editNote)
                            .font(store.textFont(size: store.scaledTextSize(17)))
                            .frame(minHeight: 100, maxHeight: 150)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                            )
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        if resolvedPasskeys.isEmpty {
                            Text("当前账号未匹配到通行密钥（可能尚未绑定或仅存在于其它端）。")
                                .font(store.textFont(size: store.scaledTextSize(11)))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            ForEach(resolvedPasskeys, id: \.credentialIdB64u) { passkey in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("通行密钥 RPID:\(passkey.rpId)|用户名:\(passkey.userName)")
                                        .font(store.textFont(size: store.scaledTextSize(11)))
                                        .textSelection(.enabled)
                                    Text(
                                        "创建时间:\(store.displayTime(passkey.createdAtMs))更新时间:\(store.displayTime(passkey.updatedAtMs))上次使用:\(store.displayTime(passkey.lastUsedAtMs))"
                                    )
                                    .font(store.textFont(size: store.scaledTextSize(11)))
                                    .foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                if passkey.credentialIdB64u != resolvedPasskeys.last?.credentialIdB64u {
                                    Divider()
                                }
                            }
                        }
                    }
                    .padding(.top, 2)

                    Divider()

                    VStack(alignment: .leading, spacing: 2) {
                        metadataRow(
                            label: "创建时间",
                            value: store.displayTime(editingAccount.createdAtMs),
                            device: editingAccount.createdDeviceName.isEmpty ? "-" : editingAccount.createdDeviceName
                        )
                        metadataRow(
                            label: "最后更新",
                            value: store.displayTime(editingAccount.updatedAtMs),
                            device: editingAccount.lastOperatedDeviceName.isEmpty ? "-" : editingAccount.lastOperatedDeviceName
                        )
                        metadataRow(
                            label: "删除时间",
                            value: store.displayTime(editingAccount.deletedAtMs),
                            device: editingAccount.deletedAtMs == nil ? "-" : (editingAccount.deletedDeviceName.isEmpty ? "-" : editingAccount.deletedDeviceName)
                        )
                        metadataRow(
                            label: "用户名",
                            value: store.displayTime(editingAccount.usernameUpdatedAtMs),
                            device: editingAccount.usernameUpdatedDeviceName.isEmpty ? "-" : editingAccount.usernameUpdatedDeviceName
                        )
                        metadataRow(
                            label: "密码",
                            value: store.displayTime(editingAccount.passwordUpdatedAtMs),
                            device: editingAccount.passwordUpdatedDeviceName.isEmpty ? "-" : editingAccount.passwordUpdatedDeviceName
                        )
                        metadataRow(
                            label: "TOTP",
                            value: store.displayTime(editingAccount.totpUpdatedAtMs),
                            device: editingAccount.totpUpdatedDeviceName.isEmpty ? "-" : editingAccount.totpUpdatedDeviceName
                        )
                        metadataRow(
                            label: "恢复码",
                            value: store.displayTime(editingAccount.recoveryCodesUpdatedAtMs),
                            device: editingAccount.recoveryCodesUpdatedDeviceName.isEmpty ? "-" : editingAccount.recoveryCodesUpdatedDeviceName
                        )
                        metadataRow(
                            label: "备注",
                            value: store.displayTime(editingAccount.noteUpdatedAtMs),
                            device: editingAccount.noteUpdatedDeviceName.isEmpty ? "-" : editingAccount.noteUpdatedDeviceName
                        )
                        metadataRow(
                            label: "通行密钥",
                            value: store.displayTime(editingAccount.passkeyUpdatedAtMs),
                            device: editingAccount.passkeyUpdatedDeviceName.isEmpty ? "-" : editingAccount.passkeyUpdatedDeviceName
                        )
                    }
                    .textSelection(.enabled)
                }
                .padding(.trailing, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(18)
        .frame(maxWidth: 780)
        .frame(minWidth: 760, minHeight: 620, alignment: .topLeading)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
        .shadow(radius: 18)
    }

    private var resolvedPasskeys: [PasskeyRecord] {
        let ids = Set(
            editingAccount.passkeyCredentialIds
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        )

        var matchedById: [PasskeyRecord] = []
        if !ids.isEmpty {
            matchedById = store.passkeys.filter { ids.contains($0.credentialIdB64u.trimmingCharacters(in: .whitespacesAndNewlines)) }
        }

        let fallbackMatched: [PasskeyRecord]
        if matchedById.isEmpty {
            let username = editingAccount.username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let accountSites = Set(editingAccount.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
            let accountEtld1 = Set(accountSites.map { DomainUtils.etldPlusOne(for: $0) }.filter { !$0.isEmpty })
            fallbackMatched = store.passkeys.filter { passkey in
                let passkeyUsername = passkey.userName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                guard !username.isEmpty, passkeyUsername == username else { return false }
                let rpId = DomainUtils.normalize(passkey.rpId)
                guard !rpId.isEmpty else { return false }
                if accountSites.contains(rpId) {
                    return true
                }
                let rpEtld1 = DomainUtils.etldPlusOne(for: rpId)
                return !rpEtld1.isEmpty && accountEtld1.contains(rpEtld1)
            }
        } else {
            fallbackMatched = []
        }

        let merged = matchedById + fallbackMatched
        return merged.sorted { lhs, rhs in
            if lhs.updatedAtMs != rhs.updatedAtMs {
                return lhs.updatedAtMs > rhs.updatedAtMs
            }
            return lhs.credentialIdB64u < rhs.credentialIdB64u
        }
    }

    private var accountLevelHelpText: String {
        fieldHelpText(editingAccount.updatedAtMs, editingAccount.lastOperatedDeviceName)
    }

    private func fieldHelpText(_ updatedAtMs: Int64?, _ deviceName: String) -> String {
        "更新时间: \(store.displayTime(updatedAtMs))\n设备: \(deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "-" : deviceName)"
    }

    @ViewBuilder
    private func metadataRow(label: String, value: String, device: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .frame(width: 92, alignment: .leading)
            Text(":")
                .frame(width: 10, alignment: .center)
            Text(value)
                .frame(width: 220, alignment: .leading)
            Text("|")
                .frame(width: 10, alignment: .center)
            Text(device)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(size: store.scaledTextSize(11), weight: .regular, design: .monospaced))
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

}
