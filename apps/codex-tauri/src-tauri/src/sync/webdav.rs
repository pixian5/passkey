//! Minimal WebDAV transport for the shared pass.sync.bundle.v2 document.
//!
//! WebDAV is intentionally only a storage transport: merge, encryption and
//! safety decisions remain in `pipeline`, exactly as they do for the self-
//! hosted server.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::blocking::Client;
use reqwest::header::{
    HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, ETAG, IF_MATCH, IF_NONE_MATCH,
};
use reqwest::StatusCode;
use std::time::Duration;
use url::Url;

use super::http::FetchResult;
use super::{crypto::decrypt_wire_body_with_fallback, pipeline, pipeline::SyncMode};
use pass_merge::v2::SyncPayload;

#[derive(Debug, Clone)]
pub struct WebDavSettings {
    pub enabled: bool,
    pub base_url: String,
    pub remote_path: String,
    pub username: String,
    pub password: String,
    pub previous_encryption_key: String,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 WebDAV 客户端失败: {e}"))
}

pub fn resource_url(base_url: &str, remote_path: &str) -> Result<String, String> {
    let base = base_url.trim();
    let path = remote_path.trim().trim_start_matches('/');
    if base.is_empty() || path.is_empty() {
        return Err("请填写 WebDAV 地址和远端路径".into());
    }
    if path.contains('?') || path.contains('#') || path.contains("://") {
        return Err("WebDAV 远端路径必须是相对路径且不能包含查询串或锚点".into());
    }
    if path
        .split('/')
        .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("WebDAV 远端路径无效".into());
    }
    let mut url = Url::parse(base).map_err(|_| "WebDAV 地址无效".to_string())?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("WebDAV 地址不应包含账号、查询串或锚点".into());
    }
    let local = matches!(url.host(), Some(url::Host::Domain("localhost")))
        || matches!(url.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
        || matches!(url.host(), Some(url::Host::Ipv6(ip)) if ip.is_loopback());
    if url.scheme() != "https" && !(local && url.scheme() == "http") {
        return Err("WebDAV 必须使用 HTTPS（本机 localhost 可使用 HTTP）".into());
    }
    let mut joined = url.path().trim_end_matches('/').to_string();
    joined.push('/');
    joined.push_str(path);
    url.set_path(&joined);
    Ok(url.to_string())
}

fn headers(username: &str, password: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    if !username.trim().is_empty() || !password.is_empty() {
        let credentials = STANDARD.encode(format!("{}:{}", username.trim(), password));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Basic {credentials}"))
                .map_err(|_| "WebDAV 用户名或密码含非法字符".to_string())?,
        );
    }
    Ok(headers)
}

pub fn get(
    base_url: &str,
    remote_path: &str,
    username: &str,
    password: &str,
) -> Result<FetchResult, String> {
    let response = client()?
        .get(resource_url(base_url, remote_path)?)
        .headers(headers(username, password)?)
        .send()
        .map_err(|e| format!("拉取 WebDAV 同步包失败: {e}"))?;
    let status = response.status();
    if status == StatusCode::NOT_FOUND {
        return Ok(FetchResult {
            body: None,
            etag: None,
            empty: true,
        });
    }
    if !status.is_success() {
        let code = status.as_u16();
        return Err(format!(
            "拉取 WebDAV 同步包失败 HTTP {code}: {}",
            response.text().unwrap_or_default()
        ));
    }
    let etag = response
        .headers()
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let bytes = response
        .bytes()
        .map_err(|e| format!("读取 WebDAV 响应失败: {e}"))?
        .to_vec();
    Ok(FetchResult {
        empty: bytes.is_empty(),
        body: (!bytes.is_empty()).then_some(bytes),
        etag,
    })
}

pub fn put(
    base_url: &str,
    remote_path: &str,
    username: &str,
    password: &str,
    body: &[u8],
    if_match: Option<&str>,
    _idempotency_key: &str,
) -> Result<String, String> {
    let mut request_headers = headers(username, password)?;
    request_headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(etag) = if_match.filter(|value| !value.trim().is_empty()) {
        request_headers.insert(
            IF_MATCH,
            HeaderValue::from_str(etag.trim()).map_err(|_| "WebDAV ETag 非法".to_string())?,
        );
    } else {
        request_headers.insert(IF_NONE_MATCH, HeaderValue::from_static("*"));
    }
    let response = client()?
        .put(resource_url(base_url, remote_path)?)
        .headers(request_headers)
        .body(body.to_vec())
        .send()
        .map_err(|e| format!("写入 WebDAV 同步包失败: {e}"))?;
    if response.status() == StatusCode::PRECONDITION_FAILED
        || response.status() == StatusCode::PRECONDITION_REQUIRED
    {
        return Err("PRECONDITION_FAILED".into());
    }
    if !response.status().is_success() {
        let code = response.status().as_u16();
        return Err(format!(
            "写入 WebDAV 同步包失败 HTTP {code}: {}",
            response.text().unwrap_or_default()
        ));
    }
    Ok(response
        .headers()
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string())
}

