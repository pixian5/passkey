use super::pipeline::SyncRetryContext;
use crate::local_vault;
use pass_merge::v2::SyncPayload;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const OUTBOX_FILE: &str = "sync_outbox.json";
const OUTBOX_CONTEXT: &str = "pass.tauri.sync_outbox.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutboxItem {
    pub source_key: String,
    pub payload: SyncPayload,
    pub payload_sha256: String,
    pub expected_etag: Option<String>,
    pub expected_revision: Option<i64>,
    pub idempotency_key: String,
    pub sync_session_id: String,
    pub operation_id: String,
    pub created_at_ms: i64,
    pub attempts: u32,
    pub next_retry_at_ms: i64,
    pub last_error: String,
}

fn path(data_dir: &Path) -> PathBuf {
    data_dir.join(OUTBOX_FILE)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

pub fn payload_sha256(payload: &SyncPayload) -> String {
    let bytes = serde_json::to_vec(payload).unwrap_or_default();
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn load(data_dir: &Path) -> Result<Vec<SyncOutboxItem>, String> {
    let Some(raw) = local_vault::read_text(data_dir, &path(data_dir), OUTBOX_CONTEXT)? else {
        return Ok(Vec::new());
    };
    serde_json::from_str(&raw).map_err(|error| format!("读取同步补偿队列失败: {error}"))
}

fn save(data_dir: &Path, items: &[SyncOutboxItem]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(items)
        .map_err(|error| format!("序列化同步补偿队列失败: {error}"))?;
    local_vault::write_text(data_dir, &path(data_dir), OUTBOX_CONTEXT, &raw)
}

pub fn matching_context(
    data_dir: &Path,
    source_key: &str,
    payload: &SyncPayload,
) -> Result<Option<SyncRetryContext>, String> {
    let hash = payload_sha256(payload);
    Ok(load(data_dir)?
        .into_iter()
        .find(|item| item.source_key == source_key && item.payload_sha256 == hash)
        .map(|item| SyncRetryContext {
            idempotency_key: item.idempotency_key,
            sync_session_id: item.sync_session_id,
            operation_id: item.operation_id,
        }))
}

pub fn new_context(_payload: &SyncPayload) -> SyncRetryContext {
    SyncRetryContext {
        idempotency_key: format!("pass-tauri-{}", Uuid::new_v4()),
        sync_session_id: format!("sync-{}", Uuid::new_v4()),
        operation_id: format!("op-{}", Uuid::new_v4()),
    }
}

pub fn record_failure(
    data_dir: &Path,
    source_key: &str,
    payload: &SyncPayload,
    context: &SyncRetryContext,
    expected_etag: Option<String>,
    expected_revision: Option<i64>,
    error: &str,
) -> Result<(), String> {
    let hash = payload_sha256(payload);
    let mut items = load(data_dir)?;
    let previous = items
        .iter()
        .find(|item| item.source_key == source_key && item.payload_sha256 == hash);
    let now = now_ms();
    let attempts = previous.map(|item| item.attempts + 1).unwrap_or(1).min(8);
    let item = SyncOutboxItem {
        source_key: source_key.to_string(),
        payload: payload.clone(),
        payload_sha256: hash,
        expected_etag: expected_etag
            .or_else(|| previous.and_then(|item| item.expected_etag.clone())),
        expected_revision: expected_revision
            .or_else(|| previous.and_then(|item| item.expected_revision)),
        idempotency_key: context.idempotency_key.clone(),
        sync_session_id: context.sync_session_id.clone(),
        operation_id: context.operation_id.clone(),
        created_at_ms: previous.map(|item| item.created_at_ms).unwrap_or(now),
        attempts,
        next_retry_at_ms: now
            + 5_000_i64.saturating_mul(1_i64 << attempts.saturating_sub(1).min(7)),
        last_error: error.to_string(),
    };
    items.retain(|old| old.source_key != source_key);
    items.push(item);
    save(data_dir, &items)
}

pub fn clear(data_dir: &Path, source_key: &str) -> Result<(), String> {
    let mut items = load(data_dir)?;
    let original = items.len();
    items.retain(|item| item.source_key != source_key);
    if items.len() != original {
        save(data_dir, &items)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn same_payload_reuses_context_and_changed_payload_gets_new_item() {
        let path = std::env::temp_dir().join(format!("pass-tauri-outbox-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        let payload = SyncPayload::default();
        let context = new_context(&payload);
        record_failure(
            &path,
            "server|https://sync",
            &payload,
            &context,
            None,
            None,
            "offline",
        )
        .unwrap();
        let loaded = matching_context(&path, "server|https://sync", &payload)
            .unwrap()
            .unwrap();
        assert_eq!(loaded.idempotency_key, context.idempotency_key);
        let mut changed = payload.clone();
        changed.accounts.push(Default::default());
        assert!(matching_context(&path, "server|https://sync", &changed)
            .unwrap()
            .is_none());
        let _ = fs::remove_dir_all(path);
    }
}
