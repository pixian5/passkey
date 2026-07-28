use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, ETAG, IF_MATCH};
use reqwest::StatusCode;
use serde_json::Value;
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

pub fn validate_base_url(base: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err("同步服务器 URL 不能为空".into());
    }
    let parsed = url::Url::parse(&base).map_err(|_| "同步服务器 URL 无效".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("同步服务器 URL 不应包含账号或密码".into());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("同步服务器 URL 不应包含查询串或锚点".into());
    }
    if !matches!(parsed.path(), "" | "/") {
        return Err("同步服务器 URL 不应包含路径".into());
    }
    let is_local = match parsed.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(host)) => host.is_loopback(),
        Some(url::Host::Ipv6(host)) => host.is_loopback(),
        None => false,
    };
    if !(parsed.scheme() == "https" || (is_local && parsed.scheme() == "http")) {
        return Err("同步端点必须使用 HTTPS（本机 localhost 可用 HTTP）".into());
    }
    Ok(base)
}

fn state_url(base: &str) -> Result<String, String> {
    let base = validate_base_url(base)?;
    Ok(format!("{base}/v2/sync/state"))
}

/// Optional Authorization header. Empty token → no auth header (server may allow open access).
fn maybe_auth_header(token: &str) -> Result<Option<HeaderValue>, String> {
    let token = token.trim();
    if token.is_empty() {
        return Ok(None);
    }
    HeaderValue::from_str(&format!("Bearer {token}"))
        .map(Some)
        .map_err(|_| "Bearer Token 含非法字符".to_string())
}

fn apply_auth(headers: &mut HeaderMap, token: &str) -> Result<(), String> {
    if let Some(value) = maybe_auth_header(token)? {
        headers.insert(AUTHORIZATION, value);
    }
    Ok(())
}

/// GET /v2/sync/state — 404 means empty remote.
pub fn get_sync_state(base_url: &str, token: &str) -> Result<FetchResult, String> {
    let url = state_url(base_url)?;
    let client = build_client()?;
    let mut headers = HeaderMap::new();
    apply_auth(&mut headers, token)?;
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
    idempotency_key: Option<&str>,
) -> Result<String, String> {
    let url = state_url(base_url)?;
    let client = build_client()?;
    let mut headers = HeaderMap::new();
    apply_auth(&mut headers, token)?;
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(etag) = if_match {
        if !etag.trim().is_empty() {
            headers.insert(
                IF_MATCH,
                HeaderValue::from_str(etag.trim()).map_err(|_| "ETag 非法".to_string())?,
            );
        }
    }
    let idem = idempotency_key
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    headers.insert(
        "Idempotency-Key",
        HeaderValue::from_str(&idem).unwrap_or(HeaderValue::from_static("idem")),
    );
    // The transport API predates the structured report callback. Until it
    // carries the two IDs separately, the stable logical-write key remains a
    // useful server-side trace for retries and response-loss recovery.
    headers.insert(
        "X-Sync-Operation-Id",
        HeaderValue::from_str(&idem).unwrap_or(HeaderValue::from_static("idem")),
    );
    headers.insert(
        "X-Sync-Client-Version",
        HeaderValue::from_static(env!("CARGO_PKG_VERSION")),
    );
    let resp = client
        .put(&url)
        .headers(headers)
        .body(body.to_vec())
        .send()
        .map_err(|e| format!("推送同步状态失败: {e}"))?;
    let status = resp.status();
    if status == StatusCode::PRECONDITION_FAILED || status == StatusCode::PRECONDITION_REQUIRED {
        return Err("PRECONDITION_FAILED".into());
    }
    if !status.is_success() {
        let code = status.as_u16();
        let text = resp.text().unwrap_or_default();
        return Err(format!("推送同步状态失败 HTTP {code}: {text}"));
    }
    let response_headers = resp.headers().clone();
    let body = resp
        .bytes()
        .map_err(|e| format!("读取同步提交回执失败: {e}"))?;
    let receipt: serde_json::Value =
        serde_json::from_slice(&body).map_err(|e| format!("同步提交回执不是有效 JSON: {e}"))?;
    let etag = response_headers
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let scope = response_headers
        .get("X-Sync-Scope")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let payload_sha256 = response_headers
        .get("X-Payload-Sha256")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let revision_header = response_headers
        .get("X-Sync-Revision")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok());
    let idempotency_header = response_headers
        .get("X-Sync-Idempotency-Key")
        .and_then(|v| v.to_str().ok());
    let receipt_idempotency = receipt.get("idempotencyKey").and_then(Value::as_str);
    let expected_idempotency = idempotency_key.filter(|value| !value.trim().is_empty());
    let valid_receipt = receipt.get("ok").and_then(Value::as_bool) == Some(true)
        && receipt.get("committed").and_then(Value::as_bool) == Some(true)
        && !scope.is_empty()
        && receipt.get("scope").and_then(Value::as_str) == Some(scope)
        && !etag.is_empty()
        && receipt.get("etag").and_then(Value::as_str) == Some(etag.as_str())
        && !payload_sha256.is_empty()
        && receipt.get("payloadSha256").and_then(Value::as_str) == Some(payload_sha256)
        && receipt
            .get("revision")
            .and_then(Value::as_i64)
            .filter(|v| *v > 0)
            == revision_header
        && expected_idempotency.map_or(true, |expected| idempotency_header == Some(expected))
        && expected_idempotency.map_or(true, |expected| receipt_idempotency == Some(expected));
    if !valid_receipt {
        return Err("服务器未返回可验证的同步提交回执".into());
    }
    Ok(etag)
}

#[cfg(test)]
mod tests {
    use super::validate_base_url;

    #[test]
    fn only_loopback_may_use_http() {
        assert!(validate_base_url("https://sync.example.test").is_ok());
        assert!(validate_base_url("http://localhost:53333").is_ok());
        assert!(validate_base_url("http://127.0.0.1:53333").is_ok());
        assert!(validate_base_url("http://localhost.evil.test").is_err());
        assert!(validate_base_url("http://sync.example.test").is_err());
    }

    #[test]
    fn rejects_credentials_query_fragment_and_paths() {
        assert!(validate_base_url("https://user:pass@sync.example.test").is_err());
        assert!(validate_base_url("https://user@sync.example.test").is_err());
        assert!(validate_base_url("https://sync.example.test/?a=b").is_err());
        assert!(validate_base_url("https://sync.example.test/#frag").is_err());
        assert!(validate_base_url("https://sync.example.test/foo").is_err());
        assert!(validate_base_url("ftp://sync.example.test").is_err());
        assert!(validate_base_url("http://127.0.0.1.evil.test").is_err());
    }
}