fn require_etag_for_existing(body: &Option<Vec<u8>>, etag: &Option<String>) -> Result<(), String> {
    if body.as_ref().is_some_and(|value| !value.is_empty())
        && etag.as_ref().is_none_or(|value| value.trim().is_empty())
    {
        return Err(
            "WebDAV 远端已有同步包但未返回 ETag，无法安全做条件写入。请改用支持 ETag 的 WebDAV，或改用自建服务器作为主源。"
                .into(),
        );
    }
    Ok(())
}

pub fn run_sync<A>(
    settings: &WebDavSettings,
    mode: SyncMode,
    local: SyncPayload,
    device_name: &str,
    platform: &str,
    encryption_key: &str,
    apply_local: A,
) -> Result<(pipeline::SyncReport, SyncPayload), String>
where
    A: FnMut(&pass_merge::v2::SyncPayload) -> Result<(), String>,
{
    if !settings.enabled {
        return Err("WebDAV 同步未启用".into());
    }
    // Validate once before the retry loop so an invalid configuration does not
    // look like a network conflict.
    let _ = resource_url(&settings.base_url, &settings.remote_path)?;
    pipeline::run_sync_with_transport(
        mode,
        local,
        device_name,
        platform,
        encryption_key,
        "webdav",
        || {
            let fetched = get(
                &settings.base_url,
                &settings.remote_path,
                &settings.username,
                &settings.password,
            )?;
            require_etag_for_existing(&fetched.body, &fetched.etag)?;
            let etag = fetched.etag;
            let payload = match fetched.body {
                Some(body) => {
                    let document = decrypt_wire_body_with_fallback(
                        &body,
                        encryption_key,
                        &settings.previous_encryption_key,
                    )?;
                    let value = document.get("payload").cloned().unwrap_or(document);
                    Some(
                        serde_json::from_value(value)
                            .map_err(|e| format!("解析 WebDAV payload 失败: {e}"))?,
                    )
                }
                None => None,
            };
            Ok((payload, etag))
        },
        apply_local,
        |wire, etag, idempotency_key| {
            put(
                &settings.base_url,
                &settings.remote_path,
                &settings.username,
                &settings.password,
                wire,
                etag,
                idempotency_key,
            )
        },
    )
}

pub fn preview(
    settings: &WebDavSettings,
    mode: SyncMode,
    local: SyncPayload,
    device_name: &str,
    encryption_key: &str,
) -> Result<(pipeline::SyncReport, SyncPayload), String> {
    if !settings.enabled {
        return Err("WebDAV 同步未启用".into());
    }
    let _ = resource_url(&settings.base_url, &settings.remote_path)?;
    pipeline::preview_with_transport(mode, local, device_name, "webdav", || {
        let fetched = get(
            &settings.base_url,
            &settings.remote_path,
            &settings.username,
            &settings.password,
        )?;
        require_etag_for_existing(&fetched.body, &fetched.etag)?;
        let etag = fetched.etag;
        let payload = match fetched.body {
            Some(body) => {
                let document = decrypt_wire_body_with_fallback(
                    &body,
                    encryption_key,
                    &settings.previous_encryption_key,
                )?;
                let value = document.get("payload").cloned().unwrap_or(document);
                Some(
                    serde_json::from_value(value)
                        .map_err(|e| format!("解析 WebDAV payload 失败: {e}"))?,
                )
            }
            None => None,
        };
        Ok((payload, etag))
    })
}

#[cfg(test)]
mod tests {
    use super::resource_url;

    #[test]
    fn joins_valid_resource_path_without_url_escape_hatches() {
        assert_eq!(
            resource_url("https://dav.example.test/root/", "pass/sync.json").unwrap(),
            "https://dav.example.test/root/pass/sync.json"
        );
        assert!(resource_url("https://dav.example.test", "../secrets").is_err());
        assert!(resource_url("http://dav.example.test", "sync.json").is_err());
    }
}
