import AppKit
import Foundation
import SwiftUI

@MainActor
final class AccountStore: ObservableObject {
    @Published var deviceName: String = ""
    @Published var statusMessage: String = "" {
        didSet {
            let message = statusMessage.trimmingCharacters(in: .whitespacesAndNewlines)
            let allowsUndoMove = nextStatusAllowsUndoMove
            nextStatusAllowsUndoMove = false
            isTopToastUndoAvailable = allowsUndoMove
            guard !message.isEmpty else { return }
            showToast(message)
        }
    }
    @Published var createSitesText: String = ""
    @Published var createUsername: String = ""
    @Published var createPassword: String = ""
    @Published var createTotpSecret: String = ""
    @Published var createRecoveryCodes: String = ""
    @Published var createNote: String = ""
    @Published var showDeletedAccounts: Bool = false
    @Published var editingAccountId: UUID?
    @Published var editSitesText: String = ""
    @Published var editUsername: String = ""
    @Published var editPassword: String = ""
    @Published var editTotpSecret: String = ""
    @Published var editRecoveryCodes: String = ""
    @Published var editNote: String = ""
    @Published var exportDirectoryPath: String = ""
    @Published var uiFontFamily: String = AccountStore.systemDefaultFontFamily {
        didSet {
            let fallback = AccountStore.systemDefaultFontFamily
            let normalized = uiFontFamily.trimmingCharacters(in: .whitespacesAndNewlines)
            let resolved = (normalized == fallback || AccountStore.installedFontFamilies.contains(normalized))
                ? normalized
                : fallback
            if resolved != uiFontFamily {
                uiFontFamily = resolved
                return
            }
            UserDefaults.standard.set(resolved, forKey: Keys.uiFontFamily)
        }
    }
    @Published var uiTextFontSize: Double = 20 {
        didSet {
            let clamped = min(max(uiTextFontSize, 12), 40)
            if clamped != uiTextFontSize {
                uiTextFontSize = clamped
                return
            }
            UserDefaults.standard.set(clamped, forKey: Keys.uiTextFontSize)
        }
    }
    @Published var uiButtonFontSize: Double = 20 {
        didSet {
            let clamped = min(max(uiButtonFontSize, 12), 52)
            if clamped != uiButtonFontSize {
                uiButtonFontSize = clamped
                return
            }
            UserDefaults.standard.set(clamped, forKey: Keys.uiButtonFontSize)
        }
    }
    @Published var uiToastDurationSeconds: Double = 3 {
        didSet {
            let clamped = min(max(uiToastDurationSeconds, 1), 10)
            if clamped != uiToastDurationSeconds {
                uiToastDurationSeconds = clamped
                return
            }
            UserDefaults.standard.set(clamped, forKey: Keys.uiToastDurationSeconds)
        }
    }
    @Published private(set) var toastMessage: String = ""
    @Published private(set) var isToastVisible: Bool = false
    @Published private(set) var isTopToastUndoAvailable: Bool = false
    @Published private(set) var folders: [AccountFolder] = []
    @Published private(set) var undoMoveToastMessage: String = ""
    @Published private(set) var isUndoMoveToastVisible: Bool = false
    @Published private(set) var selectAllAccountsSignal: Int = 0
    @Published private(set) var cloudSyncStatus: String = "iCloud 未连接，使用本机数据"
    @Published private(set) var accounts: [PasswordAccount] = []

    static let systemDefaultFontFamily = "系统默认"
    static let fixedNewAccountFolderName = "新账号"
    static let fixedNewAccountFolderId = UUID(uuidString: "F16A2C4E-4A2A-43D5-A670-3F1767D41001")!
    private static let installedFontFamilies: Set<String> = Set(NSFontManager.shared.availableFontFamilies)

