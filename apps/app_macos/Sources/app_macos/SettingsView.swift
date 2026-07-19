import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @ObservedObject var store: AccountStore
    @ObservedObject var appLock: AppLockStore
    @State private var newMasterPassword: String = ""
    @State private var confirmMasterPassword: String = ""
    @State private var disableUnlockPassword: String = ""
    @State private var didConfigureWindow: Bool = false
    @State private var isServerProvisioningPresented: Bool = false
    private let labelColumnWidth: CGFloat = 170
    private let idleMinuteChoices: [Int] = [1, 3, 5, 10, 15, 30, 60]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("设备名称")
                        .frame(width: labelColumnWidth, alignment: .leading)
                    TextField("例如 PassDevice", text: $store.deviceName)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: store.deviceName) { _ in
                            store.saveDeviceName(showStatus: false)
                        }
                }

                Text("说明：设备名称会写入账号最后操作设备字段。")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                GroupBox("界面字体") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Text("字体")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            Picker("字体", selection: $store.uiFontFamily) {
                                ForEach(store.uiFontFamilyOptions, id: \.self) { family in
                                    Text(family).tag(family)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                        }

                        HStack(spacing: 8) {
                            Text("文本字号")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            Slider(value: $store.uiTextFontSize, in: 12 ... 40, step: 1)
                            Text("\(Int(store.uiTextFontSize))")
                                .frame(width: 40, alignment: .trailing)
                                .monospacedDigit()
                        }

                        HStack(spacing: 8) {
                            Text("按钮字号")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            Slider(value: $store.uiButtonFontSize, in: 12 ... 52, step: 1)
                            Text("\(Int(store.uiButtonFontSize))")
                                .frame(width: 40, alignment: .trailing)
                                .monospacedDigit()
                        }

                        HStack(spacing: 8) {
                            Text("提示时长")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            Slider(value: $store.uiToastDurationSeconds, in: 1 ... 10, step: 0.5)
                            Text("\(store.uiToastDurationSeconds, specifier: "%.1f")s")
                                .frame(width: 58, alignment: .trailing)
                                .monospacedDigit()
                        }
                    }
                    .padding(.top, 2)
                }

                GroupBox("密码显示") {
                    Toggle("全局显示密码、令牌和密钥", isOn: $store.showPasswordsGlobally)
                        .toggleStyle(.checkbox)
                    Text("关闭后所有密码框默认隐藏；每个字段旁的眼睛按钮仍可临时切换该字段。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                GroupBox("数据同步") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 16) {
                            leadingToggle("iCloud（仅 Apple）", isOn: $store.syncEnableICloud)
                            leadingToggle("WebDAV", isOn: $store.syncEnableWebDAV)
                            leadingToggle("自建服务器", isOn: $store.syncEnableSelfHostedServer)
                        }

                        Text("主同步源用于“云端覆盖本地”和主源写入顺序；合并仍按时间戳与设备名规则裁决，其他源作为镜像备份。")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 8) {
                            Text("主同步源")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            Picker("主同步源", selection: $store.syncPrimarySource) {
                                ForEach(AccountStore.SyncPrimarySource.allCases) { source in
                                    Text(source.label).tag(source)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                        }

                        Text(store.cloudSyncStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        if !store.storageIntegrityStatus.isEmpty {
                            Text(store.storageIntegrityStatus)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .textSelection(.enabled)
                        }

                        Text(syncDiagnosticsText)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)

                        if !store.syncOutboxStatus.isEmpty {
                            Text(store.syncOutboxStatus)
                                .font(.caption)
                                .foregroundStyle(.orange)
                                .textSelection(.enabled)
                            HStack(spacing: 8) {
                                Button("立即重试补偿任务") {
                                    store.retrySyncOutboxNow()
                                }
                                Button("清理失效目标任务") {
                                    store.clearInactiveSyncOutboxItems()
                                }
                            }
                        }

                        if store.syncEnableSelfHostedServer {
                            HStack(spacing: 8) {
                                Text("服务地址")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                TextField(AccountStore.defaultSelfHostedServerBaseURL, text: $store.serverBaseURL)
                                    .textFieldStyle(.roundedBorder)
                                Button {
                                    store.loadSyncSecretsForUI()
                                    isServerProvisioningPresented = true
                                } label: {
                                    Label("接入服务器", systemImage: "server.rack")
                                }
                                .buttonStyle(.borderedProminent)
                            }
                            HStack(spacing: 8) {
                                Text("访问令牌")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                PasswordField(text: $store.serverAuthToken, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "部署服务器时配置的 Bearer Token")
                                    .onTapGesture { store.loadSyncSecretsForUI() }
                            }
                            Text("服务端主接口为 /v2/sync/state，使用 GET/PUT 交换 pass.sync.bundle.v2；/v1 仅兼容旧客户端。")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        if store.syncEnableWebDAV {
                            HStack(spacing: 8) {
                                Text("WebDAV 地址")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                TextField("https://dav.example.com/remote.php/dav/files/<user>/", text: $store.webdavBaseURL)
                                    .textFieldStyle(.roundedBorder)
                            }
                            HStack(spacing: 8) {
                                Text("远端路径")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                TextField("pass-sync-bundle-v2.json", text: $store.webdavRemotePath)
                                    .textFieldStyle(.roundedBorder)
                            }
                            HStack(spacing: 8) {
                                Text("用户名")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                TextField("可选", text: $store.webdavUsername)
                                    .textFieldStyle(.roundedBorder)
                            }
                            HStack(spacing: 8) {
                                Text("密码")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                PasswordField(text: $store.webdavPassword, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "可选（仅保存于本机）")
                                    .onTapGesture { store.loadSyncSecretsForUI() }
                            }
                        }

                        HStack(spacing: 8) {
                            Text("同步加密密钥")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            PasswordField(text: $store.syncEncryptionKey, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "留空则明文同步")
                                .onTapGesture { store.loadSyncSecretsForUI() }
                            Button("生成") {
                                store.generateSyncEncryptionKey()
                            }
                            .buttonStyle(.bordered)
                            Button("复制") {
                                store.copySyncEncryptionKey()
                            }
                            .buttonStyle(.bordered)
                        }

                        Text("同步加密密钥可选。填写 256 位密钥并在所有设备使用同一值时，使用 AES-256-GCM 端到端加密；留空则手动/自动同步与导出均使用明文同步包。明文可能包含密码，请仅在可信网络和已允许明文的同步服务器上使用。")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Text(store.syncEncryptionKeyIdentifier.isEmpty
                            ? "当前未配置同步密钥，将使用明文同步包。"
                            : "当前同步密钥 ID：\(store.syncEncryptionKeyIdentifier)。配对、轮换或排查密钥不匹配时请核对此标识。")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 8) {
                            Text("轮换前密钥")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            PasswordField(text: $store.previousSyncEncryptionKey, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "可选：仅用于读取旧加密数据")
                                .onTapGesture { store.loadSyncSecretsForUI() }
                        }
                        Text(store.previousSyncEncryptionKeyIdentifier.isEmpty
                            ? "轮换前密钥未配置。"
                            : "轮换前密钥 ID：\(store.previousSyncEncryptionKeyIdentifier)。一次成功同步后，确认所有设备已更新再清空。")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack(spacing: 8) {
                            Text("自动同步")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            Picker("自动同步", selection: $store.autoSyncIntervalMinutes) {
                                ForEach(store.autoSyncIntervalOptions) { option in
                                    Text(option.label).tag(option.rawValue)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                        }

                        Text(store.autoSyncStatusDescription)
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack(alignment: .top, spacing: 8) {
                            Text("同步操作")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 8) {
                                    Button("预览合并") {
                                        Task { await store.previewSync() }
                                    }
                                    .font(store.buttonFont())
                                    .buttonStyle(.bordered)

                                    Button("合并已启用源") {
                                        store.syncNow(modeOverride: .merge)
                                    }
                                    .font(store.buttonFont())
                                    .buttonStyle(.bordered)

                                    Button("云端覆盖本地") {
                                        confirmRemoteOverwriteLocal()
                                    }
                                    .font(store.buttonFont())
                                    .buttonStyle(.bordered)

                                    Button("本地覆盖云端") {
                                        confirmLocalOverwriteRemote()
                                    }
                                    .font(store.buttonFont())
                                    .buttonStyle(.bordered)
                                }
                                Text(store.syncPreviewStatus)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Text("合并：保留双方变更；云端覆盖本地：用所有已启用远端的汇总结果替换本机；本地覆盖云端：直接把本机数据推到所有已启用远端。")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack(alignment: .top, spacing: 8) {
                            Text("服务器快照")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 8) {
                                    Button("读取快照") {
                                        Task { await store.loadSyncVersions() }
                                    }
                                    .font(store.buttonFont())
                                    .buttonStyle(.bordered)
                                    Text(store.syncVersionsStatus)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                if !store.syncVersionSummaries.isEmpty {
                                    ForEach(store.syncVersionSummaries) { version in
                                        HStack(spacing: 8) {
                                            Text("版本 \(version.id) · 导出 \(store.displayTime(version.exportedAtMs)) · 保存 \(store.displayTime(version.savedAtMs)) · \(version.payloadSha256.prefix(12))")
                                                .font(.caption)
                                                .lineLimit(1)
                                            Spacer(minLength: 8)
                                            Button("恢复") {
                                                let alert = NSAlert()
                                                alert.messageText = "恢复服务器快照？"
                                                alert.informativeText = "恢复前会自动保存本机安全快照，恢复后本机数据将替换为版本 \(version.id)。"
                                                alert.alertStyle = .warning
                                                alert.addButton(withTitle: "恢复")
                                                alert.addButton(withTitle: "取消")
                                                if alert.runModal() == .alertFirstButtonReturn {
                                                    Task { await store.restoreSyncVersion(version) }
                                                }
                                            }
                                            .font(store.buttonFont())
                                            .buttonStyle(.bordered)
                                        }
                                    }
                                }
                            }
                        }

                        HStack(spacing: 8) {
                            Button("导出同步包") {
                                exportSyncBundleWithPanel()
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)

                            Button("导入并合并同步包") {
                                importSyncBundleWithPanel()
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(.top, 2)
                }

                GroupBox("数据导出") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 8) {
                            Text("导出账号目录")
                                .frame(width: labelColumnWidth, alignment: .leading)
                                .fixedSize(horizontal: true, vertical: false)
                            TextField("为空时点击导出后选择目录", text: $store.exportDirectoryPath)
                                .textFieldStyle(.roundedBorder)
                                .onChange(of: store.exportDirectoryPath) { _ in
                                    store.saveExportDirectoryPath()
                                }
                            Button("导出全部账号 CSV") {
                                exportCsvWithDirectoryRule()
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)
                        }

                        HStack(spacing: 8) {
                            Text("浏览器导入")
                                .frame(width: labelColumnWidth, alignment: .leading)
                                .fixedSize(horizontal: true, vertical: false)
                            Button("导入 Chrome/Firefox/Safari 密码 CSV") {
                                importBrowserPasswordCsvWithPanel()
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)
                        }

                        HStack(spacing: 8) {
                            Text("验证器导入")
                                .frame(width: labelColumnWidth, alignment: .leading)
                                .fixedSize(horizontal: true, vertical: false)
                            Button("导入谷歌验证器导出二维码（剪贴板）") {
                                store.importGoogleAuthenticatorExportQRCodeFromClipboard()
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)

                            Button("多选二维码图片导入") {
                                importGoogleAuthenticatorQRCodesWithPanel()
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)
                        }

                        HStack(spacing: 8) {
                            Text("浏览器导出")
                                .frame(width: labelColumnWidth, alignment: .leading)
                                .fixedSize(horizontal: true, vertical: false)
                            Button("导出 Chrome 密码 CSV") {
                                exportBrowserPasswordCsvWithPanel(format: .chrome)
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)

                            Button("导出 Firefox 密码 CSV") {
                                exportBrowserPasswordCsvWithPanel(format: .firefox)
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)

                            Button("导出 Safari 密码 CSV") {
                                exportBrowserPasswordCsvWithPanel(format: .safari)
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)
                        }

                        HStack(spacing: 8) {
                            Text("Apple迁移")
                                .frame(width: labelColumnWidth, alignment: .leading)
                                .fixedSize(horizontal: true, vertical: false)
                            Button("导出到 Credential Exchange") {
                                store.exportToAppleCredentialExchange()
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.bordered)
                        }
                    }
                    .padding(.top, 2)
                }

                Divider()

                GroupBox("应用解锁") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("状态：\(appLock.isUnlockEnabled ? "已启用" : "未启用")")
                            .font(.subheadline)

                        Toggle("优先通过指纹解锁", isOn: $appLock.preferBiometrics)
                            .toggleStyle(.checkbox)

                        Picker("锁定策略", selection: $appLock.lockPolicy) {
                            ForEach(AppLockPolicy.allCases) { policy in
                                Text(policy.title).tag(policy)
                            }
                        }
                        .pickerStyle(.segmented)

                        if appLock.lockPolicy == .idleTimeout {
                            HStack(spacing: 8) {
                                Text("无操作锁定时间")
                                    .frame(width: 100, alignment: .leading)
                                Picker("无操作锁定时间", selection: $appLock.idleLockMinutes) {
                                    ForEach(idleMinuteChoices, id: \.self) { minute in
                                        Text("\(minute) 分钟").tag(minute)
                                    }
                                }
                                .labelsHidden()
                                .frame(width: 140)
                            }
                        }

                        if appLock.isUnlockEnabled {
                            HStack(spacing: 8) {
                                PasswordField(text: $disableUnlockPassword, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "输入主密码后可关闭解锁")
                                Button("关闭解锁") {
                                    appLock.disableUnlock(currentPassword: disableUnlockPassword)
                                    if !appLock.isUnlockEnabled {
                                        disableUnlockPassword = ""
                                    }
                                }
                                .font(store.buttonFont())
                                .buttonStyle(.bordered)
                            }
                        } else {
                            HStack(spacing: 8) {
                                Text("主密码")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                PasswordField(text: $newMasterPassword, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "至少 4 位")
                            }

                            HStack(spacing: 8) {
                                Text("确认密码")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                PasswordField(text: $confirmMasterPassword, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "再次输入主密码")
                            }

                            Button("设置主密码并启用") {
                                appLock.enableUnlock(
                                    newPassword: newMasterPassword,
                                    confirmPassword: confirmMasterPassword
                                )
                                if appLock.isUnlockEnabled {
                                    newMasterPassword = ""
                                    confirmMasterPassword = ""
                                }
                            }
                            .font(store.buttonFont())
                            .buttonStyle(.borderedProminent)
                        }

                        if !appLock.settingsMessage.isEmpty {
                            Text(appLock.settingsMessage)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(
            minWidth: 760,
            maxWidth: .infinity,
            minHeight: 520,
            maxHeight: .infinity,
            alignment: .topLeading
        )
        .background(WindowAccessor { window in
            configureWindowIfNeeded(window)
        })
        .sheet(isPresented: $isServerProvisioningPresented) {
            ServerProvisioningSheet(store: store)
        }
    }

    private var syncDiagnosticsText: String {
        let d = store.syncDiagnostics
        let revision = d.revision.map { String($0) } ?? "-"
        let etag = d.etag ?? "-"
        let conflict = d.conflictCount
        return "诊断：本地账号 \(d.localAccounts)、远端账号 \(d.remoteAccounts)；本地通行密钥 \(d.localPasskeys)、远端通行密钥 \(d.remotePasskeys)；本地文件夹 \(d.localFolders)、远端文件夹 \(d.remoteFolders)；冲突 \(conflict)；修订 \(revision)；ETag \(etag.prefix(16))；来源 \(d.sourceSummary)"
    }

    private func configureWindowIfNeeded(_ window: NSWindow) {
        guard !didConfigureWindow else { return }
        didConfigureWindow = true

        window.styleMask.insert(.resizable)
        window.minSize = NSSize(width: 760, height: 520)

        var frame = window.frame
        let targetWidth = max(frame.width, 760)
        let targetHeight = max(frame.height, 520)
        if frame.width != targetWidth || frame.height != targetHeight {
            frame.size = NSSize(width: targetWidth, height: targetHeight)
            window.setFrame(frame, display: true)
        }
    }

    private func confirmRemoteOverwriteLocal() {
        Task { @MainActor in
            let preflight = await store.remoteOverwritePreflight()
            guard !preflight.needsWarning || presentRemoteOverwriteWarning(preflight) else {
                return
            }
            store.syncNow(modeOverride: .remoteOverwriteLocal)
        }
    }

    private func presentRemoteOverwriteWarning(_ preflight: AccountStore.RemoteOverwritePreflightResult) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "云端覆盖本地前发现风险"

        var messages: [String] = []
        if !preflight.unreachableSources.isEmpty {
            messages.append("以下远端当前不可达：\(preflight.unreachableSources.joined(separator: "；"))。继续执行后，本次操作很可能直接失败。")
        }
        if !preflight.emptySources.isEmpty {
            messages.append("以下远端当前为空：\(preflight.emptySources.joined(separator: "、"))。如果所有可用远端都为空，继续执行可能把本地数据覆盖成空。")
        }
        messages.append("确定仍要继续执行“云端覆盖本地”吗？")
        alert.informativeText = messages.joined(separator: "\n\n")
        alert.addButton(withTitle: "继续")
        alert.addButton(withTitle: "取消")
        return alert.runModal() == .alertFirstButtonReturn
    }

    private func confirmLocalOverwriteRemote() {
        if store.isCurrentLocalPayloadEmpty() {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "本地数据当前为空"
            alert.informativeText = "继续执行“本地覆盖云端”会把所有已启用远端同步源覆盖成空数据。确定继续吗？"
            alert.addButton(withTitle: "继续")
            alert.addButton(withTitle: "取消")
            guard alert.runModal() == .alertFirstButtonReturn else {
                return
            }
        }
        store.syncNow(modeOverride: .localOverwriteRemote)
    }

    @ViewBuilder
    private func leadingToggle(_ title: String, isOn: Binding<Bool>) -> some View {
        Toggle(title, isOn: isOn)
            .toggleStyle(.checkbox)
    }

    private func exportCsvWithDirectoryRule() {
        if let directoryURL = store.configuredExportDirectoryURL() {
            store.saveExportDirectoryPath(clearBookmark: false)
            let fileURL = directoryURL.appendingPathComponent(store.suggestedCsvFileName(), isDirectory: false)
            if store.exportCsv(to: fileURL, securityScopedDirectoryURL: directoryURL) {
                return
            }
            store.statusMessage = "预设导出目录不可写，请重新选择目录"
        }

        if !store.exportDirectoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            store.statusMessage = "已保存目录尚未获得系统授权，改为手动选择目录"
        }

        let panel = NSOpenPanel()
        panel.title = "选择导出目录"
        panel.message = "请选择全部账号 CSV 导出目录"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "选择"

        beginExportPanel(panel) { response in
            guard response == .OK else {
                store.statusMessage = "已取消导出"
                return
            }
            guard let selectedDirectory = panel.url else {
                store.statusMessage = "导出失败：选择目录后未返回有效路径"
                return
            }

            store.exportDirectoryPath = selectedDirectory.path
            store.saveExportDirectoryPath(clearBookmark: false)
            store.saveExportDirectoryBookmark(for: selectedDirectory)
            let fileURL = selectedDirectory.appendingPathComponent(store.suggestedCsvFileName(), isDirectory: false)
            store.exportCsv(to: fileURL, securityScopedDirectoryURL: selectedDirectory)
        }
    }

    private func exportSyncBundleWithPanel() {
        let panel = NSSavePanel()
        panel.title = "导出同步包"
        panel.message = "请选择同步包保存位置"
        panel.nameFieldStringValue = store.suggestedSyncBundleFileName()
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true
        panel.prompt = "导出"

        beginExportPanel(panel) { response in
            guard response == .OK else {
                store.statusMessage = "已取消同步包导出"
                return
            }
            guard let url = panel.url else {
                store.statusMessage = "同步包导出失败：确认保存位置后未返回有效路径"
                return
            }

            store.exportSyncBundle(to: url)
        }
    }

    private func importSyncBundleWithPanel() {
        let panel = NSOpenPanel()
        panel.title = "导入同步包"
        panel.message = "请选择 JSON 同步包文件，导入后会和当前数据做合并"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.json]
        panel.prompt = "导入并合并"

        guard panel.runModal() == .OK, let url = panel.url else {
            store.statusMessage = "已取消同步包导入"
            return
        }

        store.importSyncBundle(from: url)
    }

    private func importBrowserPasswordCsvWithPanel() {
        let panel = NSOpenPanel()
        panel.title = "导入浏览器密码 CSV"
        panel.message = "请选择 Chrome、Firefox 或 Safari 可导入的密码 CSV，导入后会和当前账号按站点与用户名做合并"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.commaSeparatedText, .plainText]
        panel.prompt = "导入"

        guard panel.runModal() == .OK, let url = panel.url else {
            store.statusMessage = "已取消浏览器密码 CSV 导入"
            return
        }

        store.importBrowserPasswordCsv(from: url)
    }

    private func importGoogleAuthenticatorQRCodesWithPanel() {
        let panel = NSOpenPanel()
        panel.title = "导入谷歌验证器导出二维码"
        panel.message = "请选择一张或多张谷歌验证器导出二维码图片，程序会按所有选中的批次合并导入"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.png, .jpeg, .gif, .bmp, .tiff, .webP]
        panel.prompt = "导入"

        guard panel.runModal() == .OK else {
            store.statusMessage = "已取消谷歌验证器二维码导入"
            return
        }

        guard let folderSelection = promptAuthenticatorImportFolderSelection(imageCount: panel.urls.count) else {
            store.statusMessage = "已取消谷歌验证器二维码导入"
            return
        }

        store.importGoogleAuthenticatorExportQRCodes(
            from: panel.urls,
            targetFolderId: folderSelection.targetFolderId,
            newFolderName: folderSelection.newFolderName
        )
    }

    private func promptAuthenticatorImportFolderSelection(imageCount: Int) -> AuthenticatorImportFolderSelection? {
        let alert = NSAlert()
        alert.messageText = "选择导入位置"
        alert.informativeText = "已选择 \(imageCount) 张二维码图片。你可以不放入文件夹、导入到现有文件夹，或填写新文件夹名后自动创建。"
        alert.alertStyle = .informational
        alert.addButton(withTitle: "导入")
        alert.addButton(withTitle: "取消")

        let popupButton = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 320, height: 26), pullsDown: false)
        popupButton.addItem(withTitle: "不放入文件夹")
        popupButton.lastItem?.representedObject = ""
        if !store.activeFolders.isEmpty {
            popupButton.menu?.addItem(.separator())
            for folder in store.activeFolders {
                let item = NSMenuItem(title: folder.name, action: nil, keyEquivalent: "")
                item.representedObject = folder.id.uuidString.lowercased()
                popupButton.menu?.addItem(item)
            }
        }
        popupButton.selectItem(at: 0)

        let newFolderField = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        newFolderField.placeholderString = "新文件夹名（可选，填写后自动创建并导入）"

        let folderLabel = NSTextField(labelWithString: "导入文件夹")
        let newFolderLabel = NSTextField(labelWithString: "新文件夹名")
        folderLabel.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        newFolderLabel.font = .systemFont(ofSize: NSFont.smallSystemFontSize)

        let accessoryStack = NSStackView(views: [folderLabel, popupButton, newFolderLabel, newFolderField])
        accessoryStack.orientation = .vertical
        accessoryStack.alignment = .leading
        accessoryStack.spacing = 8
        accessoryStack.translatesAutoresizingMaskIntoConstraints = false

        let accessoryContainer = NSView(frame: NSRect(x: 0, y: 0, width: 340, height: 104))
        accessoryContainer.addSubview(accessoryStack)
        NSLayoutConstraint.activate([
            accessoryStack.leadingAnchor.constraint(equalTo: accessoryContainer.leadingAnchor),
            accessoryStack.trailingAnchor.constraint(equalTo: accessoryContainer.trailingAnchor),
            accessoryStack.topAnchor.constraint(equalTo: accessoryContainer.topAnchor),
            accessoryStack.bottomAnchor.constraint(equalTo: accessoryContainer.bottomAnchor)
        ])
        alert.accessoryView = accessoryContainer

        guard alert.runModal() == .alertFirstButtonReturn else {
            return nil
        }

        let newFolderName = newFolderField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let selectedFolderId = (popupButton.selectedItem?.representedObject as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        return AuthenticatorImportFolderSelection(
            targetFolderId: selectedFolderId.flatMap(UUID.init(uuidString:)),
            newFolderName: newFolderName
        )
    }

    private func exportBrowserPasswordCsvWithPanel(format: BrowserPasswordExportFormat) {
        let panel = NSSavePanel()
        panel.title = "导出\(format.label)密码 CSV"
        panel.message = "请选择 \(format.label) 可导入密码 CSV 的保存位置"
        panel.nameFieldStringValue = store.suggestedBrowserCsvFileName(browser: format)
        panel.allowedContentTypes = [.commaSeparatedText, .plainText]
        panel.canCreateDirectories = true
        panel.prompt = "导出"

        beginExportPanel(panel) { response in
            guard response == .OK else {
                store.statusMessage = "已取消\(format.label)密码 CSV 导出"
                return
            }
            guard let url = panel.url else {
                store.statusMessage = "\(format.label) 密码 CSV 导出失败：确认保存位置后未返回有效路径"
                return
            }

            store.exportBrowserPasswordCsv(to: url, format: format)
        }
    }

    private func beginExportPanel(
        _ panel: NSSavePanel,
        completion: @escaping (NSApplication.ModalResponse) -> Void
    ) {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            panel.beginSheetModal(for: window, completionHandler: completion)
        } else {
            panel.begin(completionHandler: completion)
        }
    }
}

