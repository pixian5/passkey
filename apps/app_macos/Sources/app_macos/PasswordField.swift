import SwiftUI

/// A text field whose default visibility follows the global preference while
/// allowing a temporary per-field override.
struct PasswordField: View {
    @Binding var text: String
    @Binding var showPasswordsGlobally: Bool
    let placeholder: String
    @State private var localVisibility: Bool?

    private var isVisible: Bool {
        localVisibility ?? showPasswordsGlobally
    }

    var body: some View {
        HStack(spacing: 6) {
            Group {
                if isVisible {
                    TextField(placeholder, text: $text)
                } else {
                    SecureField(placeholder, text: $text)
                }
            }
            .textFieldStyle(.roundedBorder)
            .frame(minWidth: 0, maxWidth: .infinity)
            .layoutPriority(1)

            Button {
                localVisibility = !isVisible
            } label: {
                Image(systemName: isVisible ? "eye.slash" : "eye")
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(.borderless)
            .frame(width: 32, height: 28)
            .contentShape(Rectangle())
            .help(isVisible ? "隐藏此字段" : "显示此字段")
        }
        .frame(minWidth: 0, maxWidth: .infinity)
        .onChange(of: showPasswordsGlobally) { _ in
            // A global change must take effect immediately, including fields
            // that were temporarily overridden with their own eye button.
            localVisibility = nil
        }
    }
}
