use super::crypto::{decrypt_wire_body, encrypt_bundle_document, PLAINTEXT_SCHEMA};
use super::http::{get_sync_state, put_sync_state};
use super::settings::SyncSettings;
use chrono::Utc;
use pass_merge::v2::{evaluate_sync_safety, merge_sync_payloads, sync_alias_groups, SyncPayload};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
        match self {
            Self::RemoteOverwriteLocal => "remoteOverwriteLocal",
            _ => "merge",
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub ok: bool,
    pub dry_run: bool,
    pub mode: String,
    pub message: String,
    pub safe: bool,
    pub reasons: Vec<String>,
    pub local_accounts: usize,
    pub remote_accounts: usize,
    pub merged_accounts: usize,
    pub applied: bool,
    pub pushed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
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
    };
    ensure_field_clocks(&mut payload, device_name);
    let _ = sync_alias_groups(&mut payload.accounts, now_ms(), device_name);
    payload
}

fn decide_merged(
    mode: SyncMode,
    local: SyncPayload,
    remote: Option<SyncPayload>,
) -> (SyncPayload, pass_merge::v2::SyncSafetyReport) {
    let remote = remote.unwrap_or_default();
    let merged = match mode {
        SyncMode::Merge => merge_sync_payloads(local.clone(), remote.clone()),
        SyncMode::RemoteOverwriteLocal => remote.clone(),
        SyncMode::LocalOverwriteRemote => local.clone(),
    };
    let report = evaluate_sync_safety(&local, Some(&remote), &merged, mode.safety_mode());
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
    let remote_count = remote_opt.as_ref().map(|p| p.accounts.len()).unwrap_or(0);
    let (merged, report) = decide_merged(mode, local.clone(), remote_opt);
    let message = if report.safe {
        format!(
            "预览（未写入）：账号 {}->{}，远端 {}，safe=true",
            local.accounts.len(),
            merged.accounts.len(),
            remote_count
        )
    } else {
        format!("预览停止：安全检查未通过（{}）", report.reasons.join(", "))
    };
    let _ = (device_name, platform);
    Ok((
        SyncReport {
            ok: report.safe,
            dry_run: true,
            mode: mode.as_str().into(),
            message,
            safe: report.safe,
            reasons: report.reasons.clone(),
            local_accounts: local.accounts.len(),
            remote_accounts: remote_count,
            merged_accounts: merged.accounts.len(),
            applied: false,
            pushed: false,
            etag: None,
        },
        merged,
    ))
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
    let doc = decrypt_wire_body(fetched.body.as_ref().unwrap(), &settings.encryption_key)?;
    let payload = extract_payload(&doc)?;
    Ok((Some(payload), fetched.etag))
}

/// Shared merge/safety/write loop for non-server transports such as WebDAV.
/// The transport owns conditional reads/writes; this layer remains the only
/// authority for merge, encryption envelope and safety decisions.
pub(crate) fn run_sync_with_transport<P, U>(
    mode: SyncMode,
    local: SyncPayload,
    device_name: &str,
    platform: &str,
    encryption_key: &str,
    mut pull: P,
    mut push: U,
) -> Result<(SyncReport, SyncPayload), String>
where
    P: FnMut() -> Result<(Option<SyncPayload>, Option<String>), String>,
    U: FnMut(&[u8], Option<&str>) -> Result<String, String>,
{
    let mut attempt = 0;
    loop {
        attempt += 1;
        let (remote_opt, etag) = pull()?;
        let remote_count = remote_opt.as_ref().map(|p| p.accounts.len()).unwrap_or(0);
        let (merged, report) = decide_merged(mode, local.clone(), remote_opt);
        if !report.safe {
            return Ok((
                SyncReport {
                    ok: false,
                    dry_run: false,
                    mode: mode.as_str().into(),
                    message: format!("同步停止：安全检查未通过（{}）", report.reasons.join(", ")),
                    safe: false,
                    reasons: report.reasons,
                    local_accounts: local.accounts.len(),
                    remote_accounts: remote_count,
                    merged_accounts: merged.accounts.len(),
                    applied: false,
                    pushed: false,
                    etag,
                },
                local,
            ));
        }
        let mut to_store = match mode {
            SyncMode::LocalOverwriteRemote => local.clone(),
            _ => merged.clone(),
        };
        ensure_field_clocks(&mut to_store, device_name);
        let _ = sync_alias_groups(&mut to_store.accounts, now_ms(), device_name);
        let wire = encrypt_bundle_document(
            &build_bundle_document(&to_store, device_name, platform),
            encryption_key,
        )?;
        match push(&wire, etag.as_deref()) {
            Ok(new_etag) => {
                return Ok((
                    SyncReport {
                        ok: true,
                        dry_run: false,
                        mode: mode.as_str().into(),
                        message: format!(
                            "同步完成：账号 {}->{}（已写入本地并推送）",
                            local.accounts.len(),
                            to_store.accounts.len()
                        ),
                        safe: true,
                        reasons: vec![],
                        local_accounts: local.accounts.len(),
                        remote_accounts: remote_count,
                        merged_accounts: to_store.accounts.len(),
                        applied: true,
                        pushed: true,
                        etag: Some(new_etag),
                    },
                    to_store,
                ));
            }
            Err(e) if e == "PRECONDITION_FAILED" && attempt < MAX_CONFLICT_RETRIES => continue,
            Err(e) => return Err(e),
        }
    }
}