private struct ServerProvisioningSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: AccountStore
    @State private var serverURL: String
    @State private var username: String
    @State private var sshPort: String
    @State private var authMode: ServerSSHAuthMode
    @State private var secret: String
    @State private var privateKeyPassphrase: String
    @State private var accessToken: String
    @State private var syncEncryptionKey: String
    @State private var isWorking = false
    @State private var errorMessage = ""

    init(store: AccountStore) {
        self.store = store
        let credential = store.savedServerSSHCredential(for: store.serverBaseURL)
        _serverURL = State(initialValue: store.serverBaseURL)
        _username = State(initialValue: credential.username)
        _sshPort = State(initialValue: String(credential.port))
        _authMode = State(initialValue: credential.authMode)
        _secret = State(initialValue: credential.secret)
        _privateKeyPassphrase = State(initialValue: credential.privateKeyPassphrase)
        _accessToken = State(initialValue: store.serverAuthToken)
        _syncEncryptionKey = State(initialValue: store.syncEncryptionKey)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("接入自建同步服务器")
                .font(.title3.weight(.semibold))

            Text("应用会通过 SSH 安装或更新同步服务。默认使用 root；非 root 用户必须具备免密码 sudo 权限。服务器 URL 仅用于提取主机并验证最终服务，SSH 端口单独填写。")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                Text("服务器地址")
                    .frame(width: 120, alignment: .leading)
                TextField("https://example.com:5443", text: $serverURL)
                    .textFieldStyle(.roundedBorder)
                Button("读取已保存") {
                    loadSavedCredential()
                }
                .buttonStyle(.bordered)
            }

            HStack(spacing: 8) {
                Text("SSH 用户名")
                    .frame(width: 120, alignment: .leading)
                TextField("root", text: $username)
                    .textFieldStyle(.roundedBorder)
                Text("SSH 端口")
                TextField("22", text: $sshPort)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 72)
            }

            Picker("认证方式", selection: $authMode) {
                ForEach(ServerSSHAuthMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            if authMode == .password {
                HStack(spacing: 8) {
                    Text("SSH 密码")
                        .frame(width: 120, alignment: .leading)
                    PasswordField(text: $secret, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "输入服务器登录密码")
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("SSH 私钥")
                    TextEditor(text: $secret)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 128, maxHeight: 190)
                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(.quaternary))
                    PasswordField(text: $privateKeyPassphrase, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "私钥口令（可选）")
                }
            }

            HStack(spacing: 8) {
                Text("访问令牌")
                    .frame(width: 120, alignment: .leading)
                PasswordField(text: $accessToken, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "用于服务端 Bearer Token")
            }

            HStack(spacing: 8) {
                Text("同步加密密钥")
                    .frame(width: 120, alignment: .leading)
                PasswordField(text: $syncEncryptionKey, showPasswordsGlobally: $store.showPasswordsGlobally, placeholder: "留空则允许明文同步")
            }

            Text("接入时会先备份服务器现有同步数据库。同步加密密钥不会发送给服务器，只用于决定是否强制加密同步包。")
                .font(.caption)
                .foregroundStyle(.secondary)

            if !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }

            HStack {
                Spacer()
                Button("取消") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button {
                    provision()
                } label: {
                    if isWorking {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Label("连接并接入", systemImage: "link")
                    }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(isWorking)
            }
        }
        .padding(20)
        .frame(width: 620)
        .onAppear {
            store.loadSyncSecretsForUI()
            if accessToken.isEmpty { accessToken = store.serverAuthToken }
            if syncEncryptionKey.isEmpty { syncEncryptionKey = store.syncEncryptionKey }
        }
    }

    private func loadSavedCredential() {
        let credential = store.savedServerSSHCredential(for: serverURL)
        username = credential.username
        sshPort = String(credential.port)
        authMode = credential.authMode
        secret = credential.secret
        privateKeyPassphrase = credential.privateKeyPassphrase
    }

    private func provision() {
        errorMessage = ""
        guard let port = Int(sshPort.trimmingCharacters(in: .whitespacesAndNewlines)),
              (1 ... 65535).contains(port)
        else {
            errorMessage = "SSH 端口必须是 1 到 65535 之间的数字"
            return
        }
        let credential = ServerSSHCredential(
            username: username.trimmingCharacters(in: .whitespacesAndNewlines),
            port: port,
            authMode: authMode,
            secret: secret,
            privateKeyPassphrase: privateKeyPassphrase
        )
        isWorking = true
        Task { @MainActor in
            do {
                try await store.provisionSelfHostedServer(
                    serverURL: serverURL,
                    credential: credential,
                    accessToken: accessToken,
                    syncEncryptionKey: syncEncryptionKey
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            isWorking = false
        }
    }
}

private struct AuthenticatorImportFolderSelection {
    let targetFolderId: UUID?
    let newFolderName: String
}

private struct WindowAccessor: NSViewRepresentable {
    let onResolve: (NSWindow) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async {
            if let window = view.window {
                onResolve(window)
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            if let window = nsView.window {
                onResolve(window)
            }
        }
    }
}
