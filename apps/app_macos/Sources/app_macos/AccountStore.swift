import AppKit
import Foundation
import SwiftUI
import Vision

@MainActor
final class AccountStore: ObservableObject {
    enum SyncMode: String, CaseIterable, Identifiable {
        case merge
        case remoteOverwriteLocal
        case localOverwriteRemote

        var id: String { rawValue }

        var label: String {
            switch self {
            case .merge:
                return "合并"
            case .remoteOverwriteLocal:
                return "云端覆盖本地"
            case .localOverwriteRemote:
                return "本地覆盖云端"
            }
        }

        var completionVerb: String {
            switch self {
            case .merge:
                return "完成合并同步"
            case .remoteOverwriteLocal:
                return "完成云端覆盖本地"
            case .localOverwriteRemote:
                return "完成本地覆盖云端"
            }
        }
    }

    enum AutoSyncInterval: Int, CaseIterable, Identifiable {
        case disabled = 0
        case minute1 = 1
        case minute3 = 3
        case minute5 = 5
        case minute10 = 10
        case minute15 = 15
        case minute30 = 30
        case minute60 = 60

        var id: Int { rawValue }

        var label: String {
            switch self {
            case .disabled:
                return "关闭"
            case .minute1:
                return "每 1 分钟"
            case .minute3:
                return "每 3 分钟"
            case .minute5:
                return "每 5 分钟"
            case .minute10:
                return "每 10 分钟"
            case .minute15:
                return "每 15 分钟"
            case .minute30:
                return "每 30 分钟"
            case .minute60:
                return "每 60 分钟"
            }
        }
    }

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
    @Published private(set) var historyEntries: [OperationHistoryEntry] = []
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
    @Published var syncMode: SyncMode = .merge {
        didSet {
            guard !isLoadingSyncPreferences else { return }
            UserDefaults.standard.set(syncMode.rawValue, forKey: Keys.syncMode)
        }
    }
    @Published var autoSyncIntervalMinutes: Int = AutoSyncInterval.disabled.rawValue {
        didSet {
            let resolved = AutoSyncInterval(rawValue: autoSyncIntervalMinutes) ?? .disabled
            if resolved.rawValue != autoSyncIntervalMinutes {
                autoSyncIntervalMinutes = resolved.rawValue
                return
            }
            guard !isLoadingSyncPreferences else { return }
            UserDefaults.standard.set(resolved.rawValue, forKey: Keys.autoSyncIntervalMinutes)
            updateAutoSyncTimer()
        }
    }

    static let systemDefaultFontFamily = "系统默认"
    static let fixedNewAccountFolderName = "新账号"
    static let fixedNewAccountFolderId = UUID(uuidString: "F16A2C4E-4A2A-43D5-A670-3F1767D41001")!
    static let syncBundleSchemaV2 = "pass.sync.bundle.v2"
    static let defaultSelfHostedServerBaseURL = "https://or.sbbz.tech:5443"
    static let defaultSelfHostedServerAuthToken = "ClzgP2xsXHETVut9F6ddHVRdvvclz0QM0fDHveyOZFhGjs7l"
    private static let maxHistoryEntries = 500
    private static let installedFontFamilies: Set<String> = Set(NSFontManager.shared.availableFontFamilies)

    private struct RemotePayloadResponse {
        let payload: SyncBundlePayload?
        let etag: String?
    }

    private struct SelfHostedPushResult {
        let payload: SyncBundlePayload
        let changedLocalData: Bool
    }

    private enum SyncRemoteError: LocalizedError {
        case preconditionFailed

        var errorDescription: String? {
            switch self {
            case .preconditionFailed:
                return "远端数据已被其他设备更新，请重新拉取并合并后再上传"
            }
        }
    }

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
    private var autoSyncTimer: Timer?
    private lazy var localSQLiteStore = LocalSQLiteStore(
        databaseURL: dataDirectoryURL().appendingPathComponent("pass.db", isDirectory: false)
    )

