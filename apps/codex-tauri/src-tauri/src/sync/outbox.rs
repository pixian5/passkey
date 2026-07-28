use super::pipeline::SyncRetryContext;
use crate::local_vault;
use pass_merge::v2::SyncPayload;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const OUTBOX_FILE: &str = "sync_outbox.json";
const OUTBOX_CONTEXT: &str = "pass.tauri.sync_outbox.v1";
const MAX_ATTEMPTS: u32 = 12;
const BASE_DELAY_MS: i64 = 5_000;
const MAX_DELAY_MS: i64 = 60 * 60 * 1_000;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutboxSummary {
    pub source_key: String,
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

fn canonical_url(raw: &str) -> Option<String> {
    let mut url = url::Url::parse(raw.trim()).ok()?;
    let default_port = match url.scheme() {
        "https" => Some(443),
        "http" => Some(80),
        _ => None,
    };
    if url.port().is_some() && url.port() == default_port {
        let _ = url.set_port(None);
    }
    let normalized = url.to_string();
    Some(normalized.trim_end_matches('/').to_string())
}

pub fn source_key(kind: &str, resource_url: &str) -> Result<String, String> {
    let kind = kind.trim();
    let url = canonical_url(resource_url).ok_or_else(|| "同步目标 URL 无效".to_string())?;
    if kind.is_empty() || url.is_empty() {
        return Err("同步目标无效".into());
    }
    Ok(format!("{kind}|{url}"))
}

fn normalize_source_key(value: &str) -> String {
    let Some((kind, resource_url)) = value.split_once('|') else {
        return value.trim().to_string();
    };
    source_key(kind, resource_url).unwrap_or_else(|_| value.trim().to_string())
}

fn normalize_items(items: Vec<SyncOutboxItem>) -> Vec<SyncOutboxItem> {
    let mut normalized = Vec::<SyncOutboxItem>::new();
    for mut item in items {
        item.source_key = normalize_source_key(&item.source_key);
        if let Some(index) = normalized
            .iter()
            .position(|existing| existing.source_key == item.source_key)
        {
            if normalized[index].created_at_ms <= item.created_at_ms {
                normalized[index] = item;
            }
        } else {
            normalized.push(item);
        }
    }
    normalized.sort_by_key(|item| (item.next_retry_at_ms, item.source_key.clone()));
    normalized
}

pub fn load(data_dir: &Path) -> Result<Vec<SyncOutboxItem>, String> {
    let Some(raw) = local_vault::read_text(data_dir, &path(data_dir), OUTBOX_CONTEXT)? else {
        return Ok(Vec::new());
    };
    serde_json::from_str(&raw)
        .map(normalize_items)
        .map_err(|error| format!("读取同步补偿队列失败: {error}"))
}

fn save(data_dir: &Path, items: &[SyncOutboxItem]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(items)
        .map_err(|error| format!("序列化同步补偿队列失败: {error}"))?;
    local_vault::write_text(data_dir, &path(data_dir), OUTBOX_CONTEXT, &raw)
}

pub fn retry_context(item: &SyncOutboxItem) -> SyncRetryContext {
    SyncRetryContext {
        idempotency_key: item.idempotency_key.clone(),
        sync_session_id: item.sync_session_id.clone(),
        operation_id: item.operation_id.clone(),
    }
}

pub fn matching_item(
    data_dir: &Path,
    source_key: &str,
    payload: &SyncPayload,
) -> Result<Option<SyncOutboxItem>, String> {
    let hash = payload_sha256(payload);
    let source_key = normalize_source_key(source_key);
    Ok(load(data_dir)?
        .into_iter()
        .find(|item| item.source_key == source_key && item.payload_sha256 == hash))
}

pub fn is_ready(item: &SyncOutboxItem, force: bool) -> bool {
    force || item.next_retry_at_ms <= now_ms()
}

pub fn wait_seconds(item: &SyncOutboxItem) -> i64 {
    item.next_retry_at_ms
        .saturating_sub(now_ms())
        .saturating_add(999)
        / 1_000
}

pub fn summaries(data_dir: &Path) -> Result<Vec<SyncOutboxSummary>, String> {
    Ok(load(data_dir)?
        .into_iter()
        .map(|item| SyncOutboxSummary {
            source_key: item.source_key,
            created_at_ms: item.created_at_ms,
            attempts: item.attempts,
            next_retry_at_ms: item.next_retry_at_ms,
            last_error: item.last_error,
        })
        .collect())
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
    let source_key = normalize_source_key(source_key);
    let mut items = load(data_dir)?;
    let previous = items
        .iter()
        .find(|item| item.source_key == source_key && item.payload_sha256 == hash);
    let now = now_ms();
    let attempts = previous
        .map(|item| item.attempts + 1)
        .unwrap_or(1)
        .min(MAX_ATTEMPTS);
    let exponent = attempts.saturating_sub(1).min(8);
    let delay_ms = BASE_DELAY_MS
        .saturating_mul(1_i64 << exponent)
        .min(MAX_DELAY_MS);
    let item = SyncOutboxItem {
        source_key: source_key.clone(),
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
        next_retry_at_ms: now.saturating_add(delay_ms),
        last_error: error.to_string(),
    };
    items.retain(|old| old.source_key != source_key);
    items.push(item);
    save(data_dir, &items)
}

pub fn clear(data_dir: &Path, source_key: &str) -> Result<(), String> {
    let source_key = normalize_source_key(source_key);
    let mut items = load(data_dir)?;
    let original = items.len();
    items.retain(|item| item.source_key != source_key);
    if items.len() != original {
        save(data_dir, &items)?;
    }
    Ok(())
}

pub fn remove_inactive(data_dir: &Path, active_source_keys: &[String]) -> Result<usize, String> {
    let active = active_source_keys
        .iter()
        .map(|value| normalize_source_key(value))
        .collect::<BTreeSet<_>>();
    let mut items = load(data_dir)?;
    let original = items.len();
    items.retain(|item| active.contains(&item.source_key));
    let removed = original.saturating_sub(items.len());
    if removed > 0 {
        save(data_dir, &items)?;
    }
    Ok(removed)
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
        let loaded = matching_item(&path, "server|https://sync", &payload)
            .unwrap()
            .unwrap();
        assert_eq!(
            retry_context(&loaded).idempotency_key,
            context.idempotency_key
        );
        let mut changed = payload.clone();
        changed.accounts.push(Default::default());
        assert!(matching_item(&path, "server|https://sync", &changed)
            .unwrap()
            .is_none());
        let _ = fs::remove_dir_all(path);
    }

    #[test]
    fn source_keys_are_canonical_and_backoff_matches_shared_policy() {
        assert_eq!(
            source_key("server", "https://SYNC.example:443/").unwrap(),
            "server|https://sync.example"
        );
        let path = std::env::temp_dir().join(format!("pass-tauri-outbox-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        let payload = SyncPayload::default();
        let context = new_context(&payload);
        for _ in 0..MAX_ATTEMPTS {
            record_failure(
                &path,
                "server|https://sync.example/",
                &payload,
                &context,
                None,
                None,
                "offline",
            )
            .unwrap();
        }
        let item = matching_item(&path, "server|https://sync.example", &payload)
            .unwrap()
            .unwrap();
        assert_eq!(item.attempts, MAX_ATTEMPTS);
        assert!(item.next_retry_at_ms - now_ms() <= 1_280_000);
        assert!(item.next_retry_at_ms - now_ms() >= 1_275_000);
        let _ = fs::remove_dir_all(path);
    }
}
