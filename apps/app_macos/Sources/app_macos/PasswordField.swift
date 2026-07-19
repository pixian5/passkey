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

            Button {
                localVisibility = !isVisible
            } label: {
                Image(systemName: isVisible ? "eye.slash" : "eye")
                    .frame(width: 18, height: 18)
            }
            .buttonStyle(.borderless)
            .help(isVisible ? "隐藏此字段" : "显示此字段")
        }
    }
}
