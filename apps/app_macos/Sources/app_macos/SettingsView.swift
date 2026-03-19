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
    private let labelColumnWidth: CGFloat = 124
    private let idleMinuteChoices: [Int] = [1, 3, 5, 10, 15, 30, 60]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("设备名称")
                        .frame(width: labelColumnWidth, alignment: .leading)
                    TextField("例如 ChromeMac", text: $store.deviceName)
                        .textFieldStyle(.roundedBorder)
                    Button("保存") {
                        store.saveDeviceName()
                    }
                    .font(store.buttonFont())
                    .buttonStyle(.borderedProminent)
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

                GroupBox("数据同步") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(store.cloudSyncStatus)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        VStack(alignment: .leading, spacing: 6) {
                            Toggle("iCloud（仅 Apple）", isOn: $store.syncEnableICloud)
                                .toggleStyle(.switch)
                            Toggle("WebDAV", isOn: $store.syncEnableWebDAV)
                                .toggleStyle(.switch)
                            Toggle("自建服务器", isOn: $store.syncEnableSelfHostedServer)
                                .toggleStyle(.switch)
                        }

                        Text("可同时启用多个同步源；点击“同步已启用源”会依次拉取并回写所有已启用源。")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack(alignment: .top, spacing: 8) {
                            Text("同步操作")
                                .frame(width: labelColumnWidth, alignment: .leading)
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 8) {
                                    Button("合并已启用源") {
                                        store.syncNow(modeOverride: .merge)
                                    }
                                    .font(store.buttonFont())
                                    .buttonStyle(.bordered)

                                    Button("云端覆盖本地") {
                                        store.syncNow(modeOverride: .remoteOverwriteLocal)
                                    }
                                    .font(store.buttonFont())
                                    .buttonStyle(.bordered)

                                    Button("本地覆盖云端") {
                                        store.syncNow(modeOverride: .localOverwriteRemote)
                                    }
                                    .font(store.buttonFont())
                                    .buttonStyle(.bordered)
                                }
                            }
                        }

                        Text("合并：保留双方变更；云端覆盖本地：用所有已启用远端的汇总结果替换本机；本地覆盖云端：直接把本机数据推到所有已启用远端。")
                            .font(.caption)
                            .foregroundStyle(.secondary)

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
                                SecureField("可选（写入本机 Keychain）", text: $store.webdavPassword)
                                    .textFieldStyle(.roundedBorder)
                            }
                        }

                        if store.syncEnableSelfHostedServer {
                            HStack(spacing: 8) {
                                Text("服务地址")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                TextField(AccountStore.defaultSelfHostedServerBaseURL, text: $store.serverBaseURL)
                                    .textFieldStyle(.roundedBorder)
                            }
                            HStack(spacing: 8) {
                                Text("访问令牌")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                SecureField("可选（Bearer Token，写入本机 Keychain）", text: $store.serverAuthToken)
                                    .textFieldStyle(.roundedBorder)
                            }
                            Text("服务端接口固定为 /v1/sync/payload，使用 GET/PUT 交换 pass.sync.bundle.v2。")
                                .font(.caption)
                                .foregroundStyle(.secondary)
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
                    }
                    .padding(.top, 2)
                }

                Divider()

                GroupBox("应用解锁") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("状态：\(appLock.isUnlockEnabled ? "已启用" : "未启用")")
                            .font(.subheadline)

                        Toggle("优先通过指纹解锁", isOn: $appLock.preferBiometrics)
                            .toggleStyle(.switch)

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
                                SecureField("输入主密码后可关闭解锁", text: $disableUnlockPassword)
                                    .textFieldStyle(.roundedBorder)
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
                                SecureField("至少 4 位", text: $newMasterPassword)
                                    .textFieldStyle(.roundedBorder)
                            }

                            HStack(spacing: 8) {
                                Text("确认密码")
                                    .frame(width: labelColumnWidth, alignment: .leading)
                                SecureField("再次输入主密码", text: $confirmMasterPassword)
                                    .textFieldStyle(.roundedBorder)
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
            minWidth: 980,
            maxWidth: .infinity,
            minHeight: 520,
            maxHeight: .infinity,
            alignment: .topLeading
        )
        .background(WindowAccessor { window in
            configureWindowIfNeeded(window)
        })
    }

    private func configureWindowIfNeeded(_ window: NSWindow) {
        guard !didConfigureWindow else { return }
        didConfigureWindow = true

        window.styleMask.insert(.resizable)
        window.minSize = NSSize(width: 980, height: 520)

        var frame = window.frame
        let targetWidth = max(frame.width, 1100)
        let targetHeight = max(frame.height, 520)
        if frame.width != targetWidth || frame.height != targetHeight {
            frame.size = NSSize(width: targetWidth, height: targetHeight)
            window.setFrame(frame, display: true)
        }
    }

    private func exportCsvWithDirectoryRule() {
        if let directoryURL = store.configuredExportDirectoryURL() {
            store.saveExportDirectoryPath()
            let fileURL = directoryURL.appendingPathComponent(store.suggestedCsvFileName(), isDirectory: false)
            store.exportCsv(to: fileURL)
            return
        }

        if !store.exportDirectoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            store.statusMessage = "导出目录不存在，改为手动选择目录"
        }

        let panel = NSOpenPanel()
        panel.title = "选择导出目录"
        panel.message = "请选择全部账号 CSV 导出目录"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "选择"

        guard panel.runModal() == .OK, let selectedDirectory = panel.url else {
            if store.statusMessage.isEmpty {
                store.statusMessage = "已取消导出"
            }
            return
        }

        store.exportDirectoryPath = selectedDirectory.path
        store.saveExportDirectoryPath()
        let fileURL = selectedDirectory.appendingPathComponent(store.suggestedCsvFileName(), isDirectory: false)
        store.exportCsv(to: fileURL)
    }

    private func exportSyncBundleWithPanel() {
        let panel = NSSavePanel()
        panel.title = "导出同步包"
        panel.message = "请选择同步包保存位置"
        panel.nameFieldStringValue = store.suggestedSyncBundleFileName()
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true
        panel.prompt = "导出"

        guard panel.runModal() == .OK, let url = panel.url else {
            store.statusMessage = "已取消同步包导出"
            return
        }

        store.exportSyncBundle(to: url)
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

        store.importGoogleAuthenticatorExportQRCodes(from: panel.urls)
    }

    private func exportBrowserPasswordCsvWithPanel(format: BrowserPasswordExportFormat) {
        let panel = NSSavePanel()
        panel.title = "导出\(format.label)密码 CSV"
        panel.message = "请选择 \(format.label) 可导入密码 CSV 的保存位置"
        panel.nameFieldStringValue = store.suggestedBrowserCsvFileName(browser: format)
        panel.allowedContentTypes = [.commaSeparatedText, .plainText]
        panel.canCreateDirectories = true
        panel.prompt = "导出"

        guard panel.runModal() == .OK, let url = panel.url else {
            store.statusMessage = "已取消\(format.label)密码 CSV 导出"
            return
        }

        store.exportBrowserPasswordCsv(to: url, format: format)
    }
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
