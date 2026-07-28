use super::crypto::{decrypt_wire_body_with_fallback, encrypt_bundle_document, PLAINTEXT_SCHEMA};
use super::http::{get_sync_state, put_sync_state};
use super::settings::SyncSettings;
use chrono::Utc;
use pass_merge::v2::{
    evaluate_sync_safety, merge_sync_payloads, sync_alias_groups, SyncOperationReport, SyncPayload,
};
use serde_json::{json, Value};
use uuid::Uuid;

const MAX_CONFLICT_RETRIES: u32 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncMode {
    Merge,
    RemoteOverwriteLocal,
    LocalOverwriteRemote,
}

impl SyncMode {
    pub fn parse(raw: &str) -> Self {
        match raw.trim() {
            "remoteOverwriteLocal" => Self::RemoteOverwriteLocal,
            "localOverwriteRemote" => Self::LocalOverwriteRemote,
            _ => Self::Merge,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::RemoteOverwriteLocal => "remoteOverwriteLocal",
            Self::LocalOverwriteRemote => "localOverwriteRemote",
        }
    }

    pub fn safety_mode(self) -> &'static str {
        self.as_str()
    }
}

pub type SyncReport = SyncOperationReport;

#[derive(Debug, Clone, Default)]
pub struct SyncRetryContext {
    pub idempotency_key: String,
    pub sync_session_id: String,
    pub operation_id: String,
}

fn new_trace_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4())
}

fn classify_sync_error(error: &str) -> (&'static str, bool) {
    let text = error.to_ascii_uppercase();
    if text.contains("PRECONDITION_FAILED")
        || text.contains("HTTP 412")
        || text.contains("HTTP 428")
    {
        ("ETAG_CONFLICT", true)
    } else if text.contains("HTTP 429") || text.contains("RATE_LIMIT") {
        ("RATE_LIMITED", true)
    } else if text.contains("HTTP 503") || text.contains("SERVER_BUSY") {
        ("SERVER_BUSY", true)
    } else if text.contains("HTTP 401") || text.contains("AUTH_REQUIRED") {
        ("AUTH_REQUIRED", false)
    } else if text.contains("HTTP 403") || text.contains("AUTH_FORBIDDEN") {
        ("AUTH_FORBIDDEN", false)
    } else if text.contains("解密") || text.contains("密钥") {
        ("DECRYPT_FAILED", false)
    } else if text.contains("SCHEMA") || text.contains("JSON") || text.contains("PAYLOAD") {
        ("INVALID_SCHEMA", false)
    } else if text.contains("ETAG") {
        ("NO_ETAG", false)
    } else if text.contains("本地") && text.contains("变化") {
        ("LOCAL_CHANGED", false)
    } else {
        ("REMOTE_UNAVAILABLE", true)
    }
}

