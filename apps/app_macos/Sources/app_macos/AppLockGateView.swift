import AppKit
import SwiftUI

struct AppLockGateView: View {
    @ObservedObject var store: AccountStore
    @ObservedObject var appLock: AppLockStore
    @FocusState private var isPasswordFocused: Bool
    private let autoLockTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            ContentView(store: store)
                .disabled(appLock.shouldShowLockScreen)
                .blur(radius: appLock.shouldShowLockScreen ? 3 : 0)

            if appLock.shouldShowLockScreen {
                lockOverlay
                    .onAppear {
                        isPasswordFocused = true
                        appLock.autoTryBiometricIfNeeded()
                    }
            }
        }
        .onReceive(autoLockTimer) { now in
            appLock.checkAutoLock(at: now)
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willResignActiveNotification)) { _ in
            appLock.handleAppWillResignActive()
        }
        .onChange(of: appLock.shouldShowLockScreen) { locked in
            if locked {
                isPasswordFocused = true
                appLock.autoTryBiometricIfNeeded()
            }
        }
    }

    private var lockOverlay: some View {
        VStack(spacing: 12) {
            Text("Pass Mac 已锁定")
                .font(.title3.weight(.semibold))

            if !appLock.lockMessage.isEmpty {
                Text(appLock.lockMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            SecureField("输入主密码", text: $appLock.unlockPasswordInput)
                .textFieldStyle(.roundedBorder)
                .focused($isPasswordFocused)
                .frame(width: 280)
                .onSubmit {
                    appLock.unlockWithPassword()
                }

            HStack(spacing: 8) {
                Button("解锁") {
                    appLock.unlockWithPassword()
                }
                .font(store.buttonFont())
                .buttonStyle(.borderedProminent)

                if appLock.preferBiometrics {
                    Button("使用指纹解锁") {
                        appLock.tryBiometricUnlock()
                    }
                    .font(store.buttonFont())
                    .buttonStyle(.bordered)
                }
            }
        }
        .padding(24)
        .background(.ultraThickMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black.opacity(0.14))
    }
}
