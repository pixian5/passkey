import AppKit
import Foundation
import SwiftUI
import Vision

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
    @Published private(set) var passkeys: [PasskeyRecord] = []
    @Published var syncEnableICloud: Bool = true {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            UserDefaults.standard.set(syncEnableICloud, forKey: Keys.syncEnableICloud)
            handleSyncSourceSelectionChanged()
        }
    }
    @Published var syncEnableWebDAV: Bool = false {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            UserDefaults.standard.set(syncEnableWebDAV, forKey: Keys.syncEnableWebDAV)
            handleSyncSourceSelectionChanged()
        }
    }
    @Published var syncEnableSelfHostedServer: Bool = false {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            UserDefaults.standard.set(syncEnableSelfHostedServer, forKey: Keys.syncEnableSelfHostedServer)
            handleSyncSourceSelectionChanged()
        }
    }
    @Published var webdavBaseURL: String = "" {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            UserDefaults.standard.set(webdavBaseURL, forKey: Keys.webdavBaseURL)
        }
    }
    @Published var webdavRemotePath: String = "pass-sync-bundle-v2.json" {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            UserDefaults.standard.set(webdavRemotePath, forKey: Keys.webdavRemotePath)
        }
    }
    @Published var webdavUsername: String = "" {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            UserDefaults.standard.set(webdavUsername, forKey: Keys.webdavUsername)
        }
    }
    @Published var webdavPassword: String = "" {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            _ = saveSecret(webdavPassword, account: SecretKeys.webdavPasswordAccount)
        }
    }
    @Published var serverBaseURL: String = "" {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            UserDefaults.standard.set(serverBaseURL, forKey: Keys.serverBaseURL)
        }
    }
    @Published var serverAuthToken: String = "" {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            _ = saveSecret(serverAuthToken, account: SecretKeys.serverTokenAccount)
        }
    }

    static let systemDefaultFontFamily = "系统默认"
    static let fixedNewAccountFolderName = "新账号"
    static let fixedNewAccountFolderId = UUID(uuidString: "F16A2C4E-4A2A-43D5-A670-3F1767D41001")!
    static let syncBundleSchemaV2 = "pass.sync.bundle.v2"
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
    private var isLoadingSyncPreferences: Bool = false
    private var syncNowTask: Task<Void, Never>?

    private struct FolderMoveOperation {
        let accountIds: [UUID]
        let previousFolderIdsByAccountId: [UUID: [UUID]]
        let actionSummary: String
    }

    init() {
        load()
        handleSyncSourceSelectionChanged()
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
            createdAtMs: nowMs(),
            updatedAtMs: nowMs()
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

    func pasteCreateTotpRawSecretFromClipboard() {
        pasteRawTotpSecretFromClipboard(to: .create)
    }

    func pasteCreateTotpURIFromClipboard() {
        pasteOtpAuthURIFromClipboard(to: .create)
    }

    func pasteCreateTotpQRCodeFromClipboard() {
        pasteQRCodeFromClipboard(to: .create)
    }

    func pasteEditTotpRawSecretFromClipboard() {
        pasteRawTotpSecretFromClipboard(to: .edit)
    }

    func pasteEditTotpURIFromClipboard() {
        pasteOtpAuthURIFromClipboard(to: .edit)
    }

    func pasteEditTotpQRCodeFromClipboard() {
        pasteQRCodeFromClipboard(to: .edit)
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

    func suggestedSyncBundleFileName() -> String {
        "pass-sync-bundle-\(timestampForFile()).json"
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

    func exportSyncBundle(to fileURL: URL) {
        let bundle = SyncBundleV2(
            schema: Self.syncBundleSchemaV2,
            exportedAtMs: nowMs(),
            source: SyncBundleSource(
                app: "pass-mac",
                platform: "macos-app",
                deviceName: currentDeviceName(),
                formatVersion: 2
            ),
            payload: SyncBundlePayload(
                accounts: accounts,
                folders: folders,
                passkeys: passkeys
            )
        )

        do {
            let parentDirectory = fileURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(
                at: parentDirectory,
                withIntermediateDirectories: true
            )
            let data = try encoder.encode(bundle)
            try data.write(to: fileURL, options: .atomic)
            statusMessage = "同步包导出成功: \(fileURL.path)"
        } catch {
            statusMessage = "同步包导出失败: \(error.localizedDescription)"
        }
    }

    func importSyncBundle(from fileURL: URL) {
        do {
            let data = try Data(contentsOf: fileURL)
            let parsed = try decodeSyncBundle(data)
            let remoteAccounts = normalizeDecodedAccounts(parsed.accounts)
            let remoteFolders = parsed.folders
            let remotePasskeys = parsed.passkeys

            let localAccountCount = accounts.count
            let localFolderCount = folders.count
            let localPasskeyCount = passkeys.count

            let mergedFolders = mergeFolderCollections(local: folders, remote: remoteFolders)
            let validFolderIds = Set(mergedFolders.map(\.id))
            var mergedAccounts = mergeAccountCollections(local: accounts, remote: remoteAccounts)
            mergedAccounts = reconcileAccountsWithValidFolderIds(mergedAccounts, validFolderIds: validFolderIds)
            let mergedPasskeys = mergePasskeyCollections(local: passkeys, remote: remotePasskeys)

            folders = mergedFolders
            accounts = mergedAccounts
            passkeys = mergedPasskeys
            syncAliasGroups()
            saveFoldersToDefaults()
            saveAccounts()
            savePasskeysToLocalDisk()

            if let editingAccountId, !accounts.contains(where: { $0.id == editingAccountId }) {
                cancelEditing()
            }

            statusMessage =
                "同步包导入并合并完成（\(parsed.kind)）：账号 \(localAccountCount)+\(remoteAccounts.count)->\(accounts.count)，" +
                "文件夹 \(localFolderCount)+\(remoteFolders.count)->\(folders.count)，" +
                "通行密钥 \(localPasskeyCount)+\(remotePasskeys.count)->\(passkeys.count)"
        } catch {
            statusMessage = "同步包导入失败: \(error.localizedDescription)"
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
            statusMessage = "仅支持 置顶、非置顶 项目内部排序"
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

            // 最近修改优先；恢复回收站、编辑保存后会触发 updatedAtMs 更新并置顶。
            if lhs.updatedAtMs != rhs.updatedAtMs {
                return lhs.updatedAtMs > rhs.updatedAtMs
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

    var syncNowButtonTitle: String {
        "同步已启用源"
    }

    func syncWithICloudNow() {
        syncNow()
    }

    func syncNow() {
        if let syncNowTask, !syncNowTask.isCancelled {
            statusMessage = "同步进行中，请稍候"
            return
        }
        syncNowTask = Task { [weak self] in
            guard let self else { return }
            await self.performSyncNow()
            self.syncNowTask = nil
        }
    }

    private func performSyncNow() async {
        let enabledSourceNames = activeSyncSourceNames()
        guard !enabledSourceNames.isEmpty else {
            cloudSyncStatus = "未启用同步源"
            statusMessage = "请先启用至少一个同步源"
            return
        }

        var mergedPayload = buildCurrentSyncPayload()

        if syncEnableICloud {
            do {
                if let remotePayload = try fetchRemotePayloadFromICloud() {
                    mergedPayload = mergePayloads(local: mergedPayload, remote: remotePayload)
                }
            } catch {
                statusMessage = "iCloud 拉取失败: \(error.localizedDescription)"
                return
            }
        }

        if syncEnableWebDAV {
            guard let resourceURL = buildWebDAVResourceURL() else {
                statusMessage = "WebDAV 配置不完整：请填写服务地址与远端文件路径"
                return
            }
            do {
                let authorization = buildBasicAuthorization(
                    username: webdavUsername,
                    password: webdavPassword
                )
                if let remotePayload = try await fetchRemotePayload(
                    from: resourceURL,
                    authorization: authorization
                ) {
                    mergedPayload = mergePayloads(local: mergedPayload, remote: remotePayload)
                }
            } catch {
                statusMessage = "WebDAV 拉取失败: \(error.localizedDescription)"
                return
            }
        }

        if syncEnableSelfHostedServer {
            guard let resourceURL = buildSelfHostedPayloadURL() else {
                statusMessage = "服务器配置不完整：请填写服务地址"
                return
            }
            do {
                let authorization = buildBearerAuthorization(serverAuthToken)
                if let remotePayload = try await fetchRemotePayload(
                    from: resourceURL,
                    authorization: authorization
                ) {
                    mergedPayload = mergePayloads(local: mergedPayload, remote: remotePayload)
                }
            } catch {
                statusMessage = "服务器拉取失败: \(error.localizedDescription)"
                return
            }
        }

        let changed = applyMergedPayloadIfNeeded(mergedPayload)
        var pushErrors: [String] = []

        if syncEnableICloud {
            do {
                _ = try pushPayloadToICloud(mergedPayload)
            } catch {
                pushErrors.append("iCloud: \(error.localizedDescription)")
            }
        }

        if syncEnableWebDAV {
            guard let resourceURL = buildWebDAVResourceURL() else {
                pushErrors.append("WebDAV: 配置不完整")
                updateSyncStatusAfterSync(changed: changed, enabledSourceNames: enabledSourceNames, pushErrors: pushErrors)
                return
            }
            do {
                let authorization = buildBasicAuthorization(
                    username: webdavUsername,
                    password: webdavPassword
                )
                try await pushRemotePayload(
                    mergedPayload,
                    to: resourceURL,
                    authorization: authorization
                )
            } catch {
                pushErrors.append("WebDAV: \(error.localizedDescription)")
            }
        }

        if syncEnableSelfHostedServer {
            guard let resourceURL = buildSelfHostedPayloadURL() else {
                pushErrors.append("服务器: 配置不完整")
                updateSyncStatusAfterSync(changed: changed, enabledSourceNames: enabledSourceNames, pushErrors: pushErrors)
                return
            }
            do {
                let authorization = buildBearerAuthorization(serverAuthToken)
                try await pushRemotePayload(
                    mergedPayload,
                    to: resourceURL,
                    authorization: authorization
                )
            } catch {
                pushErrors.append("服务器: \(error.localizedDescription)")
            }
        }

        updateSyncStatusAfterSync(changed: changed, enabledSourceNames: enabledSourceNames, pushErrors: pushErrors)
    }

    private func updateSyncStatusAfterSync(
        changed: Bool,
        enabledSourceNames: [String],
        pushErrors: [String]
    ) {
        let sourceSummary = enabledSourceNames.joined(separator: " + ")
        if pushErrors.isEmpty {
            cloudSyncStatus = changed
                ? "\(sourceSummary) 已合并并同步: \(displayTime(nowMs()))"
                : "\(sourceSummary) 已同步: \(displayTime(nowMs()))"
            statusMessage = changed
                ? "已与 \(sourceSummary) 完成合并同步"
                : "\(sourceSummary) 已同步"
        } else {
            cloudSyncStatus = "同步部分失败: \(pushErrors.joined(separator: "；"))"
            statusMessage = "同步完成但部分源失败：\(pushErrors.joined(separator: "；"))"
        }
    }

    private func activeSyncSourceNames() -> [String] {
        var names: [String] = []
        if syncEnableICloud { names.append("iCloud") }
        if syncEnableWebDAV { names.append("WebDAV") }
        if syncEnableSelfHostedServer { names.append("服务器") }
        return names
    }

    private func buildCurrentSyncPayload() -> SyncBundlePayload {
        SyncBundlePayload(
            accounts: accounts,
            folders: folders,
            passkeys: passkeys
        )
    }

    private func buildSyncBundleDocument(payload: SyncBundlePayload) -> SyncBundleV2 {
        SyncBundleV2(
            schema: Self.syncBundleSchemaV2,
            exportedAtMs: nowMs(),
            source: SyncBundleSource(
                app: "pass-mac",
                platform: "macos-app",
                deviceName: currentDeviceName(),
                formatVersion: 2
            ),
            payload: payload
        )
    }

    private func mergePayloads(local: SyncBundlePayload, remote: SyncBundlePayload) -> SyncBundlePayload {
        let mergedFolders = mergeFolderCollections(local: local.folders, remote: remote.folders)
        let validFolderIds = Set(mergedFolders.map(\.id))
        var mergedAccounts = mergeAccountCollections(
            local: normalizeDecodedAccounts(local.accounts),
            remote: normalizeDecodedAccounts(remote.accounts)
        )
        mergedAccounts = reconcileAccountsWithValidFolderIds(mergedAccounts, validFolderIds: validFolderIds)
        let mergedPasskeys = mergePasskeyCollections(local: local.passkeys, remote: remote.passkeys)
        return SyncBundlePayload(
            accounts: mergedAccounts,
            folders: mergedFolders,
            passkeys: mergedPasskeys
        )
    }

    @discardableResult
    private func applyMergedPayloadIfNeeded(_ payload: SyncBundlePayload) -> Bool {
        let currentPayload = buildCurrentSyncPayload()
        guard !syncPayloadEquals(currentPayload, payload) else { return false }
        suppressCloudPush = true
        defer { suppressCloudPush = false }
        folders = payload.folders
        accounts = payload.accounts
        passkeys = payload.passkeys
        syncAliasGroups()
        saveFoldersToDefaults()
        saveAccounts()
        savePasskeysToLocalDisk()
        return true
    }

    private func syncPayloadEquals(_ lhs: SyncBundlePayload, _ rhs: SyncBundlePayload) -> Bool {
        guard let leftData = try? encoder.encode(lhs),
              let rightData = try? encoder.encode(rhs)
        else {
            return false
        }
        return leftData == rightData
    }

    private func buildWebDAVResourceURL() -> URL? {
        let base = webdavBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        let remotePath = webdavRemotePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !base.isEmpty, !remotePath.isEmpty, let baseURL = URL(string: base) else {
            return nil
        }
        var url = baseURL
        for component in remotePath.split(separator: "/").map(String.init) {
            url.appendPathComponent(component)
        }
        return url
    }

    private func buildSelfHostedPayloadURL() -> URL? {
        let base = serverBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !base.isEmpty else { return nil }
        let normalizedBase = base.hasSuffix("/") ? base : "\(base)/"
        return URL(string: "v1/sync/payload", relativeTo: URL(string: normalizedBase))?.absoluteURL
    }

    private func buildBasicAuthorization(username: String, password: String) -> String? {
        guard !username.isEmpty || !password.isEmpty else { return nil }
        let source = "\(username):\(password)"
        guard let data = source.data(using: .utf8) else { return nil }
        return "Basic \(data.base64EncodedString())"
    }

    private func buildBearerAuthorization(_ token: String) -> String? {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return "Bearer \(trimmed)"
    }

    private func fetchRemotePayload(from url: URL, authorization: String?) async throws -> SyncBundlePayload? {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let authorization {
            request.setValue(authorization, forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(
                domain: "AccountStore.SyncRemote",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "远端响应不可识别"]
            )
        }
        if http.statusCode == 404 {
            return nil
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw NSError(
                domain: "AccountStore.SyncRemote",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "远端拉取失败，HTTP \(http.statusCode)"]
            )
        }
        guard !data.isEmpty else {
            return nil
        }
        let parsed = try decodeSyncBundle(data)
        return SyncBundlePayload(
            accounts: normalizeDecodedAccounts(parsed.accounts),
            folders: parsed.folders,
            passkeys: parsed.passkeys
        )
    }

    private func pushRemotePayload(_ payload: SyncBundlePayload, to url: URL, authorization: String?) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let authorization {
            request.setValue(authorization, forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try encoder.encode(buildSyncBundleDocument(payload: payload))
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(
                domain: "AccountStore.SyncRemote",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "远端响应不可识别"]
            )
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw NSError(
                domain: "AccountStore.SyncRemote",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "远端上传失败，HTTP \(http.statusCode)"]
            )
        }
    }

    private func saveSecret(_ secret: String, account: String) -> Bool {
        if secret.isEmpty {
            return LocalKeychain.delete(service: SecretKeys.service, account: account)
        }
        guard let data = secret.data(using: .utf8) else { return false }
        return LocalKeychain.save(service: SecretKeys.service, account: account, data: data)
    }

    private func readSecret(account: String) -> String {
        guard let data = LocalKeychain.read(service: SecretKeys.service, account: account),
              let value = String(data: data, encoding: .utf8)
        else {
            return ""
        }
        return value
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
        isLoadingSyncPreferences = true
        syncEnableICloud = defaults.object(forKey: Keys.syncEnableICloud) as? Bool ?? true
        syncEnableWebDAV = defaults.object(forKey: Keys.syncEnableWebDAV) as? Bool ?? false
        syncEnableSelfHostedServer = defaults.object(forKey: Keys.syncEnableSelfHostedServer) as? Bool ?? false
        webdavBaseURL = defaults.string(forKey: Keys.webdavBaseURL) ?? ""
        webdavRemotePath = defaults.string(forKey: Keys.webdavRemotePath) ?? "pass-sync-bundle-v2.json"
        webdavUsername = defaults.string(forKey: Keys.webdavUsername) ?? ""
        webdavPassword = readSecret(account: SecretKeys.webdavPasswordAccount)
        serverBaseURL = defaults.string(forKey: Keys.serverBaseURL) ?? ""
        serverAuthToken = readSecret(account: SecretKeys.serverTokenAccount)
        isLoadingSyncPreferences = false
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

        passkeys = loadPasskeysFromLocalDisk()

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
        if !suppressCloudPush && syncEnableICloud {
            pushSyncDataToICloud(trigger: "local_update")
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

    private func loadPasskeysFromLocalDisk() -> [PasskeyRecord] {
        let fileURL = passkeysFileURL()
        guard let data = try? Data(contentsOf: fileURL) else {
            return []
        }
        guard let decoded = try? decoder.decode([PasskeyRecord].self, from: data) else {
            return []
        }
        return decoded.map(normalizePasskeyRecord)
    }

    private func savePasskeysToLocalDisk() {
        do {
            let data = try encoder.encode(passkeys.map(normalizePasskeyRecord))
            try FileManager.default.createDirectory(
                at: dataDirectoryURL(),
                withIntermediateDirectories: true
            )
            try data.write(to: passkeysFileURL(), options: .atomic)
            if !suppressCloudPush && syncEnableICloud {
                pushSyncDataToICloud(trigger: "local_update")
            }
        } catch {
            statusMessage = "保存通行密钥失败: \(error.localizedDescription)"
        }
    }

    private func handleSyncSourceSelectionChanged() {
        if syncEnableICloud {
            if cloudObserver == nil {
                setupICloudSync()
            }
        } else {
            teardownICloudSyncObserver()
        }
        if cloudObserver == nil {
            refreshSyncSourceStatusHint()
        }
    }

    private func refreshSyncSourceStatusHint() {
        let names = activeSyncSourceNames()
        if names.isEmpty {
            cloudSyncStatus = "未启用同步源"
            return
        }
        cloudSyncStatus = "已启用同步源：\(names.joined(separator: " + "))"
    }

    private func teardownICloudSyncObserver() {
        if let observer = cloudObserver {
            NotificationCenter.default.removeObserver(observer)
            cloudObserver = nil
        }
    }

    private func setupICloudSync() {
        teardownICloudSyncObserver()
        cloudObserver = NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: cloudStore,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.syncEnableWebDAV || self.syncEnableSelfHostedServer {
                    self.syncNow()
                } else {
                    _ = self.pullSyncDataFromICloud(trigger: "remote_change")
                }
            }
        }

        if syncEnableWebDAV || syncEnableSelfHostedServer {
            syncNow()
        } else {
            _ = pullSyncDataFromICloud(trigger: "startup")
            pushSyncDataToICloud(trigger: "startup")
        }
    }

    @discardableResult
    private func pullSyncDataFromICloud(trigger: String) -> Bool {
        guard syncEnableICloud else { return false }
        let remotePayload: SyncBundlePayload
        do {
            guard let fetched = try fetchRemotePayloadFromICloud() else {
                if trigger == "manual" {
                    cloudSyncStatus = "iCloud 可用，当前无云端数据"
                }
                return false
            }
            remotePayload = fetched
        } catch {
            cloudSyncStatus = error.localizedDescription
            return false
        }

        let localPayload = buildCurrentSyncPayload()
        let mergedPayload = mergePayloads(local: localPayload, remote: remotePayload)
        let changed = applyMergedPayloadIfNeeded(mergedPayload)
        guard changed else {
            if trigger == "manual" {
                cloudSyncStatus = "iCloud 已是最新"
            } else {
                cloudSyncStatus = "iCloud 已连接（无新变更）"
            }
            return false
        }

        do {
            _ = try pushPayloadToICloud(buildCurrentSyncPayload())
        } catch {
            cloudSyncStatus = "iCloud 合并后回写失败: \(error.localizedDescription)"
            return false
        }
        cloudSyncStatus = "iCloud 已合并同步: \(displayTime(nowMs()))"
        return true
    }

    private func pushSyncDataToICloud(trigger: String) {
        guard syncEnableICloud else { return }
        do {
            let requested = try pushPayloadToICloud(buildCurrentSyncPayload())
            if trigger == "manual" && requested {
                cloudSyncStatus = "iCloud 同步已提交: \(displayTime(nowMs()))"
            } else if trigger == "manual" {
                cloudSyncStatus = "iCloud 同步请求未完成，稍后自动重试"
            }
        } catch {
            cloudSyncStatus = "iCloud 同步失败: \(error.localizedDescription)"
        }
    }

    private func fetchRemotePayloadFromICloud() throws -> SyncBundlePayload? {
        guard iCloudAvailable() else {
            throw NSError(
                domain: "AccountStore.ICloudSync",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "iCloud 不可用，已使用本机数据"]
            )
        }

        _ = cloudStore.synchronize()
        guard let encoded = cloudStore.string(forKey: ICloudKeys.syncPayloadBlob),
              let data = Data(base64Encoded: encoded)
        else {
            return nil
        }

        let parsed = try decodeSyncBundle(data)
        return SyncBundlePayload(
            accounts: normalizeDecodedAccounts(parsed.accounts),
            folders: parsed.folders,
            passkeys: parsed.passkeys
        )
    }

    private func pushPayloadToICloud(_ payload: SyncBundlePayload) throws -> Bool {
        guard iCloudAvailable() else {
            throw NSError(
                domain: "AccountStore.ICloudSync",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "iCloud 不可用，已使用本机数据"]
            )
        }
        let bundle = buildSyncBundleDocument(payload: payload)
        let data = try encoder.encode(bundle)
        if data.count > 900_000 {
            throw NSError(
                domain: "AccountStore.ICloudSync",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "iCloud 数据过大，当前仅本机保存"]
            )
        }

        let encoded = data.base64EncodedString()
        if cloudStore.string(forKey: ICloudKeys.syncPayloadBlob) == encoded {
            return true
        }

        cloudStore.set(encoded, forKey: ICloudKeys.syncPayloadBlob)
        cloudStore.set(nowMs(), forKey: ICloudKeys.syncPayloadUpdatedAtMs)
        return cloudStore.synchronize()
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
        let mergedPasskeyCredentialIds = Array(
            Set((lhs.passkeyCredentialIds + rhs.passkeyCredentialIds)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty })
        ).sorted()
        let passkeyUpdatedAtMs = max(lhs.passkeyUpdatedAtMs, rhs.passkeyUpdatedAtMs)

        let latestContentUpdatedAt = max(
            usernameField.updatedAtMs,
            passwordField.updatedAtMs,
            totpField.updatedAtMs,
            recoveryField.updatedAtMs,
            noteField.updatedAtMs,
            passkeyUpdatedAtMs
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
            passkeyCredentialIds: mergedPasskeyCredentialIds,
            usernameUpdatedAtMs: usernameField.updatedAtMs,
            passwordUpdatedAtMs: passwordField.updatedAtMs,
            totpUpdatedAtMs: totpField.updatedAtMs,
            recoveryCodesUpdatedAtMs: recoveryField.updatedAtMs,
            noteUpdatedAtMs: noteField.updatedAtMs,
            passkeyUpdatedAtMs: passkeyUpdatedAtMs,
            updatedAtMs: latestUpdatedAt,
            isDeleted: keepDeleted,
            deletedAtMs: keepDeleted ? latestDeletedAt : nil,
            lastOperatedDeviceName: lastOperatedDeviceName,
            createdAtMs: min(lhs.createdAtMs, rhs.createdAtMs)
        )
    }

    private func mergeFolderCollections(
        local: [AccountFolder],
        remote: [AccountFolder]
    ) -> [AccountFolder] {
        var mergedById: [UUID: AccountFolder] = [:]

        for folder in local {
            mergedById[folder.id] = folder
        }

        for folder in remote {
            if let existing = mergedById[folder.id] {
                mergedById[folder.id] = mergeSameFolder(existing, folder)
            } else {
                mergedById[folder.id] = folder
            }
        }

        let fixedId = Self.fixedNewAccountFolderId
        if let existing = mergedById[fixedId] {
            mergedById[fixedId] = AccountFolder(
                id: fixedId,
                name: Self.fixedNewAccountFolderName,
                createdAtMs: existing.createdAtMs,
                updatedAtMs: existing.updatedAtMs
            )
        } else {
            mergedById[fixedId] = AccountFolder(
                id: fixedId,
                name: Self.fixedNewAccountFolderName,
                createdAtMs: nowMs(),
                updatedAtMs: nowMs()
            )
        }

        return sortFoldersWithFixedNewAccountFirst(Array(mergedById.values))
    }

    private func mergeSameFolder(_ lhs: AccountFolder, _ rhs: AccountFolder) -> AccountFolder {
        let leftUpdatedAt = lhs.updatedAtMs
        let rightUpdatedAt = rhs.updatedAtMs
        if lhs.id == Self.fixedNewAccountFolderId {
            return AccountFolder(
                id: lhs.id,
                name: Self.fixedNewAccountFolderName,
                createdAtMs: min(lhs.createdAtMs, rhs.createdAtMs),
                updatedAtMs: max(leftUpdatedAt, rightUpdatedAt)
            )
        }

        let leftName = lhs.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let rightName = rhs.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let mergedName: String
        if rightUpdatedAt > leftUpdatedAt {
            mergedName = rightName.isEmpty ? leftName : rightName
        } else if leftUpdatedAt > rightUpdatedAt {
            mergedName = leftName.isEmpty ? rightName : leftName
        } else {
            mergedName = leftName.isEmpty ? rightName : leftName
        }

        return AccountFolder(
            id: lhs.id,
            name: mergedName.isEmpty ? lhs.name : mergedName,
            createdAtMs: min(lhs.createdAtMs, rhs.createdAtMs),
            updatedAtMs: max(leftUpdatedAt, rightUpdatedAt)
        )
    }

    private func normalizePasskeyRecord(_ source: PasskeyRecord) -> PasskeyRecord {
        let normalizedCredentialId = source.credentialIdB64u.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedRpId = DomainUtils.normalize(source.rpId)
        let normalizedUserName = source.userName.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedDisplayName = source.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedMode = source.mode.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedCreateCompatMethod = normalizePasskeyCreateCompatMethod(source.createCompatMethod, alg: source.alg)
        let createdAt = max(source.createdAtMs, 0)
        let updatedAt = max(source.updatedAtMs, createdAt)
        let lastUsedAt = source.lastUsedAtMs.map { max($0, 0) }

        return PasskeyRecord(
            credentialIdB64u: normalizedCredentialId,
            rpId: normalizedRpId,
            userName: normalizedUserName,
            displayName: normalizedDisplayName,
            userHandleB64u: source.userHandleB64u,
            alg: source.alg,
            signCount: max(source.signCount, 0),
            privateJwk: source.privateJwk,
            publicJwk: source.publicJwk,
            createdAtMs: createdAt,
            updatedAtMs: updatedAt,
            lastUsedAtMs: lastUsedAt,
            mode: normalizedMode.isEmpty ? "managed" : normalizedMode,
            createCompatMethod: normalizedCreateCompatMethod
        )
    }

    private func normalizePasskeyCreateCompatMethod(_ raw: String?, alg: Int) -> String {
        let normalized = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch normalized {
        case "standard", "user_name_fallback", "rs256", "user_name_fallback+rs256", "unknown_linked":
            return normalized
        default:
            return alg == -257 ? "rs256" : "standard"
        }
    }

    private func mergePasskeyCollections(
        local: [PasskeyRecord],
        remote: [PasskeyRecord]
    ) -> [PasskeyRecord] {
        var mergedById: [String: PasskeyRecord] = [:]
        var order: [String] = []
        for item in (local + remote) {
            let normalized = normalizePasskeyRecord(item)
            let id = normalized.credentialIdB64u
            guard !id.isEmpty else { continue }
            if let existing = mergedById[id] {
                mergedById[id] = mergeSamePasskey(existing, normalized)
            } else {
                mergedById[id] = normalized
                order.append(id)
            }
        }
        return order.compactMap { mergedById[$0] }.sorted { lhs, rhs in
            if lhs.updatedAtMs != rhs.updatedAtMs {
                return lhs.updatedAtMs > rhs.updatedAtMs
            }
            return lhs.credentialIdB64u < rhs.credentialIdB64u
        }
    }

    private func mergeSamePasskey(_ lhs: PasskeyRecord, _ rhs: PasskeyRecord) -> PasskeyRecord {
        let left = normalizePasskeyRecord(lhs)
        let right = normalizePasskeyRecord(rhs)
        let newer = left.updatedAtMs >= right.updatedAtMs ? left : right
        let older = left.updatedAtMs >= right.updatedAtMs ? right : left

        return PasskeyRecord(
            credentialIdB64u: newer.credentialIdB64u.isEmpty ? older.credentialIdB64u : newer.credentialIdB64u,
            rpId: newer.rpId.isEmpty ? older.rpId : newer.rpId,
            userName: newer.userName.isEmpty ? older.userName : newer.userName,
            displayName: newer.displayName.isEmpty ? older.displayName : newer.displayName,
            userHandleB64u: newer.userHandleB64u.isEmpty ? older.userHandleB64u : newer.userHandleB64u,
            alg: newer.alg == 0 ? older.alg : newer.alg,
            signCount: max(left.signCount, right.signCount),
            privateJwk: newer.privateJwk ?? older.privateJwk,
            publicJwk: newer.publicJwk ?? older.publicJwk,
            createdAtMs: min(left.createdAtMs, right.createdAtMs),
            updatedAtMs: max(left.updatedAtMs, right.updatedAtMs),
            lastUsedAtMs: max(left.lastUsedAtMs ?? 0, right.lastUsedAtMs ?? 0) > 0
                ? max(left.lastUsedAtMs ?? 0, right.lastUsedAtMs ?? 0)
                : nil,
            mode: newer.mode.isEmpty ? older.mode : newer.mode,
            createCompatMethod: normalizePasskeyCreateCompatMethod(
                newer.createCompatMethod ?? older.createCompatMethod,
                alg: newer.alg == 0 ? older.alg : newer.alg
            )
        )
    }

    private func reconcileAccountsWithValidFolderIds(
        _ source: [PasswordAccount],
        validFolderIds: Set<UUID>
    ) -> [PasswordAccount] {
        source.map { account in
            var mutable = account
            let filtered = normalizeFolderIds(
                mutable.resolvedFolderIds.filter { validFolderIds.contains($0) }
            )
            mutable.setResolvedFolderIds(filtered)
            return mutable
        }
    }

    private func decodeSyncBundle(_ data: Data) throws -> (
        accounts: [PasswordAccount],
        folders: [AccountFolder],
        passkeys: [PasskeyRecord],
        kind: String
    ) {
        if let bundle = try? decoder.decode(SyncBundleV2.self, from: data),
           bundle.schema == Self.syncBundleSchemaV2
        {
            return (bundle.payload.accounts, bundle.payload.folders, bundle.payload.passkeys, "v2")
        }

        throw NSError(
            domain: "AccountStore.SyncBundle",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "不支持的同步包格式，仅支持 pass.sync.bundle.v2"]
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
                    let hasSiteOverlap = !currentSites.isDisjoint(with: targetSites)
                    let sameEtld1 = currentSites.contains { currentSite in
                        targetSites.contains { targetSite in
                            DomainUtils.etldPlusOne(for: currentSite) == DomainUtils.etldPlusOne(for: targetSite)
                        }
                    }
                    if hasSiteOverlap || sameEtld1 {
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
            mutable.passkeyCredentialIds = Array(
                Set(mutable.passkeyCredentialIds
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty })
            ).sorted()
            if mutable.passkeyUpdatedAtMs <= 0 {
                mutable.passkeyUpdatedAtMs = mutable.createdAtMs
            }
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
        let fixedUpdatedAt = folders.first(where: { $0.id == fixedId })?.updatedAtMs
            ?? folders.filter { legacyNewAccountFolderIds.contains($0.id) }.map(\.updatedAtMs).max()
            ?? fixedCreatedAt

        let retainedFolders = folders.filter { folder in
            folder.id != fixedId && !legacyNewAccountFolderIds.contains(folder.id)
        }

        let fixedFolder = AccountFolder(
            id: fixedId,
            name: fixedName,
            createdAtMs: fixedCreatedAt,
            updatedAtMs: fixedUpdatedAt
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

    private enum TotpDraftTarget {
        case create
        case edit
    }

    private struct ParsedOtpAuthPayload {
        let secret: String
        let siteAlias: String?
        let username: String?
    }

    private func pasteRawTotpSecretFromClipboard(to target: TotpDraftTarget) {
        guard let rawText = NSPasteboard.general.string(forType: .string) else {
            statusMessage = "剪贴板没有文本内容"
            return
        }

        let secret = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !secret.isEmpty else {
            statusMessage = "剪贴板文本为空"
            return
        }
        guard isValidTotpSecret(secret) else {
            statusMessage = "粘贴失败：原始密钥不是有效 TOTP"
            return
        }

        applyTotpPayload(
            ParsedOtpAuthPayload(secret: secret, siteAlias: nil, username: nil),
            to: target,
            includeSiteAndUsername: false
        )
        statusMessage = "已填充 TOTP 原始密钥"
    }

    private func pasteOtpAuthURIFromClipboard(to target: TotpDraftTarget) {
        guard let rawText = NSPasteboard.general.string(forType: .string) else {
            statusMessage = "剪贴板没有文本内容"
            return
        }
        guard let payload = parseOtpAuthURI(rawText) else {
            statusMessage = "粘贴失败：不是有效的 otpauth://totp URI"
            return
        }

        applyTotpPayload(payload, to: target, includeSiteAndUsername: true)
        statusMessage = "已解析 otpauth URI，并填充 TOTP/站点别名/用户名"
    }

    private func pasteQRCodeFromClipboard(to target: TotpDraftTarget) {
        guard let qrPayload = parseQRCodePayloadFromPasteboard() else {
            statusMessage = "粘贴失败：剪贴板没有可识别的二维码图片"
            return
        }
        guard let payload = parseOtpAuthURI(qrPayload) else {
            statusMessage = "粘贴失败：二维码内容不是有效的 otpauth://totp URI"
            return
        }

        applyTotpPayload(payload, to: target, includeSiteAndUsername: true)
        statusMessage = "已解析二维码，并填充 TOTP/站点别名/用户名"
    }

    private func applyTotpPayload(
        _ payload: ParsedOtpAuthPayload,
        to target: TotpDraftTarget,
        includeSiteAndUsername: Bool
    ) {
        switch target {
        case .create:
            createTotpSecret = payload.secret
            if includeSiteAndUsername {
                if let siteAlias = payload.siteAlias, !siteAlias.isEmpty {
                    createSitesText = siteAlias
                }
                if let username = payload.username, !username.isEmpty {
                    createUsername = username
                }
            }
        case .edit:
            editTotpSecret = payload.secret
            if includeSiteAndUsername {
                if let siteAlias = payload.siteAlias, !siteAlias.isEmpty {
                    editSitesText = siteAlias
                }
                if let username = payload.username, !username.isEmpty {
                    editUsername = username
                }
            }
        }
    }

    private func parseOtpAuthURI(_ raw: String) -> ParsedOtpAuthPayload? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard let components = URLComponents(string: trimmed) else { return nil }
        guard components.scheme?.lowercased() == "otpauth" else { return nil }
        guard components.host?.lowercased() == "totp" else { return nil }

        let queryItems = components.queryItems ?? []
        let secret = queryItems
            .first(where: { $0.name.caseInsensitiveCompare("secret") == .orderedSame })?
            .value?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !secret.isEmpty, isValidTotpSecret(secret) else { return nil }

        let issuerFromQuery = queryItems
            .first(where: { $0.name.caseInsensitiveCompare("issuer") == .orderedSame })?
            .value?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

        let decodedPath = components.path.removingPercentEncoding ?? components.path
        let label = decodedPath
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .trimmingCharacters(in: .whitespacesAndNewlines)

        var labelIssuer = ""
        var labelUsername: String?
        if let colon = label.firstIndex(of: ":") {
            labelIssuer = String(label[..<colon]).trimmingCharacters(in: .whitespacesAndNewlines)
            let username = String(label[label.index(after: colon)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            labelUsername = username.isEmpty ? nil : username
        } else {
            labelUsername = label.isEmpty ? nil : label
        }

        let issuer = issuerFromQuery.isEmpty ? labelIssuer : issuerFromQuery
        let siteAlias = siteAliasFromIssuer(issuer)

        return ParsedOtpAuthPayload(
            secret: secret,
            siteAlias: siteAlias,
            username: labelUsername
        )
    }

    private func siteAliasFromIssuer(_ issuer: String) -> String? {
        let compactIssuer = issuer
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
        guard !compactIssuer.isEmpty else { return nil }
        let normalized = DomainUtils.normalize(compactIssuer)
        guard !normalized.isEmpty else { return nil }
        if normalized.contains(".") {
            return normalized
        }
        return "\(normalized).com"
    }

    private func isValidTotpSecret(_ secret: String) -> Bool {
        TotpGenerator.currentCode(secret: secret, at: Date(timeIntervalSince1970: 0)) != nil
    }

    private func parseQRCodePayloadFromPasteboard() -> String? {
        let pasteboard = NSPasteboard.general
        guard let images = pasteboard.readObjects(forClasses: [NSImage.self], options: nil) as? [NSImage] else {
            return nil
        }
        for image in images {
            guard let cgImage = cgImage(from: image) else { continue }
            guard let payload = parseQRCodePayload(from: cgImage) else { continue }
            return payload
        }
        return nil
    }

    private func cgImage(from image: NSImage) -> CGImage? {
        var rect = CGRect(origin: .zero, size: image.size)
        if let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) {
            return cgImage
        }
        guard let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff)
        else {
            return nil
        }
        return rep.cgImage
    }

    private func parseQRCodePayload(from cgImage: CGImage) -> String? {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        guard (try? handler.perform([request])) != nil else {
            return nil
        }
        let observations = request.results ?? []
        for observation in observations {
            let payload = observation.payloadStringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !payload.isEmpty {
                return payload
            }
        }
        return nil
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

    private func passkeysFileURL() -> URL {
        dataDirectoryURL().appendingPathComponent("passkeys.json", isDirectory: false)
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
        if !suppressCloudPush && syncEnableICloud {
            pushSyncDataToICloud(trigger: "local_update")
        }
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

private struct SyncBundleV2: Codable {
    let schema: String
    let exportedAtMs: Int64
    let source: SyncBundleSource
    let payload: SyncBundlePayload
}

private struct SyncBundleSource: Codable {
    let app: String
    let platform: String
    let deviceName: String
    let formatVersion: Int
}

private struct SyncBundlePayload: Codable {
    let accounts: [PasswordAccount]
    let folders: [AccountFolder]
    let passkeys: [PasskeyRecord]
}

private enum Keys {
    static let deviceName = "pass.deviceName"
    static let exportDirectoryPath = "pass.export.directoryPath"
    static let foldersData = "pass.folders.data"
    static let syncEnableICloud = "pass.sync.enableICloud.v3"
    static let syncEnableWebDAV = "pass.sync.enableWebDAV.v3"
    static let syncEnableSelfHostedServer = "pass.sync.enableSelfHostedServer.v3"
    static let webdavBaseURL = "pass.sync.webdav.baseURL.v2"
    static let webdavRemotePath = "pass.sync.webdav.remotePath.v2"
    static let webdavUsername = "pass.sync.webdav.username.v2"
    static let serverBaseURL = "pass.sync.server.baseURL.v2"
    static let uiFontFamily = "pass.ui.font.family"
    static let uiTextFontSize = "pass.ui.font.textSize"
    static let uiButtonFontSize = "pass.ui.font.buttonSize"
    static let uiToastDurationSeconds = "pass.ui.toast.duration"
}

private enum SecretKeys {
    static let service = "pass.sync.credentials.v2"
    static let webdavPasswordAccount = "sync.webdav.password"
    static let serverTokenAccount = "sync.server.token"
}

private enum ICloudKeys {
    static let syncPayloadBlob = "pass.sync.payload.blob.v2"
    static let syncPayloadUpdatedAtMs = "pass.sync.payload.updatedAtMs.v2"
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
            passkeyCredentialIds: [],
            usernameUpdatedAtMs: updatedAtMs,
            passwordUpdatedAtMs: updatedAtMs,
            totpUpdatedAtMs: updatedAtMs,
            recoveryCodesUpdatedAtMs: updatedAtMs,
            noteUpdatedAtMs: updatedAtMs,
            passkeyUpdatedAtMs: updatedAtMs,
            updatedAtMs: updatedAtMs,
            isDeleted: isDeleted,
            deletedAtMs: isDeleted ? updatedAtMs : nil,
            lastOperatedDeviceName: deviceName,
            createdAtMs: updatedAtMs
        )
    }
}
