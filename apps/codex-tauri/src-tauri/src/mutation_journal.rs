//! Encrypted write-ahead marker for SQLite mutations whose undo entry lives
//! in a separate encrypted file.  A marker survives crashes between the two
//! durable writes and lets `open_db` finish the undo history on next access.

use pass_merge::v2::SyncPayload;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::local_vault;

const FILE_NAME: &str = "pending_vault_mutation.json";
const CONTEXT: &str = "pass.tauri.pending_vault_mutation.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMutation {
    pub id: String,
    pub title: String,
    pub before: SyncPayload,
    #[serde(default)]
    pub action: PendingAction,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PendingAction {
    #[default]
    PushUndo,
    Undo {
        history_entry_id: String,
        after: SyncPayload,
    },
    Redo {
        history_entry_id: String,
        after: SyncPayload,
    },
}

fn path(data_dir: &Path) -> PathBuf {
    data_dir.join(FILE_NAME)
}

pub fn begin(data_dir: &Path, title: &str, before: SyncPayload) -> Result<PendingMutation, String> {
    begin_with_action(data_dir, title, before, PendingAction::PushUndo)
}

pub fn begin_undo(
    data_dir: &Path,
    title: &str,
    history_entry_id: String,
    before: SyncPayload,
    after: SyncPayload,
) -> Result<PendingMutation, String> {
    begin_with_action(
        data_dir,
        title,
        before,
        PendingAction::Undo {
            history_entry_id,
            after,
        },
    )
}

pub fn begin_redo(
    data_dir: &Path,
    title: &str,
    history_entry_id: String,
    before: SyncPayload,
    after: SyncPayload,
) -> Result<PendingMutation, String> {
    begin_with_action(
        data_dir,
        title,
        before,
        PendingAction::Redo {
            history_entry_id,
            after,
        },
    )
}

fn begin_with_action(
    data_dir: &Path,
    title: &str,
    before: SyncPayload,
    action: PendingAction,
) -> Result<PendingMutation, String> {
    if load(data_dir)?.is_some() {
        return Err("存在尚未恢复的本地写入，拒绝覆盖恢复日志".into());
    }
    let pending = PendingMutation {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        before,
        action,
    };
    let raw = serde_json::to_string(&pending)
        .map_err(|error| format!("序列化待完成写入失败: {error}"))?;
    local_vault::write_text(data_dir, &path(data_dir), CONTEXT, &raw)?;
    Ok(pending)
}

pub fn load(data_dir: &Path) -> Result<Option<PendingMutation>, String> {
    let Some(raw) = local_vault::read_text(data_dir, &path(data_dir), CONTEXT)? else {
        return Ok(None);
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|_| "待完成写入日志损坏，拒绝继续覆盖本地数据".to_string())
}

pub fn clear(data_dir: &Path) -> Result<(), String> {
    let file = path(data_dir);
    match fs::remove_file(&file) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("清理待完成写入日志失败: {error}")),
    }
    if let Some(parent) = file.parent() {
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("持久化待完成写入日志清理失败: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_mutation_is_encrypted_and_round_trips() {
        let root = std::env::temp_dir().join(format!("pass-mutation-journal-{}", Uuid::new_v4()));
        let before = SyncPayload {
            all_regular_order_updated_device_name: "journal-secret".into(),
            ..Default::default()
        };
        let pending = begin(&root, "测试写入", before.clone()).unwrap();
        let stored = fs::read_to_string(path(&root)).unwrap();
        assert!(!stored.contains("journal-secret"));
        let loaded = load(&root).unwrap().unwrap();
        assert_eq!(loaded.id, pending.id);
        assert_eq!(loaded.before, before);
        assert!(matches!(loaded.action, PendingAction::PushUndo));
        clear(&root).unwrap();
        assert!(load(&root).unwrap().is_none());
        let _ = fs::remove_dir_all(root);
    }
}
