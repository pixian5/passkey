//! Import / export helpers: sync bundle, browser password CSV.

use pass_csvio::build_csv;
use pass_merge::v2::{
    evaluate_sync_safety, merge_sync_payloads, Folder, Passkey, PasswordAccount, SyncPayload,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

use crate::sync::crypto::{decrypt_wire_body, encrypt_bundle_document, PLAINTEXT_SCHEMA};
use crate::sync::http::{get_sync_state, put_sync_state};
use crate::sync::pipeline::{local_payload_from_vault, SyncMode};
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
        return serde_json::from_value(p.clone())
            .map_err(|e| format!("解析 payload 失败: {e}"));
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
    let remote_count = remote.accounts.len();
    let local_count = local.accounts.len();
    let merged = merge_sync_payloads(local.clone(), remote.clone());
    let report = evaluate_sync_safety(&local, Some(&remote), &merged, "merge");
    Ok(BundleImportResult {
        ok: report.safe,
        safe: report.safe,
        reasons: report.reasons.clone(),
        local_accounts: local_count,
        remote_accounts: remote_count,
        merged_accounts: merged.accounts.len(),
        message: if report.safe {
            format!(
                "同步包合并预览：本地 {} → 合并 {}（远端 {}）",
                local_count,
                merged.accounts.len(),
                remote_count
            )
        } else {
            format!("同步包合并被安全检查拦截：{}", report.reasons.join(", "))
        },
        payload: merged,
    })
}

// --- Browser CSV ---

fn parse_csv_rows(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(c);
            }
        } else {
            match c {
                '"' => in_quotes = true,
                ',' => {
                    row.push(std::mem::take(&mut field));
                }
                '\n' => {
                    row.push(std::mem::take(&mut field));
                    if row.iter().any(|c| !c.trim().is_empty()) {
                        rows.push(std::mem::take(&mut row));
                    } else {
                        row.clear();
                    }
                }
                '\r' => {}
                other => field.push(other),
            }
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        if row.iter().any(|c| !c.trim().is_empty()) {
            rows.push(row);
        }
    }
    rows
}

fn normalize_header(h: &str) -> String {
    h.trim()
        .trim_start_matches('\u{feff}')
        .to_ascii_lowercase()
        .replace(' ', "")
        .replace('_', "")
}

fn host_from_url(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if let Some(rest) = t.strip_prefix("https://").or_else(|| t.strip_prefix("http://")) {
        let host = rest.split(['/', '?', '#']).next().unwrap_or(rest);
        let host = host.trim().trim_start_matches('[').trim_end_matches(']');
        if host.is_empty() {
            return None;
        }
        return Some(host.to_ascii_lowercase());
    }
    let host = t
        .split(['/', '?', '#', ':'])
        .next()
        .unwrap_or(t)
        .trim()
        .to_ascii_lowercase();
    if host.is_empty() || !host.contains('.') {
        // still allow bare domains without dot (intranet)
        if host.is_empty() {
            return None;
        }
    }
    Some(host)
}

