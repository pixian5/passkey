//
//  AppDelegate.swift
//  PassSafari
//
//  Created by 🌞 🐑 on 2026-03-27.
//

import Cocoa
import SafariServices

private let passSafariExtensionBundleIdentifier = "com.pass.safari.Extension"

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            SFSafariApplication.showPreferencesForExtension(withIdentifier: passSafariExtensionBundleIdentifier) { _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    NSApp.activate(ignoringOtherApps: true)
                }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

}
