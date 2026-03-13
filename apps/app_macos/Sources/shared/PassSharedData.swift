import Foundation

enum PassSharedData {
    static let appGroupIdentifier = "group.com.pass.desktop.shared"
    static let directoryName = "pass-mac"

    static func dataDirectoryURL(fileManager: FileManager = .default) -> URL {
        if let sharedBase = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) {
            return sharedBase.appendingPathComponent(directoryName, isDirectory: true)
        }
        return legacyDataDirectoryURL(fileManager: fileManager)
    }

    static func legacyDataDirectoryURL(fileManager: FileManager = .default) -> URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent(directoryName, isDirectory: true)
    }

    static func databaseURL(fileManager: FileManager = .default) -> URL {
        dataDirectoryURL(fileManager: fileManager).appendingPathComponent("pass.db", isDirectory: false)
    }

    static func legacyDatabaseURL(fileManager: FileManager = .default) -> URL {
        legacyDataDirectoryURL(fileManager: fileManager).appendingPathComponent("pass.db", isDirectory: false)
    }

    static func accountsLegacyJSONURL(fileManager: FileManager = .default) -> URL {
        dataDirectoryURL(fileManager: fileManager).appendingPathComponent("accounts.json", isDirectory: false)
    }

    static func passkeysLegacyJSONURL(fileManager: FileManager = .default) -> URL {
        dataDirectoryURL(fileManager: fileManager).appendingPathComponent("passkeys.json", isDirectory: false)
    }

    static func migrateLegacyStoreToSharedContainerIfNeeded(fileManager: FileManager = .default) {
        guard let sharedBase = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) else {
            return
        }

        let legacyDirectory = legacyDataDirectoryURL(fileManager: fileManager)
        let sharedDirectory = sharedBase.appendingPathComponent(directoryName, isDirectory: true)
        guard legacyDirectory.path != sharedDirectory.path else {
            return
        }
        guard fileManager.fileExists(atPath: legacyDirectory.path) else {
            return
        }

        do {
            try fileManager.createDirectory(at: sharedDirectory, withIntermediateDirectories: true)
            let items = try fileManager.contentsOfDirectory(atPath: legacyDirectory.path)
            for item in items {
                let sourceURL = legacyDirectory.appendingPathComponent(item, isDirectory: false)
                let targetURL = sharedDirectory.appendingPathComponent(item, isDirectory: false)
                guard !fileManager.fileExists(atPath: targetURL.path) else { continue }
                try fileManager.copyItem(at: sourceURL, to: targetURL)
            }
        } catch {
            // Keep the legacy store untouched if migration fails.
        }
    }
}
