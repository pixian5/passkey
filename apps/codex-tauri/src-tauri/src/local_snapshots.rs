//! Encrypted local recovery snapshots made before a sync-driven vault replacement.

use chrono::Utc;
use pass_merge::v2::SyncPayload;
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

use crate::local_vault;

const SNAPSHOTS_FILE: &str = "local_sync_snapshots.json";
const SNAPSHOTS_CONTEXT: &str = "pass.tauri.local_sync_snapshots.v1";
const MAX_SNAPSHOTS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSnapshot {
    id: String,
    created_at_ms: i64,
    reason: String,
    payload: SyncPayload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSnapshotSummary {
    pub id: String,
    pub created_at_ms: i64,
    pub reason: String,
    pub accounts: usize,
    pub folders: usize,
    pub passkeys: usize,
}

fn path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join(SNAPSHOTS_FILE)
}

fn load(data_dir: &Path) -> Result<Vec<LocalSnapshot>, String> {
    let Some(raw) = local_vault::read_text(data_dir, &path(data_dir), SNAPSHOTS_CONTEXT)? else {
        return Ok(vec![]);
    };
    serde_json::from_str(&raw).map_err(|_| "本地安全快照损坏，未覆盖现有 vault".to_string())
}

fn save(data_dir: &Path, snapshots: &[LocalSnapshot]) -> Result<(), String> {
    let raw = serde_json::to_string(snapshots).map_err(|e| format!("序列化本地安全快照失败: {e}"))?;
    local_vault::write_text(data_dir, &path(data_dir), SNAPSHOTS_CONTEXT, &raw)
}

pub fn create(data_dir: &Path, payload: &SyncPayload, reason: &str) -> Result<(), String> {
    let mut snapshots = load(data_dir)?;
    snapshots.push(LocalSnapshot {
        id: Uuid::new_v4().to_string(),
        created_at_ms: Utc::now().timestamp_millis(),
        reason: reason.to_string(),
        payload: payload.clone(),
    });
    snapshots.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    snapshots.truncate(MAX_SNAPSHOTS);
    save(data_dir, &snapshots)
}

pub fn list(data_dir: &Path) -> Result<Vec<LocalSnapshotSummary>, String> {
    let mut snapshots = load(data_dir)?;
    snapshots.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    Ok(snapshots
        .into_iter()
        .map(|snapshot| LocalSnapshotSummary {
            id: snapshot.id,
            created_at_ms: snapshot.created_at_ms,
            reason: snapshot.reason,
            accounts: snapshot.payload.accounts.len(),
            folders: snapshot.payload.folders.len(),
            passkeys: snapshot.payload.passkeys.len(),
        })
        .collect())
}

pub fn get(data_dir: &Path, id: &str) -> Result<SyncPayload, String> {
    load(data_dir)?
        .into_iter()
        .find(|snapshot| snapshot.id == id)
        .map(|snapshot| snapshot.payload)
        .ok_or_else(|| "未找到本地安全快照".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_newest_twenty_encrypted_snapshots() {
        let root = std::env::temp_dir().join(format!("pass-tauri-snapshot-test-{}", Uuid::new_v4()));
        for index in 0..22 {
            create(&root, &SyncPayload::default(), &format!("snapshot-{index}")).unwrap();
        }
        let summaries = list(&root).unwrap();
        assert_eq!(summaries.len(), MAX_SNAPSHOTS);
        assert!(get(&root, &summaries[0].id).is_ok());
        let _ = std::fs::remove_dir_all(root);
    }
}
