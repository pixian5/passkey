//! Encrypted draft values for the self-hosted service provisioning form.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::local_vault;

const FILE_NAME: &str = "provision_draft.json";
const SCOPE: &str = "pass.tauri.provision_draft.v1";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionDraft {
    #[serde(default)]
    pub server_url: String,
    #[serde(default)]
    pub tls_certificate: String,
    #[serde(default)]
    pub tls_private_key: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub sync_encryption_key: String,
}

fn path(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE_NAME)
}

pub fn load(data_dir: &Path) -> ProvisionDraft {
    local_vault::read_text(data_dir, &path(data_dir), SCOPE)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(data_dir: &Path, draft: &ProvisionDraft) -> Result<(), String> {
    let raw = serde_json::to_string(draft).map_err(|e| format!("序列化创建服务草稿失败: {e}"))?;
    local_vault::write_text(data_dir, &path(data_dir), SCOPE, &raw)
}
