import SwiftUI

@main
struct PassMacApp: App {
    @StateObject private var store = AccountStore()
    @StateObject private var appLock = AppLockStore()

    var body: some Scene {
        WindowGroup {
            AppLockGateView(store: store, appLock: appLock)
                .font(store.textFont())
                .appToast(store)
        }
        .commands {
            PassMacSettingsCommands()
            PassMacAccountCommands(store: store)
        }

        Window("设置", id: "settings") {
            SettingsView(store: store, appLock: appLock)
                .font(store.textFont())
                .appToast(store)
        }
        .defaultSize(width: 860, height: 620)
        .windowResizability(.automatic)

        Window("新建账号", id: "create-account") {
            CreateAccountWindowView(store: store)
                .font(store.textFont())
                .appToast(store)
        }
        .defaultSize(width: 760, height: 760)
        .windowResizability(.automatic)
    }
}

private struct PassMacSettingsCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("设置...") {
                openWindow(id: "settings")
            }
            .keyboardShortcut(",", modifiers: .command)
        }
    }
}

private struct PassMacAccountCommands: Commands {
    @ObservedObject var store: AccountStore

    var body: some Commands {
        CommandMenu("账号") {
            Button("全选账号") {
                store.triggerSelectAllAccounts()
            }
            .keyboardShortcut("a", modifiers: .command)

            Button("撤销移动") {
                store.undoLastMoveOperation()
            }
            .keyboardShortcut("z", modifiers: .command)
        }
    }
}
