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

    func readData(for key: String) throws -> Data? {
        try openIfNeeded()
        let sql = "SELECT value FROM kv WHERE key = ?1 LIMIT 1;"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw LocalSQLiteStoreError.prepareFailed(lastErrorMessage())
        }
        defer { sqlite3_finalize(statement) }

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
        return Data(bytes: bytes, count: length)
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

        data.withUnsafeBytes { rawBuffer in
            let bytes = rawBuffer.baseAddress
            sqlite3_bind_blob(statement, 2, bytes, Int32(rawBuffer.count), SQLITE_TRANSIENT)
        }
        sqlite3_bind_int64(statement, 3, updatedAtMs)

        guard sqlite3_step(statement) == SQLITE_DONE else {
            throw LocalSQLiteStoreError.stepFailed(lastErrorMessage())
        }
    }

    private func openIfNeeded() throws {
        if db != nil { return }

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
