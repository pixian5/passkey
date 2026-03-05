import AppKit
import SwiftUI

struct ContentView: View {
    @ObservedObject var store: AccountStore
    @Environment(\.openWindow) private var openWindow
    @State private var showRecycleBinPopup: Bool = false
    @State private var totpDisplayDate: Date = Date()
    private let totpTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        let accounts = store.activeAccounts()
        let deletedAccounts = store.accounts.filter(\.isDeleted)
        let editingAccount = store.accountForEditing()

        return ZStack {
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
                        .disabled(accounts.isEmpty)
                        .opacity(accounts.isEmpty ? 0.45 : 1)

                        Button {
                            store.cancelEditing()
                            showRecycleBinPopup = true
                        } label: {
                            topActionButtonLabel(
                                "回收站 (\(deletedAccounts.count))",
                                prominent: false
                            )
                        }
                        .buttonStyle(.plain)

                        Spacer()
                    }
                }

                if accounts.isEmpty {
                    Text("暂无账号")
                        .foregroundStyle(.secondary)
                } else {
                    List(accounts) { account in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(account.accountId)
                                    .font(store.textFont(size: store.scaledTextSize(17), weight: .semibold))
                                    .textSelection(.enabled)
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
                                if let code = store.currentTotpCode(for: account, at: totpDisplayDate) {
                                    Button {
                                        copyTotpCode(code)
                                    } label: {
                                        Text("验证码: \(formattedTotpCode(code)) (剩余 \(store.totpRemainingSeconds(at: totpDisplayDate))s)")
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

                            HStack(spacing: 8) {
                                Button("编辑") {
                                    store.beginEditing(account)
                                }
                                .font(store.buttonFont())
                                .buttonStyle(.bordered)

                                Button("删除账号") {
                                    store.moveToRecycleBin(for: account)
                                }
                                .font(store.buttonFont())
                                .buttonStyle(.bordered)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .listStyle(.inset(alternatesRowBackgrounds: true))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(16)
            .frame(minWidth: 1000, minHeight: 700, alignment: .topLeading)
            .onReceive(totpTimer) { value in
                totpDisplayDate = value
            }

            if let editingAccount, !showRecycleBinPopup {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .onTapGesture {
                        store.cancelEditing()
                    }

                AccountEditPopup(store: store, editingAccount: editingAccount)
                    .padding(26)
            }

            if showRecycleBinPopup {
                Color.black.opacity(0.16)
                    .ignoresSafeArea()
                    .onTapGesture {
                        showRecycleBinPopup = false
                    }

                RecycleBinPopup(
                    store: store,
                    deletedAccounts: deletedAccounts,
                    onClose: { showRecycleBinPopup = false }
                )
                .padding(26)
            }
        }
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
                    }

                    HStack {
                        Text("密码")
                            .frame(width: 80, alignment: .leading)
                        TextField("密码", text: $store.editPassword)
                            .textFieldStyle(.roundedBorder)
                    }

                    HStack {
                        Text("TOTP")
                            .frame(width: 80, alignment: .leading)
                        TextField("TOTP 种子密钥", text: $store.editTotpSecret)
                            .textFieldStyle(.roundedBorder)
                    }

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
