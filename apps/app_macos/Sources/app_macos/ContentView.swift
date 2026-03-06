import AppKit
import SwiftUI
import UniformTypeIdentifiers

private enum AccountSidebarFilter: Hashable {
    case all
    case passkeys
    case totp
    case recycle
    case folder(UUID)
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
    @State private var pendingMoveAccountIds: [UUID] = []
    @State private var moveFolderCheckedIds: Set<UUID> = []
    @State private var draggingAccountIds: [UUID] = []
    @State private var localKeyDownMonitor: Any?

    var body: some View {
        let allAccounts = store.accounts
        let activeAccounts = allAccounts.filter { !$0.isDeleted }
        let deletedAccounts = allAccounts.filter(\.isDeleted)
        let passkeyAccounts = activeAccounts.filter { $0.password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let totpAccounts = activeAccounts.filter { !$0.totpSecret.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let accounts = filteredAccounts(from: allAccounts)
        let editingAccount = store.accountForEditing()

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
                    GroupBox {
                        HStack(spacing: 8) {
                            Button {
                                openWindow(id: "create-account")
                            } label: {
                                topActionButtonLabel(
                                    "新建账号",
                                    prominent: true
                                )
                            }
                            .buttonStyle(.plain)

                            Button {
                                store.addDemoAccountsIfNeeded()
                            } label: {
                                topActionButtonLabel(
                                    "生成演示账号",
                                    prominent: false
                                )
                            }
                            .buttonStyle(.plain)

                            Button {
                                store.deleteAllAccounts()
                            } label: {
                                topActionButtonLabel(
                                    "删除全部账号",
                                    prominent: true,
                                    tint: .red
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(activeAccounts.isEmpty)
                            .opacity(activeAccounts.isEmpty ? 0.45 : 1)

                            Spacer()
                        }
                    }

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
                                        .contentShape(Rectangle())
                                        .onTapGesture {
                                            handleAccountRowTap(
                                                account.id,
                                                orderedAccountIds: accounts.map(\.id)
                                            )
                                        }
                                        .onDrag {
                                            beginDragging(account.id, orderedAccountIds: accounts.map(\.id))
                                            return NSItemProvider(object: account.id.uuidString as NSString)
                                        }
                                        .onDrop(of: [UTType.text], isTargeted: nil) { _ in
                                            handleAccountReorderDrop(targetAccountId: account.id)
                                        }
                                        .contextMenu {
                                            Button("编辑") {
                                                selectOnlyAccountIfNoMultiModifier(account.id)
                                                store.beginEditing(account)
                                            }

                                            Divider()

                                            if !account.isDeleted {
                                                Button(store.accountIsPinned(account) ? "取消置顶" : "置顶") {
                                                    selectOnlyAccountIfNoMultiModifier(account.id)
                                                    store.togglePin(for: account)
                                                }

                                                Button("放入文件夹") {
                                                    prepareMoveToFolder(from: account.id)
                                                }
                                                .disabled(store.folders.isEmpty)

                                                Divider()

                                                Button("删除", role: .destructive) {
                                                    selectOnlyAccountIfNoMultiModifier(account.id)
                                                    store.moveToRecycleBin(for: account)
                                                }
                                            } else {
                                                Button("恢复账号") {
                                                    selectOnlyAccountIfNoMultiModifier(account.id)
                                                    store.restoreFromRecycleBin(for: account)
                                                }
                                                Button("永久删除", role: .destructive) {
                                                    selectOnlyAccountIfNoMultiModifier(account.id)
                                                    store.permanentlyDeleteFromRecycleBin(account)
                                                }
                                            }
                                        }
                                }
                            }
                        }
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
                selectedAccountIds = Set(accounts.map(\.id))
                selectionAnchorAccountId = accounts.first?.id
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

            if showMoveToFolderSheet {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showMoveToFolderSheet = false
                    }

                moveToFolderSheet
                    .padding(26)
            }

            if let editingAccount {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .onTapGesture {
                        store.cancelEditing()
                    }

                AccountEditPopup(store: store, editingAccount: editingAccount)
                    .padding(26)
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
            sidebarItem(title: "通行秘钥 (\(passkeyCount))", selected: selectedSidebarFilter == .passkeys) {
                selectedSidebarFilter = .passkeys
            }
            sidebarItem(title: "验证码 (\(totpCount))", selected: selectedSidebarFilter == .totp) {
                selectedSidebarFilter = .totp
            }
            sidebarItem(title: "回收站 (\(recycleCount))", selected: selectedSidebarFilter == .recycle) {
                selectedSidebarFilter = .recycle
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
                                if folder.id == AccountStore.fixedNewAccountFolderId {
                                    Button("固定文件夹不可删除") {}
                                        .disabled(true)
                                } else {
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
                if store.accountIsPinned(account) {
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
    }

    private func filteredAccounts(from allAccounts: [PasswordAccount]) -> [PasswordAccount] {
        let scopedAccounts: [PasswordAccount]
        switch selectedSidebarFilter {
        case .all:
            scopedAccounts = allAccounts.filter { !$0.isDeleted }
        case .passkeys:
            scopedAccounts = allAccounts.filter {
                !$0.isDeleted && $0.password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
        let sortedScoped = store.displaySortedAccounts(scopedAccounts)

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
            return "搜索通行秘钥账号（输入即搜）"
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
            }
        }
        .padding(18)
        .frame(width: 420)
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

    private func activeFolderAccountCount(_ folderId: UUID) -> Int {
        store.accounts.filter { !$0.isDeleted && $0.isInFolder(folderId) }.count
    }

    private func beginDragging(_ accountId: UUID, orderedAccountIds _: [UUID]) {
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
        guard let sourceAccountId = draggingAccountIds.first else {
            return false
        }
        draggingAccountIds = []
        guard sourceAccountId != targetAccountId else {
            return false
        }
        store.moveAccountBefore(sourceId: sourceAccountId, targetId: targetAccountId)
        return true
    }

    private func handleDropToFolder(_ folderId: UUID) -> Bool {
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

            if let textResponder = NSApp.keyWindow?.firstResponder as? NSTextView,
               textResponder.isEditable
            {
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
            if let anchor = selectionAnchorAccountId,
               let anchorIndex = orderedAccountIds.firstIndex(of: anchor),
               let targetIndex = orderedAccountIds.firstIndex(of: accountId)
            {
                let lower = min(anchorIndex, targetIndex)
                let upper = max(anchorIndex, targetIndex)
                selectedAccountIds = Set(orderedAccountIds[lower...upper])
            } else {
                selectedAccountIds = [accountId]
            }
            selectionAnchorAccountId = accountId
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

    @ViewBuilder
    private func topActionButtonLabel(
        _ title: String,
        prominent: Bool,
        tint: Color = .accentColor
    ) -> some View {
        let buttonSize = CGFloat(store.uiButtonFontSize)
        let verticalPadding = max(6, buttonSize * 0.22)
        let minHeight = max(44, buttonSize + 24)

        Text(title)
            .font(store.buttonFont(weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 18)
            .padding(.vertical, verticalPadding)
            .frame(minHeight: minHeight)
            .foregroundStyle(prominent ? Color.white : Color.primary)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(prominent ? tint : Color.secondary.opacity(0.14))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.secondary.opacity(0.35), lineWidth: prominent ? 0 : 1)
            )
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

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("网站: \(editingAccount.canonicalSite) | 用户名: \(editingAccount.username)")
                    .font(store.textFont(size: store.scaledTextSize(17), weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button("保存编辑") {
                    store.saveEditing()
                }
                .font(store.buttonFont())
                .buttonStyle(.borderedProminent)

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
                        TextField("用户名", text: $store.editUsername)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    HStack {
                        Text("密码")
                            .frame(width: 80, alignment: .leading)
                        TextField("密码", text: $store.editPassword)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("TOTP")
                                .frame(width: 80, alignment: .leading)
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
                        TextEditor(text: $store.editNote)
                            .font(store.textFont(size: store.scaledTextSize(17)))
                            .frame(minHeight: 100, maxHeight: 150)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                            )
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 2) {
                        Text("正在编辑: 网站 \(editingAccount.canonicalSite) | 用户名 \(editingAccount.username)")
                            .font(store.textFont(size: store.scaledTextSize(12)))
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text("创建时间: \(store.displayTime(editingAccount.createdAtMs)) | 最后更新时间: \(store.displayTime(editingAccount.updatedAtMs)) | 删除时间: \(store.displayTime(editingAccount.deletedAtMs))")
                            .font(store.textFont(size: store.scaledTextSize(11)))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text("用户名更新时间: \(store.displayTime(editingAccount.usernameUpdatedAtMs)) | 密码更新时间: \(store.displayTime(editingAccount.passwordUpdatedAtMs))")
                            .font(store.textFont(size: store.scaledTextSize(11)))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text("TOTP 更新时间: \(store.displayTime(editingAccount.totpUpdatedAtMs)) | 恢复码更新时间: \(store.displayTime(editingAccount.recoveryCodesUpdatedAtMs)) | 备注更新时间: \(store.displayTime(editingAccount.noteUpdatedAtMs))")
                            .font(store.textFont(size: store.scaledTextSize(11)))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
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
}