pub fn browser_entries_from_csv(text: &str) -> Result<Vec<PasswordAccount>, String> {
    let rows = parse_csv_rows(text);
    if rows.is_empty() {
        return Err("CSV 为空".into());
    }
    let headers: Vec<String> = rows[0].iter().map(|h| normalize_header(h)).collect();
    let mut out = Vec::new();
    let ts = now_ms();
    for row in rows.iter().skip(1) {
        let mut map: BTreeMap<String, String> = BTreeMap::new();
        for (i, h) in headers.iter().enumerate() {
            let v = row.get(i).map(|s| s.trim().to_string()).unwrap_or_default();
            map.insert(h.clone(), v);
        }
        let url = map
            .get("url")
            .or_else(|| map.get("origin"))
            .or_else(|| map.get("website"))
            .or_else(|| map.get("hostname"))
            .or_else(|| map.get("loginuri"))
            .cloned()
            .unwrap_or_default();
        let username = map
            .get("username")
            .or_else(|| map.get("user"))
            .cloned()
            .unwrap_or_default();
        let password = map
            .get("password")
            .or_else(|| map.get("pass"))
            .cloned()
            .unwrap_or_default();
        let Some(site) = host_from_url(&url) else {
            continue;
        };
        if username.is_empty() && password.is_empty() {
            continue;
        }
        let mut note_parts = Vec::new();
        if let Some(n) = map.get("name").filter(|s| !s.is_empty()) {
            note_parts.push(format!("来源名称: {n}"));
        }
        if let Some(n) = map
            .get("note")
            .or_else(|| map.get("notes"))
            .filter(|s| !s.is_empty())
        {
            note_parts.push(format!("备注: {n}"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let account_id = format!("{site}-{username}-{ts}");
        out.push(PasswordAccount {
            record_id: Some(id.clone()),
            id: Some(id),
            account_id,
            canonical_site: site.clone(),
            sites: vec![site],
            username: username.clone(),
            password,
            note: note_parts.join("\n"),
            username_at_create: username,
            created_at_ms: ts,
            updated_at_ms: ts,
            username_updated_at_ms: ts,
            password_updated_at_ms: ts,
            note_updated_at_ms: ts,
            created_device_name: "import".into(),
            last_operated_device_name: "import".into(),
            username_updated_device_name: "import".into(),
            password_updated_device_name: "import".into(),
            note_updated_device_name: "import".into(),
            ..Default::default()
        });
    }
    Ok(out)
}

pub fn merge_imported_accounts(
    existing: Vec<PasswordAccount>,
    imported: Vec<PasswordAccount>,
    device: &str,
) -> Vec<PasswordAccount> {
    let local = SyncPayload {
        accounts: existing,
        folders: vec![],
        passkeys: vec![],
    };
    let remote = SyncPayload {
        accounts: imported,
        folders: vec![],
        passkeys: vec![],
    };
    let mut merged = merge_sync_payloads(local, remote);
    for a in &mut merged.accounts {
        if a.last_operated_device_name.trim().is_empty() {
            a.last_operated_device_name = device.to_string();
        }
    }
    merged.accounts
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

// --- Sync versions ---

pub fn list_sync_versions(settings: &SyncSettings) -> Result<Vec<SyncVersionSummary>, String> {
    if settings.base_url.trim().is_empty() || settings.auth_token.trim().is_empty() {
        return Err("请先配置同步服务器 URL 与 Token".into());
    }
    let base = settings.base_url.trim().trim_end_matches('/');
    let url = format!("{base}/v2/sync/versions");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header(
            "Authorization",
            format!("Bearer {}", settings.auth_token.trim()),
        )
        .send()
        .map_err(|e| format!("读取快照失败: {e}"))?;
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let text = resp.text().unwrap_or_default();
        return Err(format!("读取快照失败 HTTP {code}: {text}"));
    }
    let text = resp
        .text()
        .map_err(|e| format!("读取快照列表失败: {e}"))?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("解析快照列表失败: {e}"))?;
    let arr = value
        .as_array()
        .or_else(|| value.get("versions").and_then(|v| v.as_array()))
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for item in arr {
        let id = item
            .get("id")
            .or_else(|| item.get("versionId"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        out.push(SyncVersionSummary {
            id,
            exported_at_ms: item
                .get("exportedAtMs")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
            saved_at_ms: item
                .get("savedAtMs")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
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
    if settings.base_url.trim().is_empty() || settings.auth_token.trim().is_empty() {
        return Err("请先配置同步服务器 URL 与 Token".into());
    }
    let base = settings.base_url.trim().trim_end_matches('/');
    let id = version_id.trim();
    // Prefer restore endpoint; fallback to GET version body.
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    // Need current etag for restore
    let fetched = get_sync_state(&settings.base_url, &settings.auth_token)?;
    let etag = fetched.etag.clone();

    let restore_url = format!("{base}/v2/sync/versions/{id}/restore");
    let mut req = client
        .post(&restore_url)
        .header(
            "Authorization",
            format!("Bearer {}", settings.auth_token.trim()),
        )
        .header("Content-Type", "application/json");
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
    let resp = client
        .get(&get_url)
        .header(
            "Authorization",
            format!("Bearer {}", settings.auth_token.trim()),
        )
        .send()
        .map_err(|e| format!("下载快照失败: {e}"))?;
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

pub fn run_sync_with_mode(
    settings: &SyncSettings,
    local: SyncPayload,
    device_name: &str,
    platform: &str,
    mode: SyncMode,
) -> Result<(crate::sync::pipeline::SyncReport, SyncPayload), String> {
    let mut s = settings.clone();
    s.mode = mode.as_str().to_string();
    crate::sync::pipeline::run_sync(&s, local, device_name, platform)
}

pub fn local_from_parts(
    accounts: &[PasswordAccount],
    folders: &[Folder],
    passkeys: &[Passkey],
    device: &str,
) -> SyncPayload {
    local_payload_from_vault(accounts, folders, passkeys, device)
}