    private enum LocalDatabaseKeys {
        static let accounts = "accounts"
        static let folders = "folders"
        static let passkeys = "passkeys"
        static let history = "history"
    }

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
            matchedSites: [],
            autoAddMatchingSites: false,
            createdAtMs: nowMs(),
            updatedAtMs: nowMs()
        )
        folders.append(folder)
        _ = normalizeFoldersEnsuringFixedNewAccountFolder()
        saveFoldersToDefaults()
        appendHistoryEntry(action: "创建文件夹：\(name)")
        statusMessage = "已创建文件夹: \(name)"
    }

    private func resolveAuthenticatorImportFolderId(
        targetFolderId: UUID?,
        newFolderName: String
    ) -> UUID? {
        let normalizedNewFolderName = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !normalizedNewFolderName.isEmpty {
            if let existing = folders.first(where: {
                $0.name.trimmingCharacters(in: .whitespacesAndNewlines)
                    .caseInsensitiveCompare(normalizedNewFolderName) == .orderedSame
            }) {
                return existing.id
            }

            let now = nowMs()
            let folder = AccountFolder(
                id: UUID(),
                name: normalizedNewFolderName,
                matchedSites: [],
                autoAddMatchingSites: false,
                createdAtMs: now,
                updatedAtMs: now
            )
            folders.append(folder)
            _ = normalizeFoldersEnsuringFixedNewAccountFolder()
            saveFoldersToDefaults()
            appendHistoryEntry(action: "创建文件夹：\(normalizedNewFolderName)")
            return folder.id
        }

        guard let targetFolderId else {
            return nil
        }
        guard folders.contains(where: { $0.id == targetFolderId }) else {
            statusMessage = "目标文件夹不存在"
            return nil
        }
        return targetFolderId
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
            appendHistoryEntry(action: "删除文件夹：\(folder.name)，并从 \(removedFromAccountCount) 个账号中移除")
            statusMessage = "已删除文件夹: \(folder.name)，并从 \(removedFromAccountCount) 个账号中移除"
        } else {
            appendHistoryEntry(action: "删除文件夹：\(folder.name)")
            statusMessage = "已删除文件夹: \(folder.name)"
        }
    }

    func folderName(for id: UUID) -> String {
        folders.first(where: { $0.id == id })?.name ?? "未命名文件夹"
    }

    func folderRuleSites(for id: UUID) -> [String] {
        folders.first(where: { $0.id == id })?.matchedSites ?? []
    }

    func folderRuleAutoAddEnabled(for id: UUID) -> Bool {
        folders.first(where: { $0.id == id })?.autoAddMatchingSites ?? false
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
        var beforeAccounts: [PasswordAccount] = []
        var changedCount = 0
        let now = nowMs()
        let device = currentDeviceName()

        for index in selectedIndexes {
            let currentFolderIds = accounts[index].resolvedFolderIds
            previousFolderIdsByAccountId[accounts[index].id] = currentFolderIds

            if currentFolderIds != targetFolderIds {
                beforeAccounts.append(accounts[index])
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
        let changedIds = Set(beforeAccounts.map(\.accountId))
        let afterAccounts = accounts.filter { changedIds.contains($0.accountId) }
        appendAccountHistoryBatch(
            category: .local,
            title: actionSummary,
            timestampMs: now,
            beforeAccounts: beforeAccounts,
            afterAccounts: afterAccounts
        )
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
        var beforeAccounts: [PasswordAccount] = []
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
                beforeAccounts.append(accounts[index])
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
        let changedIds = Set(beforeAccounts.map(\.accountId))
        let afterAccounts = accounts.filter { changedIds.contains($0.accountId) }
        appendAccountHistoryBatch(
            category: .local,
            title: actionSummary,
            timestampMs: now,
            beforeAccounts: beforeAccounts,
            afterAccounts: afterAccounts
        )
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
        var beforeAccounts: [PasswordAccount] = []
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
                beforeAccounts.append(accounts[index])
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
        let changedIds = Set(beforeAccounts.map(\.accountId))
        let afterAccounts = accounts.filter { changedIds.contains($0.accountId) }
        appendAccountHistoryBatch(
            category: .local,
            title: actionSummary,
            timestampMs: now,
            beforeAccounts: beforeAccounts,
            afterAccounts: afterAccounts
        )
        setStatusMessage("\(actionSummary)（\(changedCount) 个账号），点击撤销", allowsUndoMove: true)
    }

    func addAccountsMatchingSitesToFolder(siteInputs: [String], folderId: UUID) {
        guard folders.contains(where: { $0.id == folderId }) else {
            statusMessage = "目标文件夹不存在"
            return
        }

        let normalizedSites = Array(
            Set(siteInputs.map(DomainUtils.normalize).filter { !$0.isEmpty })
        ).sorted()
        guard !normalizedSites.isEmpty else {
            statusMessage = "请至少输入一个站点"
            return
        }

        let matchingIds = accounts.compactMap { account -> UUID? in
            guard !account.isDeleted else { return nil }
            let aliases = Set(account.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
            let canonical = DomainUtils.normalize(account.canonicalSite)
            let matched = normalizedSites.contains { site in
                aliases.contains(site) || canonical == site
            }
            return matched ? account.id : nil
        }

        guard !matchingIds.isEmpty else {
            statusMessage = "没有找到包含这些站点的账号"
            return
        }

        addAccountsToFolder(accountIds: matchingIds, folderId: folderId)
    }

    func configureFolderSiteRules(folderId: UUID, siteInputs: [String], autoAdd: Bool) {
        guard let folderIndex = folders.firstIndex(where: { $0.id == folderId }) else {
            statusMessage = "目标文件夹不存在"
            return
        }

        let normalizedSites = Array(
            Set(siteInputs.map(DomainUtils.normalize).filter { !$0.isEmpty })
        ).sorted()
        let now = nowMs()
        folders[folderIndex].matchedSites = normalizedSites
        folders[folderIndex].autoAddMatchingSites = autoAdd
        folders[folderIndex].updatedAtMs = now
        saveFoldersToDefaults()
        appendHistoryEntry(
            action: "更新文件夹站点规则：\(folders[folderIndex].name)（\(normalizedSites.count) 个站点，自动加入\(autoAdd ? "开" : "关")）",
            timestampMs: now
        )

        let matchingIds = accounts.compactMap { account -> UUID? in
            guard !account.isDeleted else { return nil }
            let aliases = Set(account.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
            let canonical = DomainUtils.normalize(account.canonicalSite)
            let matched = normalizedSites.contains { site in
                aliases.contains(site) || canonical == site
            }
            return matched ? account.id : nil
        }

        guard !matchingIds.isEmpty else {
            statusMessage = "已保存文件夹站点规则"
            return
        }

        addAccountsToFolder(accountIds: matchingIds, folderId: folderId)
    }

    func duplicateAccountGroups(inFolder folderId: UUID) -> [FolderDuplicateAccountGroup] {
        let grouped = Dictionary(grouping: accounts.filter { !$0.isDeleted && $0.isInFolder(folderId) }) { account in
            let normalizedSites = Array(
                Set(account.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
            ).sorted()
            let fallbackSites = normalizedSites.isEmpty
                ? [DomainUtils.normalize(account.canonicalSite)].filter { !$0.isEmpty }
                : normalizedSites
            let usernameKey = account.username
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            return "\(fallbackSites.joined(separator: "|"))\n\(usernameKey)"
        }

        return grouped.compactMap { key, groupedAccounts in
            guard groupedAccounts.count > 1 else { return nil }

            let sortedAccounts = groupedAccounts.sorted { lhs, rhs in
                if lhs.updatedAtMs != rhs.updatedAtMs {
                    return lhs.updatedAtMs > rhs.updatedAtMs
                }
                if lhs.createdAtMs != rhs.createdAtMs {
                    return lhs.createdAtMs > rhs.createdAtMs
                }
                return lhs.accountId < rhs.accountId
            }

            let first = sortedAccounts[0]
            let siteAliases = Array(
                Set(first.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
            ).sorted()
            let usernameDisplay = first.username.trimmingCharacters(in: .whitespacesAndNewlines)

            return FolderDuplicateAccountGroup(
                id: key,
                folderId: folderId,
                usernameKey: usernameDisplay.lowercased(),
                usernameDisplay: usernameDisplay.isEmpty ? "(空用户名)" : usernameDisplay,
                siteAliases: siteAliases.isEmpty ? [first.canonicalSite] : siteAliases,
                accounts: sortedAccounts
            )
        }
        .sorted { lhs, rhs in
            if lhs.newestUpdatedAtMs != rhs.newestUpdatedAtMs {
                return lhs.newestUpdatedAtMs > rhs.newestUpdatedAtMs
            }
            return lhs.id < rhs.id
        }
    }

    func keepOnlyDuplicateAccount(inFolder folderId: UUID, accountIdToKeep: UUID) {
        guard let targetGroup = duplicateAccountGroups(inFolder: folderId).first(where: { group in
            group.accounts.contains(where: { $0.id == accountIdToKeep })
        }) else {
            statusMessage = "当前文件夹里未找到可去重分组"
            return
        }

        let targetIds = Set(targetGroup.accounts.map(\.id)).subtracting([accountIdToKeep])
        guard !targetIds.isEmpty else {
            statusMessage = "当前分组无需处理"
            return
        }

        let folderTitle = folderName(for: folderId)
        moveAccountsToRecycleBin(
            accountIds: targetIds,
            historyTitle: "文件夹去重：\(folderTitle) · 仅保留此账号",
            statusMessage: "文件夹去重完成：\(folderTitle)，当前分组已移入回收站 \(targetIds.count) 个重复账号，保留 1 个账号"
        )
    }

    func keepLatestDuplicateAccounts(inFolder folderId: UUID) {
        let groups = duplicateAccountGroups(inFolder: folderId)
        guard !groups.isEmpty else {
            statusMessage = "当前文件夹暂无重复账号"
            return
        }

        performFolderDuplicateKeep(
            inFolder: folderId,
            keepAccountIds: Set(groups.compactMap { $0.accounts.first?.id }),
            keptGroupCount: groups.count,
            operationLabel: "保留全部最新账号"
        )
    }

    func keepEarliestDuplicateAccounts(inFolder folderId: UUID) {
        let groups = duplicateAccountGroups(inFolder: folderId)
        guard !groups.isEmpty else {
            statusMessage = "当前文件夹暂无重复账号"
            return
        }

        performFolderDuplicateKeep(
            inFolder: folderId,
            keepAccountIds: Set(groups.compactMap { $0.accounts.last?.id }),
            keptGroupCount: groups.count,
            operationLabel: "保留全部最早账号"
        )
    }

    private func performFolderDuplicateKeep(
        inFolder folderId: UUID,
        keepAccountIds: Set<UUID>,
        keptGroupCount: Int,
        operationLabel: String
    ) {
        guard folders.contains(where: { $0.id == folderId }) else {
            statusMessage = "目标文件夹不存在"
            return
        }

        let groups = duplicateAccountGroups(inFolder: folderId)
        guard !groups.isEmpty else {
            statusMessage = "当前文件夹暂无重复账号"
            return
        }

        let duplicateAccountIds = Set(groups.flatMap { $0.accounts.map(\.id) })
        let targetIds = duplicateAccountIds.subtracting(keepAccountIds)
        guard !targetIds.isEmpty else {
            statusMessage = "当前文件夹重复账号无需处理"
            return
        }

        let folderTitle = folderName(for: folderId)
        moveAccountsToRecycleBin(
            accountIds: targetIds,
            historyTitle: "文件夹去重：\(folderTitle) · \(operationLabel)",
            statusMessage: "文件夹去重完成：\(folderTitle)，已移入回收站 \(targetIds.count) 个重复账号，保留 \(keptGroupCount) 组目标账号"
        )
    }

    func undoLastMoveOperation() {
        guard let operation = lastMoveOperation else {
            statusMessage = "没有可撤销的移动操作"
            return
        }

        let idSet = Set(operation.accountIds)
        let now = nowMs()
        let device = currentDeviceName()
        let beforeAccounts = accounts.filter { idSet.contains($0.id) }
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
        let afterAccounts = accounts.filter { idSet.contains($0.id) }
        appendAccountHistoryBatch(
            category: .local,
            title: "撤销移动：\(operation.actionSummary)",
            timestampMs: now,
            beforeAccounts: beforeAccounts,
            afterAccounts: afterAccounts
        )
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
        let createdIds = Set(samples.map(\.accountId))
        let afterAccounts = accounts.filter { createdIds.contains($0.accountId) }
        appendAccountHistoryBatch(
            category: .local,
            title: "生成演示账号：20 条",
            beforeAccounts: [],
            afterAccounts: afterAccounts
        )
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
        applyAutomaticFolderRules(to: &created)
        accounts.append(created)
        syncAliasGroups()
        saveAccounts()
        let persistedCreated = accounts.first(where: { $0.accountId == created.accountId }) ?? created
        appendAccountHistoryBatch(
            category: .local,
            title: "创建账号：\(created.accountId)",
            beforeAccounts: [],
            afterAccounts: [persistedCreated]
        )

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

    func importGoogleAuthenticatorExportQRCodeFromClipboard(
        targetFolderId: UUID? = nil,
        newFolderName: String = ""
    ) {
        guard let migration = readGoogleAuthenticatorMigrationFromPasteboard() else {
            statusMessage = "剪贴板里没有可识别的谷歌验证器导出二维码"
            return
        }
        importGoogleAuthenticatorMigration(
            migration,
            targetFolderId: targetFolderId,
            newFolderName: newFolderName
        )
    }

    func importGoogleAuthenticatorExportQRCodes(
        from fileURLs: [URL],
        targetFolderId: UUID? = nil,
        newFolderName: String = ""
    ) {
        let migrations = fileURLs.compactMap(parseGoogleAuthenticatorMigrationFromImageFile)
        guard !migrations.isEmpty else {
            statusMessage = "未从所选图片中识别到谷歌验证器导出二维码"
            return
        }
        importGoogleAuthenticatorMigration(
            mergedGoogleAuthenticatorMigrations(migrations),
            targetFolderId: targetFolderId,
            newFolderName: newFolderName
        )
    }

    private func importGoogleAuthenticatorMigration(
        _ migration: ParsedGoogleAuthenticatorMigration,
        targetFolderId: UUID?,
        newFolderName: String
    ) {
        let resolvedFolderId = resolveAuthenticatorImportFolderId(
            targetFolderId: targetFolderId,
            newFolderName: newFolderName
        )
        if (
            !newFolderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            targetFolderId != nil
        ) && resolvedFolderId == nil {
            return
        }
        let previousAccounts = accounts
        let startedAtMs = nowMs()
        var nextAccounts = accounts
        var createdCount = 0
        var updatedCount = 0
        var unchangedCount = 0
        var skippedCount = migration.skippedCount
        let normalizedTargetFolderId = resolvedFolderId.flatMap { folderId in
            folders.contains(where: { $0.id == folderId }) ? folderId : nil
        }

        for (offset, entry) in migration.entries.enumerated() {
            guard let siteAlias = entry.siteAlias, !siteAlias.isEmpty, !entry.secret.isEmpty else {
                skippedCount += 1
                continue
            }

            let timestamp = startedAtMs + Int64(offset)
            if let matchedIndex = matchedImportedTotpAccountIndex(
                in: nextAccounts,
                siteAlias: siteAlias,
                username: entry.username ?? "",
                secret: entry.secret
            ) {
                let updated = applyImportedTotpEntry(
                    entry,
                    siteAlias: siteAlias,
                    to: nextAccounts[matchedIndex],
                    nowMs: timestamp,
                    targetFolderId: normalizedTargetFolderId
                )
                if updated == nextAccounts[matchedIndex] {
                    unchangedCount += 1
                } else {
                    nextAccounts[matchedIndex] = updated
                    updatedCount += 1
                }
                continue
            }

            let createdAtMs = startedAtMs + Int64(offset) * 1000
            let createdAt = Date(timeIntervalSince1970: TimeInterval(createdAtMs) / 1000)
            var created = AccountFactory.create(
                site: siteAlias,
                username: entry.username ?? "",
                password: "",
                deviceName: currentDeviceName(),
                createdAt: createdAt
            )
            created.sites = [siteAlias]
            created.totpSecret = entry.secret
            created.totpUpdatedAtMs = createdAtMs
            created.updatedAtMs = createdAtMs
            created.lastOperatedDeviceName = currentDeviceName()
            if let normalizedTargetFolderId {
                created.setResolvedFolderIds([normalizedTargetFolderId])
            }
            applyAutomaticFolderRules(to: &created)
            nextAccounts.append(created)
            createdCount += 1
        }

        guard createdCount > 0 || updatedCount > 0 else {
            statusMessage =
                "谷歌验证器导入完成，没有新增或更新账号" +
                googleAuthenticatorImportSuffix(
                    importedCount: migration.entries.count,
                    skippedCount: skippedCount,
                    unchangedCount: unchangedCount,
                    batchSize: migration.batchSize,
                    batchIndex: migration.batchIndex
                )
            return
        }

        accounts = nextAccounts
        syncAliasGroups()
        saveAccounts()

        if let editingAccountId, !accounts.contains(where: { $0.id == editingAccountId }) {
            cancelEditing()
        }

        appendAccountHistoryBatch(
            category: .local,
            title: "导入谷歌验证器导出二维码",
            beforeAccounts: previousAccounts,
            afterAccounts: accounts
        )

        statusMessage =
            "谷歌验证器导入完成：新增 \(createdCount) 条，更新 \(updatedCount) 条" +
            (normalizedTargetFolderId.map { "，导入到文件夹 \(folderName(for: $0))" } ?? "") +
            googleAuthenticatorImportSuffix(
                importedCount: migration.entries.count,
                skippedCount: skippedCount,
                unchangedCount: unchangedCount,
                batchSize: migration.batchSize,
                batchIndex: migration.batchIndex
            )
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

        let beforeAccount = accounts[index]
        let now = nowMs()
        accounts[index].isDeleted = true
        accounts[index].deletedAtMs = now
        statusMessage = "账号已移入回收站"
        accounts[index].touchUpdatedAt(now, deviceName: currentDeviceName())
        saveAccounts()
        appendAccountHistoryBatch(
            category: .local,
            title: "账号移入回收站：\(accounts[index].accountId)",
            timestampMs: now,
            beforeAccounts: [beforeAccount],
            afterAccounts: [accounts[index]]
        )
    }

    func moveToRecycleBin(accountIds: Set<UUID>) {
        moveAccountsToRecycleBin(accountIds: accountIds)
    }

    private func moveAccountsToRecycleBin(
        accountIds: Set<UUID>,
        historyTitle: String? = nil,
        statusMessage customStatusMessage: String? = nil
    ) {
        let targetIndexes = accounts.indices.filter { accountIds.contains(accounts[$0].id) && !accounts[$0].isDeleted }
        guard !targetIndexes.isEmpty else {
            statusMessage = "未找到可删除账号"
            return
        }

        let beforeAccounts = targetIndexes.map { accounts[$0] }
        let now = nowMs()
        let device = currentDeviceName()
        for index in targetIndexes {
            accounts[index].isDeleted = true
            accounts[index].deletedAtMs = now
            accounts[index].touchUpdatedAt(now, deviceName: device)
        }
        if let editingAccountId, targetIndexes.contains(where: { accounts[$0].id == editingAccountId }) {
            cancelEditing()
        }
        saveAccounts()
        let changedIds = Set(beforeAccounts.map(\.accountId))
        let afterAccounts = accounts.filter { changedIds.contains($0.accountId) }
        appendAccountHistoryBatch(
            category: .local,
            title: historyTitle ?? "批量移入回收站：\(targetIndexes.count) 条账号",
            timestampMs: now,
            beforeAccounts: beforeAccounts,
            afterAccounts: afterAccounts
        )
        statusMessage = customStatusMessage ?? "已将 \(targetIndexes.count) 条账号移入回收站"
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

        let beforeAccount = accounts[index]
        let now = nowMs()
        accounts[index].isDeleted = false
        accounts[index].deletedAtMs = nil
        statusMessage = "账号已从回收站恢复"
        accounts[index].touchUpdatedAt(now, deviceName: currentDeviceName())
        saveAccounts()
        appendAccountHistoryBatch(
            category: .local,
            title: "账号从回收站恢复：\(accounts[index].accountId)",
            timestampMs: now,
            beforeAccounts: [beforeAccount],
            afterAccounts: [accounts[index]]
        )
    }

    func restoreFromRecycleBin(accountIds: Set<UUID>) {
        let targetIndexes = accounts.indices.filter { accountIds.contains(accounts[$0].id) && accounts[$0].isDeleted }
        guard !targetIndexes.isEmpty else {
            statusMessage = "未找到可恢复账号"
            return
        }

        let beforeAccounts = targetIndexes.map { accounts[$0] }
        let now = nowMs()
        let device = currentDeviceName()
        for index in targetIndexes {
            accounts[index].isDeleted = false
            accounts[index].deletedAtMs = nil
            accounts[index].touchUpdatedAt(now, deviceName: device)
        }
        saveAccounts()
        let changedIds = Set(beforeAccounts.map(\.accountId))
        let afterAccounts = accounts.filter { changedIds.contains($0.accountId) }
        appendAccountHistoryBatch(
            category: .local,
            title: "批量恢复账号：\(targetIndexes.count) 条",
            timestampMs: now,
            beforeAccounts: beforeAccounts,
            afterAccounts: afterAccounts
        )
        statusMessage = "已恢复 \(targetIndexes.count) 个账号"
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

        let removedAccount = accounts[index]
        let removedId = removedAccount.accountId
        accounts.remove(at: index)
        if editingAccountId == account.id {
            cancelEditing()
        }
        saveAccounts()
        appendAccountHistoryBatch(
            category: .local,
            title: "永久删除账号：\(removedId)",
            beforeAccounts: [removedAccount],
            afterAccounts: []
        )
        statusMessage = "账号已永久删除: \(removedId)"
    }

    func permanentlyDeleteFromRecycleBin(accountIds: Set<UUID>) {
        let beforeAccounts = accounts.filter { accountIds.contains($0.id) && $0.isDeleted }
        let targetIds = Set(beforeAccounts.map(\.id))
        guard !targetIds.isEmpty else {
            statusMessage = "未找到可永久删除账号"
            return
        }

        accounts.removeAll { targetIds.contains($0.id) }
        if let editingAccountId, targetIds.contains(editingAccountId) {
            cancelEditing()
        }
        saveAccounts()
        appendAccountHistoryBatch(
            category: .local,
            title: "批量永久删除账号：\(targetIds.count) 条",
            beforeAccounts: beforeAccounts,
            afterAccounts: []
        )
        statusMessage = "已永久删除 \(targetIds.count) 个账号"
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

        let beforeAccounts = deletedIndexes.map { accounts[$0] }
        let now = nowMs()
        let device = currentDeviceName()
        for index in deletedIndexes {
            accounts[index].isDeleted = false
            accounts[index].deletedAtMs = nil
            accounts[index].touchUpdatedAt(now, deviceName: device)
        }
        saveAccounts()
        let changedIds = Set(beforeAccounts.map(\.accountId))
        let afterAccounts = accounts.filter { changedIds.contains($0.accountId) }
        appendAccountHistoryBatch(
            category: .local,
            title: "全部恢复回收站账号：\(deletedIndexes.count) 条",
            timestampMs: now,
            beforeAccounts: beforeAccounts,
            afterAccounts: afterAccounts
        )
        statusMessage = "已恢复 \(deletedIndexes.count) 个账号"
    }

    func permanentlyDeleteAllFromRecycleBin() {
        let deletedCount = accounts.filter(\.isDeleted).count
        guard deletedCount > 0 else {
            statusMessage = "回收站为空"
            return
        }

        let beforeAccounts = accounts.filter(\.isDeleted)
        let deletedIds = Set(beforeAccounts.map(\.id))
        accounts.removeAll(where: \.isDeleted)
        if let editingAccountId, deletedIds.contains(editingAccountId) {
            cancelEditing()
        }
        saveAccounts()
        appendAccountHistoryBatch(
            category: .local,
            title: "清空回收站：永久删除 \(deletedCount) 条账号",
            beforeAccounts: beforeAccounts,
            afterAccounts: []
        )
        statusMessage = "已永久删除 \(deletedCount) 个账号"
    }

    func deleteAllAccounts() {
        let activeIndexes = accounts.indices.filter { !accounts[$0].isDeleted }
        guard !activeIndexes.isEmpty else {
            statusMessage = "暂无可删除账号"
            return
        }

        let beforeAccounts = activeIndexes.map { accounts[$0] }
        let now = nowMs()
        let device = currentDeviceName()
        for index in activeIndexes {
            accounts[index].isDeleted = true
            accounts[index].deletedAtMs = now
            accounts[index].touchUpdatedAt(now, deviceName: device)
        }
        cancelEditing()
        saveAccounts()
        let changedIds = Set(beforeAccounts.map(\.accountId))
        let afterAccounts = accounts.filter { changedIds.contains($0.accountId) }
        appendAccountHistoryBatch(
            category: .local,
            title: "全部账号移入回收站：\(activeIndexes.count) 条",
            timestampMs: now,
            beforeAccounts: beforeAccounts,
            afterAccounts: afterAccounts
        )
        statusMessage = "已将全部账号移入回收站 \(activeIndexes.count) 条"
    }

    func suggestedCsvFileName() -> String {
        "pass-all-accounts-\(timestampForFile()).csv"
    }

    func suggestedBrowserCsvFileName(browser: BrowserPasswordExportFormat) -> String {
        "pass-\(browser.fileNameToken)-passwords-\(timestampForFile()).csv"
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

    func exportBrowserPasswordCsv(to fileURL: URL, format: BrowserPasswordExportFormat) {
        let csv = buildBrowserPasswordCsvContent(format: format)
        let parentDirectory = fileURL.deletingLastPathComponent()

        do {
            try FileManager.default.createDirectory(
                at: parentDirectory,
                withIntermediateDirectories: true
            )
            try csv.write(to: fileURL, atomically: true, encoding: String.Encoding.utf8)
            statusMessage = "\(format.label) 密码 CSV 导出成功: \(fileURL.path)"
        } catch {
            statusMessage = "\(format.label) 密码 CSV 导出失败: \(error.localizedDescription)"
        }
    }

    func exportSyncBundle(to fileURL: URL) {
        let logicalClockMs = nowMs()
        let bundle = SyncBundleV2(
            schema: Self.syncBundleSchemaV2,
            exportedAtMs: logicalClockMs,
            source: SyncBundleSource(
                app: "pass-mac",
                platform: "macos-app",
                deviceName: currentDeviceName(),
                deviceId: syncDeviceId(),
                logicalClockMs: logicalClockMs,
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
            try data.write(to: fileURL, options: Data.WritingOptions.atomic)
            statusMessage = "同步包导出成功: \(fileURL.path)"
        } catch {
            statusMessage = "同步包导出失败: \(error.localizedDescription)"
        }
    }

    func importSyncBundle(from fileURL: URL) {
        do {
            let previousAccounts = accounts
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
            appendAccountHistoryBatch(
                category: .sync,
                title: "导入同步包并合并（\(parsed.kind)）",
                beforeAccounts: previousAccounts,
                afterAccounts: accounts
            )
        } catch {
            statusMessage = "同步包导入失败: \(error.localizedDescription)"
        }
    }

    func importBrowserPasswordCsv(from fileURL: URL) {
        do {
            let previousAccounts = accounts
            let data = try Data(contentsOf: fileURL)
            let parsed = try BrowserPasswordImportParser.parse(data: data)
            let startedAtMs = nowMs()
            var nextAccounts = accounts
            var createdCount = 0
            var updatedCount = 0
            var unchangedCount = 0

            for (offset, entry) in parsed.entries.enumerated() {
                if let matchedIndex = matchedImportedAccountIndex(in: nextAccounts, entry: entry) {
                    let updated = applyImportedBrowserEntry(
                        entry,
                        to: nextAccounts[matchedIndex],
                        nowMs: startedAtMs + Int64(offset)
                    )
                    if updated == nextAccounts[matchedIndex] {
                        unchangedCount += 1
                    } else {
                        nextAccounts[matchedIndex] = updated
                        updatedCount += 1
                    }
                    continue
                }

                let createdAtMs = startedAtMs + Int64(offset) * 1000
                let createdAt = Date(timeIntervalSince1970: TimeInterval(createdAtMs) / 1000)
                var created = AccountFactory.create(
                    site: entry.sites.first ?? "",
                    username: entry.username,
                    password: entry.password,
                    deviceName: currentDeviceName(),
                    createdAt: createdAt
                )
                created.sites = entry.sites
                created.note = entry.note
                created.noteUpdatedAtMs = entry.note.isEmpty ? created.noteUpdatedAtMs : createdAtMs
                created.updatedAtMs = createdAtMs
                created.lastOperatedDeviceName = currentDeviceName()
                nextAccounts.append(created)
                createdCount += 1
            }

            guard createdCount > 0 || updatedCount > 0 else {
                statusMessage =
                    "浏览器密码 CSV 导入完成（\(parsed.format.label)），没有新增或更新账号" +
                    (parsed.skippedRowCount > 0 ? "，跳过 \(parsed.skippedRowCount) 行" : "") +
                    (unchangedCount > 0 ? "，未变化 \(unchangedCount) 行" : "")
                return
            }

            accounts = nextAccounts
            syncAliasGroups()
            saveAccounts()

            if let editingAccountId, !accounts.contains(where: { $0.id == editingAccountId }) {
                cancelEditing()
            }

            appendAccountHistoryBatch(
                category: .local,
                title: "导入 \(parsed.format.label) 密码 CSV",
                beforeAccounts: previousAccounts,
                afterAccounts: accounts
            )

            statusMessage =
                "浏览器密码 CSV 导入完成（\(parsed.format.label)）：新增 \(createdCount) 条，更新 \(updatedCount) 条" +
                (parsed.skippedRowCount > 0 ? "，跳过 \(parsed.skippedRowCount) 行" : "") +
                (unchangedCount > 0 ? "，未变化 \(unchangedCount) 行" : "")
        } catch {
            statusMessage = "浏览器密码 CSV 导入失败: \(error.localizedDescription)"
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

    private func buildBrowserPasswordCsvContent(format: BrowserPasswordExportFormat) -> String {
        let header = format.headers.joined(separator: ",")
        let activeAccounts = accounts.filter { !$0.isDeleted }
        let rows: [String] = activeAccounts.flatMap { account in
            let sites = Array(
                Set(account.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
            ).sorted()
            return sites.compactMap { site in
                let columns = format.row(
                    site: site,
                    username: account.username,
                    password: account.password,
                    note: account.note,
                    canonicalSite: account.canonicalSite
                )
                return columns.map(csvEscaped).joined(separator: ",")
            }
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

        let originalAccount = accounts[index]
        let now = nowMs()
        let device = currentDeviceName()
        var changed = false
        var changedLabels: [String] = []

        let normalizedSites = parseSites(editSitesText)
        if !normalizedSites.isEmpty, normalizedSites != accounts[index].sites {
            accounts[index].sites = normalizedSites
            changed = true
            changedLabels.append("站点别名")
        }

        let newUsername = editUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        if !newUsername.isEmpty, newUsername != accounts[index].username {
            accounts[index].username = newUsername
            accounts[index].usernameUpdatedAtMs = now
            changed = true
            changedLabels.append("用户名")
        }

        if editPassword != accounts[index].password {
            accounts[index].password = editPassword
            accounts[index].passwordUpdatedAtMs = now
            changed = true
            changedLabels.append("密码")
        }

        if editTotpSecret != accounts[index].totpSecret {
            accounts[index].totpSecret = editTotpSecret
            accounts[index].totpUpdatedAtMs = now
            changed = true
            changedLabels.append("TOTP")
        }

        if editRecoveryCodes != accounts[index].recoveryCodes {
            accounts[index].recoveryCodes = editRecoveryCodes
            accounts[index].recoveryCodesUpdatedAtMs = now
            changed = true
            changedLabels.append("恢复码")
        }

        if editNote != accounts[index].note {
            accounts[index].note = editNote
            accounts[index].noteUpdatedAtMs = now
            changed = true
            changedLabels.append("备注")
        }

        guard changed else {
            statusMessage = "没有可保存的变更"
            return
        }

        applyAutomaticFolderRules(to: &accounts[index])
        accounts[index].touchUpdatedAt(now, deviceName: device)
        syncAliasGroups()
        saveAccounts()
        let titleSuffix = changedLabels.isEmpty ? "" : "（" + changedLabels.joined(separator: "、") + "）"
        appendAccountHistoryBatch(
            category: .local,
            title: "编辑账号：\(accounts[index].accountId)\(titleSuffix)",
            timestampMs: now,
            beforeAccounts: [originalAccount],
            afterAccounts: [accounts[index]]
        )
        statusMessage = "账号编辑已保存"
        cancelEditing()
    }

    func accountIsPinned(_ account: PasswordAccount, scopeKey: String = "all") -> Bool {
        pinnedState(for: account, scopeKey: scopeKey).pinned
    }

    func togglePin(for account: PasswordAccount, scopeKey: String = "all", scopeLabel: String = "全部") {
        guard let index = accounts.firstIndex(where: { $0.id == account.id }) else {
            statusMessage = "未找到目标账号"
            return
        }
        guard !accounts[index].isDeleted else {
            statusMessage = "回收站账号不支持置顶"
            return
        }

        let beforeAccount = accounts[index]
        let now = nowMs()
        let device = currentDeviceName()
        var nextState = pinnedState(for: accounts[index], scopeKey: scopeKey)
        let nextPinned = !nextState.pinned
        if nextPinned {
            nextState.pinned = true
            nextState.pinnedSortOrder = nextPinnedSortOrder(scopeKey: scopeKey)
        } else {
            nextState.pinned = false
            nextState.pinnedSortOrder = nil
            nextState.regularSortOrder = nil
        }
        setPinnedState(nextState, for: &accounts[index], scopeKey: scopeKey)
        accounts[index].touchUpdatedAt(now, deviceName: device)
        saveAccounts()
        appendAccountHistoryBatch(
            category: .local,
            title: nextPinned
                ? "账号置顶[\(scopeLabel)]：\(accounts[index].accountId)"
                : "取消账号置顶[\(scopeLabel)]：\(accounts[index].accountId)",
            timestampMs: now,
            beforeAccounts: [beforeAccount],
            afterAccounts: [accounts[index]]
        )
        statusMessage = nextPinned ? "账号已在\(scopeLabel)置顶" : "已取消\(scopeLabel)置顶"
    }

    func moveAccountBefore(sourceId: UUID, targetId: UUID, scopeKey: String = "all") {
        guard editingAccountId == nil else {
            return
        }
        guard sourceId != targetId else { return }
        guard let source = accounts.first(where: { $0.id == sourceId }),
              let target = accounts.first(where: { $0.id == targetId })
        else {
            return
        }
        guard !source.isDeleted, !target.isDeleted else {
            return
        }

        let pinned = pinnedState(for: source, scopeKey: scopeKey).pinned
        guard pinnedState(for: target, scopeKey: scopeKey).pinned == pinned else {
            statusMessage = "仅支持 置顶、非置顶 项目内部排序"
            return
        }

        let group = sortedAccountsForDisplay(
            accounts.filter { !$0.isDeleted && pinnedState(for: $0, scopeKey: scopeKey).pinned == pinned },
            scopeKey: scopeKey
        )
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
            var state = pinnedState(for: accounts[index], scopeKey: scopeKey)
            if pinned {
                state.pinnedSortOrder = Int64(order)
            } else {
                state.regularSortOrder = Int64(order)
            }
            setPinnedState(state, for: &accounts[index], scopeKey: scopeKey)
            accounts[index].touchUpdatedAt(now, deviceName: device)
        }

        saveAccounts()
        appendHistoryEntry(action: pinned ? "重排置顶账号顺序" : "重排普通账号顺序", timestampMs: now)
    }

    func activeAccounts() -> [PasswordAccount] {
        sortedAccountsForDisplay(accounts.filter { !$0.isDeleted }, scopeKey: "all")
    }

    func filteredAccounts() -> [PasswordAccount] {
        showDeletedAccounts ? accounts.filter(\.isDeleted) : accounts.filter { !$0.isDeleted }
    }

    func displaySortedAccounts(_ source: [PasswordAccount], scopeKey: String = "all") -> [PasswordAccount] {
        sortedAccountsForDisplay(source, scopeKey: scopeKey)
    }

    private func pinnedState(for account: PasswordAccount, scopeKey: String) -> AccountPinnedViewState {
        let legacy = AccountPinnedViewState(
            pinned: account.isPinned ?? false,
            pinnedSortOrder: account.pinnedSortOrder,
            regularSortOrder: account.regularSortOrder
        )
        return account.pinnedViews?[scopeKey] ?? (scopeKey == "all" ? legacy : AccountPinnedViewState(pinned: false, pinnedSortOrder: nil, regularSortOrder: nil))
    }

    private func setPinnedState(_ state: AccountPinnedViewState, for account: inout PasswordAccount, scopeKey: String) {
        var pinnedViews = account.pinnedViews ?? [:]
        pinnedViews[scopeKey] = state
        account.pinnedViews = pinnedViews
        if scopeKey == "all" {
            account.isPinned = state.pinned
            account.pinnedSortOrder = state.pinnedSortOrder
            account.regularSortOrder = state.regularSortOrder
        }
    }

    private func nextPinnedSortOrder(scopeKey: String) -> Int64 {
        let pinnedOrders = accounts.compactMap { account -> Int64? in
            let state = pinnedState(for: account, scopeKey: scopeKey)
            guard state.pinned else { return nil }
            return state.pinnedSortOrder
        }
        return (pinnedOrders.max() ?? -1) + 1
    }

    private func sortedAccountsForDisplay(_ source: [PasswordAccount], scopeKey: String) -> [PasswordAccount] {
        source.sorted { lhs, rhs in
            let lhsState = pinnedState(for: lhs, scopeKey: scopeKey)
            let rhsState = pinnedState(for: rhs, scopeKey: scopeKey)
            let lhsPinned = lhsState.pinned
            let rhsPinned = rhsState.pinned
            if lhsPinned != rhsPinned {
                return lhsPinned && !rhsPinned
            }

            // 最近修改优先；恢复回收站、编辑保存后会触发 updatedAtMs 更新并置顶。
            if lhs.updatedAtMs != rhs.updatedAtMs {
                return lhs.updatedAtMs > rhs.updatedAtMs
            }

            if lhsPinned && rhsPinned {
                switch (lhsState.pinnedSortOrder, rhsState.pinnedSortOrder) {
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
                switch (lhsState.regularSortOrder, rhsState.regularSortOrder) {
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

    private func applyAutomaticFolderRules(to account: inout PasswordAccount) {
        let accountSites = Set(account.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
        guard !accountSites.isEmpty else { return }
        let matchingFolderIds = folders.compactMap { folder -> UUID? in
            guard folder.autoAddMatchingSites else { return nil }
            let folderSites = Set(folder.matchedSites.map(DomainUtils.normalize).filter { !$0.isEmpty })
            guard !folderSites.isDisjoint(with: accountSites) else { return nil }
            return folder.id
        }
        guard !matchingFolderIds.isEmpty else { return }
        let mergedFolderIds = normalizeFolderIds(account.resolvedFolderIds + matchingFolderIds)
        account.setResolvedFolderIds(mergedFolderIds)
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
        syncNow()
    }

    func syncNow(modeOverride: SyncMode? = nil, suppressBusyMessage: Bool = false) {
        if let syncNowTask, !syncNowTask.isCancelled {
            if !suppressBusyMessage {
                statusMessage = "同步进行中，请稍候"
            }
            return
        }
        syncNowTask = Task { [weak self] in
            guard let self else { return }
            await self.performSyncNow(mode: modeOverride ?? self.syncMode)
            self.syncNowTask = nil
        }
    }

    private func performSyncNow(mode: SyncMode) async {
        let enabledSourceNames = activeSyncSourceNames()
        guard !enabledSourceNames.isEmpty else {
            cloudSyncStatus = "未启用同步源"
            statusMessage = "请先启用至少一个同步源"
            return
        }

        let localPayload = buildCurrentSyncPayload()
        var mergedPayload = localPayload
        var selfHostedETag: String?

        if mode != .localOverwriteRemote {
            var remoteAggregate: SyncBundlePayload?

            if syncEnableICloud {
                do {
                    if let remotePayload = try fetchRemotePayloadFromICloud() {
                        remoteAggregate = mergePayloadsIfNeeded(current: remoteAggregate, incoming: remotePayload)
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
                    let remoteResponse = try await fetchRemotePayload(
                        from: resourceURL,
                        authorization: authorization
                    )
                    if let remotePayload = remoteResponse.payload {
                        remoteAggregate = mergePayloadsIfNeeded(current: remoteAggregate, incoming: remotePayload)
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
                    let remoteResponse = try await fetchRemotePayload(
                        from: resourceURL,
                        authorization: authorization
                    )
                    selfHostedETag = remoteResponse.etag
                    if let remotePayload = remoteResponse.payload {
                        remoteAggregate = mergePayloadsIfNeeded(current: remoteAggregate, incoming: remotePayload)
                    }
                } catch {
                    statusMessage = "服务器拉取失败: \(error.localizedDescription)"
                    return
                }
            }

            switch mode {
            case .merge:
                if let remoteAggregate {
                    mergedPayload = mergePayloads(local: localPayload, remote: remoteAggregate)
                }
            case .remoteOverwriteLocal:
                mergedPayload = remoteAggregate ?? emptySyncPayload()
            case .localOverwriteRemote:
                break
            }
        }

        let syncTitle = "同步并更新本地（\(enabledSourceNames.joined(separator: " + "))，\(mode.label)）"
        var changed = applyMergedPayloadIfNeeded(mergedPayload, historyTitle: syncTitle)
        var pushErrors: [String] = []

        if syncEnableSelfHostedServer {
            guard let resourceURL = buildSelfHostedPayloadURL() else {
                pushErrors.append("服务器: 配置不完整")
                updateSyncStatusAfterSync(
                    changed: changed,
                    enabledSourceNames: enabledSourceNames,
                    pushErrors: pushErrors,
                    mode: mode
                )
                return
            }
            do {
                let authorization = buildBearerAuthorization(serverAuthToken)
                switch mode {
                case .merge:
                    let pushResult = try await pushSelfHostedPayloadWithRetry(
                        mergedPayload,
                        to: resourceURL,
                        authorization: authorization,
                        etag: selfHostedETag,
                        historyTitle: "同步冲突后重新合并（服务器，\(mode.label)）"
                    )
                    mergedPayload = pushResult.payload
                    changed = changed || pushResult.changedLocalData
                case .remoteOverwriteLocal:
                    let pushResult = try await pushSelfHostedRemotePayloadWithRetry(
                        mergedPayload,
                        to: resourceURL,
                        authorization: authorization,
                        etag: selfHostedETag,
                        historyTitle: "远端覆盖本地（服务器，\(mode.label)）"
                    )
                    mergedPayload = pushResult.payload
                    changed = changed || pushResult.changedLocalData
                case .localOverwriteRemote:
                    try await pushRemotePayload(
                        mergedPayload,
                        to: resourceURL,
                        authorization: authorization
                    )
                }
            } catch {
                pushErrors.append("服务器: \(error.localizedDescription)")
            }
        }

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
                updateSyncStatusAfterSync(
                    changed: changed,
                    enabledSourceNames: enabledSourceNames,
                    pushErrors: pushErrors,
                    mode: mode
                )
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

        updateSyncStatusAfterSync(
            changed: changed,
            enabledSourceNames: enabledSourceNames,
            pushErrors: pushErrors,
            mode: mode
        )
    }

    private func updateSyncStatusAfterSync(
        changed: Bool,
        enabledSourceNames: [String],
        pushErrors: [String],
        mode: SyncMode
    ) {
        let sourceSummary = enabledSourceNames.joined(separator: " + ")
        if pushErrors.isEmpty {
            cloudSyncStatus = changed
                ? "\(sourceSummary) \(mode.completionVerb): \(displayTime(nowMs()))"
                : "\(sourceSummary) 已同步: \(displayTime(nowMs()))"
            statusMessage = changed
                ? "已与 \(sourceSummary) \(mode.completionVerb)"
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

    var autoSyncIntervalOptions: [AutoSyncInterval] {
        AutoSyncInterval.allCases
    }

    var autoSyncStatusDescription: String {
        let interval = AutoSyncInterval(rawValue: autoSyncIntervalMinutes) ?? .disabled
        let enabledSourceNames = activeSyncSourceNames()
        if interval == .disabled {
            return "自动同步已关闭"
        }
        if enabledSourceNames.isEmpty {
            return "自动同步已开启，但当前没有可用同步源"
        }
        return "自动按“合并”模式执行 \(interval.label)，同步源：\(enabledSourceNames.joined(separator: " + "))"
    }

    private func buildCurrentSyncPayload() -> SyncBundlePayload {
        SyncBundlePayload(
            accounts: accounts,
            folders: folders,
            passkeys: passkeys
        )
    }

    private func emptySyncPayload() -> SyncBundlePayload {
        SyncBundlePayload(accounts: [], folders: [], passkeys: [])
    }

    private func mergePayloadsIfNeeded(current: SyncBundlePayload?, incoming: SyncBundlePayload) -> SyncBundlePayload {
        guard let current else { return incoming }
        return mergePayloads(local: current, remote: incoming)
    }

    private func buildSyncBundleDocument(payload: SyncBundlePayload) -> SyncBundleV2 {
        let logicalClockMs = nowMs()
        return SyncBundleV2(
            schema: Self.syncBundleSchemaV2,
            exportedAtMs: logicalClockMs,
            source: SyncBundleSource(
                app: "pass-mac",
                platform: "macos-app",
                deviceName: currentDeviceName(),
                deviceId: syncDeviceId(),
                logicalClockMs: logicalClockMs,
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
    private func applyMergedPayloadIfNeeded(_ payload: SyncBundlePayload, historyTitle: String? = nil) -> Bool {
        let currentPayload = buildCurrentSyncPayload()
        guard !syncPayloadEquals(currentPayload, payload) else { return false }
        let previousAccounts = currentPayload.accounts
        suppressCloudPush = true
        defer { suppressCloudPush = false }
        folders = payload.folders
        accounts = payload.accounts
        passkeys = payload.passkeys
        syncAliasGroups()
        saveFoldersToDefaults()
        saveAccounts()
        savePasskeysToLocalDisk()
        if let historyTitle {
            appendAccountHistoryBatch(
                category: .sync,
                title: historyTitle,
                beforeAccounts: previousAccounts,
                afterAccounts: accounts
            )
        }
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

    private func fetchRemotePayload(from url: URL, authorization: String?) async throws -> RemotePayloadResponse {
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
            return RemotePayloadResponse(payload: nil, etag: nil)
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw NSError(
                domain: "AccountStore.SyncRemote",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "远端拉取失败，HTTP \(http.statusCode)"]
            )
        }
        guard !data.isEmpty else {
            return RemotePayloadResponse(payload: nil, etag: http.value(forHTTPHeaderField: "ETag"))
        }
        let parsed = try decodeSyncBundle(data)
        return RemotePayloadResponse(
            payload: SyncBundlePayload(
                accounts: normalizeDecodedAccounts(parsed.accounts),
                folders: parsed.folders,
                passkeys: parsed.passkeys
            ),
            etag: http.value(forHTTPHeaderField: "ETag")
        )
    }

    private func pushRemotePayload(
        _ payload: SyncBundlePayload,
        to url: URL,
        authorization: String?,
        ifMatch: String? = nil
    ) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let authorization {
            request.setValue(authorization, forHTTPHeaderField: "Authorization")
        }
        if let ifMatch {
            request.setValue(ifMatch, forHTTPHeaderField: "If-Match")
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
        if http.statusCode == 412 {
            throw SyncRemoteError.preconditionFailed
        }
        guard (200 ... 299).contains(http.statusCode) else {
            throw NSError(
                domain: "AccountStore.SyncRemote",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: "远端上传失败，HTTP \(http.statusCode)"]
            )
        }
    }

    private func pushSelfHostedPayloadWithRetry(
        _ payload: SyncBundlePayload,
        to url: URL,
        authorization: String?,
        etag: String?,
        historyTitle: String
    ) async throws -> SelfHostedPushResult {
        do {
            try await pushRemotePayload(payload, to: url, authorization: authorization, ifMatch: etag)
            return SelfHostedPushResult(payload: payload, changedLocalData: false)
        } catch SyncRemoteError.preconditionFailed {
            let latestResponse = try await fetchRemotePayload(from: url, authorization: authorization)
            let latestPayload = latestResponse.payload ?? SyncBundlePayload(accounts: [], folders: [], passkeys: [])
            let reconciledPayload = mergePayloads(local: payload, remote: latestPayload)
            let changed = applyMergedPayloadIfNeeded(reconciledPayload, historyTitle: historyTitle)
            try await pushRemotePayload(
                reconciledPayload,
                to: url,
                authorization: authorization,
                ifMatch: latestResponse.etag
            )
            return SelfHostedPushResult(payload: reconciledPayload, changedLocalData: changed)
        }
    }

    private func pushSelfHostedRemotePayloadWithRetry(
        _ payload: SyncBundlePayload,
        to url: URL,
        authorization: String?,
        etag: String?,
        historyTitle: String
    ) async throws -> SelfHostedPushResult {
        do {
            try await pushRemotePayload(payload, to: url, authorization: authorization, ifMatch: etag)
            return SelfHostedPushResult(payload: payload, changedLocalData: false)
        } catch SyncRemoteError.preconditionFailed {
            let latestResponse = try await fetchRemotePayload(from: url, authorization: authorization)
            let latestPayload = latestResponse.payload ?? emptySyncPayload()
            let changed = applyMergedPayloadIfNeeded(latestPayload, historyTitle: historyTitle)
            try await pushRemotePayload(
                latestPayload,
                to: url,
                authorization: authorization,
                ifMatch: latestResponse.etag
            )
            return SelfHostedPushResult(payload: latestPayload, changedLocalData: changed)
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
        PassSharedData.migrateLegacyStoreToSharedContainerIfNeeded()

        let defaults = UserDefaults.standard
        deviceName = defaults.string(forKey: Keys.deviceName) ?? ""
        exportDirectoryPath = defaults.string(forKey: Keys.exportDirectoryPath) ?? ""
        isLoadingSyncPreferences = true
        syncEnableICloud = defaults.object(forKey: Keys.syncEnableICloud) as? Bool ?? true
        syncEnableWebDAV = defaults.object(forKey: Keys.syncEnableWebDAV) as? Bool ?? false
        syncEnableSelfHostedServer = defaults.object(forKey: Keys.syncEnableSelfHostedServer) as? Bool ?? false
        syncMode = SyncMode(rawValue: defaults.string(forKey: Keys.syncMode) ?? "") ?? .merge
        autoSyncIntervalMinutes = AutoSyncInterval(rawValue: defaults.integer(forKey: Keys.autoSyncIntervalMinutes))?.rawValue ?? AutoSyncInterval.disabled.rawValue
        webdavBaseURL = defaults.string(forKey: Keys.webdavBaseURL) ?? ""
        webdavRemotePath = defaults.string(forKey: Keys.webdavRemotePath) ?? "pass-sync-bundle-v2.json"
        webdavUsername = defaults.string(forKey: Keys.webdavUsername) ?? ""
        webdavPassword = readSecret(account: SecretKeys.webdavPasswordAccount)
        serverBaseURL = defaults.string(forKey: Keys.serverBaseURL) ?? Self.defaultSelfHostedServerBaseURL
        serverAuthToken = {
            let saved = readSecret(account: SecretKeys.serverTokenAccount)
            return saved.isEmpty ? Self.defaultSelfHostedServerAuthToken : saved
        }()
        isLoadingSyncPreferences = false

        let foldersDataFromDatabase = loadCollectionDataFromLocalDatabase(for: LocalDatabaseKeys.folders)
        var migratedFoldersFromDefaults = false
        if let foldersDataFromDatabase,
           let decodedFolders = try? decoder.decode([AccountFolder].self, from: foldersDataFromDatabase)
        {
            folders = decodedFolders
        } else if let foldersData = defaults.data(forKey: Keys.foldersData),
                  let decodedFolders = try? decoder.decode([AccountFolder].self, from: foldersData)
        {
            folders = decodedFolders
            migratedFoldersFromDefaults = true
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
        historyEntries = loadHistoryFromLocalDisk()

        let accountDataFromDatabase = loadCollectionDataFromLocalDatabase(for: LocalDatabaseKeys.accounts)
        let fileURL = dataFileURL()
        let accountDataFromLegacyFile = try? Data(contentsOf: fileURL)
        let accountDataCandidates = [accountDataFromDatabase, accountDataFromLegacyFile].compactMap { $0 }
        guard !accountDataCandidates.isEmpty else {
            accounts = []
            CredentialIdentitySync.replaceCredentialIdentities(accounts: accounts)
            if folderNormalization.foldersChanged || migratedFoldersFromDefaults {
                saveFoldersToDefaults()
            }
            return
        }

        for data in accountDataCandidates {
            if let decoded = try? decoder.decode([PasswordAccount].self, from: data) {
                accounts = normalizeDecodedAccounts(decoded)
                let accountsChanged = migrateAccountFolderIdsFromLegacyNewAccountFolder(
                    legacyFolderIds: folderNormalization.legacyNewAccountFolderIds
                )
                let usingDatabaseData = accountDataFromDatabase.map { $0 == data } ?? false
                if accountsChanged || !usingDatabaseData {
                    saveAccountsToLocalDisk()
                }
                CredentialIdentitySync.replaceCredentialIdentities(accounts: accounts)
                if folderNormalization.foldersChanged || migratedFoldersFromDefaults {
                    saveFoldersToDefaults()
                }
                return
            }

            if let legacy = try? decoder.decode([LegacyPasswordAccount].self, from: data) {
                accounts = legacy.map { $0.toCurrent(deviceName: currentDeviceName()) }
                _ = migrateAccountFolderIdsFromLegacyNewAccountFolder(
                    legacyFolderIds: folderNormalization.legacyNewAccountFolderIds
                )
                CredentialIdentitySync.replaceCredentialIdentities(accounts: accounts)
                if folderNormalization.foldersChanged || migratedFoldersFromDefaults {
                    saveFoldersToDefaults()
                }
                saveAccounts()
                return
            }
        }

        accounts = []
        CredentialIdentitySync.replaceCredentialIdentities(accounts: accounts)
        if folderNormalization.foldersChanged || migratedFoldersFromDefaults {
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
            try saveCollectionDataToLocalDatabase(data, for: LocalDatabaseKeys.accounts)
            CredentialIdentitySync.replaceCredentialIdentities(accounts: accounts)
        } catch {
            statusMessage = "保存失败: \(error.localizedDescription)"
        }
    }

    private func loadPasskeysFromLocalDisk() -> [PasskeyRecord] {
        if let data = loadCollectionDataFromLocalDatabase(for: LocalDatabaseKeys.passkeys),
           let decoded = try? decoder.decode([PasskeyRecord].self, from: data)
        {
            return decoded.map(normalizePasskeyRecord)
        }

        let fileURL = passkeysFileURL()
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? decoder.decode([PasskeyRecord].self, from: data)
        else {
            return []
        }
        let normalized = decoded.map(normalizePasskeyRecord)
        do {
            let migratedData = try encoder.encode(normalized)
            try saveCollectionDataToLocalDatabase(migratedData, for: LocalDatabaseKeys.passkeys)
        } catch {
            statusMessage = "迁移通行密钥到 SQLite 失败: \(error.localizedDescription)"
        }
        return normalized
    }

    private func savePasskeysToLocalDisk() {
        do {
            let data = try encoder.encode(passkeys.map(normalizePasskeyRecord))
            try saveCollectionDataToLocalDatabase(data, for: LocalDatabaseKeys.passkeys)
            if !suppressCloudPush && syncEnableICloud {
                pushSyncDataToICloud(trigger: "local_update")
            }
        } catch {
            statusMessage = "保存通行密钥失败: \(error.localizedDescription)"
        }
    }

    func clearHistoryEntries() {
        historyEntries = []
        saveHistoryToLocalDisk()
        statusMessage = "历史记录已清空"
    }

    func clearHistoryEntries(category: HistoryEntryCategory) {
        historyEntries.removeAll { $0.category == category }
        saveHistoryToLocalDisk()
        statusMessage = "\(category.menuTitle)已清空"
    }

    func historyEntries(category: HistoryEntryCategory) -> [OperationHistoryEntry] {
        historyEntries.filter { $0.category == category }
    }

    func canRevertHistoryEntry(_ entry: OperationHistoryEntry) -> Bool {
        if entry.accountBefore != nil || entry.accountAfter != nil {
            let accountId = historyAccountId(for: entry)
            return accountId != nil
        }
        return entry.fieldKey == "note" && entry.accountId != nil && entry.oldValue != nil
    }

    func canRevertHistoryOperation(_ entries: [OperationHistoryEntry]) -> Bool {
        !entries.isEmpty && entries.allSatisfy(canRevertHistoryEntry)
    }

    func clearHistoryEntries(forAccountId accountId: String) {
        let prefix = "\(accountId)："
        historyEntries.removeAll { entry in
            entry.accountId == accountId || entry.action.hasPrefix(prefix)
        }
        saveHistoryToLocalDisk()
        statusMessage = "历史记录已清空"
    }

    func revertHistoryEntry(_ entry: OperationHistoryEntry) {
        if entry.accountBefore != nil || entry.accountAfter != nil {
            revertAccountSnapshotHistoryEntry(entry)
            return
        }
        guard entry.fieldKey == "note",
              let accountId = entry.accountId,
              let restoredNote = entry.oldValue
        else {
            statusMessage = "该历史记录暂不支持回退"
            return
        }
        guard let index = accounts.firstIndex(where: { $0.accountId == accountId }) else {
            statusMessage = "未找到历史记录对应的账号"
            return
        }

        let currentNote = accounts[index].note
        guard currentNote != restoredNote else {
            statusMessage = "备注已经是该历史版本"
            return
        }

        let now = nowMs()
        let device = currentDeviceName()
        accounts[index].note = restoredNote
        accounts[index].noteUpdatedAtMs = now
        accounts[index].touchUpdatedAt(now, deviceName: device)
        saveAccounts()

        if editingAccountId == accounts[index].id {
            editNote = restoredNote
        }

        appendHistoryEntry(
            action: "\(accountId)：备注改为",
            timestampMs: now,
            accountId: accountId,
            fieldKey: "note",
            oldValue: currentNote,
            newValue: restoredNote
        )
        statusMessage = "已回退到该次修改前的备注"
    }

    func revertHistoryOperation(_ entries: [OperationHistoryEntry]) {
        guard canRevertHistoryOperation(entries) else {
            statusMessage = "该历史记录暂不支持整次撤销"
            return
        }

        let sortedEntries = entries.sorted { lhs, rhs in
            let lhsAccountId = historyAccountId(for: lhs) ?? lhs.accountId ?? ""
            let rhsAccountId = historyAccountId(for: rhs) ?? rhs.accountId ?? ""
            if lhsAccountId != rhsAccountId {
                return lhsAccountId < rhsAccountId
            }
            return lhs.id.uuidString < rhs.id.uuidString
        }

        var nextAccounts = accounts
        var beforeByAccountId: [String: PasswordAccount] = [:]
        var afterByAccountId: [String: PasswordAccount?] = [:]

        for entry in sortedEntries {
            if entry.accountBefore != nil || entry.accountAfter != nil {
                guard let accountId = historyAccountId(for: entry) else {
                    statusMessage = "未找到历史记录对应的账号"
                    return
                }

                let currentIndex = nextAccounts.firstIndex(where: { $0.accountId == accountId })
                let currentAccount = currentIndex.map { nextAccounts[$0] }
                let restoredAccount = entry.accountBefore

                if beforeByAccountId[accountId] == nil, let currentAccount {
                    beforeByAccountId[accountId] = currentAccount
                }

                if let currentIndex {
                    if let restoredAccount {
                        nextAccounts[currentIndex] = restoredAccount
                    } else {
                        nextAccounts.remove(at: currentIndex)
                    }
                } else if let restoredAccount {
                    nextAccounts.append(restoredAccount)
                }

                afterByAccountId[accountId] = restoredAccount
                continue
            }

            guard entry.fieldKey == "note",
                  let accountId = entry.accountId,
                  let restoredNote = entry.oldValue,
                  let currentIndex = nextAccounts.firstIndex(where: { $0.accountId == accountId })
            else {
                statusMessage = "未找到历史记录对应的账号"
                return
            }

            if beforeByAccountId[accountId] == nil {
                beforeByAccountId[accountId] = nextAccounts[currentIndex]
            }

            let now = nowMs()
            let device = currentDeviceName()
            nextAccounts[currentIndex].note = restoredNote
            nextAccounts[currentIndex].noteUpdatedAtMs = now
            nextAccounts[currentIndex].touchUpdatedAt(now, deviceName: device)
            afterByAccountId[accountId] = nextAccounts[currentIndex]
        }

        let changedAccountIds = Set(beforeByAccountId.keys).union(afterByAccountId.keys)
        guard !changedAccountIds.isEmpty else {
            statusMessage = "这次操作已经是历史版本"
            return
        }

        accounts = nextAccounts
        syncAliasGroups()
        saveAccounts()

        if let editingAccountId {
            if let editingIndex = accounts.firstIndex(where: { $0.id == editingAccountId }) {
                beginEditing(accounts[editingIndex])
            } else {
                cancelEditing()
            }
        }

        let now = nowMs()
        appendAccountHistoryBatch(
            category: .local,
            title: "从\(sortedEntries.first?.category.operationPrefix ?? HistoryEntryCategory.local.operationPrefix)历史撤回 \(changedAccountIds.count) 个账号",
            timestampMs: now,
            beforeAccounts: changedAccountIds.compactMap { beforeByAccountId[$0] },
            afterAccounts: changedAccountIds.compactMap { afterByAccountId[$0] ?? nil }
        )
        statusMessage = "已撤销此次操作：\(changedAccountIds.count) 个账号"
    }

    private func revertAccountSnapshotHistoryEntry(_ entry: OperationHistoryEntry) {
        guard let accountId = historyAccountId(for: entry) else {
            statusMessage = "未找到历史记录对应的账号"
            return
        }

        let currentIndex = accounts.firstIndex(where: { $0.accountId == accountId })
        let currentAccount = currentIndex.map { accounts[$0] }
        let restoredAccount = entry.accountBefore

        if currentAccount == restoredAccount {
            statusMessage = "该账号已经是该历史版本"
            return
        }

        if let currentIndex {
            if let restoredAccount {
                accounts[currentIndex] = restoredAccount
            } else {
                accounts.remove(at: currentIndex)
            }
        } else if let restoredAccount {
            accounts.append(restoredAccount)
        } else {
            statusMessage = "该账号已不存在，无需撤回"
            return
        }

        syncAliasGroups()
        saveAccounts()

        if let editingAccountId {
            if let editingIndex = accounts.firstIndex(where: { $0.id == editingAccountId }) {
                beginEditing(accounts[editingIndex])
            } else {
                cancelEditing()
            }
        }

        let now = nowMs()
        appendAccountHistoryBatch(
            category: .local,
            title: "从\(entry.category.operationPrefix)历史撤回 1 个账号",
            timestampMs: now,
            beforeAccounts: currentAccount.map { [$0] } ?? [],
            afterAccounts: restoredAccount.map { [$0] } ?? []
        )
        statusMessage = "已按历史记录撤回账号：\(accountId)"
    }

    private func loadHistoryFromLocalDisk() -> [OperationHistoryEntry] {
        guard let data = loadCollectionDataFromLocalDatabase(for: LocalDatabaseKeys.history),
              let decoded = try? decoder.decode([OperationHistoryEntry].self, from: data)
        else {
            return []
        }
        return decoded
            .filter { !$0.action.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .sorted { lhs, rhs in
                if lhs.timestampMs != rhs.timestampMs {
                    return lhs.timestampMs > rhs.timestampMs
                }
                return lhs.id.uuidString < rhs.id.uuidString
            }
    }

    private func saveHistoryToLocalDisk() {
        do {
            let data = try encoder.encode(historyEntries)
            try saveCollectionDataToLocalDatabase(data, for: LocalDatabaseKeys.history)
        } catch {
            statusMessage = "保存历史记录失败: \(error.localizedDescription)"
        }
    }

    private func historyAccountId(for entry: OperationHistoryEntry) -> String? {
        if let accountId = entry.accountId, !accountId.isEmpty {
            return accountId
        }
        if let accountId = entry.accountBefore?.accountId, !accountId.isEmpty {
            return accountId
        }
        if let accountId = entry.accountAfter?.accountId, !accountId.isEmpty {
            return accountId
        }
        return nil
    }

    private func appendAccountHistoryBatch(
        category: HistoryEntryCategory,
        title: String,
        timestampMs: Int64? = nil,
        beforeAccounts: [PasswordAccount],
        afterAccounts: [PasswordAccount]
    ) {
        let now = timestampMs ?? nowMs()
        let operationId = UUID()
        let beforeByAccountId = Dictionary(uniqueKeysWithValues: beforeAccounts.map { ($0.accountId, $0) })
        let afterByAccountId = Dictionary(uniqueKeysWithValues: afterAccounts.map { ($0.accountId, $0) })
        let accountIds = Set(beforeByAccountId.keys).union(afterByAccountId.keys).sorted()
        guard !accountIds.isEmpty else { return }

        for accountId in accountIds {
            let before = beforeByAccountId[accountId]
            let after = afterByAccountId[accountId]
            guard before != after else { continue }

            let detail = historyDetailText(before: before, after: after)
            let entry = OperationHistoryEntry(
                id: UUID(),
                timestampMs: now,
                category: category,
                operationId: operationId,
                operationTitle: title,
                action: detail,
                accountId: accountId,
                accountBefore: before,
                accountAfter: after
            )
            historyEntries.insert(entry, at: 0)
        }

        if historyEntries.count > Self.maxHistoryEntries {
            historyEntries.removeLast(historyEntries.count - Self.maxHistoryEntries)
        }
        saveHistoryToLocalDisk()
    }

    private func historyDetailText(before: PasswordAccount?, after: PasswordAccount?) -> String {
        switch (before, after) {
        case (nil, let created?):
            return "创建账号：\(created.accountId)"
        case (let removed?, nil):
            return "删除账号：\(removed.accountId)"
        case (let before?, let after?):
            let changedFields = historyChangedFieldLabels(before: before, after: after)
            if changedFields.isEmpty {
                return "更新账号：\(after.accountId)"
            }
            return "更新账号：\(after.accountId)（\(changedFields.joined(separator: "、"))）"
        default:
            return "账号变更"
        }
    }

    private func historyChangedFieldLabels(before: PasswordAccount, after: PasswordAccount) -> [String] {
        var labels: [String] = []
        if before.sites != after.sites { labels.append("站点别名") }
        if before.username != after.username { labels.append("用户名") }
        if before.password != after.password { labels.append("密码") }
        if before.totpSecret != after.totpSecret { labels.append("TOTP") }
        if before.recoveryCodes != after.recoveryCodes { labels.append("恢复码") }
        if before.note != after.note { labels.append("备注") }
        if before.passkeyCredentialIds != after.passkeyCredentialIds { labels.append("通行密钥") }
        if before.resolvedFolderIds != after.resolvedFolderIds { labels.append("文件夹") }
        if before.isDeleted != after.isDeleted { labels.append(after.isDeleted ? "移入回收站" : "恢复账号") }
        return labels
    }

    private func appendHistoryEntry(
        action rawAction: String,
        timestampMs: Int64? = nil,
        category: HistoryEntryCategory = .local,
        accountId: String? = nil,
        fieldKey: String? = nil,
        oldValue: String? = nil,
        newValue: String? = nil
    ) {
        let action = rawAction.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !action.isEmpty else { return }
        let entry = OperationHistoryEntry(
            id: UUID(),
            timestampMs: timestampMs ?? nowMs(),
            category: category,
            action: action,
            accountId: accountId,
            fieldKey: fieldKey,
            oldValue: oldValue,
            newValue: newValue
        )
        historyEntries.insert(entry, at: 0)
        if historyEntries.count > Self.maxHistoryEntries {
            historyEntries.removeLast(historyEntries.count - Self.maxHistoryEntries)
        }
        saveHistoryToLocalDisk()
    }

    private func historyValueSnippet(_ raw: String, maxLength: Int = 80) -> String {
        let normalized = raw
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty {
            return "(空)"
        }
        if normalized.count <= maxLength {
            return normalized
        }
        return String(normalized.prefix(maxLength)) + "..."
    }

    private func loadCollectionDataFromLocalDatabase(for key: String) -> Data? {
        try? localSQLiteStore.readData(for: key)
    }

    private func saveCollectionDataToLocalDatabase(_ data: Data, for key: String) throws {
        try localSQLiteStore.writeData(data, for: key, updatedAtMs: nowMs())
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
        updateAutoSyncTimer()
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
                    self.syncNow(modeOverride: .merge)
                } else {
                    _ = self.pullSyncDataFromICloud(trigger: "remote_change")
                }
            }
        }

        if syncEnableWebDAV || syncEnableSelfHostedServer {
            syncNow(modeOverride: .merge)
        } else {
            _ = pullSyncDataFromICloud(trigger: "startup")
            pushSyncDataToICloud(trigger: "startup")
        }
    }

    private func updateAutoSyncTimer() {
        autoSyncTimer?.invalidate()
        autoSyncTimer = nil

        let interval = AutoSyncInterval(rawValue: autoSyncIntervalMinutes) ?? .disabled
        guard interval != .disabled else { return }
        guard !activeSyncSourceNames().isEmpty else { return }

        autoSyncTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(interval.rawValue * 60), repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.syncNow(modeOverride: .merge, suppressBusyMessage: true)
            }
        }
        autoSyncTimer?.tolerance = min(30, TimeInterval(interval.rawValue * 10))
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
        let changed = applyMergedPayloadIfNeeded(
            mergedPayload,
            historyTitle: "iCloud 自动合并并更新本地"
        )
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
            pinnedViews: newerAccount.pinnedViews,
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
                matchedSites: existing.matchedSites,
                autoAddMatchingSites: existing.autoAddMatchingSites,
                createdAtMs: existing.createdAtMs,
                updatedAtMs: existing.updatedAtMs
            )
        } else {
            mergedById[fixedId] = AccountFolder(
                id: fixedId,
                name: Self.fixedNewAccountFolderName,
                matchedSites: [],
                autoAddMatchingSites: false,
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
                matchedSites: rightUpdatedAt >= leftUpdatedAt ? rhs.matchedSites : lhs.matchedSites,
                autoAddMatchingSites: rightUpdatedAt >= leftUpdatedAt ? rhs.autoAddMatchingSites : lhs.autoAddMatchingSites,
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
            matchedSites: rightUpdatedAt > leftUpdatedAt ? rhs.matchedSites : lhs.matchedSites,
            autoAddMatchingSites: rightUpdatedAt > leftUpdatedAt ? rhs.autoAddMatchingSites : lhs.autoAddMatchingSites,
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
            matchedSites: folders.first(where: { $0.id == fixedId })?.matchedSites ?? [],
            autoAddMatchingSites: folders.first(where: { $0.id == fixedId })?.autoAddMatchingSites ?? false,
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

    private func matchedImportedAccountIndex(
        in source: [PasswordAccount],
        entry: BrowserPasswordImportEntry
    ) -> Int? {
        let entrySites = Set(entry.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
        let entryCanonicalSites = Set(entrySites.map(DomainUtils.etldPlusOne))
        let normalizedUsername = entry.username.trimmingCharacters(in: .whitespacesAndNewlines)

        var bestMatch: (index: Int, score: Int)?

        for (index, account) in source.enumerated() {
            let accountSites = Set(account.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
            let accountCanonicalSites = Set(accountSites.map(DomainUtils.etldPlusOne)).union([account.canonicalSite])
            let usernameMatches = normalizedUsername.isEmpty
                ? account.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                : (
                    account.username.trimmingCharacters(in: .whitespacesAndNewlines) == normalizedUsername ||
                    account.usernameAtCreate.trimmingCharacters(in: .whitespacesAndNewlines) == normalizedUsername
                )
            let siteOverlaps = !entrySites.isDisjoint(with: accountSites)
            let canonicalMatches = !entryCanonicalSites.isDisjoint(with: accountCanonicalSites)

            let score: Int
            if usernameMatches && siteOverlaps {
                score = account.isDeleted ? 35 : 40
            } else if usernameMatches && canonicalMatches {
                score = account.isDeleted ? 25 : 30
            } else if normalizedUsername.isEmpty && siteOverlaps {
                score = account.isDeleted ? 15 : 20
            } else if normalizedUsername.isEmpty && canonicalMatches {
                score = account.isDeleted ? 5 : 10
            } else {
                continue
            }

            if bestMatch == nil || score > bestMatch!.score {
                bestMatch = (index, score)
            }
        }

        return bestMatch?.index
    }

    private func applyImportedBrowserEntry(
        _ entry: BrowserPasswordImportEntry,
        to account: PasswordAccount,
        nowMs: Int64
    ) -> PasswordAccount {
        var updated = account
        var changed = false

        let mergedSites = Array(
            Set((updated.sites + entry.sites).map(DomainUtils.normalize).filter { !$0.isEmpty })
        ).sorted()
        if mergedSites != updated.sites {
            updated.sites = mergedSites
            changed = true
        }

        if !entry.username.isEmpty, entry.username != updated.username {
            updated.username = entry.username
            updated.usernameUpdatedAtMs = nowMs
            changed = true
        }

        if !entry.password.isEmpty, entry.password != updated.password {
            updated.password = entry.password
            updated.passwordUpdatedAtMs = nowMs
            changed = true
        }

        let mergedNote = mergedImportedBrowserNote(existing: updated.note, incoming: entry.note)
        if mergedNote != updated.note {
            updated.note = mergedNote
            updated.noteUpdatedAtMs = nowMs
            changed = true
        }

        if updated.isDeleted {
            updated.isDeleted = false
            updated.deletedAtMs = nil
            changed = true
        }

        if changed {
            updated.touchUpdatedAt(nowMs, deviceName: currentDeviceName())
        }

        return updated
    }

    private func mergedImportedBrowserNote(existing: String, incoming: String) -> String {
        let normalizedIncoming = incoming.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedIncoming.isEmpty else { return existing }

        let normalizedExisting = existing.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedExisting.isEmpty else { return normalizedIncoming }
        if normalizedExisting.contains(normalizedIncoming) {
            return normalizedExisting
        }
        return "\(normalizedExisting)\n\(normalizedIncoming)"
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

    private struct ParsedGoogleAuthenticatorEntry {
        let secret: String
        let siteAlias: String?
        let username: String?
    }

    private struct ParsedGoogleAuthenticatorMigration {
        let entries: [ParsedGoogleAuthenticatorEntry]
        let skippedCount: Int
        let batchSize: Int
        let batchIndex: Int
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
        let siteAlias = resolveImportedSiteAlias(issuer: issuer, username: labelUsername)

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

    private func resolveImportedSiteAlias(issuer: String, username: String?) -> String? {
        if let site = siteAliasFromIssuer(issuer), !site.isEmpty {
            return site
        }
        if let site = siteAliasFromUsername(username), !site.isEmpty {
            return site
        }
        return nil
    }

    private func siteAliasFromUsername(_ username: String?) -> String? {
        let raw = (username ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }
        if let atIndex = raw.lastIndex(of: "@"), atIndex < raw.index(before: raw.endIndex) {
            let domainPart = String(raw[raw.index(after: atIndex)...])
            let normalized = DomainUtils.normalize(domainPart)
            return normalized.isEmpty ? nil : normalized
        }
        let normalized = DomainUtils.normalize(raw)
        return normalized.isEmpty ? nil : normalized
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

    private func parseGoogleAuthenticatorMigrationFromImageFile(_ fileURL: URL) -> ParsedGoogleAuthenticatorMigration? {
        guard let image = NSImage(contentsOf: fileURL),
              let cgImage = cgImage(from: image),
              let qrPayload = parseQRCodePayload(from: cgImage)
        else {
            return nil
        }
        return parseGoogleAuthenticatorMigrationURI(qrPayload)
    }

    private func readGoogleAuthenticatorMigrationFromPasteboard() -> ParsedGoogleAuthenticatorMigration? {
        if let rawText = NSPasteboard.general.string(forType: .string),
           let payload = parseGoogleAuthenticatorMigrationURI(rawText)
        {
            return payload
        }
        guard let qrPayload = parseQRCodePayloadFromPasteboard() else {
            return nil
        }
        return parseGoogleAuthenticatorMigrationURI(qrPayload)
    }

    private func mergedGoogleAuthenticatorMigrations(
        _ migrations: [ParsedGoogleAuthenticatorMigration]
    ) -> ParsedGoogleAuthenticatorMigration {
        var seen: Set<String> = []
        var entries: [ParsedGoogleAuthenticatorEntry] = []
        var skippedCount = 0
        var batchSize = 0

        for migration in migrations {
            skippedCount += migration.skippedCount
            batchSize += max(migration.batchSize, migration.entries.isEmpty ? 0 : 1)
            for entry in migration.entries {
                let key = [
                    entry.siteAlias ?? "",
                    entry.username ?? "",
                    entry.secret,
                ].joined(separator: "|")
                if seen.insert(key).inserted {
                    entries.append(entry)
                }
            }
        }

        return ParsedGoogleAuthenticatorMigration(
            entries: entries,
            skippedCount: skippedCount,
            batchSize: max(batchSize, migrations.count),
            batchIndex: 0
        )
    }

    private func parseGoogleAuthenticatorMigrationURI(_ raw: String) -> ParsedGoogleAuthenticatorMigration? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let components = URLComponents(string: trimmed) else {
            return nil
        }
        guard components.scheme?.lowercased() == "otpauth-migration" else { return nil }
        guard components.host?.lowercased() == "offline" else { return nil }
        let dataB64 = components.queryItems?
            .first(where: { $0.name.caseInsensitiveCompare("data") == .orderedSame })?
            .value?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !dataB64.isEmpty else { return nil }
        guard let rawData = Data(base64Encoded: normalizedBase64String(dataB64)) else {
            return nil
        }
        return decodeGoogleAuthenticatorMigrationPayload(rawData)
    }

    private func normalizedBase64String(_ raw: String) -> String {
        let normalized = raw
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = normalized.count % 4
        guard remainder != 0 else { return normalized }
        return normalized + String(repeating: "=", count: 4 - remainder)
    }

    private func decodeGoogleAuthenticatorMigrationPayload(_ data: Data) -> ParsedGoogleAuthenticatorMigration? {
        var reader = ProtoReader(data: data)
        var entries: [ParsedGoogleAuthenticatorEntry] = []
        var skippedCount = 0
        var batchSize = 0
        var batchIndex = 0

        while !reader.isAtEnd {
            guard let tag = reader.readVarint() else { break }
            let fieldNumber = Int(tag >> 3)
            let wireType = Int(tag & 0x07)

            switch (fieldNumber, wireType) {
            case (1, 2):
                guard let nested = reader.readLengthDelimited() else { return nil }
                if let entry = decodeGoogleAuthenticatorOtpParameters(nested) {
                    entries.append(entry)
                } else {
                    skippedCount += 1
                }
            case (3, 0):
                guard let value = reader.readVarint() else { return nil }
                batchSize = Int(value)
            case (4, 0):
                guard let value = reader.readVarint() else { return nil }
                batchIndex = Int(value)
            default:
                guard reader.skipField(wireType: wireType) else { return nil }
            }
        }

        return ParsedGoogleAuthenticatorMigration(
            entries: entries,
            skippedCount: skippedCount,
            batchSize: batchSize,
            batchIndex: batchIndex
        )
    }

    private func decodeGoogleAuthenticatorOtpParameters(_ data: Data) -> ParsedGoogleAuthenticatorEntry? {
        var reader = ProtoReader(data: data)
        var secretData = Data()
        var name = ""
        var issuer = ""
        var algorithm = 1
        var digits = 1
        var type = 2

        while !reader.isAtEnd {
            guard let tag = reader.readVarint() else { break }
            let fieldNumber = Int(tag >> 3)
            let wireType = Int(tag & 0x07)

            switch (fieldNumber, wireType) {
            case (1, 2):
                guard let value = reader.readLengthDelimited() else { return nil }
                secretData = value
            case (2, 2):
                guard let value = reader.readLengthDelimitedString() else { return nil }
                name = value
            case (3, 2):
                guard let value = reader.readLengthDelimitedString() else { return nil }
                issuer = value
            case (4, 0):
                guard let value = reader.readVarint() else { return nil }
                algorithm = Int(value)
            case (5, 0):
                guard let value = reader.readVarint() else { return nil }
                digits = Int(value)
            case (6, 0):
                guard let value = reader.readVarint() else { return nil }
                type = Int(value)
            default:
                guard reader.skipField(wireType: wireType) else { return nil }
            }
        }

        guard !secretData.isEmpty else { return nil }
        guard type == 2, algorithm == 1, digits == 1 else { return nil }

        let label = parseImportedOtpLabel(name)
        let effectiveIssuer = issuer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? label.issuer : issuer
        let username = !label.username.isEmpty ? label.username : name.trimmingCharacters(in: .whitespacesAndNewlines)
        let siteAlias = resolveImportedSiteAlias(issuer: effectiveIssuer, username: username)
        let secret = base32EncodedString(secretData)
        guard let siteAlias, !secret.isEmpty, isValidTotpSecret(secret) else {
            return nil
        }

        return ParsedGoogleAuthenticatorEntry(
            secret: secret,
            siteAlias: siteAlias,
            username: username.isEmpty ? nil : username
        )
    }

    private func parseImportedOtpLabel(_ raw: String) -> (issuer: String, username: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return ("", "") }
        guard let colonIndex = text.firstIndex(of: ":") else {
            return ("", text)
        }
        let issuer = String(text[..<colonIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
        let username = String(text[text.index(after: colonIndex)...]).trimmingCharacters(in: .whitespacesAndNewlines)
        return (issuer, username)
    }

    private func base32EncodedString(_ data: Data) -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var output = ""
        var buffer: UInt16 = 0
        var bitsInBuffer = 0

        for byte in data {
            buffer = (buffer << 8) | UInt16(byte)
            bitsInBuffer += 8

            while bitsInBuffer >= 5 {
                let index = Int((buffer >> UInt16(bitsInBuffer - 5)) & 0x1F)
                output.append(alphabet[index])
                bitsInBuffer -= 5
                if bitsInBuffer == 0 {
                    buffer = 0
                } else {
                    buffer &= (UInt16(1) << UInt16(bitsInBuffer)) - 1
                }
            }
        }

        if bitsInBuffer > 0 {
            let index = Int((buffer << UInt16(5 - bitsInBuffer)) & 0x1F)
            output.append(alphabet[index])
        }

        return output
    }

    private struct ProtoReader {
        let data: Data
        var offset: Int = 0

        var isAtEnd: Bool {
            offset >= data.count
        }

        mutating func readVarint() -> UInt64? {
            var result: UInt64 = 0
            var shift: UInt64 = 0

            while offset < data.count && shift <= 63 {
                let byte = data[offset]
                offset += 1
                result |= UInt64(byte & 0x7F) << shift
                if (byte & 0x80) == 0 {
                    return result
                }
                shift += 7
            }

            return nil
        }

        mutating func readLengthDelimited() -> Data? {
            guard let length = readVarint() else { return nil }
            let count = Int(length)
            guard count >= 0, offset + count <= data.count else { return nil }
            let slice = data.subdata(in: offset ..< offset + count)
            offset += count
            return slice
        }

        mutating func readLengthDelimitedString() -> String? {
            guard let value = readLengthDelimited() else { return nil }
            return String(data: value, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }

        mutating func skipField(wireType: Int) -> Bool {
            switch wireType {
            case 0:
                return readVarint() != nil
            case 1:
                guard offset + 8 <= data.count else { return false }
                offset += 8
                return true
            case 2:
                return readLengthDelimited() != nil
            case 5:
                guard offset + 4 <= data.count else { return false }
                offset += 4
                return true
            default:
                return false
            }
        }
    }

    private func matchedImportedTotpAccountIndex(
        in accounts: [PasswordAccount],
        siteAlias: String,
        username: String,
        secret: String
    ) -> Int? {
        let entrySite = DomainUtils.normalize(siteAlias)
        let entryCanonicalSite = DomainUtils.etldPlusOne(for: entrySite)
        let normalizedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedSecret = secret.trimmingCharacters(in: .whitespacesAndNewlines)

        var bestMatch: (index: Int, score: Int)?

        for (index, account) in accounts.enumerated() {
            let accountSecret = account.totpSecret.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalizedSecret.isEmpty, accountSecret == normalizedSecret else {
                continue
            }

            let accountSites = Set(account.sites.map(DomainUtils.normalize).filter { !$0.isEmpty })
            let accountCanonicalSites = Set(accountSites.map(DomainUtils.etldPlusOne)).union([account.canonicalSite])
            let usernameMatches = normalizedUsername.isEmpty
                ? account.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                : (
                    account.username.trimmingCharacters(in: .whitespacesAndNewlines) == normalizedUsername ||
                    account.usernameAtCreate.trimmingCharacters(in: .whitespacesAndNewlines) == normalizedUsername
                )
            let siteOverlaps = accountSites.contains(entrySite)
            let canonicalMatches = !entryCanonicalSite.isEmpty && accountCanonicalSites.contains(entryCanonicalSite)

            let score: Int
            if usernameMatches && siteOverlaps {
                score = account.isDeleted ? 35 : 40
            } else if usernameMatches && canonicalMatches {
                score = account.isDeleted ? 25 : 30
            } else {
                continue
            }

            if bestMatch == nil || score > bestMatch!.score {
                bestMatch = (index, score)
            }
        }

        return bestMatch?.index
    }

    private func applyImportedTotpEntry(
        _ entry: ParsedGoogleAuthenticatorEntry,
        siteAlias: String,
        to account: PasswordAccount,
        nowMs: Int64,
        targetFolderId: UUID?
    ) -> PasswordAccount {
        var updated = account
        var changed = false

        let mergedSites = Array(
            Set((updated.sites + [siteAlias]).map(DomainUtils.normalize).filter { !$0.isEmpty })
        ).sorted()
        if mergedSites != updated.sites {
            updated.sites = mergedSites
            changed = true
        }

        if let username = entry.username, !username.isEmpty, username != updated.username {
            updated.username = username
            updated.usernameUpdatedAtMs = nowMs
            changed = true
        }

        if !entry.secret.isEmpty, entry.secret != updated.totpSecret {
            updated.totpSecret = entry.secret
            updated.totpUpdatedAtMs = nowMs
            changed = true
        }

        if updated.isDeleted {
            updated.isDeleted = false
            updated.deletedAtMs = nil
            changed = true
        }

        if let targetFolderId {
            let nextFolderIds = normalizeFolderIds(updated.resolvedFolderIds + [targetFolderId])
            if nextFolderIds != updated.resolvedFolderIds {
                updated.setResolvedFolderIds(nextFolderIds)
                changed = true
            }
        }

        if changed {
            updated.touchUpdatedAt(nowMs, deviceName: currentDeviceName())
        }

        return updated
    }

    private func googleAuthenticatorImportSuffix(
        importedCount: Int,
        skippedCount: Int,
        unchangedCount: Int,
        batchSize: Int,
        batchIndex: Int
    ) -> String {
        var parts: [String] = ["解析 \(importedCount) 条"]
        if skippedCount > 0 {
            parts.append("跳过 \(skippedCount) 条")
        }
        if unchangedCount > 0 {
            parts.append("未变化 \(unchangedCount) 条")
        }
        if batchSize > 1 {
            parts.append("当前批次 \(batchIndex + 1)/\(batchSize)")
        }
        return "，" + parts.joined(separator: "，")
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
        PassSharedData.dataDirectoryURL()
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

    private func syncDeviceId() -> String {
        let defaults = UserDefaults.standard
        let existing = defaults.string(forKey: Keys.syncDeviceId)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        if !existing.isEmpty {
            return existing
        }
        let generated = UUID().uuidString.lowercased()
        defaults.set(generated, forKey: Keys.syncDeviceId)
        return generated
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
        do {
            try saveCollectionDataToLocalDatabase(data, for: LocalDatabaseKeys.folders)
        } catch {
            statusMessage = "保存文件夹到 SQLite 失败: \(error.localizedDescription)"
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
    let deviceId: String
    let logicalClockMs: Int64
    let formatVersion: Int

    private enum CodingKeys: String, CodingKey {
        case app
        case platform
        case deviceName
        case deviceId
        case logicalClockMs
        case formatVersion
    }

    init(
        app: String,
        platform: String,
        deviceName: String,
        deviceId: String,
        logicalClockMs: Int64,
        formatVersion: Int
    ) {
        self.app = app
        self.platform = platform
        self.deviceName = deviceName
        self.deviceId = deviceId
        self.logicalClockMs = logicalClockMs
        self.formatVersion = formatVersion
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        app = try container.decode(String.self, forKey: .app)
        platform = try container.decode(String.self, forKey: .platform)
        deviceName = try container.decode(String.self, forKey: .deviceName)
        deviceId = try container.decodeIfPresent(String.self, forKey: .deviceId) ?? "legacy-device"
        logicalClockMs = try container.decodeIfPresent(Int64.self, forKey: .logicalClockMs) ?? 0
        formatVersion = try container.decodeIfPresent(Int.self, forKey: .formatVersion) ?? 2
    }
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
    static let syncDeviceId = "pass.sync.deviceId.v1"
    static let syncEnableICloud = "pass.sync.enableICloud.v3"
    static let syncEnableWebDAV = "pass.sync.enableWebDAV.v3"
    static let syncEnableSelfHostedServer = "pass.sync.enableSelfHostedServer.v3"
    static let syncMode = "pass.sync.mode.v1"
    static let autoSyncIntervalMinutes = "pass.sync.autoIntervalMinutes.v1"
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
            pinnedViews: nil,
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
