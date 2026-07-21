import Foundation
import Darwin

/// Thin loader around `pass-core-ffi` (Rust). Used for production merge authority.
enum PassCoreFFI {
    enum FFIError: Error, LocalizedError {
        case libraryNotFound([String])
        case symbolMissing(String)
        case callFailed(String)
        case invalidUTF8
        case decodeFailed(String)

        var errorDescription: String? {
            switch self {
            case .libraryNotFound(let paths):
                return "未找到 pass-core-ffi 动态库，尝试路径：\(paths.joined(separator: " | "))"
            case .symbolMissing(let name):
                return "缺少 FFI 符号：\(name)"
            case .callFailed(let message):
                return message
            case .invalidUTF8:
                return "FFI 返回了非法 UTF-8"
            case .decodeFailed(let message):
                return "解码 FFI JSON 失败：\(message)"
            }
        }
    }

    private static let lock = NSLock()
    // Loaded once under `lock`; marked unsafe for Swift 6 global mutability checks.
    nonisolated(unsafe) private static var handle: UnsafeMutableRawPointer?
    nonisolated(unsafe) private static var mergeFn: MergeFn?
    nonisolated(unsafe) private static var safetyFn: SafetyFn?
    nonisolated(unsafe) private static var aliasFn: AliasFn?
    nonisolated(unsafe) private static var csvFn: CsvFn?
    nonisolated(unsafe) private static var freeFn: FreeFn?
    nonisolated(unsafe) private static var lastErrorFn: LastErrorFn?

