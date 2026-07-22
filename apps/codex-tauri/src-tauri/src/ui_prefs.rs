//! UI preferences persisted under app data dir (parity with PassMac Settings).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::local_vault;

const PREFS_FILE: &str = "ui_prefs.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefs {
    #[serde(default = "default_font")]
    pub font_family: String,
    #[serde(default = "default_text_size")]
    pub text_font_size: f64,
    #[serde(default = "default_button_size")]
    pub button_font_size: f64,
    #[serde(default = "default_toast")]
    pub toast_duration_seconds: f64,
    #[serde(default)]
    pub show_passwords_globally: bool,
    #[serde(default)]
    pub export_directory: String,
    #[serde(default = "default_auto_sync")]
    pub auto_sync_interval_minutes: i32,
    #[serde(default)]
    pub previous_encryption_key: String,
    #[serde(default)]
    pub webdav_enabled: bool,
    #[serde(default)]
    pub webdav_base_url: String,
    #[serde(default = "default_webdav_path")]
    pub webdav_remote_path: String,
    #[serde(default)]
    pub webdav_username: String,
    #[serde(default)]
    pub webdav_password: String,
    /// The source that decides merge / overwrite semantics; other enabled
    /// sources receive a local-overwrite mirror after it completes.
    #[serde(default = "default_sync_primary_source")]
    pub sync_primary_source: String,
    /// Manual folder sidebar order (folder ids). Missing folders append at end.
    #[serde(default)]
    pub folder_order: Vec<String>,
}

fn default_font() -> String {
    "系统默认".into()
}
fn default_text_size() -> f64 {
    14.0
}
fn default_button_size() -> f64 {
    13.0
}
fn default_toast() -> f64 {
    2.5
}
fn default_auto_sync() -> i32 {
    0
}
fn default_webdav_path() -> String {
    "pass-sync-bundle-v2.json".into()
}
fn default_sync_primary_source() -> String {
    "selfHosted".into()
}

impl Default for UiPrefs {
    fn default() -> Self {
        Self {
            font_family: default_font(),
            text_font_size: default_text_size(),
            button_font_size: default_button_size(),
            toast_duration_seconds: default_toast(),
            show_passwords_globally: false,
            export_directory: String::new(),
            auto_sync_interval_minutes: default_auto_sync(),
            previous_encryption_key: String::new(),
            webdav_enabled: false,
            webdav_base_url: String::new(),
            webdav_remote_path: default_webdav_path(),
            webdav_username: String::new(),
            webdav_password: String::new(),
            sync_primary_source: default_sync_primary_source(),
            folder_order: Vec::new(),
        }
    }
}

pub fn prefs_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join(PREFS_FILE)
}

pub fn load_ui_prefs(data_dir: &PathBuf) -> UiPrefs {
    let path = prefs_path(data_dir);
    local_vault::read_text(data_dir, &path, "pass.tauri.ui_prefs.v1")
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_ui_prefs(data_dir: &PathBuf, prefs: &UiPrefs) -> Result<(), String> {
    let path = prefs_path(data_dir);
    let raw =
        serde_json::to_string_pretty(prefs).map_err(|e| format!("序列化界面设置失败: {e}"))?;
    local_vault::write_text(data_dir, &path, "pass.tauri.ui_prefs.v1", &raw)
}
