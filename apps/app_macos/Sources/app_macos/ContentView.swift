import AppKit
import SwiftUI

struct ContentView: View {
    @ObservedObject var store: AccountStore
    @State private var isCreateSectionExpanded: Bool = false
    @State private var showRecycleBinPopup: Bool = false
    @State private var totpDisplayDate: Date = Date()
    private let totpTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        let accounts = store.activeAccounts()
        let deletedAccounts = store.accounts.filter(\.isDeleted)
        let editingAccount = store.accountForEditing()

        return ZStack {
            VStack(alignment: .leading, spacing: 14) {
                GroupBox {
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            isCreateSectionExpanded.toggle()
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: isCreateSectionExpanded ? "chevron.down" : "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .frame(width: 14)
                            Text("新建账号")
                                .font(.headline)
                            Spacer()
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    if isCreateSectionExpanded {
                        VStack(spacing: 8) {
                            HStack {
                                Text("站点")
                                    .frame(width: 80, alignment: .leading)
                                TextField("例如 icloud.com", text: $store.createSite)
                                    .textFieldStyle(.roundedBorder)
                            }
                            HStack {
                                Text("用户名")
                                    .frame(width: 80, alignment: .leading)
                                TextField("例如 alice@icloud.com", text: $store.createUsername)
                                    .textFieldStyle(.roundedBorder)
                            }
                            HStack {
                                Text("密码")
                                    .frame(width: 80, alignment: .leading)
                                TextField("请输入密码", text: $store.createPassword)
                                    .textFieldStyle(.roundedBorder)
                            }
                            HStack {
                                Text("TOTP")
                                    .frame(width: 80, alignment: .leading)
                                TextField("TOTP 种子密钥", text: $store.createTotpSecret)
                                    .textFieldStyle(.roundedBorder)
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                Text("恢复码")
                                    .frame(width: 80, alignment: .leading)
                                TextEditor(text: $store.createRecoveryCodes)
                                    .font(.body)
                                    .frame(minHeight: 74, maxHeight: 110)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 6)
                                            .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                                    )
                            }
                            VStack(alignment: .leading, spacing: 6) {
                                Text("备注")
                                    .frame(width: 80, alignment: .leading)
                                TextEditor(text: $store.createNote)
                                    .font(.body)
                                    .frame(minHeight: 84, maxHeight: 120)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 6)
                                            .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                                    )
                            }
                            HStack(spacing: 8) {
                                Button("创建账号") {
                                    store.createAccountFromDraft()
                                }
                                .buttonStyle(.borderedProminent)

                                Button("生成演示账号") {
                                    store.addDemoAccountsIfNeeded()
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        .padding(.top, 4)
                    }

                    HStack {
                        Button("删除全部账号") {
                            store.deleteAllAccounts()
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                        .disabled(accounts.isEmpty)

                        Button("回收站 (\(deletedAccounts.count))") {
                            store.cancelEditing()
                            showRecycleBinPopup = true
                        }
                        .buttonStyle(.bordered)

                        Spacer()
                    }
                }

                Text(store.statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                Divider()

                if accounts.isEmpty {
                    Text("暂无账号")
                        .foregroundStyle(.secondary)
                } else {
                    List(accounts) { account in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(account.accountId)
                                    .font(.headline)
                                    .textSelection(.enabled)
                                if account.isDeleted {
                                    Text("已删除")
                                        .font(.caption2)
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
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            .help("点击复制用户名")

                            Button {
                                copyToPasteboard(account.sites.joined(separator: "  "), successMessage: "站点别名已复制")
                            } label: {
                                Text("站点别名: \(account.sites.joined(separator: "  "))")
                                    .font(.caption)
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
                                            .font(.subheadline.monospacedDigit())
                                            .foregroundStyle(.primary)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                    .buttonStyle(.plain)
                                    .help("点击复制验证码")
                                } else {
                                    Text("验证码: TOTP 密钥无效")
                                        .font(.caption)
                                        .foregroundStyle(.red)
                                }
                            }

                            HStack(spacing: 8) {
                                Button("编辑") {
                                    store.beginEditing(account)
                                }
                                .buttonStyle(.bordered)

                                Button("删除账号") {
                                    store.moveToRecycleBin(for: account)
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .listStyle(.inset(alternatesRowBackgrounds: true))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(20)
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
}

private struct RecycleBinPopup: View {
    @ObservedObject var store: AccountStore
    let deletedAccounts: [PasswordAccount]
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("回收站")
                    .font(.headline)
                Spacer()
                Button("关闭") {
                    onClose()
                }
                .buttonStyle(.bordered)
            }

            HStack(spacing: 8) {
                Button("全部恢复") {
                    store.restoreAllFromRecycleBin()
                }
                .buttonStyle(.bordered)
                .disabled(deletedAccounts.isEmpty)

                Button("全部永久删除") {
                    store.permanentlyDeleteAllFromRecycleBin()
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(deletedAccounts.isEmpty)

                Spacer()
            }

            if deletedAccounts.isEmpty {
                Text("回收站为空")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 220, alignment: .center)
            } else {
                List(deletedAccounts) { account in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(account.accountId)
                            .font(.subheadline.weight(.semibold))
                            .textSelection(.enabled)
                        Text("用户名: \(account.username)")
                            .font(.caption)
                        Text("站点别名: \(account.sites.joined(separator: "  "))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.tail)

                        HStack(spacing: 8) {
                            Button("恢复账号") {
                                store.restoreFromRecycleBin(for: account)
                            }
                            .buttonStyle(.bordered)

                            Button("永久删除") {
                                store.permanentlyDeleteFromRecycleBin(account)
                            }
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
                    .font(.headline)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Button("保存编辑") {
                    store.saveEditing()
                }
                .buttonStyle(.borderedProminent)

                Button("取消编辑") {
                    store.cancelEditing()
                }
                .buttonStyle(.bordered)
            }

            ScrollView {
                VStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Text("站点别名")
                                .frame(width: 80, alignment: .leading)
                            Text("（每行一个站点，共用同一套账号密码）")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Spacer()
                        }
                        TextEditor(text: $store.editSitesText)
                            .font(.body)
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
                            .font(.body)
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
                            .font(.body)
                            .frame(minHeight: 100, maxHeight: 150)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                            )
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 2) {
                        Text("正在编辑: 网站 \(editingAccount.canonicalSite) | 用户名 \(editingAccount.username)")
                            .font(.caption)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text("创建时间: \(store.displayTime(editingAccount.createdAtMs)) | 最后更新时间: \(store.displayTime(editingAccount.updatedAtMs)) | 删除时间: \(store.displayTime(editingAccount.deletedAtMs))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text("用户名更新时间: \(store.displayTime(editingAccount.usernameUpdatedAtMs)) | 密码更新时间: \(store.displayTime(editingAccount.passwordUpdatedAtMs))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text("TOTP 更新时间: \(store.displayTime(editingAccount.totpUpdatedAtMs)) | 恢复码更新时间: \(store.displayTime(editingAccount.recoveryCodesUpdatedAtMs)) | 备注更新时间: \(store.displayTime(editingAccount.noteUpdatedAtMs))")
                            .font(.caption2)
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