    private typealias MergeFn = @convention(c) (UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>?
    private typealias SafetyFn = @convention(c) (
        UnsafePointer<CChar>?,
        UnsafePointer<CChar>?,
        UnsafePointer<CChar>?,
        UnsafePointer<CChar>?
    ) -> UnsafeMutablePointer<CChar>?
    private typealias AliasFn = @convention(c) (
        UnsafePointer<CChar>?,
        UnsafePointer<CChar>?,
        Int64
    ) -> UnsafeMutablePointer<CChar>?
    private typealias CsvFn = @convention(c) (UnsafePointer<CChar>?) -> UnsafeMutablePointer<CChar>?
    private typealias FreeFn = @convention(c) (UnsafeMutablePointer<CChar>?) -> Void
    private typealias LastErrorFn = @convention(c) () -> UnsafePointer<CChar>?

    /// When true, skip Rust and use in-process Swift merge (debug only).
    static var forceSwiftMerge: Bool {
        if let env = ProcessInfo.processInfo.environment["PASS_USE_SWIFT_MERGE"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        {
            return env == "1" || env == "true" || env == "yes"
        }
        return false
    }

    static var isAvailable: Bool {
        (try? ensureLoaded()) != nil
    }

    static func mergeSyncPayloadJSON(localJSON: String, remoteJSON: String) throws -> String {
        try ensureLoaded()
        guard let mergeFn else { throw FFIError.symbolMissing("pass_core_merge_sync_payloads_json") }
        return try localJSON.withCString { localPtr in
            try remoteJSON.withCString { remotePtr in
                let raw = mergeFn(localPtr, remotePtr)
                return try takeReturnedString(raw)
            }
        }
    }

    static func evaluateSyncSafetyJSON(
        localJSON: String,
        remoteJSON: String?,
        mergedJSON: String,
        mode: String
    ) throws -> (safe: Bool, reasons: [String]) {
        try ensureLoaded()
        guard let safetyFn else { throw FFIError.symbolMissing("pass_core_evaluate_sync_safety_json") }

        let remote = remoteJSON ?? "null"
        let json = try localJSON.withCString { localPtr in
            try remote.withCString { remotePtr in
                try mergedJSON.withCString { mergedPtr in
                    try mode.withCString { modePtr in
                        let raw = safetyFn(localPtr, remotePtr, mergedPtr, modePtr)
                        return try takeReturnedString(raw)
                    }
                }
            }
        }

        struct Report: Decodable {
            let safe: Bool
            let reasons: [String]
        }
        do {
            let report = try JSONDecoder().decode(Report.self, from: Data(json.utf8))
            return (report.safe, report.reasons)
        } catch {
            throw FFIError.decodeFailed(String(describing: error))
        }
    }

    /// Union site aliases across accounts (`pass_core_sync_alias_groups_json`).
    /// Returns JSON array of accounts plus whether any account sites changed.
    static func syncAliasGroupsJSON(
        accountsJSON: String,
        deviceName: String,
        nowMs: Int64
    ) throws -> (accountsJSON: String, changed: Bool) {
        try ensureLoaded()
        guard let aliasFn else { throw FFIError.symbolMissing("pass_core_sync_alias_groups_json") }
        let json = try accountsJSON.withCString { accountsPtr in
            try deviceName.withCString { devicePtr in
                let raw = aliasFn(accountsPtr, devicePtr, nowMs)
                return try takeReturnedString(raw)
            }
        }
        guard let obj = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
              let changed = obj["changed"] as? Bool,
              let accounts = obj["accounts"],
              JSONSerialization.isValidJSONObject(accounts),
              let data = try? JSONSerialization.data(withJSONObject: accounts, options: [.sortedKeys]),
              let accountsOut = String(data: data, encoding: .utf8)
        else {
            throw FFIError.decodeFailed("alias result missing accounts/changed")
        }
        return (accountsOut, changed)
    }

    /// Full-account CSV export matching macOS `buildCsvContent` columns.
    static func exportMacosCsvJSON(accountsJSON: String) throws -> String {
        try ensureLoaded()
        guard let csvFn else { throw FFIError.symbolMissing("pass_core_export_macos_csv_json") }
        return try accountsJSON.withCString { ptr in
            let raw = csvFn(ptr)
            return try takeReturnedString(raw)
        }
    }

    private static func ensureLoaded() throws {
        lock.lock()
        defer { lock.unlock() }
        if handle != nil { return }

        let candidates = candidateLibraryPaths()
        for path in candidates {
            guard FileManager.default.isReadableFile(atPath: path) else { continue }
            if let h = dlopen(path, RTLD_NOW | RTLD_LOCAL) {
                handle = h
                mergeFn = unsafeBitCast(dlsym(h, "pass_core_merge_sync_payloads_json"), to: MergeFn?.self)
                safetyFn = unsafeBitCast(dlsym(h, "pass_core_evaluate_sync_safety_json"), to: SafetyFn?.self)
                aliasFn = unsafeBitCast(dlsym(h, "pass_core_sync_alias_groups_json"), to: AliasFn?.self)
                csvFn = unsafeBitCast(dlsym(h, "pass_core_export_macos_csv_json"), to: CsvFn?.self)
                freeFn = unsafeBitCast(dlsym(h, "pass_core_string_free"), to: FreeFn?.self)
                lastErrorFn = unsafeBitCast(dlsym(h, "pass_core_last_error_message"), to: LastErrorFn?.self)
                if mergeFn == nil || freeFn == nil {
                    dlclose(h)
                    handle = nil
                    mergeFn = nil
                    safetyFn = nil
                    aliasFn = nil
                    csvFn = nil
                    freeFn = nil
                    lastErrorFn = nil
                    throw FFIError.symbolMissing("merge/free")
                }
                return
            }
        }
        throw FFIError.libraryNotFound(candidates)
    }

    private static func candidateLibraryPaths() -> [String] {
        var paths: [String] = []
        let fileManager = FileManager.default
        let env = ProcessInfo.processInfo.environment

        if let override = env["PASS_CORE_FFI_DYLIB"], !override.isEmpty {
            paths.append(override)
        }

        if let frameworks = Bundle.main.privateFrameworksPath {
            paths.append((frameworks as NSString).appendingPathComponent("libpass_core_ffi.dylib"))
        }
        if let resourcePath = Bundle.main.resourcePath {
            paths.append((resourcePath as NSString).appendingPathComponent("libpass_core_ffi.dylib"))
        }
        let bundleFrameworks = (Bundle.main.bundlePath as NSString)
            .appendingPathComponent("Contents/Frameworks/libpass_core_ffi.dylib")
        paths.append(bundleFrameworks)

        // Dev: next to executable or repo layout.
        if let exe = Bundle.main.executablePath {
            let exeDir = (exe as NSString).deletingLastPathComponent
            paths.append((exeDir as NSString).appendingPathComponent("libpass_core_ffi.dylib"))
            paths.append((exeDir as NSString).appendingPathComponent("../Frameworks/libpass_core_ffi.dylib"))
        }

        // Repo checkout: core/pass_core/target/{release,debug}/libpass_core_ffi.dylib
        // AccountStore lives under apps/app_macos — walk up from #file.
        let sourceFile = URL(fileURLWithPath: #filePath)
        // .../apps/app_macos/Sources/app_macos/PassCoreFFI.swift
        let appMacos = sourceFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let repoRoot = appMacos.deletingLastPathComponent().deletingLastPathComponent()
        let releaseLib = repoRoot
            .appendingPathComponent("core/pass_core/target/release/libpass_core_ffi.dylib")
            .path
        let debugLib = repoRoot
            .appendingPathComponent("core/pass_core/target/debug/libpass_core_ffi.dylib")
            .path
        paths.append(releaseLib)
        paths.append(debugLib)

        // Vendor copy used by packaging.
        let vendorLib = appMacos
            .appendingPathComponent("Vendor/pass_core_ffi/libpass_core_ffi.dylib")
            .path
        paths.append(vendorLib)

        // De-dupe while preserving order; keep missing paths so error messages list attempts.
        var seen = Set<String>()
        var ordered: [String] = []
        for path in paths {
            let normalized = (path as NSString).standardizingPath
            if seen.insert(normalized).inserted {
                ordered.append(normalized)
            }
        }
        _ = fileManager
        return ordered
    }

    private static func takeReturnedString(_ raw: UnsafeMutablePointer<CChar>?) throws -> String {
        guard let raw else {
            let message = lastErrorMessage() ?? "pass-core-ffi returned null"
            throw FFIError.callFailed(message)
        }
        defer {
            freeFn?(raw)
        }
        guard let value = String(validatingCString: raw) else {
            throw FFIError.invalidUTF8
        }
        return value
    }

    private static func lastErrorMessage() -> String? {
        guard let lastErrorFn, let ptr = lastErrorFn() else { return nil }
        return String(validatingCString: ptr)
    }
}
