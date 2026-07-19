import Foundation

/// Stores small local secrets in the shared app-group directory without using
/// the macOS Keychain. Files are written atomically and restricted to the
/// current user (0600); the containing directory is restricted to 0700.
enum PassSharedFileSecretStore {
    static func read(named fileName: String, fileManager: FileManager = .default) -> Data? {
        let url = url(for: fileName, fileManager: fileManager)
        return try? Data(contentsOf: url)
    }

    @discardableResult
    static func write(
        _ data: Data,
        named fileName: String,
        fileManager: FileManager = .default
    ) -> Bool {
        guard isSafeFileName(fileName) else { return false }
        let directory = PassSharedData.dataDirectoryURL(fileManager: fileManager)
        let destination = directory.appendingPathComponent(fileName, isDirectory: false)
        let temporary = directory.appendingPathComponent(
            ".\(fileName).\(UUID().uuidString).tmp",
            isDirectory: false
        )

        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            try fileManager.setAttributes(
                [.posixPermissions: NSNumber(value: 0o700)],
                ofItemAtPath: directory.path
            )
            try data.write(to: temporary, options: [.atomic])
            try fileManager.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600)],
                ofItemAtPath: temporary.path
            )
            if fileManager.fileExists(atPath: destination.path) {
                _ = try fileManager.replaceItemAt(destination, withItemAt: temporary)
            } else {
                try fileManager.moveItem(at: temporary, to: destination)
            }
            try fileManager.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600)],
                ofItemAtPath: destination.path
            )
            return true
        } catch {
            try? fileManager.removeItem(at: temporary)
            return false
        }
    }

    @discardableResult
    static func remove(named fileName: String, fileManager: FileManager = .default) -> Bool {
        guard isSafeFileName(fileName) else { return false }
        let fileURL = url(for: fileName, fileManager: fileManager)
        do {
            try fileManager.removeItem(at: fileURL)
            return true
        } catch CocoaError.fileNoSuchFile {
            return true
        } catch {
            return false
        }
    }

    private static func url(for fileName: String, fileManager: FileManager) -> URL {
        PassSharedData.dataDirectoryURL(fileManager: fileManager)
            .appendingPathComponent(fileName, isDirectory: false)
    }

    private static func isSafeFileName(_ fileName: String) -> Bool {
        !fileName.isEmpty && fileName == URL(fileURLWithPath: fileName).lastPathComponent
    }
}
