// SQLite database management
use rusqlite::{params, Connection, Result};
use std::path::PathBuf;

use crate::models::{AccountFolder, PasswordAccount, PasskeyRecord};
use crate::{AppConfig, SyncConfig};

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        conn.execute("PRAGMA foreign_keys = ON", [])?;
        conn.execute("PRAGMA journal_mode = WAL", [])?;

        let db = Self { conn };
        db.initialize_schema()?;
        Ok(db)
    }

    fn initialize_schema(&self) -> Result<()> {
        // Accounts table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL UNIQUE,
                canonical_site TEXT NOT NULL,
                sites TEXT NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                totp_secret TEXT,
                recovery_codes TEXT,
                note TEXT,
                folder_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(folder_id) REFERENCES folders(id)
            )",
            [],
        )?;

        // Folders table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                matched_sites TEXT NOT NULL,
                auto_add_matching INTEGER NOT NULL DEFAULT 0
            )",
            [],
        )?;

        // Passkeys table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS passkeys (
                credential_id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                rp_id TEXT NOT NULL,
                user_name TEXT NOT NULL,
                display_name TEXT,
                user_handle TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_used_at INTEGER,
                FOREIGN KEY(account_id) REFERENCES accounts(account_id)
            )",
            [],
        )?;

        // Config table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Sync config table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                backend_type TEXT NOT NULL,
                server_url TEXT NOT NULL,
                username TEXT,
                password TEXT,
                bearer_token TEXT,
                auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
                auto_sync_interval_minutes INTEGER NOT NULL DEFAULT 30
            )",
            [],
        )?;

        // Create indexes
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_accounts_deleted ON accounts(deleted)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_accounts_folder ON accounts(folder_id)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_passkeys_account ON passkeys(account_id)",
            [],
        )?;

        Ok(())
    }

    // Account operations
    pub fn get_all_accounts(&self, include_deleted: bool) -> Result<Vec<PasswordAccount>> {
        let query = if include_deleted {
            "SELECT * FROM accounts ORDER BY updated_at DESC"
        } else {
            "SELECT * FROM accounts WHERE deleted = 0 ORDER BY updated_at DESC"
        };

        let mut stmt = self.conn.prepare(query)?;
        let accounts = stmt
            .query_map([], |row| self.row_to_account(row))?
            .collect::<Result<Vec<_>>>()?;

        Ok(accounts)
    }

    pub fn get_account_by_id(&self, account_id: &str) -> Result<Option<PasswordAccount>> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM accounts WHERE account_id = ?")?;
        let mut rows = stmt.query([account_id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(self.row_to_account(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn create_account(&self, account: &PasswordAccount) -> Result<()> {
        self.conn.execute(
            "INSERT INTO accounts (id, account_id, canonical_site, sites, username, password,
             totp_secret, recovery_codes, note, folder_id, created_at, updated_at, deleted)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                &account.id,
                &account.account_id,
                &account.canonical_site,
                serde_json::to_string(&account.sites).unwrap(),
                &account.username,
                &account.password,
                &account.totp_secret,
                &account.recovery_codes,
                &account.note,
                &account.folder_id,
                account.created_at,
                account.updated_at,
                if account.deleted { 1 } else { 0 }
            ],
        )?;
        Ok(())
    }

    pub fn update_account(&self, account: &PasswordAccount) -> Result<()> {
        self.conn.execute(
            "UPDATE accounts SET canonical_site = ?, sites = ?, username = ?, password = ?,
             totp_secret = ?, recovery_codes = ?, note = ?, folder_id = ?, updated_at = ?, deleted = ?
             WHERE account_id = ?",
            params![
                &account.canonical_site,
                serde_json::to_string(&account.sites).unwrap(),
                &account.username,
                &account.password,
                &account.totp_secret,
                &account.recovery_codes,
                &account.note,
                &account.folder_id,
                account.updated_at,
                if account.deleted { 1 } else { 0 },
                &account.account_id
            ],
        )?;
        Ok(())
    }

    pub fn delete_account(&self, account_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE accounts SET deleted = 1, updated_at = ? WHERE account_id = ?",
            params![now, account_id],
        )?;
        Ok(())
    }

    pub fn restore_account(&self, account_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE accounts SET deleted = 0, updated_at = ? WHERE account_id = ?",
            params![now, account_id],
        )?;
        Ok(())
    }

    pub fn permanently_delete_account(&self, account_id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM accounts WHERE account_id = ?", [account_id])?;
        Ok(())
    }

    pub fn search_accounts(&self, query: &str) -> Result<Vec<PasswordAccount>> {
        let search_pattern = format!("%{}%", query);
        let mut stmt = self.conn.prepare(
            "SELECT * FROM accounts WHERE deleted = 0 AND
             (username LIKE ?1 OR canonical_site LIKE ?1 OR sites LIKE ?1 OR note LIKE ?1)
             ORDER BY updated_at DESC",
        )?;

        let accounts = stmt
            .query_map([&search_pattern], |row| self.row_to_account(row))?
            .collect::<Result<Vec<_>>>()?;

        Ok(accounts)
    }

    fn row_to_account(&self, row: &rusqlite::Row) -> Result<PasswordAccount> {
        let sites_json: String = row.get(3)?;
        let sites: Vec<String> = serde_json::from_str(&sites_json).unwrap_or_default();

        Ok(PasswordAccount {
            id: row.get(0)?,
            account_id: row.get(1)?,
            canonical_site: row.get(2)?,
            sites,
            username: row.get(4)?,
            password: row.get(5)?,
            totp_secret: row.get(6)?,
            recovery_codes: row.get(7)?,
            note: row.get(8)?,
            folder_id: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
            deleted: row.get::<_, i32>(12)? != 0,
        })
    }

    // Folder operations
    pub fn get_all_folders(&self) -> Result<Vec<AccountFolder>> {
        let mut stmt = self.conn.prepare("SELECT * FROM folders ORDER BY name")?;
        let folders = stmt
            .query_map([], |row| self.row_to_folder(row))?
            .collect::<Result<Vec<_>>>()?;

        Ok(folders)
    }

    pub fn create_folder(&self, folder: &AccountFolder) -> Result<()> {
        self.conn.execute(
            "INSERT INTO folders (id, name, matched_sites, auto_add_matching) VALUES (?, ?, ?, ?)",
            params![
                &folder.id,
                &folder.name,
                serde_json::to_string(&folder.matched_sites).unwrap(),
                if folder.auto_add_matching { 1 } else { 0 }
            ],
        )?;
        Ok(())
    }

    pub fn update_folder(&self, folder: &AccountFolder) -> Result<()> {
        self.conn.execute(
            "UPDATE folders SET name = ?, matched_sites = ?, auto_add_matching = ? WHERE id = ?",
            params![
                &folder.name,
                serde_json::to_string(&folder.matched_sites).unwrap(),
                if folder.auto_add_matching { 1 } else { 0 },
                &folder.id
            ],
        )?;
        Ok(())
    }

    pub fn delete_folder(&self, folder_id: &str) -> Result<()> {
        // Remove folder reference from accounts
        self.conn.execute(
            "UPDATE accounts SET folder_id = NULL WHERE folder_id = ?",
            [folder_id],
        )?;
        self.conn
            .execute("DELETE FROM folders WHERE id = ?", [folder_id])?;
        Ok(())
    }

    fn row_to_folder(&self, row: &rusqlite::Row) -> Result<AccountFolder> {
        let matched_sites_json: String = row.get(2)?;
        let matched_sites: Vec<String> =
            serde_json::from_str(&matched_sites_json).unwrap_or_default();

        Ok(AccountFolder {
            id: row.get(0)?,
            name: row.get(1)?,
            matched_sites,
            auto_add_matching: row.get::<_, i32>(3)? != 0,
        })
    }

    // Config operations
    pub fn get_app_config(&self) -> Result<AppConfig> {
        let config_json: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM config WHERE key = 'app_config'",
                [],
                |row| row.get(0),
            )
            .ok();

        if let Some(json) = config_json {
            Ok(serde_json::from_str(&json).unwrap_or_default())
        } else {
            Ok(AppConfig::default())
        }
    }

    pub fn save_app_config(&self, config: &AppConfig) -> Result<()> {
        let json = serde_json::to_string(config).unwrap();
        self.conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('app_config', ?)",
            [json],
        )?;
        Ok(())
    }

    pub fn get_sync_config(&self) -> Result<Option<SyncConfig>> {
        let mut stmt = self.conn.prepare("SELECT * FROM sync_config WHERE id = 1")?;
        let mut rows = stmt.query([])?;

        if let Some(row) = rows.next()? {
            Ok(Some(SyncConfig {
                backend_type: row.get(1)?,
                server_url: row.get(2)?,
                username: row.get(3)?,
                password: row.get(4)?,
                bearer_token: row.get(5)?,
                auto_sync_enabled: row.get::<_, i32>(6)? != 0,
                auto_sync_interval_minutes: row.get::<_, i32>(7)? as u32,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_sync_config(&self, config: &SyncConfig) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO sync_config
             (id, backend_type, server_url, username, password, bearer_token,
              auto_sync_enabled, auto_sync_interval_minutes)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
            params![
                &config.backend_type,
                &config.server_url,
                &config.username,
                &config.password,
                &config.bearer_token,
                if config.auto_sync_enabled { 1 } else { 0 },
                config.auto_sync_interval_minutes as i32
            ],
        )?;
        Ok(())
    }
}
