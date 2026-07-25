//! Import / export helpers: sync bundle, browser password CSV.

use pass_csvio::{browser_csv_to_account_drafts, build_csv, host_from_site_value};
use pass_merge::v2::{evaluate_sync_safety, merge_sync_payloads, PasswordAccount, SyncPayload};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::sync::crypto::{decrypt_wire_body, encrypt_bundle_document, PLAINTEXT_SCHEMA};
use crate::sync::http::{get_sync_state, put_sync_state, validate_base_url};
use crate::sync::pipeline::{visible_account_count, SyncMode};
use crate::sync::settings::SyncSettings;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathResult {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub format: String,
    pub imported: usize,
    pub skipped: usize,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleImportResult {
    pub ok: bool,
    pub safe: bool,
    pub reasons: Vec<String>,
    pub local_accounts: usize,
    pub remote_accounts: usize,
    pub merged_accounts: usize,
    pub message: String,
    pub payload: SyncPayload,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncVersionSummary {
    pub id: String,
    pub exported_at_ms: i64,
    pub saved_at_ms: i64,
    pub payload_sha256: String,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn extract_payload(doc: &Value) -> Result<SyncPayload, String> {
    if let Some(p) = doc.get("payload") {
        return serde_json::from_value(p.clone()).map_err(|e| format!("解析 payload 失败: {e}"));
    }
    serde_json::from_value(doc.clone()).map_err(|e| format!("解析 SyncPayload 失败: {e}"))
}

pub fn build_bundle_bytes(
    payload: &SyncPayload,
    device_name: &str,
    platform: &str,
    encryption_key: &str,
) -> Result<Vec<u8>, String> {
    let doc = json!({
        "schema": PLAINTEXT_SCHEMA,
        "exportedAtMs": now_ms(),
        "source": {
            "app": "codex-tauri",
            "platform": platform,
            "deviceName": device_name,
            "formatVersion": 2,
        },
        "payload": payload,
    });
    encrypt_bundle_document(&doc, encryption_key)
}

pub fn import_bundle_content(
    local: SyncPayload,
    content: &[u8],
    encryption_key: &str,
    previous_key: &str,
) -> Result<BundleImportResult, String> {
    let doc = decrypt_wire_body(content, encryption_key).or_else(|e| {
        if previous_key.trim().is_empty() {
            Err(e)
        } else {
            decrypt_wire_body(content, previous_key)
        }
    })?;
    let remote = extract_payload(&doc)?;
    let remote_count = visible_account_count(&remote);
    let local_count = visible_account_count(&local);
    let merged = merge_sync_payloads(local.clone(), remote.clone());
    let merged_count = visible_account_count(&merged);
    let report = evaluate_sync_safety(&local, Some(&remote), &merged, "merge");
    Ok(BundleImportResult {
        ok: report.safe,
        safe: report.safe,
        reasons: report.reasons.clone(),
        local_accounts: local_count,
        remote_accounts: remote_count,
        merged_accounts: merged_count,
        message: if report.safe {
            format!(
                "同步包合并预览：本地 {} → 合并 {}（远端 {}）",
                local_count, merged_count, remote_count
            )
        } else {
            format!("同步包合并被安全检查拦截：{}", report.reasons.join(", "))
        },
        payload: merged,
    })
}

// --- Browser CSV ---

pub fn browser_entries_from_csv(text: &str) -> Result<Vec<PasswordAccount>, String> {
    let drafts = browser_csv_to_account_drafts(text)?;
    if drafts.is_empty() {
        return Err("CSV 中没有可导入的账号".into());
    }
    let ts = now_ms();
    let mut out = Vec::with_capacity(drafts.len());
    for draft in drafts {
        let site = draft
            .sites
            .first()
            .cloned()
            .or_else(|| host_from_site_value(&draft.username))
            .unwrap_or_default();
        if site.is_empty() {
            continue;
        }
        let id = uuid::Uuid::new_v4().to_string();
        let account_id = format!("{site}-{}-{ts}", draft.username);
        out.push(PasswordAccount {
            record_id: Some(id.clone()),
            id: Some(id),
            account_id,
            canonical_site: site.clone(),
            sites: draft.sites.clone(),
            username: draft.username.clone(),
            password: draft.password,
            note: draft.note,
            totp_secret: draft.totp_secret,
            username_at_create: draft.username,
            created_at_ms: ts,
            updated_at_ms: ts,
            username_updated_at_ms: ts,
            password_updated_at_ms: ts,
            note_updated_at_ms: ts,
            totp_updated_at_ms: ts,
            created_device_name: "import".into(),
            last_operated_device_name: "import".into(),
            username_updated_device_name: "import".into(),
            password_updated_device_name: "import".into(),
            note_updated_device_name: "import".into(),
            totp_updated_device_name: "import".into(),
            ..Default::default()
        });
    }
    if out.is_empty() {
        return Err("CSV 中没有可导入的账号".into());
    }
    Ok(out)
}

pub fn export_browser_csv(
    accounts: &[PasswordAccount],
    format: &str,
) -> Result<(Vec<&'static str>, Vec<Vec<String>>), String> {
    let active: Vec<_> = accounts.iter().filter(|a| !a.is_deleted).collect();
    match format {
        "chrome" | "safari" => {
            let headers = ["name", "url", "username", "password", "note"];
            let rows = active
                .iter()
                .map(|a| {
                    let site = a
                        .sites
                        .first()
                        .cloned()
                        .unwrap_or_else(|| a.canonical_site.clone());
                    let name = if a.canonical_site.is_empty() {
                        site.clone()
                    } else {
                        a.canonical_site.clone()
                    };
                    vec![
                        name,
                        format!("https://{site}"),
                        a.username.clone(),
                        a.password.clone(),
                        a.note.clone(),
                    ]
                })
                .collect();
            Ok((headers.to_vec(), rows))
        }
        "firefox" => {
            let headers = ["url", "username", "password"];
            let rows = active
                .iter()
                .map(|a| {
                    let site = a
                        .sites
                        .first()
                        .cloned()
                        .unwrap_or_else(|| a.canonical_site.clone());
                    vec![
                        format!("https://{site}"),
                        a.username.clone(),
                        a.password.clone(),
                    ]
                })
                .collect();
            Ok((headers.to_vec(), rows))
        }
        other => Err(format!("未知浏览器导出格式: {other}")),
    }
}

pub fn build_csv_string(headers: &[&str], rows: &[Vec<String>]) -> String {
    build_csv(headers, rows)
}

pub fn merge_imported_accounts(
    existing: Vec<PasswordAccount>,
    imported: Vec<PasswordAccount>,
    device_name: &str,
) -> Vec<PasswordAccount> {
    let mut merged = merge_sync_payloads(
        SyncPayload {
            accounts: existing,
            ..Default::default()
        },
        SyncPayload {
            accounts: imported,
            ..Default::default()
        },
    )
    .accounts;
    for account in &mut merged {
        if account.last_operated_device_name.trim().is_empty() {
            account.last_operated_device_name = device_name.to_string();
        }
    }
    merged
}

// --- Sync versions ---

pub fn list_sync_versions(settings: &SyncSettings) -> Result<Vec<SyncVersionSummary>, String> {
    let base = validate_base_url(&settings.base_url)?;
    let url = format!("{base}/v2/sync/versions");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    let token = settings.auth_token.trim();
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let resp = req.send().map_err(|e| format!("读取快照失败: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let text = resp.text().unwrap_or_default();
        return Err(format!("读取快照失败 HTTP {code}: {text}"));
    }
    let text = resp.text().map_err(|e| format!("读取快照列表失败: {e}"))?;
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("解析快照列表失败: {e}"))?;
    let arr = value
        .as_array()
        .or_else(|| value.get("versions").and_then(|v| v.as_array()))
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for item in arr {
        let id_value = item.get("id").or_else(|| item.get("versionId"));
        let id = id_value
            .and_then(|value| value.as_str().map(str::to_owned).or_else(|| value.as_i64().map(|number| number.to_string())).or_else(|| value.as_u64().map(|number| number.to_string())))
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        out.push(SyncVersionSummary {
            id,
            exported_at_ms: item
                .get("exportedAtMs")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
            saved_at_ms: item.get("savedAtMs").and_then(|v| v.as_i64()).unwrap_or(0),
            payload_sha256: item
                .get("payloadSha256")
                .or_else(|| item.get("sha256"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        });
    }
    Ok(out)
}

pub fn restore_sync_version(
    settings: &SyncSettings,
    version_id: &str,
) -> Result<(SyncPayload, Option<String>), String> {
    let base = validate_base_url(&settings.base_url)?;
    let id = version_id.trim();
    // Prefer restore endpoint; fallback to GET version body.
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    // Need current etag for restore
    let fetched = get_sync_state(&settings.base_url, &settings.auth_token)?;
    let etag = fetched.etag.clone();
    let token = settings.auth_token.trim();

    let restore_url = format!("{base}/v2/sync/versions/{id}/restore");
    let mut req = client
        .post(&restore_url)
        .header("Content-Type", "application/json");
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    if let Some(ref tag) = etag {
        req = req.header("If-Match", tag);
    }
    let resp = req.send().map_err(|e| format!("恢复快照失败: {e}"))?;
    if resp.status().is_success() {
        // Re-pull state after restore
        let after = get_sync_state(&settings.base_url, &settings.auth_token)?;
        if let Some(body) = after.body {
            let doc = decrypt_wire_body(&body, &settings.encryption_key)?;
            let payload = extract_payload(&doc)?;
            return Ok((payload, after.etag));
        }
        return Ok((SyncPayload::default(), after.etag));
    }

    // Fallback: GET version content then PUT as localOverwrite
    let get_url = format!("{base}/v2/sync/versions/{id}");
    let mut get_req = client.get(&get_url);
    if !token.is_empty() {
        get_req = get_req.header("Authorization", format!("Bearer {token}"));
    }
    let resp = get_req.send().map_err(|e| format!("下载快照失败: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let text = resp.text().unwrap_or_default();
        return Err(format!("下载快照失败 HTTP {code}: {text}"));
    }
    let body = resp.bytes().map_err(|e| e.to_string())?.to_vec();
    let doc = decrypt_wire_body(&body, &settings.encryption_key)?;
    let payload = extract_payload(&doc)?;
    let wire = encrypt_bundle_document(
        &json!({
            "schema": PLAINTEXT_SCHEMA,
            "exportedAtMs": now_ms(),
            "source": { "app": "codex-tauri", "formatVersion": 2 },
            "payload": payload,
        }),
        &settings.encryption_key,
    )?;
    let new_etag = put_sync_state(
        &settings.base_url,
        &settings.auth_token,
        &wire,
        etag.as_deref(),
    )?;
    Ok((payload, Some(new_etag)))
}

pub fn run_sync_with_mode<A>(
    settings: &SyncSettings,
    local: SyncPayload,
    device_name: &str,
    platform: &str,
    mode: SyncMode,
    apply_local: A,
) -> Result<(crate::sync::pipeline::SyncReport, SyncPayload), String>
where
    A: FnMut(&SyncPayload) -> Result<(), String>,
{
    let mut s = settings.clone();
    s.mode = mode.as_str().to_string();
    crate::sync::pipeline::run_sync(&s, local, device_name, platform, apply_local)
}