fn report_base(mode: SyncMode, dry_run: bool, source: &str) -> SyncReport {
    SyncReport {
        dry_run,
        mode: mode.as_str().into(),
        source: source.into(),
        sync_session_id: new_trace_id("sync"),
        operation_id: new_trace_id("op"),
        ..Default::default()
    }
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn extract_payload(doc: &Value) -> Result<SyncPayload, String> {
    if let Some(p) = doc.get("payload") {
        return serde_json::from_value(p.clone())
            .map_err(|e| format!("解析远端 payload 失败: {e}"));
    }
    // bare SyncPayload
    serde_json::from_value(doc.clone()).map_err(|e| format!("解析远端 SyncPayload 失败: {e}"))
}

fn build_bundle_document(payload: &SyncPayload, device_name: &str, platform: &str) -> Value {
    let exported = now_ms();
    json!({
        "schema": PLAINTEXT_SCHEMA,
        "exportedAtMs": exported,
        "source": {
            "app": "codex-tauri",
            "platform": platform,
            "deviceName": device_name,
            "formatVersion": 2,
        },
        "payload": payload,
    })
}

fn ensure_field_clocks(payload: &mut SyncPayload, device: &str) {
    for a in &mut payload.accounts {
        let act = a.updated_at_ms.max(a.created_at_ms);
        if a.username_updated_at_ms <= 0 {
            a.username_updated_at_ms = act;
        }
        if a.password_updated_at_ms <= 0 {
            a.password_updated_at_ms = act;
        }
        if a.totp_updated_at_ms <= 0 {
            a.totp_updated_at_ms = act;
        }
        if a.recovery_codes_updated_at_ms <= 0 {
            a.recovery_codes_updated_at_ms = act;
        }
        if a.note_updated_at_ms <= 0 {
            a.note_updated_at_ms = act;
        }
        if a.username_updated_device_name.trim().is_empty() {
            a.username_updated_device_name = device.to_string();
        }
        if a.password_updated_device_name.trim().is_empty() {
            a.password_updated_device_name = device.to_string();
        }
        if a.last_operated_device_name.trim().is_empty() {
            a.last_operated_device_name = device.to_string();
        }
        if a.created_device_name.trim().is_empty() {
            a.created_device_name = device.to_string();
        }
    }
}

pub fn local_payload_from_vault(
    accounts: &[pass_merge::v2::PasswordAccount],
    folders: &[pass_merge::v2::Folder],
    passkeys: &[pass_merge::v2::Passkey],
    device_name: &str,
) -> SyncPayload {
    let mut payload = SyncPayload {
        accounts: accounts.to_vec(),
        folders: folders.to_vec(),
        passkeys: passkeys.to_vec(),
        ..Default::default()
    };
    ensure_field_clocks(&mut payload, device_name);
    let _ = sync_alias_groups(&mut payload.accounts, now_ms(), device_name);
    payload
}

pub fn local_payload_from_vault_with_order(
    accounts: &[pass_merge::v2::PasswordAccount],
    folders: &[pass_merge::v2::Folder],
    passkeys: &[pass_merge::v2::Passkey],
    device_name: &str,
    all_regular_account_ids: Vec<String>,
    all_regular_order_updated_at_ms: i64,
    all_regular_order_updated_device_name: String,
    folder_order_ids: Vec<String>,
    folder_order_updated_at_ms: i64,
    folder_order_updated_device_name: String,
) -> SyncPayload {
    let mut payload = local_payload_from_vault(accounts, folders, passkeys, device_name);
    payload.all_regular_account_ids = all_regular_account_ids;
    payload.all_regular_order_updated_at_ms = all_regular_order_updated_at_ms;
    payload.all_regular_order_updated_device_name = all_regular_order_updated_device_name;
    payload.folder_order_ids = folder_order_ids;
    payload.folder_order_updated_at_ms = folder_order_updated_at_ms;
    payload.folder_order_updated_device_name = folder_order_updated_device_name;
    payload
}

/// Counts accounts that are still user-visible. Permanently deleted records are
/// sync tombstones: they must stay in payloads to prevent resurrection, but
/// must never inflate the account totals shown to users.
pub fn visible_account_count(payload: &SyncPayload) -> usize {
    payload
        .accounts
        .iter()
        .filter(|account| !account.is_permanently_deleted)
        .count()
}

pub fn visible_folder_count(payload: &SyncPayload) -> usize {
    payload
        .folders
        .iter()
        .filter(|folder| !folder.is_permanently_deleted)
        .count()
}

pub fn visible_passkey_count(payload: &SyncPayload) -> usize {
    payload
        .passkeys
        .iter()
        .filter(|passkey| !passkey.is_permanently_deleted)
        .count()
}

fn decide_merged(
    mode: SyncMode,
    mut local: SyncPayload,
    mut remote: Option<SyncPayload>,
    device_name: &str,
) -> (SyncPayload, pass_merge::v2::SyncSafetyReport) {
    // Alias expansion changes site membership and its timestamps. Canonicalize
    // every candidate before the safety gate so a tombstone cannot be bypassed
    // by a post-check alias rewrite.
    let alias_now = now_ms();
    let alias_device = if device_name.trim().is_empty() {
        "sync-merge"
    } else {
        device_name
    };
    let _ = sync_alias_groups(&mut local.accounts, alias_now, alias_device);
    if let Some(remote_payload) = remote.as_mut() {
        let _ = sync_alias_groups(&mut remote_payload.accounts, alias_now, alias_device);
    }
    let mut merged = match remote.as_ref() {
        Some(remote) => match mode {
            SyncMode::Merge => merge_sync_payloads(local.clone(), remote.clone()),
            SyncMode::RemoteOverwriteLocal => remote.clone(),
            SyncMode::LocalOverwriteRemote => local.clone(),
        },
        // A missing remote object is an uninitialized source, not a confirmed
        // empty payload. It is safe to initialize during merge/local-overwrite,
        // while remote-overwrite still resolves to an empty candidate and is
        // rejected by the safety gate when local data is visible.
        None => match mode {
            SyncMode::RemoteOverwriteLocal => SyncPayload::default(),
            SyncMode::Merge | SyncMode::LocalOverwriteRemote => local.clone(),
        },
    };
    let _ = sync_alias_groups(&mut merged.accounts, alias_now, alias_device);
    let report = evaluate_sync_safety(&local, remote.as_ref(), &merged, mode.safety_mode());
    (merged, report)
}

/// Dry-run against server settings (or empty remote if disabled / unreachable handled by caller).
pub fn preview_sync(
    settings: &SyncSettings,
    local: SyncPayload,
    device_name: &str,
    platform: &str,
) -> Result<(SyncReport, SyncPayload), String> {
    let mode = SyncMode::parse(&settings.mode);
    let (remote_opt, _) = pull_remote(settings)?;
    let local_count = visible_account_count(&local);
    let remote_count = remote_opt.as_ref().map(visible_account_count).unwrap_or(0);
    let (merged, report) = decide_merged(mode, local.clone(), remote_opt, device_name);
    let merged_count = visible_account_count(&merged);
    let message = if report.safe {
        format!(
            "预览（未写入）：账号 {}->{}，远端 {}，safe=true",
            local_count, merged_count, remote_count
        )
    } else {
        format!("预览停止：安全检查未通过（{}）", report.reasons.join(", "))
    };
    let _ = (device_name, platform);
    let mut result = report_base(mode, true, "selfHosted");
    result.ok = report.safe;
    result.message = message;
    result.set_safety(report.safe);
    result.reasons = report.reasons.clone();
    result.local_accounts = local_count;
    result.remote_accounts = remote_count;
    result.merged_accounts = merged_count;
    result.remote_pulled = true;
    result.stage = if report.safe {
        "completed"
    } else {
        "safetyChecking"
    }
    .into();
    result.code = (!report.safe).then(|| "SAFETY_BLOCKED".into());
    Ok((result, merged))
}

/// Preview a non-server transport without applying or pushing anything.
pub fn preview_with_transport<P>(
    mode: SyncMode,
    local: SyncPayload,
    device_name: &str,
    source: &str,
    mut pull: P,
) -> Result<(SyncReport, SyncPayload), String>
where
    P: FnMut() -> Result<(Option<SyncPayload>, Option<String>), String>,
{
    let (remote_opt, etag) = pull()?;
    let local_count = visible_account_count(&local);
    let remote_count = remote_opt.as_ref().map(visible_account_count).unwrap_or(0);
    let (merged, safety) = decide_merged(mode, local.clone(), remote_opt, device_name);
    let merged_count = visible_account_count(&merged);
    let mut report = report_base(mode, true, source);
    report.ok = safety.safe;
    report.message = if safety.safe {
        format!("预览（未写入）：账号 {local_count}->{merged_count}（远端 {remote_count}）")
    } else {
        format!("预览停止：安全检查未通过（{}）", safety.reasons.join(", "))
    };
    report.set_safety(safety.safe);
    report.reasons = safety.reasons;
    report.local_accounts = local_count;
    report.remote_accounts = remote_count;
    report.merged_accounts = merged_count;
    report.remote_pulled = true;
    report.stage = if report.safe {
        "completed"
    } else {
        "safetyChecking"
    }
    .into();
    report.code = (!report.safe).then(|| "SAFETY_BLOCKED".into());
    report.etag = etag;
    Ok((report, merged))
}

fn pull_remote(settings: &SyncSettings) -> Result<(Option<SyncPayload>, Option<String>), String> {
    if !settings.enabled {
        return Ok((None, None));
    }
    if settings.base_url.trim().is_empty() {
        return Err("请先配置同步服务器 URL（访问令牌与加密密钥可留空）".into());
    }
    let fetched = get_sync_state(&settings.base_url, &settings.auth_token)?;
    if fetched.empty || fetched.body.is_none() {
        return Ok((None, fetched.etag));
    }
    let doc = decrypt_wire_body_with_fallback(
        fetched.body.as_ref().unwrap(),
        &settings.encryption_key,
        &settings.previous_encryption_key,
    )?;
    let payload = extract_payload(&doc)?;
    Ok((Some(payload), fetched.etag))
}

/// Shared merge/safety/write loop for non-server transports such as WebDAV.
/// The transport owns conditional reads/writes; this layer remains the only
/// authority for merge, encryption envelope and safety decisions.
pub(crate) fn run_sync_with_transport_context<P, U, A>(
    mode: SyncMode,
    local: SyncPayload,
    device_name: &str,
    platform: &str,
    encryption_key: &str,
    source: &str,
    retry_context: Option<SyncRetryContext>,
    mut pull: P,
    mut apply_local: A,
    mut push: U,
) -> Result<(SyncReport, SyncPayload), String>
where
    P: FnMut() -> Result<(Option<SyncPayload>, Option<String>), String>,
    A: FnMut(&SyncPayload) -> Result<(), String>,
    U: FnMut(&[u8], Option<&str>, &str) -> Result<String, String>,
{
    let mut attempt = 0;
    let mut last_applied: Option<SyncPayload> = None;
    let retry_context = retry_context.unwrap_or_default();
    let idempotency_key = if retry_context.idempotency_key.trim().is_empty() {
        Uuid::new_v4().to_string()
    } else {
        retry_context.idempotency_key.clone()
    };
    let sync_session_id = if retry_context.sync_session_id.trim().is_empty() {
        new_trace_id("sync")
    } else {
        retry_context.sync_session_id.clone()
    };
    let operation_id = if retry_context.operation_id.trim().is_empty() {
        new_trace_id("op")
    } else {
        retry_context.operation_id.clone()
    };
    loop {
        attempt += 1;
        let (remote_opt, etag) = pull()?;
        let local_count = visible_account_count(&local);
        let remote_count = remote_opt.as_ref().map(visible_account_count).unwrap_or(0);
        let (merged, report) = decide_merged(mode, local.clone(), remote_opt, device_name);
        let merged_count = visible_account_count(&merged);
        if !report.safe {
            let mut failure = report_base(mode, false, source);
            failure.sync_session_id = sync_session_id.clone();
            failure.operation_id = operation_id.clone();
            failure.message = format!("同步停止：安全检查未通过（{}）", report.reasons.join(", "));
            failure.set_safety(false);
            failure.reasons = report.reasons;
            failure.local_accounts = local_count;
            failure.remote_accounts = remote_count;
            failure.merged_accounts = merged_count;
            failure.applied = last_applied.is_some();
            failure.remote_pulled = true;
            failure.stage = "safetyChecking".into();
            failure.code = Some("SAFETY_BLOCKED".into());
            failure.etag = etag;
            return Ok((
                failure,
                last_applied.clone().unwrap_or_else(|| local.clone()),
            ));
        }
        let mut to_store = match mode {
            SyncMode::LocalOverwriteRemote => local.clone(),
            _ => merged.clone(),
        };
        ensure_field_clocks(&mut to_store, device_name);
        let _ = sync_alias_groups(&mut to_store.accounts, now_ms(), device_name);
        // Apply locally before remote push so a failed push never creates
        // "remote updated / local stale" split-brain. A failed push leaves the
        // merged local vault intact for the next retry.
        apply_local(&to_store)?;
        last_applied = Some(to_store.clone());
        let wire = encrypt_bundle_document(
            &build_bundle_document(&to_store, device_name, platform),
            encryption_key,
        )?;
        match push(&wire, etag.as_deref(), &idempotency_key) {
            Ok(new_etag) => {
                let mut success = report_base(mode, false, source);
                success.sync_session_id = sync_session_id.clone();
                success.operation_id = operation_id.clone();
                success.ok = true;
                success.message = format!(
                    "同步完成：账号 {}->{}（已写入本地并推送）",
                    local_count,
                    visible_account_count(&to_store)
                );
                success.set_safety(true);
                success.local_accounts = local_count;
                success.remote_accounts = remote_count;
                success.merged_accounts = visible_account_count(&to_store);
                success.applied = true;
                success.pushed = true;
                success.remote_pulled = true;
                success.stage = "completed".into();
                success.etag = Some(new_etag);
                return Ok((success, to_store));
            }
            Err(e) if e == "PRECONDITION_FAILED" && attempt < MAX_CONFLICT_RETRIES => continue,
            Err(e) => {
                let (code, retryable) = classify_sync_error(&e);
                let mut failure = report_base(mode, false, source);
                failure.sync_session_id = sync_session_id.clone();
                failure.operation_id = operation_id.clone();
                failure.message = format!("本地已更新为合并结果，但推送远端失败，请重试同步：{e}");
                failure.set_safety(true);
                failure.reasons = vec![e];
                failure.local_accounts = local_count;
                failure.remote_accounts = remote_count;
                failure.merged_accounts = visible_account_count(&to_store);
                failure.applied = true;
                failure.remote_pulled = true;
                failure.pending_retry = true;
                failure.retryable = retryable;
                failure.stage = "pushingRemote".into();
                failure.code = Some(code.into());
                failure.etag = etag;
                return Ok((failure, to_store));
            }
        }
    }
}

/// Full sync: pull → merge → safety → apply local → push.
/// `apply_local` must persist the merged payload before the remote PUT.
pub fn run_sync_with_context<A>(
    settings: &SyncSettings,
    local: SyncPayload,
    device_name: &str,
    platform: &str,
    retry_context: Option<SyncRetryContext>,
    apply_local: A,
) -> Result<(SyncReport, SyncPayload), String>
where
    A: FnMut(&SyncPayload) -> Result<(), String>,
{
    if !settings.enabled {
        return Err("同步未启用".into());
    }
    let mode = SyncMode::parse(&settings.mode);
    let encryption_key = settings.encryption_key.clone();
    let base_url = settings.base_url.clone();
    let auth_token = settings.auth_token.clone();
    run_sync_with_transport_context(
        mode,
        local,
        device_name,
        platform,
        &encryption_key,
        "selfHosted",
        retry_context,
        || pull_remote(settings),
        apply_local,
        |wire, etag, idempotency_key| {
            put_sync_state(&base_url, &auth_token, wire, etag, Some(idempotency_key))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use pass_merge::v2::{Folder, Passkey, PasswordAccount};
    use std::cell::RefCell;

    #[test]
    fn visible_account_count_excludes_permanent_deletion_tombstones() {
        let mut tombstone = PasswordAccount::default();
        tombstone.is_permanently_deleted = true;
        let payload = SyncPayload {
            accounts: vec![PasswordAccount::default(), tombstone],
            ..SyncPayload::default()
        };

        assert_eq!(visible_account_count(&payload), 1);
    }

    #[test]
    fn visible_counts_exclude_all_permanent_deletion_tombstones() {
        let mut deleted_folder = Folder::default();
        deleted_folder.is_permanently_deleted = true;
        let mut deleted_passkey = Passkey::default();
        deleted_passkey.is_permanently_deleted = true;
        let payload = SyncPayload {
            folders: vec![Folder::default(), deleted_folder],
            passkeys: vec![Passkey::default(), deleted_passkey],
            ..SyncPayload::default()
        };

        assert_eq!(visible_folder_count(&payload), 1);
        assert_eq!(visible_passkey_count(&payload), 1);
    }

    #[test]
    fn retry_context_reuses_trace_and_idempotency_ids() {
        let seen_key = RefCell::new(String::new());
        let context = SyncRetryContext {
            idempotency_key: "idem-existing".into(),
            sync_session_id: "sync-existing".into(),
            operation_id: "op-existing".into(),
            ..Default::default()
        };
        let (report, _) = run_sync_with_transport_context(
            SyncMode::Merge,
            SyncPayload::default(),
            "test-device",
            "test",
            "",
            "selfHosted",
            Some(context),
            || Ok((None, None)),
            |_| Ok(()),
            |_, _, key| {
                *seen_key.borrow_mut() = key.to_string();
                Ok("etag-new".into())
            },
        )
        .unwrap();
        assert_eq!(&*seen_key.borrow(), "idem-existing");
        assert_eq!(report.sync_session_id, "sync-existing");
        assert_eq!(report.operation_id, "op-existing");
        assert!(report.pushed);
    }
}
