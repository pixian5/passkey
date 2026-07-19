import SwiftUI

struct AppToastOverlay: ViewModifier {
    @ObservedObject var store: AccountStore
    @State private var hostWindow: NSWindow?

    func body(content: Content) -> some View {
        content
            .background(WindowReader(window: $hostWindow))
            .overlay(alignment: .top) {
                if store.isToastVisible, shouldShowToastInCurrentWindow {
                    Group {
                        if store.isTopToastUndoAvailable {
                            Button {
                                store.undoLastMoveOperation()
                            } label: {
                                toastLabel(text: store.toastMessage)
                            }
                            .buttonStyle(.plain)
                            .help("点击撤销")
                        } else {
                            toastLabel(text: store.toastMessage)
                        }
                    }
                    .frame(maxWidth: 720)
                    .padding(.top, 120)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.18), value: store.isToastVisible)
    }

    private var shouldShowToastInCurrentWindow: Bool {
        guard let hostWindow else { return true }
        if hostWindow.isKeyWindow {
            return true
        }
        guard let keyWindow = NSApp.keyWindow else {
            return true
        }
        return keyWindow == hostWindow
    }

    private func toastLabel(text: String) -> some View {
        let style = store.toastStyle
        return Text(text)
            .font(store.textFont(size: store.scaledTextSize(15), weight: .semibold))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .foregroundStyle(style.foregroundColor)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(style.backgroundColor)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(style.borderColor, lineWidth: 1)
            )
            .shadow(radius: 8)
    }
}

extension AccountStore.ToastStyle {
    var backgroundColor: Color {
        switch self {
        case .success:
            return Color.green.opacity(0.92)
        case .error:
            return Color.red.opacity(0.92)
        case .warning:
            return Color.yellow.opacity(0.95)
        }
    }

    var borderColor: Color {
        switch self {
        case .success:
            return Color.green.opacity(0.98)
        case .error:
            return Color.red.opacity(0.98)
        case .warning:
            return Color.orange.opacity(0.9)
        }
    }

    var foregroundColor: Color {
        switch self {
        case .success, .error:
            return .white
        case .warning:
            return Color(red: 0.35, green: 0.27, blue: 0.05)
        }
    }
}

extension View {
    func appToast(_ store: AccountStore) -> some View {
        modifier(AppToastOverlay(store: store))
    }
}

private struct WindowReader: NSViewRepresentable {
    @Binding var window: NSWindow?

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            window = view.window
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            window = nsView.window
        }
    }
}