    private let decoder = JSONDecoder()
    private let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()
    private let cloudStore = NSUbiquitousKeyValueStore.default
    private let displayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "yy-M-d H:m:s"
        return formatter
    }()
    private var toastDismissWorkItem: DispatchWorkItem?
    private var undoMoveDismissWorkItem: DispatchWorkItem?
    private var nextStatusAllowsUndoMove: Bool = false
    private var lastMoveOperation: FolderMoveOperation?
    private var cloudObserver: NSObjectProtocol?
    private var suppressCloudPush: Bool = false

    private struct FolderMoveOperation {
        let accountIds: [UUID]
        let previousFolderIdsByAccountId: [UUID: [UUID]]
        let actionSummary: String
    }

    init() {
        load()
        setupICloudSync()
    }

    func saveDeviceName() {
        let normalized = deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else {
            statusMessage = "设备名称不能为空"
            return
        }

        deviceName = normalized
        UserDefaults.standard.set(normalized, forKey: Keys.deviceName)
        statusMessage = "设备名称已保存"
    }

    func triggerSelectAllAccounts() {
        selectAllAccountsSignal &+= 1
    }

    func handleSelectAllShortcut() {
        triggerSelectAllAccounts()
    }

    func handleUndoShortcut() {
        if let textResponder = NSApp.keyWindow?.firstResponder as? NSTextView,
           textResponder.isEditable
        {
            textResponder.undoManager?.undo()
            return
        }
        undoLastMoveOperation()
    }

    func createFolder(named rawName: String) {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            statusMessage = "文件夹名称不能为空"
            return
        }
        if folders.contains(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
            statusMessage = "文件夹已存在: \(name)"
            return
        }

        let folder = AccountFolder(
            id: UUID(),
            name: name,
            createdAtMs: nowMs()
        )
        folders.append(folder)
        _ = normalizeFoldersEnsuringFixedNewAccountFolder()
        saveFoldersToDefaults()
        statusMessage = "已创建文件夹: \(name)"
    }

    func deleteFolder(id: UUID) {
        guard let folder = folders.first(where: { $0.id == id }) else {
            statusMessage = "目标文件夹不存在"
            return
        }
        if folder.id == Self.fixedNewAccountFolderId {
            statusMessage = "固定文件夹不可删除"
            return
        }

        folders.removeAll(where: { $0.id == id })
        _ = normalizeFoldersEnsuringFixedNewAccountFolder()
        saveFoldersToDefaults()

        let now = nowMs()
        let device = currentDeviceName()
        var removedFromAccountCount = 0

        for index in accounts.indices {
            let currentFolderIds = accounts[index].resolvedFolderIds
            guard currentFolderIds.contains(id) else { continue }
            let nextFolderIds = currentFolderIds.filter { $0 != id }
            accounts[index].setResolvedFolderIds(nextFolderIds)
            accounts[index].touchUpdatedAt(now, deviceName: device)
            removedFromAccountCount += 1
        }

        if removedFromAccountCount > 0 {
            saveAccounts()
            statusMessage = "已删除文件夹: \(folder.name)，并从 \(removedFromAccountCount) 个账号中移除"
        } else {
            statusMessage = "已删除文件夹: \(folder.name)"
        }
    }

    func folderName(for id: UUID) -> String {
        folders.first(where: { $0.id == id })?.name ?? "未命名文件夹"
    }

    func checkedFolderIdsForAccounts(accountIds: [UUID]) -> [UUID] {
        let idSet = Set(accountIds)
        let selected = accounts.filter { idSet.contains($0.id) && !$0.isDeleted }
        guard let first = selected.first else {
            return []
        }

        var intersection = Set(first.resolvedFolderIds)
        for account in selected.dropFirst() {
            intersection.formIntersection(account.resolvedFolderIds)
        }

        let existingFolderIds = Set(folders.map(\.id))
        let filtered = intersection.filter { existingFolderIds.contains($0) }
        return normalizeFolderIds(Array(filtered))
    }

    func applyFolderSelection(accountIds: [UUID], checkedFolderIds: [UUID]) {
        let idSet = Set(accountIds)
        guard !idSet.isEmpty else {
            statusMessage = "未选择账号"
            return
        }

        let selectedIndexes = accounts.indices.filter { idSet.contains(accounts[$0].id) && !accounts[$0].isDeleted }
        guard !selectedIndexes.isEmpty else {
            statusMessage = "未选择账号"
            return
        }

        let existingFolderIds = Set(folders.map(\.id))
        let targetFolderIds = normalizeFolderIds(
            checkedFolderIds.filter { existingFolderIds.contains($0) }
        )

        var previousFolderIdsByAccountId: [UUID: [UUID]] = [:]
        var changedCount = 0
        let now = nowMs()
        let device = currentDeviceName()

        for index in selectedIndexes {
            let currentFolderIds = accounts[index].resolvedFolderIds
            previousFolderIdsByAccountId[accounts[index].id] = currentFolderIds

            if currentFolderIds != targetFolderIds {
                accounts[index].setResolvedFolderIds(targetFolderIds)
                accounts[index].touchUpdatedAt(now, deviceName: device)
                changedCount += 1
            }
        }

        guard changedCount > 0 else {
            statusMessage = "文件夹勾选无变更"
            return
        }

        let actionSummary = "已按勾选更新 \(changedCount) 个账号的文件夹"
        lastMoveOperation = FolderMoveOperation(
            accountIds: Array(previousFolderIdsByAccountId.keys),
            previousFolderIdsByAccountId: previousFolderIdsByAccountId,
            actionSummary: actionSummary
        )
        saveAccounts()
        setStatusMessage("已按勾选更新文件夹（\(changedCount) 个账号），点击撤销", allowsUndoMove: true)
    }

    func areAllAccountsInFolder(accountIds: [UUID], folderId: UUID) -> Bool {
        let idSet = Set(accountIds)
        let selected = accounts.filter { idSet.contains($0.id) && !$0.isDeleted }
        guard !selected.isEmpty else {
            return false
        }
        return selected.allSatisfy { $0.isInFolder(folderId) }
    }

    func toggleAccountsFolderMembership(accountIds: [UUID], folderId: UUID) {
        let idSet = Set(accountIds)
        guard !idSet.isEmpty else {
            statusMessage = "未选择账号"
            return
        }
        guard folders.contains(where: { $0.id == folderId }) else {
            statusMessage = "目标文件夹不存在"
            return
        }

        let selectedIndexes = accounts.indices.filter { idSet.contains(accounts[$0].id) && !accounts[$0].isDeleted }
        guard !selectedIndexes.isEmpty else {
            statusMessage = "未选择账号"
            return
        }

        let allAlreadyInFolder = selectedIndexes.allSatisfy { accounts[$0].isInFolder(folderId) }
        let shouldAddToFolder = !allAlreadyInFolder

        var previousFolderIdsByAccountId: [UUID: [UUID]] = [:]
        var changedCount = 0
        let now = nowMs()
        let device = currentDeviceName()

        for index in selectedIndexes {
            let currentFolderIds = accounts[index].resolvedFolderIds
            previousFolderIdsByAccountId[accounts[index].id] = currentFolderIds

            var nextFolderIds = currentFolderIds
            if shouldAddToFolder {
                if !nextFolderIds.contains(folderId) {
                    nextFolderIds.append(folderId)
                }
            } else {
                nextFolderIds.removeAll(where: { $0 == folderId })
            }

            let normalizedNext = normalizeFolderIds(nextFolderIds)
            if normalizedNext != currentFolderIds {
                accounts[index].setResolvedFolderIds(normalizedNext)
                accounts[index].touchUpdatedAt(now, deviceName: device)
                changedCount += 1
            }
        }

        guard changedCount > 0 else {
            statusMessage = shouldAddToFolder
                ? "所选账号已在文件夹：\(folderName(for: folderId))"
                : "所选账号不在文件夹：\(folderName(for: folderId))"
            return
        }

        let actionPrefix = shouldAddToFolder ? "已放入" : "已移出"
        let actionSummary = "\(actionPrefix) \(changedCount) 个账号 \(shouldAddToFolder ? "到" : "从")文件夹：\(folderName(for: folderId))"
        lastMoveOperation = FolderMoveOperation(
            accountIds: Array(previousFolderIdsByAccountId.keys),
            previousFolderIdsByAccountId: previousFolderIdsByAccountId,
            actionSummary: actionSummary
        )
        saveAccounts()
        setStatusMessage("\(actionSummary)（\(changedCount) 个账号），点击撤销", allowsUndoMove: true)
    }

    func addAccountsToFolder(accountIds: [UUID], folderId: UUID) {
        let idSet = Set(accountIds)
        guard !idSet.isEmpty else {
            statusMessage = "未选择账号"
            return
        }
        guard folders.contains(where: { $0.id == folderId }) else {
            statusMessage = "目标文件夹不存在"
            return
        }

        let selectedIndexes = accounts.indices.filter { idSet.contains(accounts[$0].id) && !accounts[$0].isDeleted }
        guard !selectedIndexes.isEmpty else {
            statusMessage = "未选择账号"
            return
        }

        var previousFolderIdsByAccountId: [UUID: [UUID]] = [:]
        var changedCount = 0
        let now = nowMs()
        let device = currentDeviceName()

        for index in selectedIndexes {
            let currentFolderIds = accounts[index].resolvedFolderIds
            previousFolderIdsByAccountId[accounts[index].id] = currentFolderIds
            if currentFolderIds.contains(folderId) {
                continue
            }
            var nextFolderIds = currentFolderIds
            nextFolderIds.append(folderId)
            let normalizedNext = normalizeFolderIds(nextFolderIds)
            if normalizedNext != currentFolderIds {
                accounts[index].setResolvedFolderIds(normalizedNext)
                accounts[index].touchUpdatedAt(now, deviceName: device)
                changedCount += 1
            }
        }

        guard changedCount > 0 else {
            statusMessage = "所选账号已在文件夹：\(folderName(for: folderId))"
            return
        }

        let actionSummary = "已放入 \(changedCount) 个账号 到文件夹：\(folderName(for: folderId))"
        lastMoveOperation = FolderMoveOperation(
            accountIds: Array(previousFolderIdsByAccountId.keys),
            previousFolderIdsByAccountId: previousFolderIdsByAccountId,
            actionSummary: actionSummary
        )
        saveAccounts()
        setStatusMessage("\(actionSummary)（\(changedCount) 个账号），点击撤销", allowsUndoMove: true)
    }

    func undoLastMoveOperation() {
        guard let operation = lastMoveOperation else {
            statusMessage = "没有可撤销的移动操作"
            return
        }

        let idSet = Set(operation.accountIds)
        let now = nowMs()
        let device = currentDeviceName()
        var revertedCount = 0

        for index in accounts.indices where idSet.contains(accounts[index].id) {
            if let previousFolderIds = operation.previousFolderIdsByAccountId[accounts[index].id] {
                let normalizedPrevious = normalizeFolderIds(previousFolderIds)
                if accounts[index].resolvedFolderIds != normalizedPrevious {
                    revertedCount += 1
                }
                accounts[index].setResolvedFolderIds(normalizedPrevious)
                accounts[index].touchUpdatedAt(now, deviceName: device)
            }
        }

        guard revertedCount > 0 else {
            statusMessage = "没有需要撤销的变更"
            return
        }

        saveAccounts()
        isUndoMoveToastVisible = false
        undoMoveDismissWorkItem?.cancel()
        lastMoveOperation = nil
        statusMessage = "已撤销: \(operation.actionSummary)"
    }

    func addDemoAccountsIfNeeded() {
        guard accounts.isEmpty else {
            statusMessage = "已存在账号，未重复生成"
            return
        }

        let safeDeviceName = currentDeviceName()
        let seeds: [(site: String, username: String, password: String)] = [
            ("icloud.com", "alice@icloud.com", "demo-pass-001"),
            ("apple.com", "bob@apple.com", "demo-pass-002"),
            ("qq.com", "demo@qq.com", "demo-pass-003"),
            ("wx.qq.com", "wechat@qq.com", "demo-pass-004"),
            ("baidu.com", "user01@baidu.com", "demo-pass-005"),
            ("sina.com", "user02@sina.com", "demo-pass-006"),
            ("github.com", "dev01@github.com", "demo-pass-007"),
            ("gitlab.com", "dev02@gitlab.com", "demo-pass-008"),
            ("google.com", "user03@gmail.com", "demo-pass-009"),
            ("youtube.com", "user04@gmail.com", "demo-pass-010"),
            ("x.com", "user05@x.com", "demo-pass-011"),
            ("facebook.com", "user06@fb.com", "demo-pass-012"),
            ("amazon.com", "user07@amazon.com", "demo-pass-013"),
            ("paypal.com", "user08@paypal.com", "demo-pass-014"),
            ("microsoft.com", "user09@outlook.com", "demo-pass-015"),
            ("office.com", "user10@outlook.com", "demo-pass-016"),
            ("netflix.com", "user11@netflix.com", "demo-pass-017"),
            ("spotify.com", "user12@spotify.com", "demo-pass-018"),
            ("linkedin.com", "user13@linkedin.com", "demo-pass-019"),
            ("dropbox.com", "user14@dropbox.com", "demo-pass-020"),
        ]

        let samples = seeds.enumerated().map { index, seed in
            var account = AccountFactory.create(
                site: seed.site,
                username: seed.username,
                password: seed.password,
                deviceName: safeDeviceName
            )
            account.sites = demoAliasSites(for: seed.site)
            account.totpSecret = demoTotpSecret(for: index)
            account.recoveryCodes = demoRecoveryCodes(for: index + 1)
            account.note = """
            示例账号 #\(index + 1)
            设备: \(safeDeviceName)
            用于演示同步、编辑与回收站功能
            """
            return account
        }
        accounts.append(contentsOf: samples)
        syncAliasGroups()
        saveAccounts()
        statusMessage = "已生成演示账号 20 条（含 TOTP/恢复码/备注/站点别名）"
    }

    func createAccountFromDraft() {
        let sites = parseSites(createSitesText)
        let firstAlias = firstSiteAlias(from: createSitesText)
        let username = createUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = createPassword
        let totpSecret = createTotpSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        let recoveryCodes = createRecoveryCodes
        let note = createNote

        guard !sites.isEmpty else {
            statusMessage = "站点别名不能为空"
            return
        }
        guard !username.isEmpty else {
            statusMessage = "用户名不能为空"
            return
        }
        guard !password.isEmpty else {
            statusMessage = "密码不能为空"
            return
        }

        let idSite = firstAlias.isEmpty ? sites[0] : firstAlias
        var created = AccountFactory.create(
            site: idSite,
            accountIdSite: idSite,
            username: username,
            password: password,
            deviceName: currentDeviceName()
        )
        created.sites = sites
        created.totpSecret = totpSecret
        created.recoveryCodes = recoveryCodes
        created.note = note
        created.setResolvedFolderIds([Self.fixedNewAccountFolderId])
        accounts.append(created)
        syncAliasGroups()
        saveAccounts()

        createSitesText = ""
        createUsername = ""
        createPassword = ""
        createTotpSecret = ""
        createRecoveryCodes = ""
        createNote = ""
        statusMessage = "账号已创建: \(created.accountId)"
    }

    func moveToRecycleBin(for account: PasswordAccount) {
        guard let index = accounts.firstIndex(where: { $0.id == account.id }) else {
            statusMessage = "未找到目标账号"
            return
        }

        guard !accounts[index].isDeleted else {
            statusMessage = "账号已在回收站"
            return
        }

        let now = nowMs()
        accounts[index].isDeleted = true
        accounts[index].deletedAtMs = now
        statusMessage = "账号已移入回收站"
        accounts[index].touchUpdatedAt(now, deviceName: currentDeviceName())
        saveAccounts()
    }

    func restoreFromRecycleBin(for account: PasswordAccount) {
        guard let index = accounts.firstIndex(where: { $0.id == account.id }) else {
            statusMessage = "未找到目标账号"
            return
        }

        guard accounts[index].isDeleted else {
            statusMessage = "该账号不在回收站"
            return
        }

        let now = nowMs()
        accounts[index].isDeleted = false
        accounts[index].deletedAtMs = nil
        statusMessage = "账号已从回收站恢复"
        accounts[index].touchUpdatedAt(now, deviceName: currentDeviceName())
        saveAccounts()
    }

    func permanentlyDeleteFromRecycleBin(_ account: PasswordAccount) {
        guard let index = accounts.firstIndex(where: { $0.id == account.id }) else {
            statusMessage = "未找到目标账号"
            return
        }

        guard accounts[index].isDeleted else {
            statusMessage = "仅支持在回收站中永久删除"
            return
        }

        let removedId = accounts[index].accountId
        accounts.remove(at: index)
        if editingAccountId == account.id {
            cancelEditing()
        }
        saveAccounts()
        statusMessage = "账号已永久删除: \(removedId)"
    }

    func toggleDeleted(for account: PasswordAccount) {
        if account.isDeleted {
            restoreFromRecycleBin(for: account)
        } else {
            moveToRecycleBin(for: account)
        }
    }

    func restoreAllFromRecycleBin() {
        let deletedIndexes = accounts.indices.filter { accounts[$0].isDeleted }
        guard !deletedIndexes.isEmpty else {
            statusMessage = "回收站为空"
            return
        }

        let now = nowMs()
        let device = currentDeviceName()
        for index in deletedIndexes {
            accounts[index].isDeleted = false
            accounts[index].deletedAtMs = nil
            accounts[index].touchUpdatedAt(now, deviceName: device)
        }
        saveAccounts()
        statusMessage = "已恢复 \(deletedIndexes.count) 个账号"
    }

    func permanentlyDeleteAllFromRecycleBin() {
        let deletedCount = accounts.filter(\.isDeleted).count
        guard deletedCount > 0 else {
            statusMessage = "回收站为空"
            return
        }

        let deletedIds = Set(accounts.filter(\.isDeleted).map(\.id))
        accounts.removeAll(where: \.isDeleted)
        if let editingAccountId, deletedIds.contains(editingAccountId) {
            cancelEditing()
        }
        saveAccounts()
        statusMessage = "已永久删除 \(deletedCount) 个账号"
    }

    func deleteAllAccounts() {
        let activeIndexes = accounts.indices.filter { !accounts[$0].isDeleted }
        guard !activeIndexes.isEmpty else {
            statusMessage = "暂无可删除账号"
            return
        }

        let now = nowMs()
        let device = currentDeviceName()
        for index in activeIndexes {
            accounts[index].isDeleted = true
            accounts[index].deletedAtMs = now
            accounts[index].touchUpdatedAt(now, deviceName: device)
        }
        cancelEditing()
        saveAccounts()
        statusMessage = "已将全部账号移入回收站 \(activeIndexes.count) 条"
    }

    func suggestedCsvFileName() -> String {
        "pass-all-accounts-\(timestampForFile()).csv"
    }

    func saveExportDirectoryPath() {
        let normalized = exportDirectoryPath.trimmingCharacters(in: .whitespacesAndNewlines)
        exportDirectoryPath = normalized
        UserDefaults.standard.set(normalized, forKey: Keys.exportDirectoryPath)
    }

    func configuredExportDirectoryURL() -> URL? {
        let raw = exportDirectoryPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }

        let expandedPath = (raw as NSString).expandingTildeInPath
        var isDirectory = ObjCBool(false)
        guard FileManager.default.fileExists(atPath: expandedPath, isDirectory: &isDirectory),
              isDirectory.boolValue
        else {
            return nil
        }
        return URL(fileURLWithPath: expandedPath, isDirectory: true)
    }

    func exportCsv() {
        let fileURL = dataDirectoryURL().appendingPathComponent(suggestedCsvFileName(), isDirectory: false)
        exportCsv(to: fileURL)
    }

    func exportCsv(to fileURL: URL) {
        let csv = buildCsvContent()
        let parentDirectory = fileURL.deletingLastPathComponent()

        do {
            try FileManager.default.createDirectory(
                at: parentDirectory,
                withIntermediateDirectories: true
            )
            try csv.write(to: fileURL, atomically: true, encoding: String.Encoding.utf8)
            statusMessage = "全部账号 CSV 导出成功: \(fileURL.path)"
        } catch {
            statusMessage = "全部账号 CSV 导出失败: \(error.localizedDescription)"
        }
    }

    private func buildCsvContent() -> String {
        
        let header = [
            "account_id",
            "sites",
            "username",
            "password",
            "totp_secret",
            "recovery_codes",
            "note",
            "username_updated_at_ms",
            "password_updated_at_ms",
            "totp_updated_at_ms",
            "recovery_codes_updated_at_ms",
            "note_updated_at_ms",
            "is_deleted",
            "deleted_at_ms",
            "last_operated_device_name",
            "created_at_ms",
            "updated_at_ms",
        ].joined(separator: ",")

        let rows: [String] = accounts.map { account in
            let columns: [String] = [
                account.accountId,
                account.sites.joined(separator: ";"),
                account.username,
                account.password,
                account.totpSecret,
                account.recoveryCodes,
                account.note,
                String(account.usernameUpdatedAtMs),
                String(account.passwordUpdatedAtMs),
                String(account.totpUpdatedAtMs),
                String(account.recoveryCodesUpdatedAtMs),
                String(account.noteUpdatedAtMs),
                account.isDeleted ? "true" : "false",
                account.deletedAtMs.map(String.init) ?? "",
                account.lastOperatedDeviceName,
                String(account.createdAtMs),
                String(account.updatedAtMs),
            ]

            let escaped = columns.map(csvEscaped)
            return escaped.joined(separator: ",")
        }

        return ([header] + rows).joined(separator: "\n")
    }

    func beginEditing(_ account: PasswordAccount) {
        editingAccountId = account.id
        editSitesText = account.sites.joined(separator: "\n")
        editUsername = account.username
        editPassword = account.password
        editTotpSecret = account.totpSecret
        editRecoveryCodes = account.recoveryCodes
        editNote = account.note
    }

    func cancelEditing() {
        editingAccountId = nil
        editSitesText = ""
        editUsername = ""
        editPassword = ""
        editTotpSecret = ""
        editRecoveryCodes = ""
        editNote = ""
    }

    func saveEditing() {
        guard let editingAccountId else {
            statusMessage = "没有正在编辑的账号"
            return
        }
        guard let index = accounts.firstIndex(where: { $0.id == editingAccountId }) else {
            statusMessage = "编辑目标不存在"
            cancelEditing()
            return
        }

        let now = nowMs()
        let device = currentDeviceName()
        var changed = false

        let normalizedSites = parseSites(editSitesText)
        if !normalizedSites.isEmpty, normalizedSites != accounts[index].sites {
            accounts[index].sites = normalizedSites
            changed = true
        }

        let newUsername = editUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        if !newUsername.isEmpty, newUsername != accounts[index].username {
            accounts[index].username = newUsername
            accounts[index].usernameUpdatedAtMs = now
            changed = true
        }

        if editPassword != accounts[index].password {
            accounts[index].password = editPassword
            accounts[index].passwordUpdatedAtMs = now
            changed = true
        }

        if editTotpSecret != accounts[index].totpSecret {
            accounts[index].totpSecret = editTotpSecret
            accounts[index].totpUpdatedAtMs = now
            changed = true
        }

        if editRecoveryCodes != accounts[index].recoveryCodes {
            accounts[index].recoveryCodes = editRecoveryCodes
            accounts[index].recoveryCodesUpdatedAtMs = now
            changed = true
        }

        if editNote != accounts[index].note {
            accounts[index].note = editNote
            accounts[index].noteUpdatedAtMs = now
            changed = true
        }

        guard changed else {
            statusMessage = "没有可保存的变更"
            return
        }

        accounts[index].touchUpdatedAt(now, deviceName: device)
        syncAliasGroups()
        saveAccounts()
        statusMessage = "账号编辑已保存"
        cancelEditing()
    }

    func accountIsPinned(_ account: PasswordAccount) -> Bool {
        effectivePinned(account)
    }

    func togglePin(for account: PasswordAccount) {
        guard let index = accounts.firstIndex(where: { $0.id == account.id }) else {
            statusMessage = "未找到目标账号"
            return
        }
        guard !accounts[index].isDeleted else {
            statusMessage = "回收站账号不支持置顶"
            return
        }

        let now = nowMs()
        let device = currentDeviceName()
        let nextPinned = !effectivePinned(accounts[index])
        accounts[index].isPinned = nextPinned
        if nextPinned {
            accounts[index].pinnedSortOrder = nextPinnedSortOrder()
        } else {
            accounts[index].pinnedSortOrder = nil
            accounts[index].regularSortOrder = nil
        }
        accounts[index].touchUpdatedAt(now, deviceName: device)
        saveAccounts()
        statusMessage = nextPinned ? "账号已置顶" : "已取消置顶"
    }

    func moveAccountBefore(sourceId: UUID, targetId: UUID) {
        guard sourceId != targetId else { return }
        guard let source = accounts.first(where: { $0.id == sourceId }),
              let target = accounts.first(where: { $0.id == targetId })
        else {
            return
        }
        guard !source.isDeleted, !target.isDeleted else {
            return
        }

        let pinned = effectivePinned(source)
        guard effectivePinned(target) == pinned else {
            statusMessage = "仅支持在同一分组内排序"
            return
        }

        let group = sortedAccountsForDisplay(accounts.filter { !$0.isDeleted && effectivePinned($0) == pinned })
        var orderedIds = group.map(\.id)
        guard let fromIndex = orderedIds.firstIndex(of: sourceId),
              let toIndex = orderedIds.firstIndex(of: targetId)
        else {
            return
        }

        orderedIds.remove(at: fromIndex)
        orderedIds.insert(sourceId, at: toIndex)

        let now = nowMs()
        let device = currentDeviceName()
        for (order, id) in orderedIds.enumerated() {
            guard let index = accounts.firstIndex(where: { $0.id == id }) else { continue }
            if pinned {
                accounts[index].pinnedSortOrder = Int64(order)
            } else {
                accounts[index].regularSortOrder = Int64(order)
            }
            accounts[index].touchUpdatedAt(now, deviceName: device)
        }

        saveAccounts()
    }

    func activeAccounts() -> [PasswordAccount] {
        sortedAccountsForDisplay(accounts.filter { !$0.isDeleted })
    }

    func filteredAccounts() -> [PasswordAccount] {
        showDeletedAccounts ? accounts.filter(\.isDeleted) : accounts.filter { !$0.isDeleted }
    }

    func displaySortedAccounts(_ source: [PasswordAccount]) -> [PasswordAccount] {
        sortedAccountsForDisplay(source)
    }

    private func effectivePinned(_ account: PasswordAccount) -> Bool {
        account.isPinned ?? false
    }

    private func nextPinnedSortOrder() -> Int64 {
        let pinnedOrders = accounts.compactMap { account -> Int64? in
            guard effectivePinned(account) else { return nil }
            return account.pinnedSortOrder
        }
        return (pinnedOrders.max() ?? -1) + 1
    }

    private func sortedAccountsForDisplay(_ source: [PasswordAccount]) -> [PasswordAccount] {
        source.sorted { lhs, rhs in
            let lhsPinned = effectivePinned(lhs)
            let rhsPinned = effectivePinned(rhs)
            if lhsPinned != rhsPinned {
                return lhsPinned && !rhsPinned
            }

            if lhsPinned && rhsPinned {
                switch (lhs.pinnedSortOrder, rhs.pinnedSortOrder) {
                case let (.some(lo), .some(ro)) where lo != ro:
                    return lo < ro
                case (.some, .none):
                    return true
                case (.none, .some):
                    return false
                default:
                    break
                }
            } else {
                switch (lhs.regularSortOrder, rhs.regularSortOrder) {
                case let (.some(lo), .some(ro)) where lo != ro:
                    return lo < ro
                case (.some, .none):
                    return true
                case (.none, .some):
                    return false
                default:
                    break
                }
            }

            if lhs.updatedAtMs != rhs.updatedAtMs {
                return lhs.updatedAtMs > rhs.updatedAtMs
            }
            if lhs.createdAtMs != rhs.createdAtMs {
                return lhs.createdAtMs > rhs.createdAtMs
            }
            return lhs.accountId.localizedStandardCompare(rhs.accountId) == .orderedAscending
        }
    }

    func accountForEditing() -> PasswordAccount? {
        guard let editingAccountId else { return nil }
        return accounts.first(where: { $0.id == editingAccountId })
    }

    func displayTime(_ ms: Int64?) -> String {
        guard let ms else { return "-" }
        let date = Date(timeIntervalSince1970: Double(ms) / 1000.0)
        return displayFormatter.string(from: date)
    }

    func syncWithICloudNow() {
        let pulled = pullAccountsFromICloud(trigger: "manual")
        pushAccountsToICloud(trigger: "manual")
        if pulled {
            statusMessage = "已与 iCloud 完成合并同步"
        } else if !iCloudAvailable() {
            statusMessage = "iCloud 不可用，当前仅使用本机数据"
        } else {
            statusMessage = "iCloud 已同步"
        }
    }

    func currentTotpCode(for account: PasswordAccount, at date: Date = Date()) -> String? {
        let secret = account.totpSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !secret.isEmpty else { return nil }
        return TotpGenerator.currentCode(secret: secret, at: date)
    }

    func totpRemainingSeconds(at date: Date = Date()) -> Int {
        TotpGenerator.remainingSeconds(at: date)
    }

    private func load() {
        let defaults = UserDefaults.standard
        deviceName = defaults.string(forKey: Keys.deviceName) ?? ""
        exportDirectoryPath = defaults.string(forKey: Keys.exportDirectoryPath) ?? ""
        if let foldersData = defaults.data(forKey: Keys.foldersData),
           let decodedFolders = try? decoder.decode([AccountFolder].self, from: foldersData)
        {
            folders = decodedFolders
        } else {
            folders = []
        }
        let folderNormalization = normalizeFoldersEnsuringFixedNewAccountFolder()

        let savedFontFamily = defaults.string(forKey: Keys.uiFontFamily) ?? Self.systemDefaultFontFamily
        if savedFontFamily == Self.systemDefaultFontFamily || Self.installedFontFamilies.contains(savedFontFamily) {
            uiFontFamily = savedFontFamily
        } else {
            uiFontFamily = Self.systemDefaultFontFamily
        }

        let savedTextFontSize = defaults.double(forKey: Keys.uiTextFontSize)
        uiTextFontSize = savedTextFontSize > 0 ? savedTextFontSize : 20

        let savedButtonFontSize = defaults.double(forKey: Keys.uiButtonFontSize)
        uiButtonFontSize = savedButtonFontSize > 0 ? savedButtonFontSize : 20

        let savedToastDuration = defaults.double(forKey: Keys.uiToastDurationSeconds)
        uiToastDurationSeconds = savedToastDuration > 0 ? savedToastDuration : 3

        let fileURL = dataFileURL()
        guard let data = try? Data(contentsOf: fileURL) else {
            accounts = []
            if folderNormalization.foldersChanged {
                saveFoldersToDefaults()
            }
            return
        }

        if let decoded = try? decoder.decode([PasswordAccount].self, from: data) {
            accounts = normalizeDecodedAccounts(decoded)
            let accountsChanged = migrateAccountFolderIdsFromLegacyNewAccountFolder(
                legacyFolderIds: folderNormalization.legacyNewAccountFolderIds
            )
            if accountsChanged {
                saveAccountsToLocalDisk()
            }
            if folderNormalization.foldersChanged {
                saveFoldersToDefaults()
            }
            return
        }

        if let legacy = try? decoder.decode([LegacyPasswordAccount].self, from: data) {
            accounts = legacy.map { $0.toCurrent(deviceName: currentDeviceName()) }
            _ = migrateAccountFolderIdsFromLegacyNewAccountFolder(
                legacyFolderIds: folderNormalization.legacyNewAccountFolderIds
            )
            if folderNormalization.foldersChanged {
                saveFoldersToDefaults()
            }
            saveAccounts()
            return
        }

        accounts = []
        if folderNormalization.foldersChanged {
            saveFoldersToDefaults()
        }
    }

    private func saveAccounts() {
        saveAccountsToLocalDisk()
        if !suppressCloudPush {
            pushAccountsToICloud(trigger: "local_update")
        }
    }

    private func saveAccountsToLocalDisk() {
        do {
            let data = try encoder.encode(accounts)
            try FileManager.default.createDirectory(
                at: dataDirectoryURL(),
                withIntermediateDirectories: true
            )
            try data.write(to: dataFileURL(), options: .atomic)
        } catch {
            statusMessage = "保存失败: \(error.localizedDescription)"
        }
    }

    private func setupICloudSync() {
        cloudObserver = NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: cloudStore,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                _ = self.pullAccountsFromICloud(trigger: "remote_change")
            }
        }

        _ = pullAccountsFromICloud(trigger: "startup")
        pushAccountsToICloud(trigger: "startup")
    }

    @discardableResult
    private func pullAccountsFromICloud(trigger: String) -> Bool {
        guard iCloudAvailable() else {
            cloudSyncStatus = "iCloud 不可用，已使用本机数据"
            return false
        }

        _ = cloudStore.synchronize()
        guard let encoded = cloudStore.string(forKey: ICloudKeys.accountsBlob),
              let data = Data(base64Encoded: encoded)
        else {
            cloudSyncStatus = "iCloud 可用，当前无云端数据"
            return false
        }

        let remoteAccounts: [PasswordAccount]
        if let decoded = try? decoder.decode([PasswordAccount].self, from: data) {
            remoteAccounts = normalizeDecodedAccounts(decoded)
        } else if let legacy = try? decoder.decode([LegacyPasswordAccount].self, from: data) {
            remoteAccounts = legacy.map { $0.toCurrent(deviceName: currentDeviceName()) }
        } else {
            cloudSyncStatus = "iCloud 数据解析失败，保留本机数据"
            return false
        }

        let merged = mergeAccountCollections(local: accounts, remote: remoteAccounts)
        guard merged != accounts else {
            if trigger == "manual" {
                cloudSyncStatus = "iCloud 已是最新"
            } else {
                cloudSyncStatus = "iCloud 已连接（无新变更）"
            }
            return false
        }

        suppressCloudPush = true
        accounts = merged
        syncAliasGroups()
        saveAccounts()
        suppressCloudPush = false
        pushAccountsToICloud(trigger: "post_merge")
        cloudSyncStatus = "iCloud 已合并同步: \(displayTime(nowMs()))"
        return true
    }

    private func pushAccountsToICloud(trigger: String) {
        guard iCloudAvailable() else {
            cloudSyncStatus = "iCloud 不可用，已使用本机数据"
            return
        }

        guard let data = try? encoder.encode(accounts) else {
            cloudSyncStatus = "iCloud 编码失败，保留本机数据"
            return
        }

        if data.count > 900_000 {
            cloudSyncStatus = "iCloud 数据过大，当前仅本机保存"
            return
        }

        let encoded = data.base64EncodedString()
        if cloudStore.string(forKey: ICloudKeys.accountsBlob) == encoded {
            if trigger == "manual" {
                cloudSyncStatus = "iCloud 已是最新"
            }
            return
        }

        cloudStore.set(encoded, forKey: ICloudKeys.accountsBlob)
        cloudStore.set(nowMs(), forKey: ICloudKeys.accountsUpdatedAtMs)
        let requested = cloudStore.synchronize()
        cloudSyncStatus = requested
            ? "iCloud 同步已提交: \(displayTime(nowMs()))"
            : "iCloud 同步请求未完成，稍后自动重试"
    }

    private func iCloudAvailable() -> Bool {
        FileManager.default.ubiquityIdentityToken != nil
    }

    private func mergeAccountCollections(
        local: [PasswordAccount],
        remote: [PasswordAccount]
    ) -> [PasswordAccount] {
        var mergedById: [String: PasswordAccount] = [:]
        var order: [String] = []

        for account in local {
            if let existing = mergedById[account.accountId] {
                mergedById[account.accountId] = mergeSameAccount(existing, account)
            } else {
                mergedById[account.accountId] = account
                order.append(account.accountId)
            }
        }

        for account in remote {
            if let existing = mergedById[account.accountId] {
                mergedById[account.accountId] = mergeSameAccount(existing, account)
            } else {
                mergedById[account.accountId] = account
                order.append(account.accountId)
            }
        }

        return order.compactMap { mergedById[$0] }
    }

    private func mergeSameAccount(_ lhs: PasswordAccount, _ rhs: PasswordAccount) -> PasswordAccount {
        let primary = lhs.createdAtMs <= rhs.createdAtMs ? lhs : rhs
        let secondary = lhs.createdAtMs <= rhs.createdAtMs ? rhs : lhs

        let mergedSites = Array(
            Set((lhs.sites + rhs.sites).map(DomainUtils.normalize).filter { !$0.isEmpty })
        ).sorted()
        let canonicalBySites = DomainUtils.etldPlusOne(for: mergedSites.first ?? "")
        let canonicalSite = canonicalBySites.isEmpty ? primary.canonicalSite : canonicalBySites
        let mergedFolderIds = normalizeFolderIds(lhs.resolvedFolderIds + rhs.resolvedFolderIds)

        let usernameField = newerField(
            lhs.username,
            lhs.usernameUpdatedAtMs,
            lhs.updatedAtMs,
            rhs.username,
            rhs.usernameUpdatedAtMs,
            rhs.updatedAtMs
        )
        let passwordField = newerField(
            lhs.password,
            lhs.passwordUpdatedAtMs,
            lhs.updatedAtMs,
            rhs.password,
            rhs.passwordUpdatedAtMs,
            rhs.updatedAtMs
        )
        let totpField = newerField(
            lhs.totpSecret,
            lhs.totpUpdatedAtMs,
            lhs.updatedAtMs,
            rhs.totpSecret,
            rhs.totpUpdatedAtMs,
            rhs.updatedAtMs
        )
        let recoveryField = newerField(
            lhs.recoveryCodes,
            lhs.recoveryCodesUpdatedAtMs,
            lhs.updatedAtMs,
            rhs.recoveryCodes,
            rhs.recoveryCodesUpdatedAtMs,
            rhs.updatedAtMs
        )
        let noteField = newerField(
            lhs.note,
            lhs.noteUpdatedAtMs,
            lhs.updatedAtMs,
            rhs.note,
            rhs.noteUpdatedAtMs,
            rhs.updatedAtMs
        )

        let latestContentUpdatedAt = max(
            usernameField.updatedAtMs,
            passwordField.updatedAtMs,
            totpField.updatedAtMs,
            recoveryField.updatedAtMs,
            noteField.updatedAtMs
        )

        let lhsDeletedAt = lhs.isDeleted ? (lhs.deletedAtMs ?? 0) : 0
        let rhsDeletedAt = rhs.isDeleted ? (rhs.deletedAtMs ?? 0) : 0
        let latestDeletedAt = max(lhsDeletedAt, rhsDeletedAt)
        let keepDeleted = latestDeletedAt > 0 && latestDeletedAt >= latestContentUpdatedAt

        let latestUpdatedAt = max(
            lhs.updatedAtMs,
            rhs.updatedAtMs,
            latestContentUpdatedAt,
            latestDeletedAt,
            primary.createdAtMs
        )
        let newerAccount = lhs.updatedAtMs >= rhs.updatedAtMs ? lhs : rhs
        let usernameAtCreate = primary.usernameAtCreate.isEmpty
            ? secondary.usernameAtCreate
            : primary.usernameAtCreate
        let lastOperatedDeviceName = newerAccount.lastOperatedDeviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? currentDeviceName()
            : newerAccount.lastOperatedDeviceName

        return PasswordAccount(
            id: primary.id,
            accountId: primary.accountId,
            canonicalSite: canonicalSite,
            usernameAtCreate: usernameAtCreate,
            isPinned: newerAccount.isPinned ?? false,
            pinnedSortOrder: newerAccount.pinnedSortOrder,
            regularSortOrder: newerAccount.regularSortOrder,
            folderId: mergedFolderIds.first ?? newerAccount.folderId,
            folderIds: mergedFolderIds,
            sites: mergedSites.isEmpty ? primary.sites : mergedSites,
            username: usernameField.value,
            password: passwordField.value,
            totpSecret: totpField.value,
            recoveryCodes: recoveryField.value,
            note: noteField.value,
            usernameUpdatedAtMs: usernameField.updatedAtMs,
            passwordUpdatedAtMs: passwordField.updatedAtMs,
            totpUpdatedAtMs: totpField.updatedAtMs,
            recoveryCodesUpdatedAtMs: recoveryField.updatedAtMs,
            noteUpdatedAtMs: noteField.updatedAtMs,
            updatedAtMs: latestUpdatedAt,
            isDeleted: keepDeleted,
            deletedAtMs: keepDeleted ? latestDeletedAt : nil,
            lastOperatedDeviceName: lastOperatedDeviceName,
            createdAtMs: min(lhs.createdAtMs, rhs.createdAtMs)
        )
    }

    private func newerField(
        _ lhsValue: String,
        _ lhsUpdatedAt: Int64,
        _ lhsAccountUpdatedAt: Int64,
        _ rhsValue: String,
        _ rhsUpdatedAt: Int64,
        _ rhsAccountUpdatedAt: Int64
    ) -> (value: String, updatedAtMs: Int64) {
        if lhsUpdatedAt > rhsUpdatedAt {
            return (lhsValue, lhsUpdatedAt)
        }
        if rhsUpdatedAt > lhsUpdatedAt {
            return (rhsValue, rhsUpdatedAt)
        }
        if lhsValue == rhsValue {
            return (lhsValue, lhsUpdatedAt)
        }
        if lhsAccountUpdatedAt > rhsAccountUpdatedAt {
            return (lhsValue, lhsUpdatedAt)
        }
        if rhsAccountUpdatedAt > lhsAccountUpdatedAt {
            return (rhsValue, rhsUpdatedAt)
        }
        if lhsValue.isEmpty, !rhsValue.isEmpty {
            return (rhsValue, rhsUpdatedAt)
        }
        return (lhsValue, lhsUpdatedAt)
    }

    // 对所有账号做连通分量并集同步：
    // 若账号 A/B 的 sites 有交集，则视为同一别名组，组内站点取并集并回填。
    private func syncAliasGroups() {
        guard accounts.count >= 2 else { return }

        var components: [[Int]] = []
        var visited = Set<Int>()

        for i in accounts.indices {
            if visited.contains(i) { continue }

            var queue = [i]
            var component = [Int]()
            visited.insert(i)

            while let current = queue.first {
                queue.removeFirst()
                component.append(current)

                let currentSites = Set(accounts[current].sites.map(DomainUtils.normalize))

                for j in accounts.indices where !visited.contains(j) {
                    let targetSites = Set(accounts[j].sites.map(DomainUtils.normalize))
                    if !currentSites.isDisjoint(with: targetSites) {
                        visited.insert(j)
                        queue.append(j)
                    }
                }
            }

            components.append(component)
        }

        for component in components where component.count > 1 {
            let mergedSites: [String] = Array(
                Set(component.flatMap { accounts[$0].sites.map(DomainUtils.normalize) })
            ).sorted()

            for index in component {
                if accounts[index].sites != mergedSites {
                    accounts[index].sites = mergedSites
                    accounts[index].touchUpdatedAt(nowMs(), deviceName: currentDeviceName())
                }
            }
        }
    }

    private func normalizeDecodedAccounts(_ source: [PasswordAccount]) -> [PasswordAccount] {
        source.map { account in
            var mutable = account
            mutable.setResolvedFolderIds(mutable.resolvedFolderIds)
            return mutable
        }
    }

    private func normalizeFoldersEnsuringFixedNewAccountFolder() -> (
        foldersChanged: Bool,
        legacyNewAccountFolderIds: Set<UUID>
    ) {
        let fixedName = Self.fixedNewAccountFolderName
        let fixedId = Self.fixedNewAccountFolderId

        let legacyNewAccountFolderIds: Set<UUID> = Set(
            folders.compactMap { folder in
                guard folder.id != fixedId else { return nil }
                return folder.name.caseInsensitiveCompare(fixedName) == .orderedSame ? folder.id : nil
            }
        )

        let fixedCreatedAt = folders.first(where: { $0.id == fixedId })?.createdAtMs
            ?? folders.filter { legacyNewAccountFolderIds.contains($0.id) }.map(\.createdAtMs).min()
            ?? nowMs()

        let retainedFolders = folders.filter { folder in
            folder.id != fixedId && !legacyNewAccountFolderIds.contains(folder.id)
        }

        let fixedFolder = AccountFolder(
            id: fixedId,
            name: fixedName,
            createdAtMs: fixedCreatedAt
        )

        var deduplicated: [AccountFolder] = [fixedFolder]
        var seenIds: Set<UUID> = [fixedId]
        for folder in retainedFolders {
            if seenIds.insert(folder.id).inserted {
                deduplicated.append(folder)
            }
        }

        let sorted = sortFoldersWithFixedNewAccountFirst(deduplicated)
        let changed = sorted != folders
        folders = sorted
        return (changed, legacyNewAccountFolderIds)
    }

    private func sortFoldersWithFixedNewAccountFirst(_ source: [AccountFolder]) -> [AccountFolder] {
        source.sorted { lhs, rhs in
            if lhs.id == Self.fixedNewAccountFolderId {
                return rhs.id != Self.fixedNewAccountFolderId
            }
            if rhs.id == Self.fixedNewAccountFolderId {
                return false
            }
            if lhs.createdAtMs != rhs.createdAtMs {
                return lhs.createdAtMs < rhs.createdAtMs
            }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }

    private func migrateAccountFolderIdsFromLegacyNewAccountFolder(legacyFolderIds: Set<UUID>) -> Bool {
        let validFolderIds = Set(folders.map(\.id))
        let shouldMigrateLegacyIds = !legacyFolderIds.isEmpty
        var changed = false

        for index in accounts.indices {
            let original = accounts[index].resolvedFolderIds
            var next = original

            if shouldMigrateLegacyIds && !Set(next).isDisjoint(with: legacyFolderIds) {
                next.removeAll(where: { legacyFolderIds.contains($0) })
                if !next.contains(Self.fixedNewAccountFolderId) {
                    next.append(Self.fixedNewAccountFolderId)
                }
            }

            next = normalizeFolderIds(next.filter { validFolderIds.contains($0) })
            if next != original {
                accounts[index].setResolvedFolderIds(next)
                changed = true
            }
        }

        return changed
    }

    private func normalizeFolderIds(_ source: [UUID]) -> [UUID] {
        Array(Set(source)).sorted { $0.uuidString < $1.uuidString }
    }

    private func csvEscaped(_ value: String) -> String {
        "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
    }

    private func parseSites(_ raw: String) -> [String] {
        let normalizedRaw = raw.replacingOccurrences(of: ";", with: "\n")
            .replacingOccurrences(of: ",", with: "\n")
        let values = normalizedRaw
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .map(DomainUtils.normalize)
            .filter { !$0.isEmpty }
        return Array(Set(values)).sorted()
    }

    private func firstSiteAlias(from raw: String) -> String {
        let normalizedRaw = raw.replacingOccurrences(of: ";", with: "\n")
            .replacingOccurrences(of: ",", with: "\n")
        let lines = normalizedRaw.components(separatedBy: .newlines)
        for line in lines {
            let value = DomainUtils.normalize(line)
            if !value.isEmpty {
                return value
            }
        }
        return ""
    }

    private func demoAliasSites(for site: String) -> [String] {
        let normalized = DomainUtils.normalize(site)
        let aliases: [String]
        switch normalized {
        case "icloud.com", "apple.com":
            aliases = ["apple.com", "apple.com.cn", "icloud.com", "icloud.com.cn"]
        case "qq.com", "wx.qq.com":
            aliases = ["qq.com", "wx.qq.com"]
        case "baidu.com":
            aliases = ["baidu.com", "passport.baidu.com", "pan.baidu.com"]
        case "sina.com":
            aliases = ["sina.com", "mail.sina.com", "weibo.com"]
        case "github.com":
            aliases = ["github.com", "gist.github.com"]
        case "gitlab.com":
            aliases = ["gitlab.com", "about.gitlab.com"]
        case "google.com":
            aliases = ["google.com", "accounts.google.com"]
        case "youtube.com":
            aliases = ["youtube.com", "studio.youtube.com"]
        case "x.com":
            aliases = ["x.com", "twitter.com"]
        case "facebook.com":
            aliases = ["facebook.com", "messenger.com"]
        case "amazon.com":
            aliases = ["amazon.com", "smile.amazon.com"]
        case "paypal.com":
            aliases = ["paypal.com", "www.paypal.com"]
        case "microsoft.com":
            aliases = ["microsoft.com", "live.com", "login.microsoftonline.com"]
        case "office.com":
            aliases = ["office.com", "outlook.office.com"]
        case "netflix.com":
            aliases = ["netflix.com", "help.netflix.com"]
        case "spotify.com":
            aliases = ["spotify.com", "open.spotify.com"]
        case "linkedin.com":
            aliases = ["linkedin.com", "www.linkedin.com"]
        case "dropbox.com":
            aliases = ["dropbox.com", "www.dropbox.com"]
        default:
            aliases = [normalized]
        }
        return Array(Set(aliases.map(DomainUtils.normalize).filter { !$0.isEmpty })).sorted()
    }

    private func demoTotpSecret(for index: Int) -> String {
        let seeds = [
            "JBSWY3DPEHPK3PXP",
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
            "KRUGS4ZANFZSAYJA",
            "MFRGGZDFMZTWQ2LK",
            "ONSWG4TFOQ======",
            "NBSWY3DPEB3W64TMMQ======",
            "J5XW4Z3FOI======",
            "KRSXG5DSNFXGOIDB",
            "MZXW6YTBOI======",
            "NB2W45DFOIZA====",
        ]
        return seeds[index % seeds.count]
    }

    private func demoRecoveryCodes(for index: Int) -> String {
        let prefix = String(format: "%02d", index)
        return """
        RC\(prefix)-A1B2-C3D4
        RC\(prefix)-E5F6-G7H8
        RC\(prefix)-J9K0-L1M2
        RC\(prefix)-N3P4-Q5R6
        RC\(prefix)-S7T8-U9V0
        """
    }

    private func timestampForFile() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }

    private func dataDirectoryURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("pass-mac", isDirectory: true)
    }

    private func dataFileURL() -> URL {
        dataDirectoryURL().appendingPathComponent("accounts.json", isDirectory: false)
    }

    private func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func currentDeviceName() -> String {
        let trimmed = deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "MacDevice" : trimmed
    }

    private func showToast(_ message: String) {
        toastDismissWorkItem?.cancel()
        toastMessage = message
        isToastVisible = true

        let dismissWorkItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                self.isToastVisible = false
            }
        }
        toastDismissWorkItem = dismissWorkItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + uiToastDurationSeconds,
            execute: dismissWorkItem
        )
    }

    private func setStatusMessage(_ message: String, allowsUndoMove: Bool = false) {
        nextStatusAllowsUndoMove = allowsUndoMove
        statusMessage = message
    }

    private func showUndoMoveToast(message: String) {
        undoMoveDismissWorkItem?.cancel()
        undoMoveToastMessage = message
        isUndoMoveToastVisible = true

        let dismissWorkItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                self.isUndoMoveToastVisible = false
            }
        }
        undoMoveDismissWorkItem = dismissWorkItem
        DispatchQueue.main.asyncAfter(
            deadline: .now() + 3.0,
            execute: dismissWorkItem
        )
    }

    private func saveFoldersToDefaults() {
        guard let data = try? encoder.encode(folders) else {
            return
        }
        UserDefaults.standard.set(data, forKey: Keys.foldersData)
    }

    var uiFontFamilyOptions: [String] {
        [Self.systemDefaultFontFamily] + NSFontManager.shared.availableFontFamilies.sorted()
    }

    func textFont(size: CGFloat? = nil, weight: Font.Weight = .regular) -> Font {
        appFont(size: size ?? CGFloat(uiTextFontSize), weight: weight)
    }

    func buttonFont(size: CGFloat? = nil, weight: Font.Weight = .semibold) -> Font {
        appFont(size: size ?? CGFloat(uiButtonFontSize), weight: weight)
    }

    func scaledTextSize(_ base: CGFloat) -> CGFloat {
        max(8, base + CGFloat(uiTextFontSize - 17))
    }

    private func appFont(size: CGFloat, weight: Font.Weight) -> Font {
        if uiFontFamily == Self.systemDefaultFontFamily {
            return .system(size: size, weight: weight)
        }
        return .custom(uiFontFamily, size: size).weight(weight)
    }
}

