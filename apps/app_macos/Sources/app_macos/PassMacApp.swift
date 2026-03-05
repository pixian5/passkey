import SwiftUI

@main
struct PassMacApp: App {
    @StateObject private var store = AccountStore()
    @StateObject private var appLock = AppLockStore()

    var body: some Scene {
        WindowGroup {
            AppLockGateView(store: store, appLock: appLock)
        }
        Settings {
            SettingsView(store: store, appLock: appLock)
        }
    }
}
