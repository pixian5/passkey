use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => SyncSettings::default(),
    }
}

pub fn save_sync_settings(data_dir: &PathBuf, settings: &SyncSettings) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let path = settings_path(data_dir);
    let raw = serde_json::to_string_pretty(settings).map_err(|e| format!("序列化同步设置失败: {e}"))?;
    std::fs::write(&path, raw).map_err(|e| format!("写入同步设置失败: {e}"))?;
    // Best-effort restrictive perms on Unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}
