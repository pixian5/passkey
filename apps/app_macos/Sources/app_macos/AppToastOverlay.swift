import SwiftUI

struct AppToastOverlay: ViewModifier {
    @ObservedObject var store: AccountStore

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if store.isToastVisible {
                    Text(store.toastMessage)
                        .font(store.textFont(size: store.scaledTextSize(15), weight: .semibold))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .foregroundStyle(.white)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(Color.green.opacity(0.9))
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(Color.green.opacity(0.95), lineWidth: 1)
                        )
                        .shadow(radius: 8)
                        .frame(maxWidth: 720)
                        .padding(.top, 120)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .overlay(alignment: .bottom) {
                if store.isUndoMoveToastVisible {
                    Button {
                        store.undoLastMoveOperation()
                    } label: {
                        Text(store.undoMoveToastMessage)
                            .font(store.textFont(size: store.scaledTextSize(14), weight: .semibold))
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 9)
                            .foregroundStyle(.white)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(Color.green.opacity(0.9))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(Color.green.opacity(0.95), lineWidth: 1)
                            )
                            .shadow(radius: 8)
                            .frame(maxWidth: 760)
                    }
                    .buttonStyle(.plain)
                    .padding(.bottom, 96)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.easeInOut(duration: 0.18), value: store.isToastVisible)
            .animation(.easeInOut(duration: 0.18), value: store.isUndoMoveToastVisible)
    }
}

extension View {
    func appToast(_ store: AccountStore) -> some View {
        modifier(AppToastOverlay(store: store))
    }
}
