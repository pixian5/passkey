import Foundation
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

enum LocalSQLiteStoreError: Error, LocalizedError {
    case openFailed(String)
    case executeFailed(String)
    case prepareFailed(String)
    case stepFailed(String)

    var errorDescription: String? {
        switch self {
        case .openFailed(let message):
            return "SQLite 打开失败: \(message)"
        case .executeFailed(let message):
            return "SQLite 执行失败: \(message)"
        case .prepareFailed(let message):
            return "SQLite 语句准备失败: \(message)"
        case .stepFailed(let message):
            return "SQLite 写入失败: \(message)"
        }
    }
}

final class LocalSQLiteStore {
    private let databaseURL: URL
    private var db: OpaquePointer?

    init(databaseURL: URL) {
        self.databaseURL = databaseURL
    }

    deinit {
        close()
    }

    func transaction(_ body: () throws -> Void) throws {
        try openIfNeeded()
        try execute("BEGIN IMMEDIATE;")
        do {
            try body()
            try execute("COMMIT;")
        } catch {
            try? execute("ROLLBACK;")
            throw error
        }
    }

    func readData(for key: String) throws -> Data? {
        try openIfNeeded()
        let sql = "SELECT value, updated_at_ms FROM kv WHERE key = ?1 LIMIT 1;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw LocalSQLiteStoreError.prepareFailed(lastErrorMessage())
        }
        defer {
            if let statement {
                sqlite3_finalize(statement)
            }
        }

        _ = key.withCString { pointer in
            sqlite3_bind_text(statement, 1, pointer, -1, SQLITE_TRANSIENT)
        }

        let step = sqlite3_step(statement)
        if step == SQLITE_DONE {
            return nil
        }
        guard step == SQLITE_ROW else {
            throw LocalSQLiteStoreError.stepFailed(lastErrorMessage())
        }

        let length = Int(sqlite3_column_bytes(statement, 0))
        guard let bytes = sqlite3_column_blob(statement, 0), length > 0 else {
            return Data()
        }
        let storedData = Data(bytes: bytes, count: length)
        if PassSharedCrypto.isEncrypted(storedData) {
            return try PassSharedCrypto.decrypt(storedData)
        }

        // Rows written before local encryption was introduced are migrated on first read.
        let updatedAtMs = sqlite3_column_int64(statement, 1)
        sqlite3_finalize(statement)
        statement = nil
        try writeData(storedData, for: key, updatedAtMs: updatedAtMs)
        return storedData
    }

    func writeData(_ data: Data, for key: String, updatedAtMs: Int64) throws {
        try openIfNeeded()
        let sql = """
        INSERT INTO kv (key, value, updated_at_ms)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at_ms = excluded.updated_at_ms;
        """

        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw LocalSQLiteStoreError.prepareFailed(lastErrorMessage())
        }
        defer { sqlite3_finalize(statement) }

        _ = key.withCString { pointer in
            sqlite3_bind_text(statement, 1, pointer, -1, SQLITE_TRANSIENT)
        }

        let encrypted = try PassSharedCrypto.encrypt(data)
        encrypted.withUnsafeBytes { rawBuffer in
            let bytes = rawBuffer.baseAddress
            sqlite3_bind_blob(statement, 2, bytes, Int32(rawBuffer.count), SQLITE_TRANSIENT)
        }
        sqlite3_bind_int64(statement, 3, updatedAtMs)

        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw LocalSQLiteStoreError.stepFailed(lastErrorMessage())
        }
    }

    /// 将无法解密或无法解析的值先以原始 BLOB 形式隔离备份，再替换为新的加密值。
    ///
    /// 该方法只用于单个损坏的集合（目前是 history）。它不会触碰其它 key，且只有在
    /// 备份文件成功写入后才会更新数据库中的值；因此即使重建失败，原始数据仍然保留在
    /// 数据库和备份文件中，便于后续离线恢复。
    @discardableResult
    func quarantineAndReplaceData(
        for key: String,
        with replacement: Data,
        backupDirectory: URL,
        updatedAtMs: Int64
    ) throws -> URL? {
        try openIfNeeded()
        let sql = "SELECT value FROM kv WHERE key = ?1 LIMIT 1;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw LocalSQLiteStoreError.prepareFailed(lastErrorMessage())
        }
        defer {
            if let statement {
                sqlite3_finalize(statement)
            }
        }

        _ = key.withCString { pointer in
            sqlite3_bind_text(statement, 1, pointer, -1, SQLITE_TRANSIENT)
        }

        let step = sqlite3_step(statement)
        guard step == SQLITE_ROW else {
            if step == SQLITE_DONE { return nil }
            throw LocalSQLiteStoreError.stepFailed(lastErrorMessage())
        }

        let length = Int(sqlite3_column_bytes(statement, 0))
        guard let bytes = sqlite3_column_blob(statement, 0), length > 0 else {
            return nil
        }
        let rawData = Data(bytes: bytes, count: length)

        try FileManager.default.createDirectory(
            at: backupDirectory,
            withIntermediateDirectories: true
        )
        let safeKey = key.replacingOccurrences(
            of: "[^A-Za-z0-9._-]",
            with: "_",
            options: .regularExpression
        )
        let backupURL = backupDirectory.appendingPathComponent(
            "\(safeKey)-\(updatedAtMs)-\(UUID().uuidString).blob",
            isDirectory: false
        )
        try rawData.write(to: backupURL, options: [.atomic])

        // 备份完成后才写入替代值。writeData 会使用当前有效的本地数据库密钥加密。
        try writeData(replacement, for: key, updatedAtMs: updatedAtMs)
        return backupURL
    }

    private func openIfNeeded() throws {
        if db != nil { return }

        try PassSharedCrypto.ensureKeyAvailable()
        try FileManager.default.createDirectory(
            at: databaseURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        var connection: OpaquePointer?
        let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(databaseURL.path, &connection, flags, nil) == SQLITE_OK, let connection else {
            let message = connection.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            if let connection {
                sqlite3_close(connection)
            }
            throw LocalSQLiteStoreError.openFailed(message)
        }
        db = connection

        try execute("PRAGMA journal_mode=WAL;")
        try execute("PRAGMA synchronous=NORMAL;")
        try execute("PRAGMA foreign_keys=ON;")
        try execute("PRAGMA temp_store=MEMORY;")
        try execute(
            """
            CREATE TABLE IF NOT EXISTS kv (
              key TEXT PRIMARY KEY NOT NULL,
              value BLOB NOT NULL,
              updated_at_ms INTEGER NOT NULL
            );
            """
        )
    }

    private func execute(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
            throw LocalSQLiteStoreError.executeFailed(lastErrorMessage())
        }
    }

    private func close() {
        guard let db else { return }
        sqlite3_close(db)
        self.db = nil
    }

    private func lastErrorMessage() -> String {
        guard let db else { return "database not open" }
        return String(cString: sqlite3_errmsg(db))
    }
}
