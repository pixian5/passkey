//! Small, encrypted undo journal for local vault mutations.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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

fn path(data_dir: &Path) -> PathBuf {
    data_dir.join(HISTORY_FILE)
}

fn load(data_dir: &Path) -> Result<HistoryFile, String> {
    let raw = local_vault::read_text(data_dir, &path(data_dir), HISTORY_SCOPE)?.unwrap_or_default();
    if raw.is_empty() {
        return Ok(HistoryFile::default());
    }
    if raw.trim_start().starts_with('[') {
        return Ok(HistoryFile {
            undo: serde_json::from_str(&raw).map_err(|e| format!("解析旧版操作历史失败: {e}"))?,
            redo: Vec::new(),
        });
    }
    serde_json::from_str(&raw).map_err(|e| format!("解析操作历史失败: {e}"))
}

fn save(data_dir: &Path, file: &HistoryFile) -> Result<(), String> {
    let raw = serde_json::to_string(file).map_err(|e| format!("序列化操作历史失败: {e}"))?;
    local_vault::write_text(data_dir, &path(data_dir), HISTORY_SCOPE, &raw)
}

pub fn push(data_dir: &Path, title: impl Into<String>, payload: SyncPayload) -> Result<(), String> {
    push_with_id(data_dir, Uuid::new_v4().to_string(), title, payload)
}

pub fn push_with_id(
    data_dir: &Path,
    id: String,
    title: impl Into<String>,
    payload: SyncPayload,
) -> Result<(), String> {
    let mut file = load(data_dir)?;
    if file.undo.iter().any(|entry| entry.id == id) || file.redo.iter().any(|entry| entry.id == id)
    {
        return Ok(());
    }
    file.undo.push(HistoryEntry {
        id,
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

pub fn undo_entries(data_dir: &Path) -> Result<Vec<HistoryEntry>, String> {
    Ok(load(data_dir)?.undo)
}

pub fn redo_entries(data_dir: &Path) -> Result<Vec<HistoryEntry>, String> {
    Ok(load(data_dir)?.redo)
}

pub fn latest_distinct_undo(
    data_dir: &Path,
    current_payload: &SyncPayload,
) -> Result<Option<HistoryEntry>, String> {
    let mut file = load(data_dir)?;
    let original_len = file.undo.len();
    while file
        .undo
        .last()
        .is_some_and(|entry| entry.payload == *current_payload)
    {
        file.undo.pop();
    }
    if file.undo.len() != original_len {
        save(data_dir, &file)?;
    }
    Ok(file.undo.last().cloned())
}

pub fn latest_redo(data_dir: &Path) -> Result<Option<HistoryEntry>, String> {
    Ok(load(data_dir)?.redo.last().cloned())
}

pub fn move_undo_to_redo(
    data_dir: &Path,
    id: &str,
    current_payload: SyncPayload,
) -> Result<(), String> {
    let mut file = load(data_dir)?;
    if file.redo.iter().any(|entry| entry.id == id) {
        return Ok(());
    }
    if file.undo.last().map(|entry| entry.id.as_str()) == Some(id) {
        let entry = file.undo.pop().expect("history entry exists");
        file.redo.push(HistoryEntry {
            payload: current_payload,
            ..entry
        });
        return save(data_dir, &file);
    }
    Err("撤销历史状态与待恢复操作不一致".into())
}

pub fn move_redo_to_undo(
    data_dir: &Path,
    id: &str,
    current_payload: SyncPayload,
) -> Result<(), String> {
    let mut file = load(data_dir)?;
    if file.undo.iter().any(|entry| entry.id == id) {
        return Ok(());
    }
    if file.redo.last().map(|entry| entry.id.as_str()) == Some(id) {
        let entry = file.redo.pop().expect("history entry exists");
        file.undo.push(HistoryEntry {
            payload: current_payload,
            ..entry
        });
        if file.undo.len() > MAX_ENTRIES {
            file.undo.drain(..file.undo.len() - MAX_ENTRIES);
        }
        return save(data_dir, &file);
    }
    Err("重做历史状态与待恢复操作不一致".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use pass_merge::v2::SyncPayload;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn latest_distinct_undo_skips_no_op_entries() {
        let dir = std::env::temp_dir().join(format!("pass-history-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let current = SyncPayload::default();
        let older = SyncPayload {
            all_regular_order_updated_at_ms: 7,
            ..Default::default()
        };
        push(&dir, "真实修改", older.clone()).unwrap();
        push(&dir, "失败操作残留", current.clone()).unwrap();
        let entry = latest_distinct_undo(&dir, &current)
            .unwrap()
            .expect("should keep real change");
        assert_eq!(entry.title, "真实修改");
        assert_eq!(entry.payload, older);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn recovered_entry_id_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("pass-history-id-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        push_with_id(&dir, "fixed-id".into(), "恢复写入", SyncPayload::default()).unwrap();
        push_with_id(&dir, "fixed-id".into(), "恢复写入", SyncPayload::default()).unwrap();
        assert_eq!(undo_entries(&dir).unwrap().len(), 1);
        let _ = fs::remove_dir_all(dir);
    }
}
