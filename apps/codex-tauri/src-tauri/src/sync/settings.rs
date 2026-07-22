use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::local_vault;

const SETTINGS_FILE: &str = "sync_settings.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub base_url: String,
    /// Bearer token; never log this value.
    #[serde(default)]
    pub auth_token: String,
    /// Optional base64url 32-byte AES key; empty = plaintext bundle.
    #[serde(default)]
    pub encryption_key: String,
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_mode() -> String {
    "merge".into()
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: String::new(),
            auth_token: String::new(),
            encryption_key: String::new(),
            mode: default_mode(),
        }
    }
}

pub fn settings_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join(SETTINGS_FILE)
}

pub fn load_sync_settings(data_dir: &PathBuf) -> SyncSettings {
    let path = settings_path(data_dir);
    local_vault::read_text(data_dir, &path, "pass.tauri.sync_settings.v1")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_sync_settings(data_dir: &PathBuf, settings: &SyncSettings) -> Result<(), String> {
    let path = settings_path(data_dir);
    let raw =
        serde_json::to_string_pretty(settings).map_err(|e| format!("序列化同步设置失败: {e}"))?;
    local_vault::write_text(data_dir, &path, "pass.tauri.sync_settings.v1", &raw)
}
