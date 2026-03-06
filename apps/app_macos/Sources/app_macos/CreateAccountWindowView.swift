import SwiftUI

struct CreateAccountWindowView: View {
    @ObservedObject var store: AccountStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("新建账号")
                .font(.headline)

            ScrollView {
                VStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("站点别名（每行一个）")
                            .frame(maxWidth: .infinity, alignment: .leading)
                        TextEditor(text: $store.createSitesText)
                            .font(.body)
                            .frame(minHeight: 88, maxHeight: 130)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                            )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    HStack {
                        Text("用户名")
                            .frame(width: 80, alignment: .leading)
                        TextField("例如 alice@icloud.com", text: $store.createUsername)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    HStack {
                        Text("密码")
                            .frame(width: 80, alignment: .leading)
                        TextField("请输入密码", text: $store.createPassword)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: .infinity)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("TOTP")
                                .frame(width: 80, alignment: .leading)
                            TextField("TOTP 种子密钥", text: $store.createTotpSecret)
                                .textFieldStyle(.roundedBorder)
                                .frame(maxWidth: .infinity)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        HStack {
                            Text("")
                                .frame(width: 80, alignment: .leading)
                            HStack(spacing: 8) {
                                Button("粘贴原始密钥") {
                                    store.pasteCreateTotpRawSecretFromClipboard()
                                }
                                .buttonStyle(.bordered)

                                Button("粘贴完整otpauth URI") {
                                    store.pasteCreateTotpURIFromClipboard()
                                }
                                .buttonStyle(.bordered)

                                Button("粘贴二维码") {
                                    store.pasteCreateTotpQRCodeFromClipboard()
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
                        TextEditor(text: $store.createRecoveryCodes)
                            .font(.body)
                            .frame(minHeight: 84, maxHeight: 130)
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
                            .frame(minHeight: 100, maxHeight: 160)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color.secondary.opacity(0.22), lineWidth: 1)
                            )
                    }

                    HStack(spacing: 8) {
                        Button {
                            store.createAccountFromDraft()
                        } label: {
                            actionButtonLabel("创建账号", prominent: false)
                        }
                        .buttonStyle(.plain)

                        Button {
                            let previousCount = store.accounts.count
                            store.createAccountFromDraft()
                            if store.accounts.count > previousCount {
                                dismiss()
                            }
                        } label: {
                            actionButtonLabel("创建并关闭", prominent: true)
                        }
                        .buttonStyle(.plain)

                        Button {
                            dismiss()
                        } label: {
                            actionButtonLabel("关闭", prominent: false)
                        }
                        .buttonStyle(.plain)

                        Spacer()
                    }
                }
                .padding(.top, 6)
                .padding(.trailing, 10)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }

        }
        .padding(16)
        .frame(minWidth: 700, minHeight: 700, alignment: .topLeading)
    }

    @ViewBuilder
    private func actionButtonLabel(
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
