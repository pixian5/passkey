// Pass - Cross-platform Password Manager (Tauri)
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

mod commands;
mod database;
mod models;
mod sync;
mod totp;
mod crypto;

use database::Database;

pub struct AppState {
    db: Mutex<Option<Database>>,
    master_password_hash: Mutex<Option<String>>,
    locked: Mutex<bool>,
}

// Data models matching the macOS app structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordAccount {
    pub id: String,
    pub account_id: String,
    pub canonical_site: String,
    pub sites: Vec<String>,
    pub username: String,
    pub password: String,
    pub totp_secret: Option<String>,
    pub recovery_codes: Option<String>,
    pub note: Option<String>,
    pub folder_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountFolder {
    pub id: String,
    pub name: String,
    pub matched_sites: Vec<String>,
    pub auto_add_matching: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub backend_type: String, // "webdav" or "self-hosted"
    pub server_url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub bearer_token: Option<String>,
    pub auto_sync_enabled: bool,
    pub auto_sync_interval_minutes: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppConfig {
    pub device_name: String,
    pub lock_policy: String,
    pub idle_timeout_minutes: u32,
    pub font_family: String,
    pub text_font_size: u32,
    pub button_font_size: u32,
    pub toast_duration_seconds: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            device_name: hostname::get()
                .ok()
                .and_then(|h| h.into_string().ok())
                .unwrap_or_else(|| "Unknown Device".to_string()),
            lock_policy: "idle_timeout".to_string(),
            idle_timeout_minutes: 5,
            font_family: "system".to_string(),
            text_font_size: 14,
            button_font_size: 14,
            toast_duration_seconds: 3,
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            db: Mutex::new(None),
            master_password_hash: Mutex::new(None),
            locked: Mutex::new(true),
        })
        .invoke_handler(tauri::generate_handler![
            commands::initialize_database,
            commands::unlock_app,
            commands::lock_app,
            commands::is_locked,
            commands::get_all_accounts,
            commands::get_account_by_id,
            commands::create_account,
            commands::update_account,
            commands::delete_account,
            commands::restore_account,
            commands::permanently_delete_account,
            commands::search_accounts,
            commands::get_folders,
            commands::create_folder,
            commands::update_folder,
            commands::delete_folder,
            commands::generate_totp_code,
            commands::export_to_csv,
            commands::import_from_csv,
            commands::sync_with_server,
            commands::get_sync_config,
            commands::save_sync_config,
            commands::get_app_config,
            commands::save_app_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