private enum Keys {
    static let deviceName = "pass.deviceName"
    static let exportDirectoryPath = "pass.export.directoryPath"
    static let foldersData = "pass.folders.data"
    static let uiFontFamily = "pass.ui.font.family"
    static let uiTextFontSize = "pass.ui.font.textSize"
    static let uiButtonFontSize = "pass.ui.font.buttonSize"
    static let uiToastDurationSeconds = "pass.ui.toast.duration"
}

private enum ICloudKeys {
    static let accountsBlob = "pass.accounts.blob.v1"
    static let accountsUpdatedAtMs = "pass.accounts.updatedAtMs.v1"
}

private struct LegacyPasswordAccount: Codable {
    let id: UUID
    let accountId: String
    let sites: [String]
    let username: String
    let password: String
    let updatedAtMs: Int64
    let isDeleted: Bool
}

private extension LegacyPasswordAccount {
    func toCurrent(deviceName: String) -> PasswordAccount {
        let normalizedSites = Array(Set(sites.map(DomainUtils.normalize))).sorted()
        let canonical = DomainUtils.etldPlusOne(for: normalizedSites.first ?? "")
        return PasswordAccount(
            id: id,
            accountId: accountId,
            canonicalSite: canonical,
            usernameAtCreate: username,
            isPinned: false,
            pinnedSortOrder: nil,
            regularSortOrder: nil,
            folderId: nil,
            folderIds: [],
            sites: normalizedSites,
            username: username,
            password: password,
            totpSecret: "",
            recoveryCodes: "",
            note: "",
            usernameUpdatedAtMs: updatedAtMs,
            passwordUpdatedAtMs: updatedAtMs,
            totpUpdatedAtMs: updatedAtMs,
            recoveryCodesUpdatedAtMs: updatedAtMs,
            noteUpdatedAtMs: updatedAtMs,
            updatedAtMs: updatedAtMs,
            isDeleted: isDeleted,
            deletedAtMs: isDeleted ? updatedAtMs : nil,
            lastOperatedDeviceName: deviceName,
            createdAtMs: updatedAtMs
        )
    }
}
