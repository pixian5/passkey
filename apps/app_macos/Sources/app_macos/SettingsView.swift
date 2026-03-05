import AppKit
import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: AccountStore
    @ObservedObject var appLock: AppLockStore
    @State private var newMasterPassword: String = ""
    @State private var confirmMasterPassword: String = ""
    @State private var disableUnlockPassword: String = ""
    @State private var didConfigureWindow: Bool = false
    private let idleMinuteChoices: [Int] = [1, 3, 5, 10, 15, 30, 60]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("设备名称")
                    .frame(width: 80, alignment: .leading)
                TextField("例如 ChromeMac", text: $store.deviceName)
                    .textFieldStyle(.roundedBorder)
                Button("保存") {
                    store.saveDeviceName()
                }
                .buttonStyle(.borderedProminent)
            }

            Text("说明：设备名称会写入账号最后操作设备字段。")
                .font(.caption)
                .foregroundStyle(.secondary)

            GroupBox("界面字体") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text("字体")
                            .frame(width: 80, alignment: .leading)
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
                            .frame(width: 80, alignment: .leading)
                        Slider(value: $store.uiTextFontSize, in: 12 ... 40, step: 1)
                        Text("\(Int(store.uiTextFontSize))")
                            .frame(width: 40, alignment: .trailing)
                            .monospacedDigit()
                    }

                    HStack(spacing: 8) {
                        Text("按钮字号")
                            .frame(width: 80, alignment: .leading)
                        Slider(value: $store.uiButtonFontSize, in: 12 ... 52, step: 1)
                        Text("\(Int(store.uiButtonFontSize))")
                            .frame(width: 40, alignment: .trailing)
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

                    Button("立即同步 iCloud") {
                        store.syncWithICloudNow()
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.top, 2)
            }

            GroupBox("数据导出") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text("导出账号目录")
                            .frame(width: 80, alignment: .leading)
                        TextField("为空时点击导出后选择目录", text: $store.exportDirectoryPath)
                            .textFieldStyle(.roundedBorder)
                            .onChange(of: store.exportDirectoryPath) { _ in
                                store.saveExportDirectoryPath()
                            }
                        Button("导出全部账号 CSV") {
                            exportCsvWithDirectoryRule()
                        }
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
                            .buttonStyle(.bordered)
                        }
                    } else {
                        HStack(spacing: 8) {
                            Text("主密码")
                                .frame(width: 80, alignment: .leading)
                            SecureField("至少 4 位", text: $newMasterPassword)
                                .textFieldStyle(.roundedBorder)
                        }

                        HStack(spacing: 8) {
                            Text("确认密码")
                                .frame(width: 80, alignment: .leading)
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

            Text(store.statusMessage)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(16)
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
