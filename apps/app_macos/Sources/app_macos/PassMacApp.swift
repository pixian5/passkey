import AppKit
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
                .background(MainWindowCloseTerminator())
        }
        .commands {
            PassMacSettingsCommands()
            PassMacShortcutCommands(store: store)
            PassMacAccountCommands(store: store)
            PassMacHistoryCommands()
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

        Window(HistoryEntryCategory.sync.menuTitle, id: "history-sync") {
            HistoryWindowView(store: store, category: .sync)
                .font(store.textFont())
                .appToast(store)
        }
        .defaultSize(width: 980, height: 720)
        .windowResizability(.automatic)

        Window(HistoryEntryCategory.local.menuTitle, id: "history-local") {
            HistoryWindowView(store: store, category: .local)
                .font(store.textFont())
                .appToast(store)
        }
        .defaultSize(width: 980, height: 720)
        .windowResizability(.automatic)
    }
}

private struct PassMacShortcutCommands: Commands {
    @ObservedObject var store: AccountStore

    var body: some Commands {
        CommandGroup(before: .undoRedo) {
            Button("撤销移动") {
                store.handleUndoShortcut()
            }
            .keyboardShortcut("z", modifiers: .command)
        }

        CommandGroup(replacing: .textEditing) {
            Button("全选账号") {
                store.handleSelectAllShortcut()
            }
            .keyboardShortcut("a", modifiers: .command)
        }
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
            Button("生成演示账号") {
                store.addDemoAccountsIfNeeded()
            }

            Divider()

            Button("全选账号") {
                store.triggerSelectAllAccounts()
            }

            Button("撤销移动") {
                store.undoLastMoveOperation()
            }
        }
    }
}

private struct PassMacHistoryCommands: Commands {
    @Environment(\.openWindow) private var openWindow

    var body: some Commands {
        CommandMenu("历史") {
            Button(HistoryEntryCategory.sync.menuTitle) {
                openWindow(id: "history-sync")
            }

            Button(HistoryEntryCategory.local.menuTitle) {
                openWindow(id: "history-local")
            }
        }
    }
}

private struct MainWindowCloseTerminator: NSViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async {
            context.coordinator.bindIfNeeded(to: view.window)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            context.coordinator.bindIfNeeded(to: nsView.window)
        }
    }

    final class Coordinator {
        private weak var observedWindow: NSWindow?
        private var closeObserver: NSObjectProtocol?

        deinit {
            if let closeObserver {
                NotificationCenter.default.removeObserver(closeObserver)
            }
        }

        func bindIfNeeded(to window: NSWindow?) {
            guard let window, observedWindow !== window else { return }
            observedWindow = window
            if let closeObserver {
                NotificationCenter.default.removeObserver(closeObserver)
            }
            closeObserver = NotificationCenter.default.addObserver(
                forName: NSWindow.willCloseNotification,
                object: window,
                queue: .main
            ) { _ in
                Task { @MainActor in
                    NSApp.terminate(nil)
                }
            }
        }
    }
}
