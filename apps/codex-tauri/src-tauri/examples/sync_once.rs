//! One-shot sync harness: same pipeline as the Tauri app (`run_sync`).
//!
//! ```bash
//! cd apps/codex-tauri/src-tauri
//! cargo run --example sync_once --release
//! ```
//!
//! Reads settings + vault under:
//!   ~/Library/Application Support/com.pixian5.pass.codextauri/

use rusqlite::{params, Connection};
use std::path::PathBuf;

#[path = "../src/local_vault.rs"]
mod local_vault;
#[path = "../src/sync/mod.rs"]
mod sync;

use pass_merge::v2::{Folder, Passkey, PasswordAccount};
use sync::pipeline::{local_payload_from_vault, run_sync};
use sync::settings::load_sync_settings;

fn data_dir() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME");
    PathBuf::from(home).join("Library/Application Support/com.pixian5.pass.codextauri")
}

fn open_db(dir: &PathBuf) -> Connection {
    std::fs::create_dir_all(dir).ok();
    let conn = Connection::open(dir.join("pass-tauri.db")).expect("open db");
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS kv (
           key TEXT PRIMARY KEY NOT NULL,
           value TEXT NOT NULL
         );",
    )
    .expect("init");
    conn
}

fn read_kv(conn: &Connection, data_dir: &PathBuf, key: &str) -> Option<String> {
    let stored: String = conn
        .query_row("SELECT value FROM kv WHERE key = ?1", params![key], |row| {
            row.get(0)
        })
        .ok()?;
    match local_vault::decrypt_text(data_dir, "pass.tauri.sqlite.kv.v1", &stored).ok()? {
        Some(value) => Some(value),
        None => Some(stored),
    }
}

fn write_kv(conn: &Connection, data_dir: &PathBuf, key: &str, value: &str) {
    let encrypted =
        local_vault::encrypt_text(data_dir, "pass.tauri.sqlite.kv.v1", value).expect("encrypt kv");
    conn.execute(
        "INSERT INTO kv(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, encrypted],
    )
    .expect("write kv");
}

fn load_json_vec<T: serde::de::DeserializeOwned>(
    conn: &Connection,
    data_dir: &PathBuf,
    key: &str,
) -> Vec<T> {
    match read_kv(conn, data_dir, key) {
        Some(raw) if !raw.trim().is_empty() && raw.trim() != "null" => serde_json::from_str(&raw)
            .unwrap_or_else(|e| {
                eprintln!("warn: parse {key}: {e}");
                vec![]
            }),
        _ => vec![],
    }
}

fn main() {
    let dir = data_dir();
    let settings = load_sync_settings(&dir);
    eprintln!(
        "settings enabled={} baseUrl={} token_len={} enc_len={} mode={}",
        settings.enabled,
        settings.base_url,
        settings.auth_token.len(),
        settings.encryption_key.len(),
        settings.mode
    );
    if !settings.enabled {
        eprintln!("sync disabled");
        std::process::exit(2);
    }
    if settings.auth_token.trim().is_empty() {
        eprintln!("auth token empty");
        std::process::exit(2);
    }

    let conn = open_db(&dir);
    let device =
        read_kv(&conn, &dir, "settings.device_name").unwrap_or_else(|| "CodexDesktop".into());
    let accounts: Vec<PasswordAccount> = load_json_vec(&conn, &dir, "accounts.v2");
    let folders: Vec<Folder> = load_json_vec(&conn, &dir, "folders.v1");
    let passkeys: Vec<Passkey> = load_json_vec(&conn, &dir, "passkeys.v1");
    eprintln!(
        "local before: accounts={} folders={} passkeys={} device={}",
        accounts.len(),
        folders.len(),
        passkeys.len(),
        device
    );

    let local = local_payload_from_vault(&accounts, &folders, &passkeys, &device);
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };

    match run_sync(&settings, local, &device, platform) {
        Ok((report, applied)) => {
            eprintln!(
                "report ok={} applied={} pushed={} msg={} local={} remote={} merged={}",
                report.ok,
                report.applied,
                report.pushed,
                report.message,
                report.local_accounts,
                report.remote_accounts,
                report.merged_accounts
            );
            if report.applied {
                write_kv(
                    &conn,
                    &dir,
                    "accounts.v2",
                    &serde_json::to_string(&applied.accounts).expect("ser accounts"),
                );
                write_kv(
                    &conn,
                    &dir,
                    "folders.v1",
                    &serde_json::to_string(&applied.folders).expect("ser folders"),
                );
                write_kv(
                    &conn,
                    &dir,
                    "passkeys.v1",
                    &serde_json::to_string(&applied.passkeys).expect("ser passkeys"),
                );
                let active = applied
                    .accounts
                    .iter()
                    .filter(|a| !a.is_deleted && !a.is_permanently_deleted)
                    .count();
                eprintln!(
                    "TAURI_SYNC_OK accounts={} active={} folders={} passkeys={}",
                    applied.accounts.len(),
                    active,
                    applied.folders.len(),
                    applied.passkeys.len()
                );
            } else {
                eprintln!("not applied; reasons={:?}", report.reasons);
                std::process::exit(3);
            }
        }
        Err(e) => {
            eprintln!("sync error: {e}");
            std::process::exit(1);
        }
    }
}
