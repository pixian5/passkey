//! Small, encrypted undo journal for local vault mutations.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

use pass_merge::v2::SyncPayload;

use crate::local_vault;

const HISTORY_FILE: &str = "operation_history.json";
const HISTORY_SCOPE: &str = "pass.tauri.operation_history.v1";
const MAX_ENTRIES: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub created_at_ms: i64,
    pub title: String,
    pub payload: SyncPayload,
}

fn path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join(HISTORY_FILE)
}

fn load(data_dir: &PathBuf) -> Vec<HistoryEntry> {
    local_vault::read_text(data_dir, &path(data_dir), HISTORY_SCOPE)
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(data_dir: &PathBuf, entries: &[HistoryEntry]) -> Result<(), String> {
    let raw = serde_json::to_string(entries).map_err(|e| format!("序列化操作历史失败: {e}"))?;
    local_vault::write_text(data_dir, &path(data_dir), HISTORY_SCOPE, &raw)
}

pub fn push(
    data_dir: &PathBuf,
    title: impl Into<String>,
    payload: SyncPayload,
) -> Result<(), String> {
    let mut entries = load(data_dir);
    entries.push(HistoryEntry {
        id: Uuid::new_v4().to_string(),
        created_at_ms: Utc::now().timestamp_millis(),
        title: title.into(),
        payload,
    });
    if entries.len() > MAX_ENTRIES {
        entries.drain(..entries.len() - MAX_ENTRIES);
    }
    save(data_dir, &entries)
}

pub fn latest(data_dir: &PathBuf) -> Option<HistoryEntry> {
    load(data_dir).pop()
}

pub fn remove_latest(data_dir: &PathBuf, id: &str) -> Result<(), String> {
    let mut entries = load(data_dir);
    if entries.last().map(|entry| entry.id.as_str()) == Some(id) {
        entries.pop();
        save(data_dir, &entries)?;
    }
    Ok(())
}
