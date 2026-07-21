use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, ETAG, IF_MATCH};
use reqwest::StatusCode;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct FetchResult {
    pub body: Option<Vec<u8>>,
    pub etag: Option<String>,
    pub empty: bool,
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))
}

fn validate_base_url(base: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err("同步服务器 URL 不能为空".into());
    }
    let lower = base.to_ascii_lowercase();
    let is_local = lower.contains("://localhost")
        || lower.contains("://127.0.0.1")
        || lower.contains("://[::1]");
    if !(lower.starts_with("https://") || (is_local && lower.starts_with("http://"))) {
        return Err("同步端点必须使用 HTTPS（本机 localhost 可用 HTTP）".into());
    }
    Ok(base)
}

fn state_url(base: &str) -> Result<String, String> {
    let base = validate_base_url(base)?;
    Ok(format!("{base}/v2/sync/state"))
}

fn auth_header(token: &str) -> Result<HeaderValue, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("Bearer Token 不能为空".into());
    }
    HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|_| "Bearer Token 含非法字符".to_string())
}

/// GET /v2/sync/state — 404 means empty remote.
pub fn get_sync_state(base_url: &str, token: &str) -> Result<FetchResult, String> {
    let url = state_url(base_url)?;
    let client = build_client()?;
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, auth_header(token)?);
    let resp = client
        .get(&url)
        .headers(headers)
        .send()
        .map_err(|e| format!("拉取同步状态失败: {e}"))?;
    let status = resp.status();
    if status == StatusCode::NOT_FOUND {
        return Ok(FetchResult {
            body: None,
            etag: None,
            empty: true,
        });
    }
    if !status.is_success() {
        let code = status.as_u16();
        let text = resp.text().unwrap_or_default();
        return Err(format!("拉取同步状态失败 HTTP {code}: {text}"));
    }
    let etag = resp
        .headers()
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_string());
    let body = resp
        .bytes()
        .map_err(|e| format!("读取同步响应失败: {e}"))?
        .to_vec();
    if body.is_empty() {
        return Ok(FetchResult {
            body: None,
            etag,
            empty: true,
        });
    }
    Ok(FetchResult {
        body: Some(body),
        etag,
        empty: false,
    })
}

/// PUT /v2/sync/state with optional If-Match and Idempotency-Key.
pub fn put_sync_state(
    base_url: &str,
    token: &str,
    body: &[u8],
    if_match: Option<&str>,
) -> Result<String, String> {
    let url = state_url(base_url)?;
    let client = build_client()?;
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, auth_header(token)?);
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(etag) = if_match {
        if !etag.trim().is_empty() {
            headers.insert(
                IF_MATCH,
                HeaderValue::from_str(etag.trim())
                    .map_err(|_| "ETag 非法".to_string())?,
            );
        }
    }
    let idem = Uuid::new_v4().to_string();
    headers.insert(
        "Idempotency-Key",
        HeaderValue::from_str(&idem).unwrap_or(HeaderValue::from_static("idem")),
    );
    let resp = client
        .put(&url)
        .headers(headers)
        .body(body.to_vec())
        .send()
        .map_err(|e| format!("推送同步状态失败: {e}"))?;
    let status = resp.status();
    if status == StatusCode::PRECONDITION_FAILED {
        return Err("PRECONDITION_FAILED".into());
    }
    if !status.is_success() {
        let code = status.as_u16();
        let text = resp.text().unwrap_or_default();
        return Err(format!("推送同步状态失败 HTTP {code}: {text}"));
    }
    let etag = resp
        .headers()
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    Ok(etag)
}
