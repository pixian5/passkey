import Foundation

@MainActor
final class AccountStore: ObservableObject {
    @Published var deviceName: String = ""
    @Published var statusMessage: String = ""
    @Published var createSite: String = ""
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
    @Published private(set) var cloudSyncStatus: String = "iCloud 未连接，使用本机数据"
    @Published private(set) var accounts: [PasswordAccount] = []

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
    private var cloudObserver: NSObjectProtocol?
    private var suppressCloudPush: Bool = false

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
        let site = DomainUtils.normalize(createSite)
        let username = createUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = createPassword
        let totpSecret = createTotpSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        let recoveryCodes = createRecoveryCodes
        let note = createNote

        guard !site.isEmpty else {
            statusMessage = "站点不能为空"
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

        var created = AccountFactory.create(
            site: site,
            username: username,
            password: password,
            deviceName: currentDeviceName()
        )
        created.totpSecret = totpSecret
        created.recoveryCodes = recoveryCodes
        created.note = note
        accounts.append(created)
        syncAliasGroups()
        saveAccounts()

        createSite = ""
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
        "pass-export-\(timestampForFile()).csv"
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
            statusMessage = "CSV 导出成功: \(fileURL.path)"
        } catch {
            statusMessage = "CSV 导出失败: \(error.localizedDescription)"
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
        statusMessage = "已进入编辑模式"
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

    func activeAccounts() -> [PasswordAccount] {
        accounts.filter { !$0.isDeleted }
    }

    func filteredAccounts() -> [PasswordAccount] {
        showDeletedAccounts ? accounts.filter(\.isDeleted) : accounts.filter { !$0.isDeleted }
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
        deviceName = UserDefaults.standard.string(forKey: Keys.deviceName) ?? ""
        exportDirectoryPath = UserDefaults.standard.string(forKey: Keys.exportDirectoryPath) ?? ""

        let fileURL = dataFileURL()
        guard let data = try? Data(contentsOf: fileURL) else {
            accounts = []
            return
        }

        if let decoded = try? decoder.decode([PasswordAccount].self, from: data) {
            accounts = decoded
            return
        }

        if let legacy = try? decoder.decode([LegacyPasswordAccount].self, from: data) {
            accounts = legacy.map { $0.toCurrent(deviceName: currentDeviceName()) }
            saveAccounts()
            return
        }

        accounts = []
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
            remoteAccounts = decoded
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
}

private enum Keys {
    static let deviceName = "pass.deviceName"
    static let exportDirectoryPath = "pass.export.directoryPath"
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
