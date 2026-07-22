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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct HistoryFile {
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
}

fn path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join(HISTORY_FILE)
}

fn load(data_dir: &PathBuf) -> HistoryFile {
    let raw = local_vault::read_text(data_dir, &path(data_dir), HISTORY_SCOPE)
        .ok()
        .flatten()
        .unwrap_or_default();
    if raw.trim_start().starts_with('[') {
        return HistoryFile {
            undo: serde_json::from_str(&raw).unwrap_or_default(),
            redo: Vec::new(),
        };
    }
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save(data_dir: &PathBuf, file: &HistoryFile) -> Result<(), String> {
    let raw = serde_json::to_string(file).map_err(|e| format!("序列化操作历史失败: {e}"))?;
    local_vault::write_text(data_dir, &path(data_dir), HISTORY_SCOPE, &raw)
}

pub fn push(
    data_dir: &PathBuf,
    title: impl Into<String>,
    payload: SyncPayload,
) -> Result<(), String> {
    let mut file = load(data_dir);
    file.undo.push(HistoryEntry {
        id: Uuid::new_v4().to_string(),
        created_at_ms: Utc::now().timestamp_millis(),
        title: title.into(),
        payload,
    });
    file.redo.clear();
    if file.undo.len() > MAX_ENTRIES {
        file.undo.drain(..file.undo.len() - MAX_ENTRIES);
    }
    save(data_dir, &file)
}

pub fn undo_entries(data_dir: &PathBuf) -> Vec<HistoryEntry> {
    load(data_dir).undo
}

pub fn redo_entries(data_dir: &PathBuf) -> Vec<HistoryEntry> {
    load(data_dir).redo
}

pub fn latest_undo(data_dir: &PathBuf) -> Option<HistoryEntry> {
    load(data_dir).undo.last().cloned()
}

pub fn latest_redo(data_dir: &PathBuf) -> Option<HistoryEntry> {
    load(data_dir).redo.last().cloned()
}

pub fn move_undo_to_redo(
    data_dir: &PathBuf,
    id: &str,
    current_payload: SyncPayload,
) -> Result<(), String> {
    let mut file = load(data_dir);
    if file.undo.last().map(|entry| entry.id.as_str()) == Some(id) {
        let entry = file.undo.pop().expect("history entry exists");
        file.redo.push(HistoryEntry {
            payload: current_payload,
            ..entry
        });
        save(data_dir, &file)?;
    }
    Ok(())
}

pub fn move_redo_to_undo(
    data_dir: &PathBuf,
    id: &str,
    current_payload: SyncPayload,
) -> Result<(), String> {
    let mut file = load(data_dir);
    if file.redo.last().map(|entry| entry.id.as_str()) == Some(id) {
        let entry = file.redo.pop().expect("history entry exists");
        file.undo.push(HistoryEntry {
            payload: current_payload,
            ..entry
        });
        if file.undo.len() > MAX_ENTRIES {
            file.undo.drain(..file.undo.len() - MAX_ENTRIES);
        }
        save(data_dir, &file)?;
    }
    Ok(())
}