/// Full sync: pull → merge → safety → apply local (via callback data) → push.
/// Returns report + payload to apply locally (caller writes vault).
pub fn run_sync(
    settings: &SyncSettings,
    local: SyncPayload,
    device_name: &str,
    platform: &str,
) -> Result<(SyncReport, SyncPayload), String> {
    if !settings.enabled {
        return Err("同步未启用".into());
    }
    let mode = SyncMode::parse(&settings.mode);
    let mut attempt = 0;
    loop {
        attempt += 1;
        let (remote_opt, etag) = pull_remote(settings)?;
        let remote_count = remote_opt.as_ref().map(|p| p.accounts.len()).unwrap_or(0);
        let (merged, report) = decide_merged(mode, local.clone(), remote_opt);
        if !report.safe {
            return Ok((
                SyncReport {
                    ok: false,
                    dry_run: false,
                    mode: mode.as_str().into(),
                    message: format!("同步停止：安全检查未通过（{}）", report.reasons.join(", ")),
                    safe: false,
                    reasons: report.reasons,
                    local_accounts: local.accounts.len(),
                    remote_accounts: remote_count,
                    merged_accounts: merged.accounts.len(),
                    applied: false,
                    pushed: false,
                    etag,
                },
                local,
            ));
        }

        // Push decided payload (for merge/remoteOverwrite: merged; for localOverwrite: local)
        let to_store = match mode {
            SyncMode::LocalOverwriteRemote => local.clone(),
            _ => merged.clone(),
        };
        let mut to_store = to_store;
        ensure_field_clocks(&mut to_store, device_name);
        let _ = sync_alias_groups(&mut to_store.accounts, now_ms(), device_name);

        let doc = build_bundle_document(&to_store, device_name, platform);
        let wire = encrypt_bundle_document(&doc, &settings.encryption_key)?;
        match put_sync_state(
            &settings.base_url,
            &settings.auth_token,
            &wire,
            etag.as_deref(),
        ) {
            Ok(new_etag) => {
                return Ok((
                    SyncReport {
                        ok: true,
                        dry_run: false,
                        mode: mode.as_str().into(),
                        message: format!(
                            "同步完成：账号 {}->{}（已写入本地并推送）",
                            local.accounts.len(),
                            to_store.accounts.len()
                        ),
                        safe: true,
                        reasons: vec![],
                        local_accounts: local.accounts.len(),
                        remote_accounts: remote_count,
                        merged_accounts: to_store.accounts.len(),
                        applied: true,
                        pushed: true,
                        etag: Some(new_etag),
                    },
                    to_store,
                ));
            }
            Err(e) if e == "PRECONDITION_FAILED" && attempt < MAX_CONFLICT_RETRIES => {
                continue;
            }
            Err(e) => return Err(e),
        }
    }
}
