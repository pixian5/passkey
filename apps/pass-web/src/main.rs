use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use pass_csvio::build_csv;
use pass_merge::v2::{
    evaluate_sync_safety, sync_alias_groups, Folder, Passkey, PasswordAccount, SyncPayload,
};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use reqwest::blocking::Client;
use reqwest::header::{
    HeaderMap as ReqwestHeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, ETAG, IF_MATCH,
};
use reqwest::StatusCode as ReqwestStatusCode;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;
use url::Url;
use uuid::Uuid;

const KEY_FILE: &str = "pass-web-vault-key-v1";
const VAULT_FILE: &str = "pass-web-vault-v1.enc";
const FIXED_FOLDER_ID: &str = pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID;
const FIXED_FOLDER_NAME: &str = pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_NAME;
const LOCK_PBKDF2_ITERS: u32 = 310_000;

#[derive(Clone)]
struct AppState {
    vault: Arc<Mutex<Vault>>,
    auth_token: String,
    static_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HistoryItem {
    id: String,
    title: String,
    created_at_ms: i64,
    payload: SyncPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LocalSnapshot {
    id: String,
    created_at_ms: i64,
    reason: String,
    payload: SyncPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalSnapshotSummary {
    id: String,
    created_at_ms: i64,
    reason: String,
    accounts: usize,
    folders: usize,
    passkeys: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VaultData {
    device_name: String,
    accounts: Vec<PasswordAccount>,
    folders: Vec<Folder>,
    passkeys: Vec<Passkey>,
    ui_prefs: Value,
    sync_settings: Value,
    undo: Vec<HistoryItem>,
    redo: Vec<HistoryItem>,
    #[serde(default)]
    snapshots: Vec<LocalSnapshot>,
    #[serde(default)]
    lock: WebLockData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebLockData {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    salt_b64: String,
    #[serde(default)]
    verifier_b64: String,
    #[serde(default = "default_lock_iterations")]
    iterations: u32,
    #[serde(default = "default_idle_lock_minutes")]
    idle_lock_minutes: u32,
    #[serde(default)]
    lock_policy: String,
    #[serde(default)]
    prefer_biometrics: bool,
    #[serde(default = "default_background_lock_delay")]
    background_lock_delay_seconds: u32,
}

impl Default for WebLockData {
    fn default() -> Self {
        Self {
            enabled: false,
            salt_b64: String::new(),
            verifier_b64: String::new(),
            iterations: default_lock_iterations(),
            idle_lock_minutes: default_idle_lock_minutes(),
            lock_policy: "onceUntilQuit".into(),
            prefer_biometrics: false,
            background_lock_delay_seconds: default_background_lock_delay(),
        }
    }
}

fn default_lock_iterations() -> u32 {
    LOCK_PBKDF2_ITERS
}
fn default_idle_lock_minutes() -> u32 {
    5
}
fn default_background_lock_delay() -> u32 {
    60
}

struct Vault {
    dir: PathBuf,
    data: VaultData,
    locked: bool,
    last_activity_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountInput {
    sites: Vec<String>,
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    totp_secret: String,
    #[serde(default)]
    recovery_codes: String,
    #[serde(default)]
    note: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStateOutput {
    device_name: String,
    active_accounts: Vec<PasswordAccount>,
    deleted_accounts: Vec<PasswordAccount>,
    folders: Vec<Folder>,
    passkeys: Vec<Passkey>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UndoStatus {
    title: String,
    created_at_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistorySummary {
    id: String,
    title: String,
    created_at_ms: i64,
    stack: String,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn private_file(path: &FsPath) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

fn private_dir(path: &FsPath) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("创建数据目录失败：{e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

fn private_dir_result(path: &FsPath) -> Result<(), String> {
    private_dir(path)
}

fn load_key(dir: &FsPath) -> Result<[u8; 32], String> {
    private_dir_result(dir)?;
    let path = dir.join(KEY_FILE);
    if let Ok(bytes) = fs::read(&path) {
        if bytes.len() != 32 {
            return Err("Web vault 密钥长度无效".into());
        }
        let mut key = [0; 32];
        key.copy_from_slice(&bytes);
        private_file(&path);
        return Ok(key);
    }
    let mut key = [0; 32];
    rand::thread_rng().fill_bytes(&mut key);
    fs::write(&path, key).map_err(|e| format!("写入 Web vault 密钥失败：{e}"))?;
    private_file(&path);
    Ok(key)
}

fn encrypt(dir: &FsPath, plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = load_key(dir)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let mut out = nonce.to_vec();
    out.extend(
        cipher
            .encrypt(Nonce::from_slice(&nonce), plain)
            .map_err(|_| "加密 Web vault 失败".to_string())?,
    );
    Ok(out)
}

fn decrypt(dir: &FsPath, raw: &[u8]) -> Result<Vec<u8>, String> {
    if raw.len() < 28 {
        return Err("Web vault 数据损坏".into());
    }
    let key = load_key(dir)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(Nonce::from_slice(&raw[..12]), &raw[12..])
        .map_err(|_| "Web vault 解密失败".to_string())
}

fn save_data(dir: &FsPath, data: &VaultData) -> Result<(), String> {
    private_dir_result(dir)?;
    let raw = serde_json::to_vec(data).map_err(|e| format!("序列化 Web vault 失败：{e}"))?;
    let encrypted = encrypt(dir, &raw)?;
    let path = dir.join(VAULT_FILE);
    let temp = dir.join(format!(".{VAULT_FILE}.{}.tmp", Uuid::new_v4()));
    fs::write(&temp, encrypted).map_err(|e| format!("写入 Web vault 临时文件失败：{e}"))?;
    private_file(&temp);
    fs::rename(&temp, &path).map_err(|e| format!("更新 Web vault 失败：{e}"))?;
    private_file(&path);
    Ok(())
}

fn ensure_fixed_folder(data: &mut VaultData) {
    if data.device_name.trim().is_empty() {
        data.device_name = "PassWeb".into();
    }
    if !data
        .folders
        .iter()
        .any(|f| f.id.eq_ignore_ascii_case(FIXED_FOLDER_ID))
    {
        data.folders.insert(
            0,
            Folder {
                id: FIXED_FOLDER_ID.into(),
                name: FIXED_FOLDER_NAME.into(),
                created_at_ms: now_ms(),
                updated_at_ms: now_ms(),
                ..Default::default()
            },
        );
    }
}

impl Vault {
    fn open(dir: PathBuf) -> Result<Self, String> {
        private_dir_result(&dir)?;
        let path = dir.join(VAULT_FILE);
        let data = if path.exists() {
            serde_json::from_slice(&decrypt(
                &dir,
                &fs::read(&path).map_err(|e| format!("读取 Web vault 失败：{e}"))?,
            )?)
            .map_err(|e| format!("解析 Web vault 失败：{e}"))?
        } else {
            VaultData::default()
        };
        let was_enabled = data.lock.enabled && !data.lock.verifier_b64.trim().is_empty();
        let mut vault = Self {
            dir,
            data,
            locked: was_enabled,
            last_activity_ms: now_ms(),
        };
        ensure_fixed_folder(&mut vault.data);
        if !path.exists() {
            vault.save()?;
        }
        Ok(vault)
    }
    fn save(&self) -> Result<(), String> {
        save_data(&self.dir, &self.data)
    }
    fn payload(&self) -> SyncPayload {
        SyncPayload {
            accounts: self.data.accounts.clone(),
            folders: self.data.folders.clone(),
            passkeys: self.data.passkeys.clone(),
        }
    }
    fn apply_payload(&mut self, payload: SyncPayload) {
        self.data.accounts = payload.accounts;
        self.data.folders = payload.folders;
        self.data.passkeys = payload.passkeys;
        ensure_fixed_folder(&mut self.data);
    }
    fn maybe_lock(&mut self) {
        if !self.data.lock.enabled || self.locked {
            return;
        }
        if self.data.lock.lock_policy == "idleTimeout"
            && self.data.lock.idle_lock_minutes > 0
            && now_ms().saturating_sub(self.last_activity_ms)
                >= i64::from(self.data.lock.idle_lock_minutes) * 60_000
        {
            self.locked = true;
        }
    }
    fn touch(&mut self) {
        self.maybe_lock();
        if !self.locked {
            self.last_activity_ms = now_ms();
        }
    }
    fn lock_public_state(&mut self) -> Value {
        self.maybe_lock();
        json!({
            "enabled": self.data.lock.enabled,
            "locked": self.data.lock.enabled && self.locked,
            "idleLockMinutes": self.data.lock.idle_lock_minutes,
            "hasPassword": self.data.lock.enabled && !self.data.lock.verifier_b64.is_empty(),
            "lockPolicy": if self.data.lock.lock_policy.is_empty() { "onceUntilQuit" } else { &self.data.lock.lock_policy },
            "preferBiometrics": self.data.lock.prefer_biometrics,
            "backgroundLockDelaySeconds": self.data.lock.background_lock_delay_seconds,
            "biometricReady": false
        })
    }
    fn begin(&mut self, title: &str) {
        self.data.snapshots.push(LocalSnapshot {
            id: Uuid::new_v4().to_string(),
            created_at_ms: now_ms(),
            reason: title.into(),
            payload: self.payload(),
        });
        self.data
            .snapshots
            .sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        if self.data.snapshots.len() > 20 {
            self.data.snapshots.truncate(20);
        }
        self.data.undo.push(HistoryItem {
            id: Uuid::new_v4().to_string(),
            title: title.into(),
            created_at_ms: now_ms(),
            payload: self.payload(),
        });
        if self.data.undo.len() > 100 {
            self.data.undo.remove(0);
        }
        self.data.redo.clear();
    }
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|e| format!("参数 {key} 无效：{e}"))
}
fn account_key(a: &PasswordAccount) -> String {
    a.record_id
        .clone()
        .or(a.id.clone())
        .unwrap_or_else(|| a.account_id.clone())
}
fn normalize_sites(sites: Vec<String>) -> Vec<String> {
    sites
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}
fn account_mut<'a>(
    accounts: &'a mut [PasswordAccount],
    id: &str,
) -> Option<&'a mut PasswordAccount> {
    accounts
        .iter_mut()
        .find(|a| account_key(a).eq_ignore_ascii_case(id) || a.account_id.eq_ignore_ascii_case(id))
}

fn app_state(v: &VaultData) -> AppStateOutput {
    AppStateOutput {
        device_name: v.device_name.clone(),
        active_accounts: v
            .accounts
            .iter()
            .filter(|a| !a.is_deleted && !a.is_permanently_deleted)
            .cloned()
            .collect(),
        deleted_accounts: v
            .accounts
            .iter()
            .filter(|a| a.is_deleted && !a.is_permanently_deleted)
            .cloned()
            .collect(),
        folders: v.folders.clone(),
        passkeys: v.passkeys.clone(),
    }
}

fn extract_payload(value: Value) -> Result<SyncPayload, String> {
    let payload = value.get("payload").cloned().unwrap_or(value);
    serde_json::from_value(payload).map_err(|e| format!("解析同步 payload 失败：{e}"))
}

fn bundle_document(v: &Vault) -> Value {
    json!({
        "schema": "pass.sync.bundle.v2",
        "exportedAtMs": now_ms(),
        "source": {"app":"pass-web", "platform":"linux", "deviceName":v.data.device_name, "formatVersion":2},
        "payload": v.payload(),
    })
}

fn sync_bundle_document(v: &Vault, payload: &SyncPayload) -> Value {
    json!({
        "schema": "pass.sync.bundle.v2",
        "exportedAtMs": now_ms(),
        "source": {"app":"pass-web", "platform":"linux", "deviceName":v.data.device_name, "formatVersion":2},
        "payload": payload,
    })
}

fn full_csv(v: &Vault) -> String {
    let headers = [
        "account_id",
        "sites",
        "username",
        "password",
        "totp_secret",
        "recovery_codes",
        "note",
        "created_at_ms",
        "updated_at_ms",
        "is_deleted",
    ];
    let rows = v
        .data
        .accounts
        .iter()
        .map(|a| {
            vec![
                a.account_id.clone(),
                a.sites.join(";"),
                a.username.clone(),
                a.password.clone(),
                a.totp_secret.clone(),
                a.recovery_codes.clone(),
                a.note.clone(),
                a.created_at_ms.to_string(),
                a.updated_at_ms.to_string(),
                a.is_deleted.to_string(),
            ]
        })
        .collect::<Vec<_>>();
    build_csv(&headers, &rows)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SyncMode {
    Merge,
    RemoteOverwriteLocal,
    LocalOverwriteRemote,
}

impl SyncMode {
    fn parse(value: &str) -> Self {
        match value.trim() {
            "remoteOverwriteLocal" => Self::RemoteOverwriteLocal,
            "localOverwriteRemote" => Self::LocalOverwriteRemote,
            _ => Self::Merge,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Self::Merge => "merge",
            Self::RemoteOverwriteLocal => "remoteOverwriteLocal",
            Self::LocalOverwriteRemote => "localOverwriteRemote",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncReport {
    ok: bool,
    dry_run: bool,
    mode: String,
    message: String,
    safe: bool,
    reasons: Vec<String>,
    local_accounts: usize,
    remote_accounts: usize,
    merged_accounts: usize,
    applied: bool,
    pushed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
}

#[derive(Debug, Clone)]
struct FetchResult {
    body: Option<Vec<u8>>,
    etag: Option<String>,
}

fn visible_accounts(payload: &SyncPayload) -> usize {
    payload
        .accounts
        .iter()
        .filter(|a| !a.is_permanently_deleted)
        .count()
}

fn visible_folders(payload: &SyncPayload) -> usize {
    payload
        .folders
        .iter()
        .filter(|f| !f.is_permanently_deleted)
        .count()
}

fn visible_passkeys(payload: &SyncPayload) -> usize {
    payload
        .passkeys
        .iter()
        .filter(|p| !p.is_permanently_deleted)
        .count()
}

fn decode_sync_key(raw: &str) -> Result<[u8; 32], String> {
    let text = raw.trim();
    let bytes = URL_SAFE_NO_PAD
        .decode(text)
        .or_else(|_| STANDARD.decode(text))
        .map_err(|_| "同步加密密钥无效，必须是 256 位密钥或留空".to_string())?;
    if bytes.len() != 32 {
        return Err("同步加密密钥无效，必须是 256 位密钥或留空".into());
    }
    let mut key = [0; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn encrypt_sync_document(doc: &Value, key_text: &str) -> Result<Vec<u8>, String> {
    if key_text.trim().is_empty() {
        return serde_json::to_vec(doc).map_err(|e| e.to_string());
    }
    let key = decode_sync_key(key_text)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let plaintext = serde_json::to_vec(doc).map_err(|e| e.to_string())?;
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            aes_gcm::aead::Payload {
                msg: &plaintext,
                aad: b"pass.sync.encrypted.v1",
            },
        )
        .map_err(|_| "同步加密失败".to_string())?;
    let digest = Sha256::digest(key);
    let key_id = digest
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    serde_json::to_vec(&json!({
        "schema": "pass.sync.encrypted.v1",
        "exportedAtMs": doc.get("exportedAtMs").and_then(Value::as_i64).unwrap_or(0),
        "keyId": format!("k1-{key_id}"),
        "cipher": "AES-256-GCM",
        "nonceBase64": STANDARD.encode(nonce),
        "ciphertextBase64": STANDARD.encode(encrypted),
    }))
    .map_err(|e| e.to_string())
}

fn decrypt_sync_document(raw: &[u8], key_text: &str) -> Result<Value, String> {
    let value: Value =
        serde_json::from_slice(raw).map_err(|e| format!("同步响应不是 JSON：{e}"))?;
    let schema = value.get("schema").and_then(Value::as_str).unwrap_or("");
    if schema == "pass.sync.bundle.v2" || (schema.is_empty() && value.get("cipher").is_none()) {
        if !key_text.trim().is_empty() {
            return Err("同步密钥已配置，拒绝未加密同步包".into());
        }
        return Ok(value);
    }
    if schema != "pass.sync.encrypted.v1" {
        return Err("不支持的同步包格式".into());
    }
    let key = decode_sync_key(key_text)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = STANDARD
        .decode(
            value
                .get("nonceBase64")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )
        .map_err(|_| "同步 nonce 无效".to_string())?;
    let ciphertext = STANDARD
        .decode(
            value
                .get("ciphertextBase64")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )
        .map_err(|_| "同步密文无效".to_string())?;
    if nonce.len() != 12 {
        return Err("同步 nonce 长度无效".into());
    }
    let plain = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            aes_gcm::aead::Payload {
                msg: &ciphertext,
                aad: b"pass.sync.encrypted.v1",
            },
        )
        .map_err(|_| "同步包解密失败，请确认同步密钥一致".to_string())?;
    serde_json::from_slice(&plain).map_err(|e| format!("解密后不是合法 JSON：{e}"))
}

fn sync_base_url(raw: &str) -> Result<String, String> {
    let base = raw.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("同步服务器 URL 不能为空".into());
    }
    let parsed = Url::parse(base).map_err(|_| "同步服务器 URL 无效".to_string())?;
    let local = matches!(parsed.host(), Some(url::Host::Domain(h)) if h.eq_ignore_ascii_case("localhost"))
        || matches!(parsed.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
        || matches!(parsed.host(), Some(url::Host::Ipv6(ip)) if ip.is_loopback());
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("同步服务器 URL 不应包含账号、密码、查询串或锚点".into());
    }
    if !parsed.path().is_empty() && parsed.path() != "/" {
        return Err("同步服务器 URL 不应包含路径".into());
    }
    if parsed.scheme() != "https" && !(local && parsed.scheme() == "http") {
        return Err("同步端点必须使用 HTTPS（本机 localhost 可使用 HTTP）".into());
    }
    Ok(base.to_string())
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败：{e}"))
}

fn auth_headers(token: &str) -> Result<ReqwestHeaderMap, String> {
    let mut headers = ReqwestHeaderMap::new();
    if !token.trim().is_empty() {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", token.trim()))
                .map_err(|_| "Bearer Token 含非法字符".to_string())?,
        );
    }
    Ok(headers)
}

fn self_hosted_get(base: &str, token: &str) -> Result<FetchResult, String> {
    let url = format!("{}/v2/sync/state", sync_base_url(base)?);
    let response = http_client()?
        .get(url)
        .headers(auth_headers(token)?)
        .send()
        .map_err(|e| format!("拉取同步状态失败：{e}"))?;
    if response.status() == ReqwestStatusCode::NOT_FOUND {
        return Ok(FetchResult {
            body: None,
            etag: None,
        });
    }
    if !response.status().is_success() {
        return Err(format!(
            "拉取同步状态失败 HTTP {}：{}",
            response.status().as_u16(),
            response.text().unwrap_or_default()
        ));
    }
    let etag = response
        .headers()
        .get(ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let body = response
        .bytes()
        .map_err(|e| format!("读取同步响应失败：{e}"))?
        .to_vec();
    Ok(FetchResult {
        body: (!body.is_empty()).then_some(body),
        etag,
    })
}

fn self_hosted_put(
    base: &str,
    token: &str,
    body: &[u8],
    etag: Option<&str>,
) -> Result<String, String> {
    let url = format!("{}/v2/sync/state", sync_base_url(base)?);
    let mut headers = auth_headers(token)?;
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "Idempotency-Key",
        HeaderValue::from_str(&Uuid::new_v4().to_string()).unwrap(),
    );
    if let Some(tag) = etag.filter(|v| !v.trim().is_empty()) {
        headers.insert(
            IF_MATCH,
            HeaderValue::from_str(tag.trim()).map_err(|_| "ETag 非法".to_string())?,
        );
    }
    let response = http_client()?
        .put(url)
        .headers(headers)
        .body(body.to_vec())
        .send()
        .map_err(|e| format!("推送同步状态失败：{e}"))?;
    if response.status() == ReqwestStatusCode::PRECONDITION_FAILED {
        return Err("PRECONDITION_FAILED".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "推送同步状态失败 HTTP {}：{}",
            response.status().as_u16(),
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

fn self_hosted_versions(base: &str, token: &str) -> Result<Vec<Value>, String> {
    let url = format!("{}/v2/sync/versions", sync_base_url(base)?);
    let response = http_client()?
        .get(url)
        .headers(auth_headers(token)?)
        .send()
        .map_err(|e| format!("读取服务器快照失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "读取服务器快照失败 HTTP {}：{}",
            response.status().as_u16(),
            response.text().unwrap_or_default()
        ));
    }
    let value: Value = response
        .json()
        .map_err(|e| format!("解析服务器快照失败：{e}"))?;
    Ok(value
        .as_array()
        .or_else(|| value.get("versions").and_then(Value::as_array))
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let id = item
                .get("id")
                .or_else(|| item.get("versionId"))
                .and_then(|id| match id {
                    Value::String(value) => Some(value.clone()),
                    Value::Number(value) => Some(value.to_string()),
                    _ => None,
                })?;
            Some(json!({
                "id": id,
                "exportedAtMs": item.get("exportedAtMs").and_then(Value::as_i64).unwrap_or(0),
                "savedAtMs": item.get("savedAtMs").and_then(Value::as_i64).unwrap_or(0),
                "payloadSha256": item.get("payloadSha256").and_then(Value::as_str).unwrap_or("")
            }))
        })
        .collect())
}

fn self_hosted_version(
    base: &str,
    token: &str,
    version_id: &str,
    key: &str,
) -> Result<SyncPayload, String> {
    if !version_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("服务器快照编号无效".into());
    }
    let url = format!("{}/v2/sync/versions/{version_id}", sync_base_url(base)?);
    let response = http_client()?
        .get(url)
        .headers(auth_headers(token)?)
        .send()
        .map_err(|e| format!("下载服务器快照失败：{e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "下载服务器快照失败 HTTP {}：{}",
            response.status().as_u16(),
            response.text().unwrap_or_default()
        ));
    }
    let body = response
        .bytes()
        .map_err(|e| format!("读取服务器快照失败：{e}"))?;
    extract_payload(decrypt_sync_document(&body, key)?)
}

fn webdav_resource_url(base: &str, remote_path: &str) -> Result<String, String> {
    let path = remote_path.trim().trim_start_matches('/');
    if path.is_empty()
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("WebDAV 远端路径无效".into());
    }
    let mut parsed = Url::parse(base.trim()).map_err(|_| "WebDAV 地址无效".to_string())?;
    let local = matches!(parsed.host(), Some(url::Host::Domain(h)) if h.eq_ignore_ascii_case("localhost"))
        || matches!(parsed.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
        || matches!(parsed.host(), Some(url::Host::Ipv6(ip)) if ip.is_loopback());
    if parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("WebDAV 地址不应包含账号、密码、查询串或锚点".into());
    }
    if parsed.scheme() != "https" && !(local && parsed.scheme() == "http") {
        return Err("WebDAV 必须使用 HTTPS（本机 localhost 可使用 HTTP）".into());
    }
    let mut joined = parsed.path().trim_end_matches('/').to_string();
    joined.push('/');
    joined.push_str(path);
    parsed.set_path(&joined);
    Ok(parsed.to_string())
}

fn webdav_headers(username: &str, password: &str) -> Result<ReqwestHeaderMap, String> {
    let mut headers = ReqwestHeaderMap::new();
    if !username.trim().is_empty() || !password.is_empty() {
        let value = STANDARD.encode(format!("{}:{}", username.trim(), password));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Basic {value}"))
                .map_err(|_| "WebDAV 凭据含非法字符".to_string())?,
        );
    }
    Ok(headers)
}

fn webdav_get(
    base: &str,
    path: &str,
    username: &str,
    password: &str,
) -> Result<FetchResult, String> {
    let response = http_client()?
        .get(webdav_resource_url(base, path)?)
        .headers(webdav_headers(username, password)?)
        .send()
        .map_err(|e| format!("拉取 WebDAV 同步包失败：{e}"))?;
    if response.status() == ReqwestStatusCode::NOT_FOUND {
        return Ok(FetchResult {
            body: None,
            etag: None,
        });
    }
    if !response.status().is_success() {
        return Err(format!(
            "拉取 WebDAV 同步包失败 HTTP {}：{}",
            response.status().as_u16(),
            response.text().unwrap_or_default()
        ));
    }
    let etag = response
        .headers()
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response
        .bytes()
        .map_err(|e| format!("读取 WebDAV 响应失败：{e}"))?
        .to_vec();
    Ok(FetchResult {
        body: (!body.is_empty()).then_some(body),
        etag,
    })
}

fn webdav_put(
    base: &str,
    path: &str,
    username: &str,
    password: &str,
    body: &[u8],
    etag: Option<&str>,
) -> Result<String, String> {
    let mut headers = webdav_headers(username, password)?;
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(tag) = etag.filter(|value| !value.trim().is_empty()) {
        headers.insert(
            IF_MATCH,
            HeaderValue::from_str(tag.trim()).map_err(|_| "WebDAV ETag 非法".to_string())?,
        );
    }
    let response = http_client()?
        .put(webdav_resource_url(base, path)?)
        .headers(headers)
        .body(body.to_vec())
        .send()
        .map_err(|e| format!("写入 WebDAV 同步包失败：{e}"))?;
    if response.status() == ReqwestStatusCode::PRECONDITION_FAILED {
        return Err("PRECONDITION_FAILED".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "写入 WebDAV 同步包失败 HTTP {}：{}",
            response.status().as_u16(),
            response.text().unwrap_or_default()
        ));
    }
    Ok(response
        .headers()
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string())
}

fn run_webdav_sync(v: &mut Vault, mode: SyncMode, dry_run: bool) -> Result<Value, String> {
    let prefs = v.data.ui_prefs.clone();
    if !prefs
        .get("webdavEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err("WebDAV 同步未启用".into());
    }
    let base = prefs
        .get("webdavBaseUrl")
        .and_then(Value::as_str)
        .unwrap_or("");
    let path = prefs
        .get("webdavRemotePath")
        .and_then(Value::as_str)
        .unwrap_or("pass-sync-bundle-v2.json");
    let username = prefs
        .get("webdavUsername")
        .and_then(Value::as_str)
        .unwrap_or("");
    let password = prefs
        .get("webdavPassword")
        .and_then(Value::as_str)
        .unwrap_or("");
    let key = v
        .data
        .sync_settings
        .get("encryptionKey")
        .and_then(Value::as_str)
        .unwrap_or("");
    let local = v.payload();
    let fetched = webdav_get(base, path, username, password)?;
    let mut remote = fetched
        .body
        .as_deref()
        .map(|body| decrypt_sync_document(body, key))
        .transpose()?
        .map(extract_payload)
        .transpose()?;
    let remote_for_mode = remote.clone().unwrap_or_default();
    let merged = match mode {
        SyncMode::Merge => pass_merge::v2::merge_sync_payloads(local.clone(), remote_for_mode),
        SyncMode::RemoteOverwriteLocal => remote_for_mode,
        SyncMode::LocalOverwriteRemote => local.clone(),
    };
    let safety = evaluate_sync_safety(
        &local,
        remote.as_ref(),
        &merged,
        if mode == SyncMode::RemoteOverwriteLocal {
            "remoteOverwriteLocal"
        } else {
            "merge"
        },
    );
    let local_count = visible_accounts(&local);
    let remote_count = remote.as_ref().map(visible_accounts).unwrap_or(0);
    let merged_count = visible_accounts(&merged);
    let report = SyncReport {
        ok: safety.safe,
        dry_run,
        mode: mode.as_str().into(),
        message: if safety.safe {
            format!("WebDAV 预览：本地 {local_count} → 合并 {merged_count}（远端 {remote_count}）")
        } else {
            format!(
                "WebDAV 同步停止：安全检查未通过（{}）",
                safety.reasons.join("、")
            )
        },
        safe: safety.safe,
        reasons: safety.reasons,
        local_accounts: local_count,
        remote_accounts: remote_count,
        merged_accounts: merged_count,
        applied: false,
        pushed: false,
        etag: fetched.etag.clone(),
    };
    if dry_run || !report.safe {
        return Ok(json!({"report": report, "localPayload": local, "payload": merged}));
    }
    let mut to_store = if mode == SyncMode::LocalOverwriteRemote {
        local.clone()
    } else {
        merged.clone()
    };
    let mut wire = encrypt_sync_document(&sync_bundle_document(v, &to_store), key)?;
    let mut current_etag = fetched.etag;
    let mut remote_count = remote.as_ref().map(visible_accounts).unwrap_or(0);
    for _attempt in 0..5 {
        match webdav_put(
            base,
            path,
            username,
            password,
            &wire,
            current_etag.as_deref(),
        ) {
            Ok(new_etag) => {
                v.begin("WebDAV 同步写入本地前自动备份");
                v.apply_payload(to_store.clone());
                v.save()?;
                return Ok(json!({"report": SyncReport {
                    ok: true,
                    dry_run: false,
                    mode: mode.as_str().into(),
                    message: format!("WebDAV 同步完成：账号 {}→{}", local_count, visible_accounts(&to_store)),
                    safe: true,
                    reasons: vec![],
                    local_accounts: local_count,
                    remote_accounts: remote_count,
                    merged_accounts: visible_accounts(&to_store),
                    applied: true,
                    pushed: true,
                    etag: Some(new_etag),
                }}));
            }
            Err(error) if error == "PRECONDITION_FAILED" => {
                let latest = webdav_get(base, path, username, password)?;
                current_etag = latest.etag;
                remote = latest
                    .body
                    .as_deref()
                    .map(|body| decrypt_sync_document(body, key))
                    .transpose()?
                    .map(extract_payload)
                    .transpose()?;
                let remote_for_mode = remote.clone().unwrap_or_default();
                let merged = match mode {
                    SyncMode::Merge => {
                        pass_merge::v2::merge_sync_payloads(local.clone(), remote_for_mode)
                    }
                    SyncMode::RemoteOverwriteLocal => remote_for_mode,
                    SyncMode::LocalOverwriteRemote => local.clone(),
                };
                let safety = evaluate_sync_safety(
                    &local,
                    remote.as_ref(),
                    &merged,
                    if mode == SyncMode::RemoteOverwriteLocal {
                        "remoteOverwriteLocal"
                    } else {
                        "merge"
                    },
                );
                if !safety.safe {
                    return Ok(json!({"report": SyncReport {
                        ok: false,
                        dry_run: false,
                        mode: mode.as_str().into(),
                        message: format!("WebDAV 同步停止：安全检查未通过（{}）", safety.reasons.join("、")),
                        safe: false,
                        reasons: safety.reasons,
                        local_accounts: visible_accounts(&local),
                        remote_accounts: remote.as_ref().map(visible_accounts).unwrap_or(0),
                        merged_accounts: visible_accounts(&merged),
                        applied: false,
                        pushed: false,
                        etag: current_etag.clone(),
                    }}));
                }
                to_store = if mode == SyncMode::LocalOverwriteRemote {
                    local.clone()
                } else {
                    merged
                };
                remote_count = remote.as_ref().map(visible_accounts).unwrap_or(0);
                wire = encrypt_sync_document(&sync_bundle_document(v, &to_store), key)?;
            }
            Err(error) => return Err(error),
        }
    }
    Err("WebDAV 同步冲突重试次数已用尽".into())
}

fn run_self_hosted_sync(v: &mut Vault, mode: SyncMode, dry_run: bool) -> Result<Value, String> {
    let settings = v.data.sync_settings.clone();
    if !settings
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err("同步未启用".into());
    }
    let base = settings
        .get("baseUrl")
        .and_then(Value::as_str)
        .unwrap_or("");
    let token = settings
        .get("authToken")
        .and_then(Value::as_str)
        .unwrap_or("");
    let key = settings
        .get("encryptionKey")
        .and_then(Value::as_str)
        .unwrap_or("");
    let local = v.payload();
    let fetched = self_hosted_get(base, token)?;
    let mut remote = fetched
        .body
        .as_deref()
        .map(|body| decrypt_sync_document(body, key))
        .transpose()?
        .map(extract_payload)
        .transpose()?;
    let remote_for_mode = remote.clone().unwrap_or_default();
    let merged = match mode {
        SyncMode::Merge => pass_merge::v2::merge_sync_payloads(local.clone(), remote_for_mode),
        SyncMode::RemoteOverwriteLocal => remote_for_mode,
        SyncMode::LocalOverwriteRemote => local.clone(),
    };
    let safety = evaluate_sync_safety(
        &local,
        remote.as_ref(),
        &merged,
        if mode == SyncMode::RemoteOverwriteLocal {
            "remoteOverwriteLocal"
        } else {
            "merge"
        },
    );
    let local_count = visible_accounts(&local);
    let remote_count = remote.as_ref().map(visible_accounts).unwrap_or(0);
    let merged_count = visible_accounts(&merged);
    let report = SyncReport {
        ok: safety.safe,
        dry_run,
        mode: mode.as_str().into(),
        message: if safety.safe {
            format!("同步预览：本地 {local_count} → 合并 {merged_count}（远端 {remote_count}）")
        } else {
            format!("同步停止：安全检查未通过（{}）", safety.reasons.join("、"))
        },
        safe: safety.safe,
        reasons: safety.reasons,
        local_accounts: local_count,
        remote_accounts: remote_count,
        merged_accounts: merged_count,
        applied: false,
        pushed: false,
        etag: fetched.etag.clone(),
    };
    if dry_run || !report.safe {
        return Ok(json!({
            "report": report,
            "localPayload": local,
            "payload": merged
        }));
    }
    let mut to_store = if mode == SyncMode::LocalOverwriteRemote {
        local.clone()
    } else {
        merged.clone()
    };
    let device = v.data.device_name.clone();
    for account in &mut to_store.accounts {
        if account.last_operated_device_name.trim().is_empty() {
            account.last_operated_device_name = device.clone();
        }
    }
    let _ = sync_alias_groups(&mut to_store.accounts, now_ms(), &device);
    let mut wire = encrypt_sync_document(&sync_bundle_document(v, &to_store), key)?;
    let mut attempt = 0;
    let mut current_etag = fetched.etag;
    loop {
        attempt += 1;
        match self_hosted_put(base, token, &wire, current_etag.as_deref()) {
            Ok(new_etag) => {
                v.begin("同步写入本地前自动备份");
                v.apply_payload(to_store.clone());
                v.save()?;
                return Ok(json!({
                    "report": SyncReport {
                        ok: true,
                        dry_run: false,
                        mode: mode.as_str().into(),
                        message: format!("同步完成：账号 {local_count}→{}", visible_accounts(&to_store)),
                        safe: true,
                        reasons: vec![],
                        local_accounts: local_count,
                        remote_accounts: remote_count,
                        merged_accounts: visible_accounts(&to_store),
                        applied: true,
                        pushed: true,
                        etag: Some(new_etag),
                    }
                }));
            }
            Err(error) if error == "PRECONDITION_FAILED" && attempt < 5 => {
                let latest = self_hosted_get(base, token)?;
                current_etag = latest.etag;
                remote = latest
                    .body
                    .as_deref()
                    .map(|body| decrypt_sync_document(body, key))
                    .transpose()?
                    .map(extract_payload)
                    .transpose()?;
                let remote_for_mode = remote.clone().unwrap_or_default();
                let merged = match mode {
                    SyncMode::Merge => {
                        pass_merge::v2::merge_sync_payloads(local.clone(), remote_for_mode)
                    }
                    SyncMode::RemoteOverwriteLocal => remote_for_mode,
                    SyncMode::LocalOverwriteRemote => local.clone(),
                };
                let safety = evaluate_sync_safety(
                    &local,
                    remote.as_ref(),
                    &merged,
                    if mode == SyncMode::RemoteOverwriteLocal {
                        "remoteOverwriteLocal"
                    } else {
                        "merge"
                    },
                );
                if !safety.safe {
                    return Ok(json!({"report": SyncReport {
                        ok: false,
                        dry_run: false,
                        mode: mode.as_str().into(),
                        message: format!("同步停止：安全检查未通过（{}）", safety.reasons.join("、")),
                        safe: false,
                        reasons: safety.reasons,
                        local_accounts: visible_accounts(&local),
                        remote_accounts: remote.as_ref().map(visible_accounts).unwrap_or(0),
                        merged_accounts: visible_accounts(&merged),
                        applied: false,
                        pushed: false,
                        etag: current_etag.clone(),
                    }}));
                }
                to_store = if mode == SyncMode::LocalOverwriteRemote {
                    local.clone()
                } else {
                    merged
                };
                let device = v.data.device_name.clone();
                for account in &mut to_store.accounts {
                    if account.last_operated_device_name.trim().is_empty() {
                        account.last_operated_device_name = device.clone();
                    }
                }
                let _ = sync_alias_groups(&mut to_store.accounts, now_ms(), &device);
                wire = encrypt_sync_document(&sync_bundle_document(v, &to_store), key)?;
            }
            Err(error) => return Err(error),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderRuleResult {
    folder: Folder,
    matched_count: usize,
    added_count: usize,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderDuplicateGroup {
    id: String,
    site_aliases: Vec<String>,
    username: String,
    accounts: Vec<PasswordAccount>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeduplicateResult {
    deleted_count: usize,
    kept_count: usize,
    group_count: usize,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TotpImportResult {
    created: usize,
    updated: usize,
    skipped: usize,
}

fn split_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    quoted = false;
                }
            } else {
                field.push(ch);
            }
            continue;
        }
        match ch {
            '"' => quoted = true,
            ',' => row.push(std::mem::take(&mut field)),
            '\n' => {
                row.push(std::mem::take(&mut field));
                if row.iter().any(|v| !v.trim().is_empty()) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
            }
            '\r' => {}
            other => field.push(other),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        if row.iter().any(|v| !v.trim().is_empty()) {
            rows.push(row);
        }
    }
    rows
}

fn csv_header(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('\u{feff}')
        .to_ascii_lowercase()
        .replace([' ', '_'], "")
}

fn csv_host(value: &str) -> Option<String> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let host = raw
        .strip_prefix("https://")
        .or_else(|| raw.strip_prefix("http://"))
        .unwrap_or(raw)
        .split(['/', '?', '#', ':'])
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    (!host.is_empty()).then_some(host)
}

fn imported_accounts_from_csv(text: &str) -> Result<Vec<PasswordAccount>, String> {
    let rows = split_csv(text);
    if rows.is_empty() {
        return Err("CSV 为空".into());
    }
    let headers = rows[0].iter().map(|v| csv_header(v)).collect::<Vec<_>>();
    let timestamp = now_ms();
    let mut output = Vec::new();
    for row in rows.iter().skip(1) {
        let mut values = BTreeMap::new();
        for (index, header) in headers.iter().enumerate() {
            values.insert(
                header.clone(),
                row.get(index)
                    .cloned()
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
            );
        }
        let url = values
            .get("url")
            .or_else(|| values.get("origin"))
            .or_else(|| values.get("website"))
            .or_else(|| values.get("hostname"))
            .cloned()
            .unwrap_or_default();
        let Some(site) = csv_host(&url) else { continue };
        let username = values
            .get("username")
            .or_else(|| values.get("user"))
            .cloned()
            .unwrap_or_default();
        let password = values
            .get("password")
            .or_else(|| values.get("pass"))
            .cloned()
            .unwrap_or_default();
        if username.is_empty() && password.is_empty() {
            continue;
        }
        let note = values
            .get("note")
            .or_else(|| values.get("notes"))
            .cloned()
            .unwrap_or_default();
        let id = Uuid::new_v4().to_string();
        output.push(PasswordAccount {
            record_id: Some(id.clone()),
            id: Some(id),
            account_id: format!("{site}-{timestamp}-{username}"),
            canonical_site: site.clone(),
            username_at_create: username.clone(),
            sites: vec![site],
            username,
            password,
            note,
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
            username_updated_at_ms: timestamp,
            password_updated_at_ms: timestamp,
            note_updated_at_ms: timestamp,
            created_device_name: "Web CSV 导入".into(),
            last_operated_device_name: "Web CSV 导入".into(),
            username_updated_device_name: "Web CSV 导入".into(),
            password_updated_device_name: "Web CSV 导入".into(),
            note_updated_device_name: "Web CSV 导入".into(),
            ..Default::default()
        });
    }
    Ok(output)
}

fn merge_imported_accounts(
    existing: &[PasswordAccount],
    imported: &[PasswordAccount],
) -> Vec<PasswordAccount> {
    let mut merged = pass_merge::v2::merge_sync_payloads(
        SyncPayload {
            accounts: existing.to_vec(),
            ..Default::default()
        },
        SyncPayload {
            accounts: imported.to_vec(),
            ..Default::default()
        },
    )
    .accounts;
    for account in &mut merged {
        if account.last_operated_device_name.trim().is_empty() {
            account.last_operated_device_name = "Web CSV 导入".into();
        }
    }
    merged
}

fn folder_site_match(account: &PasswordAccount, rules: &[String]) -> bool {
    let aliases = account
        .sites
        .iter()
        .chain(std::iter::once(&account.canonical_site))
        .map(|v| v.to_ascii_lowercase())
        .collect::<Vec<_>>();
    rules.iter().any(|rule| {
        let normalized = rule.to_ascii_lowercase();
        aliases
            .iter()
            .any(|site| site == &normalized || site.ends_with(&format!(".{normalized}")))
    })
}

fn normalize_rules(values: Vec<String>) -> Vec<String> {
    values
        .into_iter()
        .flat_map(|value| {
            value
                .split([',', '，', '\n'])
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .map(|value| {
            value
                .trim()
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .to_ascii_lowercase()
        })
        .filter(|value| !value.is_empty())
        .collect()
}

fn account_matches_id(account: &PasswordAccount, id: &str) -> bool {
    account_key(account).eq_ignore_ascii_case(id.trim())
        || account.account_id.eq_ignore_ascii_case(id.trim())
}

fn duplicate_groups(accounts: &[PasswordAccount], folder_id: &str) -> Vec<FolderDuplicateGroup> {
    let mut grouped: BTreeMap<String, Vec<PasswordAccount>> = BTreeMap::new();
    for account in accounts.iter().filter(|a| {
        !a.is_deleted
            && !a.is_permanently_deleted
            && a.folder_ids
                .iter()
                .any(|id| id.eq_ignore_ascii_case(folder_id))
    }) {
        let mut sites = account.sites.clone();
        sites.push(account.canonical_site.clone());
        sites.sort();
        sites.dedup();
        let key = format!(
            "{}|{}",
            sites.join("|").to_ascii_lowercase(),
            account.username.trim().to_ascii_lowercase()
        );
        grouped.entry(key).or_default().push(account.clone());
    }
    grouped
        .into_values()
        .filter(|accounts| accounts.len() > 1)
        .map(|mut accounts| {
            accounts.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));
            let mut aliases = accounts
                .iter()
                .flat_map(|account| account.sites.clone())
                .collect::<Vec<_>>();
            aliases.sort();
            aliases.dedup();
            FolderDuplicateGroup {
                id: Uuid::new_v4().to_string(),
                site_aliases: aliases,
                username: accounts
                    .first()
                    .map(|a| a.username.clone())
                    .unwrap_or_default(),
                accounts,
            }
        })
        .collect()
}

fn do_command(v: &mut Vault, command: &str, args: Value) -> Result<Value, String> {
    v.maybe_lock();
    let lock_exempt = matches!(
        command,
        "health_check"
            | "get_lock_state"
            | "lock_enable"
            | "lock_unlock"
            | "lock_unlock_biometric"
            | "lock_biometric_available"
            | "lock_touch"
    );
    if v.data.lock.enabled && v.locked && !lock_exempt {
        return Err("应用已锁定，请先解锁".into());
    }
    if !lock_exempt {
        v.touch();
    }
    match command {
        "health_check" => Ok(
            json!({"app":"pass-web","rustBackend":"ok","mode":"headless-web","featureParityTarget":["account-crud","folders","recycle-bin","undo-redo","snapshots" ]}),
        ),
        "get_lock_state" => Ok(v.lock_public_state()),
        "lock_touch" => {
            v.touch();
            Ok(json!(null))
        }
        "lock_biometric_available" => Ok(json!(false)),
        "lock_unlock_biometric" => Err("Web 版不支持 Touch ID/指纹解锁，请使用主密码".into()),
        "lock_enable" => {
            if v.data.lock.enabled {
                return Err("应用锁已启用，请先关闭后再设置新的主密码".into());
            }
            let password: String = arg(&args, "password")?;
            let confirm: String = arg(&args, "confirm")?;
            if password.trim().is_empty() {
                return Err("请输入主密码".into());
            }
            if password.trim() != confirm.trim() {
                return Err("两次输入的主密码不一致".into());
            }
            let mut salt = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut salt);
            let key = derive_web_lock_key(&password, &salt, LOCK_PBKDF2_ITERS);
            v.data.lock = WebLockData {
                enabled: true,
                salt_b64: STANDARD.encode(salt),
                verifier_b64: STANDARD.encode(Sha256::digest(key)),
                iterations: LOCK_PBKDF2_ITERS,
                idle_lock_minutes: arg(&args, "idleLockMinutes").unwrap_or(5u32).clamp(1, 60),
                lock_policy: arg::<String>(&args, "lockPolicy").unwrap_or_else(|_| "onceUntilQuit".into()),
                prefer_biometrics: arg(&args, "preferBiometrics").unwrap_or(false),
                background_lock_delay_seconds: arg(&args, "backgroundLockDelaySeconds").unwrap_or(60u32).clamp(0, 3600),
            };
            v.locked = false;
            v.touch();
            v.save()?;
            Ok(v.lock_public_state())
        }
        "lock_change_password" => {
            let old_password: String = arg(&args, "oldPassword")?;
            let new_password: String = arg(&args, "newPassword")?;
            let confirm: String = arg(&args, "confirm")?;
            let _ = verify_web_lock_password(&v.data.lock, &old_password)?;
            if new_password.trim().is_empty() {
                return Err("请输入新主密码".into());
            }
            if new_password.trim() != confirm.trim() {
                return Err("两次输入的新主密码不一致".into());
            }
            let mut salt = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut salt);
            let key = derive_web_lock_key(&new_password, &salt, LOCK_PBKDF2_ITERS);
            v.data.lock.salt_b64 = STANDARD.encode(salt);
            v.data.lock.verifier_b64 = STANDARD.encode(Sha256::digest(key));
            v.data.lock.iterations = LOCK_PBKDF2_ITERS;
            v.locked = false;
            v.touch();
            v.save()?;
            Ok(v.lock_public_state())
        }
        "lock_disable" => {
            let password: String = arg(&args, "password")?;
            let _ = verify_web_lock_password(&v.data.lock, &password)?;
            v.data.lock.enabled = false;
            v.locked = false;
            v.touch();
            v.save()?;
            Ok(v.lock_public_state())
        }
        "lock_unlock" => {
            let password: String = arg(&args, "password")?;
            let _ = verify_web_lock_password(&v.data.lock, &password)?;
            v.locked = false;
            v.touch();
            Ok(v.lock_public_state())
        }
        "lock_now" => {
            if !v.data.lock.enabled {
                return Ok(v.lock_public_state());
            }
            v.locked = true;
            Ok(v.lock_public_state())
        }
        "lock_save_preferences" => {
            if !v.data.lock.enabled {
                return Err("应用锁未启用".into());
            }
            let policy: String = arg(&args, "lockPolicy").unwrap_or_else(|_| "onceUntilQuit".into());
            if !matches!(policy.as_str(), "onceUntilQuit" | "idleTimeout" | "onBackground") {
                return Err("锁定策略无效".into());
            }
            v.data.lock.lock_policy = policy;
            v.data.lock.idle_lock_minutes = arg(&args, "idleLockMinutes").unwrap_or(5u32).clamp(1, 60);
            v.data.lock.prefer_biometrics = arg(&args, "preferBiometrics").unwrap_or(false);
            v.data.lock.background_lock_delay_seconds = arg(&args, "backgroundLockDelaySeconds").unwrap_or(60u32).clamp(0, 3600);
            v.touch();
            v.save()?;
            Ok(v.lock_public_state())
        }
        "get_app_state" => Ok(serde_json::to_value(app_state(&v.data)).unwrap()),
        "get_ui_prefs" => Ok(if v.data.ui_prefs.is_null() {
            json!({})
        } else {
            v.data.ui_prefs.clone()
        }),
        "set_ui_prefs" => {
            v.data.ui_prefs = arg(&args, "prefs")?;
            v.save()?;
            Ok(json!(null))
        }
        "get_provision_draft" => Ok(v
            .data
            .ui_prefs
            .get("webProvisionDraft")
            .cloned()
            .unwrap_or_else(|| json!({}))),
        "save_provision_draft" => {
            let draft: Value = arg(&args, "draft")?;
            if !draft.is_object() {
                return Err("创建服务草稿格式无效".into());
            }
            if !v.data.ui_prefs.is_object() {
                v.data.ui_prefs = json!({});
            }
            v.data.ui_prefs["webProvisionDraft"] = draft;
            v.save()?;
            Ok(json!(null))
        }
        "get_ssh_credential" => {
            let server_url: String = arg(&args, "serverUrl")?;
            let host = Url::parse(server_url.trim())
                .ok()
                .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
                .ok_or("服务器地址无效，无法读取 SSH 凭据")?;
            Ok(v
                .data
                .ui_prefs
                .get("webSshCredentials")
                .and_then(Value::as_object)
                .and_then(|items| items.get(&host))
                .cloned()
                .unwrap_or_else(|| json!({
                    "username": "root",
                    "port": 22,
                    "authMode": "privateKey",
                    "secret": "",
                    "privateKeyPassphrase": ""
                })))
        }
        "save_ssh_credential_cmd" => {
            let server_url: String = arg(&args, "serverUrl")?;
            let credential: Value = arg(&args, "credential")?;
            let host = Url::parse(server_url.trim())
                .ok()
                .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
                .ok_or("服务器地址无效，无法保存 SSH 凭据")?;
            if !credential.is_object() {
                return Err("SSH 凭据格式无效".into());
            }
            if !v.data.ui_prefs.is_object() {
                v.data.ui_prefs = json!({});
            }
            if !v.data.ui_prefs["webSshCredentials"].is_object() {
                v.data.ui_prefs["webSshCredentials"] = json!({});
            }
            v.data.ui_prefs["webSshCredentials"][host] = credential;
            v.save()?;
            Ok(json!(null))
        }
        "verify_sync_endpoint" => {
            let endpoint: String = arg(&args, "endpoint")?;
            let base = sync_base_url(&endpoint)?;
            let response = http_client()?.get(format!("{base}/healthz")).send();
            Ok(json!(response.map(|item| item.status().is_success()).unwrap_or(false)))
        }
        "detect_existing_sync_service" => {
            let server_url: String = arg(&args, "serverUrl")?;
            let base = sync_base_url(&server_url)?;
            let health = http_client()?.get(format!("{base}/healthz")).send();
            let healthy = health
                .as_ref()
                .map(|response| response.status().is_success())
                .unwrap_or(false);
            let state_response = if healthy {
                http_client()?.get(format!("{base}/v2/sync/state")).send().ok()
            } else {
                None
            };
            let state_exists = state_response
                .as_ref()
                .map(|response| response.status().is_success() || response.status() == ReqwestStatusCode::UNAUTHORIZED)
                .unwrap_or(false);
            let exists = healthy || state_exists;
            let mut findings = Vec::new();
            if healthy { findings.push("healthz 可访问".to_string()); }
            if state_exists { findings.push("同步状态接口可访问".to_string()); }
            Ok(json!({
                "host": Url::parse(&base).ok().and_then(|url| url.host_str().map(str::to_string)).unwrap_or_default(),
                "endpoint": base,
                "exists": exists,
                "findings": findings,
                "summary": if exists { "检测到服务器上已有 Pass 同步服务" } else { "未发现已安装的 Pass 同步服务" }
            }))
        }
        "provision_self_hosted_server" => Err("Web 版无法直接执行 SSH 部署。请在 Ubuntu/Docker 上启动同步服务器，或使用桌面版的“创建服务”功能；Web 版已支持端点检测、同步设置和凭据草稿保存。".into()),
        "get_sync_settings" => Ok(if v.data.sync_settings.is_null() {
            json!({})
        } else {
            v.data.sync_settings.clone()
        }),
        "set_sync_settings" => {
            v.data.sync_settings = arg(&args, "settings")?;
            v.save()?;
            Ok(json!(null))
        }
        "set_device_name" => {
            let name: String = arg(&args, "deviceName")?;
            if name.trim().is_empty() {
                return Err("设备名不能为空".into());
            }
            v.begin("修改设备名");
            v.data.device_name = name.trim().into();
            v.save()?;
            Ok(json!(null))
        }
        "get_undo_status" => Ok(serde_json::to_value(v.data.undo.last().map(|x| UndoStatus {
            title: x.title.clone(),
            created_at_ms: x.created_at_ms,
        }))
        .unwrap()),
        "get_redo_status" => Ok(serde_json::to_value(v.data.redo.last().map(|x| UndoStatus {
            title: x.title.clone(),
            created_at_ms: x.created_at_ms,
        }))
        .unwrap()),
        "get_operation_history" => Ok(serde_json::to_value(
            v.data
                .undo
                .iter()
                .rev()
                .chain(v.data.redo.iter().rev())
                .map(|x| HistorySummary {
                    id: x.id.clone(),
                    title: x.title.clone(),
                    created_at_ms: x.created_at_ms,
                    stack: if v.data.redo.iter().any(|r| r.id == x.id) {
                        "redo".into()
                    } else {
                        "undo".into()
                    },
                })
                .collect::<Vec<_>>(),
        )
        .unwrap()),
        "list_local_snapshots" => Ok(serde_json::to_value(
            v.data
                .snapshots
                .iter()
                .map(|snapshot| LocalSnapshotSummary {
                    id: snapshot.id.clone(),
                    created_at_ms: snapshot.created_at_ms,
                    reason: snapshot.reason.clone(),
                    accounts: visible_accounts(&snapshot.payload),
                    folders: visible_folders(&snapshot.payload),
                    passkeys: visible_passkeys(&snapshot.payload),
                })
                .collect::<Vec<_>>(),
        )
        .unwrap()),
        "restore_local_snapshot" => {
            let snapshot_id: String = arg(&args, "snapshotId")?;
            let payload = v
                .data
                .snapshots
                .iter()
                .find(|snapshot| snapshot.id == snapshot_id)
                .map(|snapshot| snapshot.payload.clone())
                .ok_or("未找到本地安全快照")?;
            v.begin("恢复本地安全快照前自动备份");
            v.apply_payload(payload.clone());
            v.save()?;
            Ok(json!(format!(
                "已恢复本地安全快照：账号 {}，文件夹 {}，通行密钥 {}",
                visible_accounts(&payload),
                visible_folders(&payload),
                visible_passkeys(&payload)
            )))
        }
        "undo_last_operation" => {
            let entry = v.data.undo.pop().ok_or("没有可撤销的本地操作")?;
            let current = v.payload();
            v.data.redo.push(HistoryItem {
                id: entry.id.clone(),
                title: entry.title.clone(),
                created_at_ms: now_ms(),
                payload: current,
            });
            v.apply_payload(entry.payload);
            v.save()?;
            Ok(json!(format!("已撤销：{}", entry.title)))
        }
        "redo_last_operation" => {
            let entry = v.data.redo.pop().ok_or("没有可重做的本地操作")?;
            let current = v.payload();
            v.data.undo.push(HistoryItem {
                id: entry.id.clone(),
                title: entry.title.clone(),
                created_at_ms: now_ms(),
                payload: current,
            });
            v.apply_payload(entry.payload);
            v.save()?;
            Ok(json!(format!("已重做：{}", entry.title)))
        }
        "create_account" => {
            let input: AccountInput = arg(&args, "input")?;
            let sites = normalize_sites(input.sites);
            if sites.is_empty() {
                return Err("至少填写一个站点".into());
            }
            let now = now_ms();
            let id = Uuid::new_v4().to_string();
            let canonical = sites[0].clone();
            v.begin("新建账号");
            let mut account = PasswordAccount {
                record_id: Some(id.clone()),
                id: Some(id),
                account_id: format!("{canonical}-{now}-{}", input.username.trim()),
                canonical_site: canonical,
                username_at_create: input.username.trim().into(),
                sites,
                username: input.username.trim().into(),
                password: input.password,
                totp_secret: input.totp_secret,
                recovery_codes: input.recovery_codes,
                note: input.note,
                created_at_ms: now,
                updated_at_ms: now,
                username_updated_at_ms: now,
                password_updated_at_ms: now,
                totp_updated_at_ms: now,
                recovery_codes_updated_at_ms: now,
                note_updated_at_ms: now,
                created_device_name: v.data.device_name.clone(),
                last_operated_device_name: v.data.device_name.clone(),
                ..Default::default()
            };
            account.folder_ids.push(FIXED_FOLDER_ID.into());
            account.folder_id = Some(FIXED_FOLDER_ID.into());
            v.data.accounts.push(account.clone());
            v.save()?;
            Ok(serde_json::to_value(account).unwrap())
        }
        "generate_demo_accounts" => {
            let now = now_ms();
            let device = v.data.device_name.clone();
            let samples = [
                (vec!["github.com", "gist.github.com"], "alice"),
                (vec!["google.com", "mail.google.com"], "alice.g"),
                (vec!["example.com", "sub.example.com"], "demo-user"),
            ];
            v.begin("生成演示账号前自动备份");
            for (offset, (sites, username)) in samples.into_iter().enumerate() {
                let normalized = normalize_sites(sites.into_iter().map(str::to_string).collect());
                let id = Uuid::new_v4().to_string();
                let timestamp = now + offset as i64;
                let mut account = PasswordAccount {
                    record_id: Some(id.clone()),
                    id: Some(id),
                    account_id: format!("{}-{}-{username}", normalized[0], timestamp),
                    canonical_site: normalized[0].clone(),
                    username_at_create: username.into(),
                    sites: normalized,
                    username: username.into(),
                    password: format!("Demo#{}!{offset}", now % 10_000),
                    note: "演示账号".into(),
                    created_at_ms: timestamp,
                    updated_at_ms: timestamp,
                    username_updated_at_ms: timestamp,
                    password_updated_at_ms: timestamp,
                    note_updated_at_ms: timestamp,
                    created_device_name: device.clone(),
                    last_operated_device_name: device.clone(),
                    username_updated_device_name: device.clone(),
                    password_updated_device_name: device.clone(),
                    note_updated_device_name: device.clone(),
                    ..Default::default()
                };
                account.folder_ids.push(FIXED_FOLDER_ID.into());
                account.folder_id = Some(FIXED_FOLDER_ID.into());
                v.data.accounts.push(account);
            }
            let _ = sync_alias_groups(&mut v.data.accounts, now, &device);
            v.save()?;
            Ok(json!(null))
        }
        "update_account" => {
            let id: String = arg(&args, "id")?;
            let input: AccountInput = arg(&args, "input")?;
            let sites = normalize_sites(input.sites);
            if sites.is_empty() {
                return Err("至少填写一个站点".into());
            }
            let now = now_ms();
            v.begin("编辑账号");
            let a = account_mut(&mut v.data.accounts, &id).ok_or("未找到要更新的账号")?;
            a.sites = sites.clone();
            a.canonical_site = sites[0].clone();
            if a.username != input.username {
                a.username = input.username;
                a.username_updated_at_ms = now;
            }
            if a.password != input.password {
                a.password = input.password;
                a.password_updated_at_ms = now;
            }
            a.totp_secret = input.totp_secret;
            a.recovery_codes = input.recovery_codes;
            a.note = input.note;
            a.updated_at_ms = now;
            v.save()?;
            Ok(json!(null))
        }
        "soft_delete_account" => {
            let id: String = arg(&args, "id")?;
            v.begin("移入回收站");
            let a = account_mut(&mut v.data.accounts, &id).ok_or("未找到账号")?;
            a.is_deleted = true;
            a.deleted_at_ms = Some(now_ms());
            a.deleted_device_name = v.data.device_name.clone();
            a.updated_at_ms = now_ms();
            v.save()?;
            Ok(json!(null))
        }
        "restore_account" => {
            let id: String = arg(&args, "id")?;
            v.begin("恢复账号");
            let a = account_mut(&mut v.data.accounts, &id).ok_or("未找到账号")?;
            a.is_deleted = false;
            a.is_permanently_deleted = false;
            a.deleted_at_ms = None;
            v.save()?;
            Ok(json!(null))
        }
        "hard_delete_account" => {
            let id: String = arg(&args, "id")?;
            v.begin("永久删除账号");
            let a = account_mut(&mut v.data.accounts, &id).ok_or("未找到账号")?;
            a.is_deleted = true;
            a.is_permanently_deleted = true;
            a.deleted_at_ms = Some(now_ms());
            v.save()?;
            Ok(json!(null))
        }
        "restore_all_deleted_accounts" => {
            v.begin("全部恢复账号");
            let mut count = 0;
            for a in &mut v.data.accounts {
                if a.is_deleted && !a.is_permanently_deleted {
                    a.is_deleted = false;
                    a.deleted_at_ms = None;
                    count += 1;
                }
            }
            v.save()?;
            Ok(json!(count))
        }
        "hard_delete_all_deleted_accounts" => {
            v.begin("清空回收站");
            let mut count = 0;
            for a in &mut v.data.accounts {
                if a.is_deleted && !a.is_permanently_deleted {
                    a.is_permanently_deleted = true;
                    count += 1;
                }
            }
            v.save()?;
            Ok(json!(count))
        }
        "create_folder" => {
            let name: String = arg(&args, "name")?;
            if name.trim().is_empty() {
                return Err("文件夹名不能为空".into());
            }
            v.begin("新建文件夹");
            let now = now_ms();
            let f = Folder {
                id: Uuid::new_v4().to_string(),
                name: name.trim().into(),
                created_at_ms: now,
                updated_at_ms: now,
                ..Default::default()
            };
            v.data.folders.push(f.clone());
            v.save()?;
            Ok(serde_json::to_value(f).unwrap())
        }
        "configure_folder_site_rules" => {
            let folder_id: String = arg(&args, "folderId")?;
            let site_inputs: Vec<String> = arg(&args, "siteInputs")?;
            let auto_add: bool = arg(&args, "autoAdd").unwrap_or(true);
            let rules = normalize_rules(site_inputs);
            let folder = v
                .data
                .folders
                .iter()
                .find(|folder| {
                    folder.id.eq_ignore_ascii_case(&folder_id)
                        && !folder.is_deleted
                        && !folder.is_permanently_deleted
                })
                .cloned()
                .ok_or("未找到文件夹")?;
            v.begin("调整文件夹规则前自动备份");
            let mut updated_folder = folder.clone();
            updated_folder.matched_sites = rules.clone();
            updated_folder.auto_add_matching_sites = auto_add;
            updated_folder.updated_at_ms = now_ms();
            if let Some(target) = v
                .data
                .folders
                .iter_mut()
                .find(|item| item.id.eq_ignore_ascii_case(&folder_id))
            {
                *target = updated_folder.clone();
            }
            let mut matched_count = 0;
            let mut added_count = 0;
            for account in v
                .data
                .accounts
                .iter_mut()
                .filter(|account| !account.is_deleted && !account.is_permanently_deleted)
            {
                if folder_site_match(account, &rules) {
                    matched_count += 1;
                    if auto_add
                        && !account
                            .folder_ids
                            .iter()
                            .any(|id| id.eq_ignore_ascii_case(&folder_id))
                    {
                        account.folder_ids.push(folder_id.clone());
                        account.folder_id = Some(folder_id.clone());
                        account.updated_at_ms = now_ms();
                        added_count += 1;
                    }
                }
            }
            v.save()?;
            Ok(serde_json::to_value(FolderRuleResult {
                folder: updated_folder,
                matched_count,
                added_count,
                message: format!(
                    "已保存文件夹规则，匹配 {} 个账号，新增加入 {} 个账号",
                    matched_count, added_count
                ),
            })
            .unwrap())
        }
        "get_folder_duplicate_groups" => {
            let folder_id: String = arg(&args, "folderId")?;
            if !v.data.folders.iter().any(|folder| {
                folder.id.eq_ignore_ascii_case(&folder_id)
                    && !folder.is_deleted
                    && !folder.is_permanently_deleted
            }) {
                return Err("未找到文件夹".into());
            }
            Ok(serde_json::to_value(duplicate_groups(&v.data.accounts, &folder_id)).unwrap())
        }
        "deduplicate_folder" => {
            let folder_id: String = arg(&args, "folderId")?;
            let mode: String = arg(&args, "mode")?;
            let requested_id: Option<String> = arg(&args, "accountId").unwrap_or(None);
            let groups = duplicate_groups(&v.data.accounts, &folder_id);
            if groups.is_empty() {
                return Ok(json!(DeduplicateResult {
                    deleted_count: 0,
                    kept_count: 0,
                    group_count: 0,
                    message: "当前文件夹暂无重复账号".into(),
                }));
            }
            let mut keep = BTreeSet::new();
            for group in &groups {
                let selected = match mode.trim().to_ascii_lowercase().as_str() {
                    "latest" => group.accounts.first(),
                    "earliest" => group.accounts.last(),
                    "account" => requested_id.as_deref().and_then(|id| {
                        group
                            .accounts
                            .iter()
                            .find(|account| account_matches_id(account, id))
                    }),
                    _ => return Err("未知去重方式".into()),
                }
                .ok_or("当前重复分组中未找到指定账号")?;
                keep.insert(account_key(selected));
            }
            v.begin("文件夹去重前自动备份");
            let duplicate_ids = groups
                .iter()
                .flat_map(|group| group.accounts.iter().map(account_key))
                .collect::<BTreeSet<_>>();
            let now = now_ms();
            let device = v.data.device_name.clone();
            let mut deleted_count = 0;
            for account in &mut v.data.accounts {
                let id = account_key(account);
                if duplicate_ids.contains(&id) && !keep.contains(&id) && !account.is_deleted {
                    account.is_deleted = true;
                    account.deleted_at_ms = Some(now);
                    account.deleted_device_name = device.clone();
                    account.last_operated_device_name = device.clone();
                    account.updated_at_ms = now;
                    deleted_count += 1;
                }
            }
            v.save()?;
            Ok(serde_json::to_value(DeduplicateResult {
                deleted_count,
                kept_count: keep.len(),
                group_count: groups.len(),
                message: format!(
                    "去重完成，已移入回收站 {} 个重复账号，保留 {} 个账号",
                    deleted_count,
                    keep.len()
                ),
            })
            .unwrap())
        }
        "delete_folder" => {
            let id: String = arg(&args, "id")?;
            if id.eq_ignore_ascii_case(FIXED_FOLDER_ID) {
                return Err("固定文件夹不可删除".into());
            }
            v.begin("删除文件夹");
            let f = v
                .data
                .folders
                .iter_mut()
                .find(|f| f.id.eq_ignore_ascii_case(&id))
                .ok_or("未找到文件夹")?;
            f.is_deleted = true;
            f.is_permanently_deleted = true;
            f.deleted_at_ms = Some(now_ms());
            for a in &mut v.data.accounts {
                a.folder_ids.retain(|x| !x.eq_ignore_ascii_case(&id));
                if a.folder_id
                    .as_deref()
                    .is_some_and(|x| x.eq_ignore_ascii_case(&id))
                {
                    a.folder_id = a.folder_ids.first().cloned();
                }
            }
            v.save()?;
            Ok(json!(null))
        }
        "set_account_folders" => {
            let id: String = arg(&args, "id")?;
            let ids: Vec<String> = arg(&args, "folderIds")?;
            let active: BTreeSet<String> = v
                .data
                .folders
                .iter()
                .filter(|f| !f.is_deleted && !f.is_permanently_deleted)
                .map(|f| f.id.to_ascii_lowercase())
                .collect();
            if ids
                .iter()
                .any(|x| !active.contains(&x.to_ascii_lowercase()))
            {
                return Err("包含不存在或已删除的文件夹".into());
            }
            v.begin("调整账号文件夹");
            let a = account_mut(&mut v.data.accounts, &id).ok_or("未找到账号")?;
            a.folder_ids = ids.clone();
            a.folder_id = ids.first().cloned();
            a.updated_at_ms = now_ms();
            v.save()?;
            Ok(json!(null))
        }
        "toggle_account_pin" => {
            let id: String = arg(&args, "id")?;
            v.begin("切换账号置顶");
            let a = account_mut(&mut v.data.accounts, &id).ok_or("未找到账号")?;
            a.is_pinned = !a.is_pinned;
            a.updated_at_ms = now_ms();
            v.save()?;
            Ok(json!(null))
        }
        "reorder_accounts" => {
            let order: Vec<String> = arg(&args, "orderedIds")?;
            let pinned: bool = arg(&args, "pinned").unwrap_or(false);
            v.begin("调整账号顺序");
            let rank = order
                .iter()
                .enumerate()
                .map(|(i, x)| (x.to_ascii_lowercase(), i as i64))
                .collect::<std::collections::HashMap<_, _>>();
            for a in &mut v.data.accounts {
                if let Some(rank) = rank.get(&account_key(a).to_ascii_lowercase()) {
                    if pinned {
                        a.pinned_sort_order = Some(*rank)
                    } else {
                        a.regular_sort_order = Some(*rank)
                    }
                }
            }
            v.save()?;
            Ok(json!(null))
        }
        "reorder_folders" => {
            let order: Vec<String> = arg(&args, "orderedIds")?;
            v.begin("调整文件夹顺序");
            let rank = order
                .iter()
                .enumerate()
                .map(|(i, x)| (x.to_ascii_lowercase(), i as i64))
                .collect::<std::collections::HashMap<_, _>>();
            v.data.folders.sort_by_key(|f| {
                rank.get(&f.id.to_ascii_lowercase())
                    .copied()
                    .unwrap_or(i64::MAX)
            });
            v.save()?;
            Ok(json!(null))
        }
        "generate_sync_encryption_key" => {
            let mut bytes = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut bytes);
            Ok(json!(URL_SAFE_NO_PAD.encode(bytes)))
        }
        "sync_key_id" => {
            let key: String = arg(&args, "key")?;
            if key.trim().is_empty() {
                Ok(json!(""))
            } else {
                let decoded = decode_sync_key(&key)?;
                let digest = Sha256::digest(decoded);
                Ok(json!(format!(
                    "k1-{}",
                    digest
                        .iter()
                        .take(8)
                        .map(|b| format!("{b:02x}"))
                        .collect::<String>()
                )))
            }
        }
        "sync_preview" => {
            let mode = SyncMode::parse(
                v.data
                    .sync_settings
                    .get("mode")
                    .and_then(Value::as_str)
                    .unwrap_or("merge"),
            );
            if v.data
                .sync_settings
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                run_self_hosted_sync(v, mode, true)
            } else {
                run_webdav_sync(v, mode, true)
            }
        }
        "sync_now" | "sync_now_mode" => {
            let mode = if command == "sync_now" {
                SyncMode::parse(
                    v.data
                        .sync_settings
                        .get("mode")
                        .and_then(Value::as_str)
                        .unwrap_or("merge"),
                )
            } else {
                SyncMode::parse(&arg::<String>(&args, "mode")?)
            };
            run_self_hosted_sync(v, mode, false)
        }
        "sync_webdav_now_mode" => {
            let mode = SyncMode::parse(&arg::<String>(&args, "mode")?);
            run_webdav_sync(v, mode, false)
        }
        "list_server_versions" => {
            let settings = &v.data.sync_settings;
            let base = settings
                .get("baseUrl")
                .and_then(Value::as_str)
                .unwrap_or("");
            let token = settings
                .get("authToken")
                .and_then(Value::as_str)
                .unwrap_or("");
            Ok(Value::Array(self_hosted_versions(base, token)?))
        }
        "restore_server_version" => {
            let version_id: String = arg(&args, "versionId")?;
            let settings = &v.data.sync_settings;
            let base = settings
                .get("baseUrl")
                .and_then(Value::as_str)
                .unwrap_or("");
            let token = settings
                .get("authToken")
                .and_then(Value::as_str)
                .unwrap_or("");
            let key = settings
                .get("encryptionKey")
                .and_then(Value::as_str)
                .unwrap_or("");
            let payload = self_hosted_version(base, token, &version_id, key)?;
            v.begin("恢复服务器快照前自动备份");
            v.apply_payload(payload.clone());
            v.save()?;
            Ok(json!(format!(
                "已恢复快照 {}：账号 {}，文件夹 {}，通行密钥 {}",
                version_id,
                visible_accounts(&payload),
                visible_folders(&payload),
                visible_passkeys(&payload)
            )))
        }
        "merge_sync_payloads" => {
            let local: String = arg(&args, "localJson")?;
            let remote: String = arg(&args, "remoteJson")?;
            let merged = pass_merge::v2::merge_sync_payloads(
                extract_payload(serde_json::from_str(&local).map_err(|e| e.to_string())?)?,
                extract_payload(serde_json::from_str(&remote).map_err(|e| e.to_string())?)?,
            );
            Ok(json!(
                serde_json::to_string(&merged).map_err(|e| e.to_string())?
            ))
        }
        "choose_export_directory" => Ok(json!(v.dir.to_string_lossy().to_string())),
        "export_sync_bundle" => {
            let path: Option<String> = arg(&args, "path").unwrap_or(None);
            let base = path
                .filter(|p| !p.trim().is_empty())
                .unwrap_or_else(|| v.dir.to_string_lossy().to_string());
            let target = FsPath::new(&base);
            let out = if target.is_dir() {
                target.join(format!("pass-sync-bundle-{}.json", now_ms()))
            } else {
                target.to_path_buf()
            };
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let key = v
                .data
                .sync_settings
                .get("encryptionKey")
                .and_then(Value::as_str)
                .unwrap_or("");
            let bytes = encrypt_sync_document(&bundle_document(v), key)?;
            fs::write(&out, &bytes).map_err(|e| format!("写入同步包失败：{e}"))?;
            Ok(json!({
                "path": out.to_string_lossy(),
                "message": format!("已导出同步包：{}（账号 {}，文件夹 {}，通行密钥 {}）", out.display(), visible_accounts(&v.payload()), visible_folders(&v.payload()), visible_passkeys(&v.payload())),
                "downloadName": out.file_name().and_then(|name| name.to_str()).unwrap_or("pass-sync-bundle.json"),
                "downloadMime": "application/json",
                "downloadBase64": STANDARD.encode(bytes)
            }))
        }
        "export_csv" | "export_csv_to_path" | "export_browser_csv_cmd" => {
            let format: String = arg(&args, "format").unwrap_or_else(|_| "full".into());
            let csv = if format == "full" {
                full_csv(v)
            } else {
                let headers = if format == "firefox" {
                    vec!["url", "username", "password"]
                } else {
                    vec!["name", "url", "username", "password", "note"]
                };
                let rows = v
                    .data
                    .accounts
                    .iter()
                    .filter(|a| !a.is_deleted)
                    .map(|a| {
                        let site = a
                            .sites
                            .first()
                            .cloned()
                            .unwrap_or_else(|| a.canonical_site.clone());
                        if format == "firefox" {
                            vec![
                                format!("https://{site}"),
                                a.username.clone(),
                                a.password.clone(),
                            ]
                        } else {
                            vec![
                                site.clone(),
                                format!("https://{site}"),
                                a.username.clone(),
                                a.password.clone(),
                                a.note.clone(),
                            ]
                        }
                    })
                    .collect::<Vec<_>>();
                build_csv(&headers, &rows)
            };
            let path: Option<String> = arg(&args, "path").unwrap_or(None);
            let out = path
                .filter(|p| !p.trim().is_empty())
                .map(PathBuf::from)
                .unwrap_or_else(|| v.dir.join(format!("pass-export-{}.csv", now_ms())));
            fs::write(&out, &csv).map_err(|e| format!("写入 CSV 失败：{e}"))?;
            let download_name = out
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("pass-export.csv");
            if command == "export_csv" {
                Ok(
                    json!({"csvPath":out.to_string_lossy(), "path":out.to_string_lossy(), "downloadName":download_name, "downloadMime":"text/csv;charset=utf-8", "downloadBase64":STANDARD.encode(csv)}),
                )
            } else {
                Ok(
                    json!({"path":out.to_string_lossy(),"message":format!("已导出 CSV：{}",out.display()),"downloadName":download_name,"downloadMime":"text/csv;charset=utf-8","downloadBase64":STANDARD.encode(csv)}),
                )
            }
        }
        "import_browser_csv_text" => {
            let content: String = arg(&args, "content")?;
            let imported = imported_accounts_from_csv(&content)?;
            if imported.is_empty() {
                return Err("CSV 中没有可导入的账号".into());
            }
            let before = v.data.accounts.len();
            v.begin("导入浏览器 CSV 前自动备份");
            v.data.accounts = merge_imported_accounts(&v.data.accounts, &imported);
            v.save()?;
            Ok(json!({
                "imported": imported.len(),
                "total": v.data.accounts.len(),
                "message": format!("已导入 {} 条账号（本地 {} → {}）", imported.len(), before, v.data.accounts.len())
            }))
        }
        "import_google_authenticator_totp" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Entry {
                site: String,
                username: String,
                secret: String,
            }
            let entries: Vec<Entry> = arg(&args, "entries")?;
            v.begin("导入谷歌验证器二维码前自动备份");
            let mut created = 0;
            let mut updated = 0;
            let mut skipped = 0;
            let now = now_ms();
            let device = v.data.device_name.clone();
            for entry in entries {
                let site = entry.site.trim().to_ascii_lowercase();
                if site.is_empty() || entry.secret.trim().is_empty() {
                    skipped += 1;
                    continue;
                }
                if let Some(account) = v.data.accounts.iter_mut().find(|account| {
                    !account.is_deleted
                        && account.username == entry.username
                        && account
                            .sites
                            .iter()
                            .any(|value| value.eq_ignore_ascii_case(&site))
                }) {
                    if account.totp_secret == entry.secret {
                        skipped += 1;
                    } else {
                        account.totp_secret = entry.secret;
                        account.totp_updated_at_ms = now;
                        account.totp_updated_device_name = device.clone();
                        account.updated_at_ms = now;
                        account.last_operated_device_name = device.clone();
                        updated += 1;
                    }
                    continue;
                }
                let id = Uuid::new_v4().to_string();
                let mut account = PasswordAccount {
                    record_id: Some(id.clone()),
                    id: Some(id),
                    account_id: format!("{site}-{now}-{}", entry.username),
                    canonical_site: site.clone(),
                    username_at_create: entry.username.clone(),
                    sites: vec![site],
                    username: entry.username,
                    totp_secret: entry.secret,
                    totp_updated_at_ms: now,
                    totp_updated_device_name: device.clone(),
                    created_at_ms: now,
                    updated_at_ms: now,
                    created_device_name: device.clone(),
                    last_operated_device_name: device.clone(),
                    ..Default::default()
                };
                account.folder_ids.push(FIXED_FOLDER_ID.into());
                account.folder_id = Some(FIXED_FOLDER_ID.into());
                v.data.accounts.push(account);
                created += 1;
            }
            v.save()?;
            Ok(serde_json::to_value(TotpImportResult {
                created,
                updated,
                skipped,
            })
            .unwrap())
        }
        "import_sync_bundle_text" => {
            let content: String = arg(&args, "content")?;
            let apply: bool = arg(&args, "apply").unwrap_or(false);
            let key = v
                .data
                .sync_settings
                .get("encryptionKey")
                .and_then(Value::as_str)
                .unwrap_or("");
            let remote = extract_payload(decrypt_sync_document(content.as_bytes(), key)?)?;
            let local = v.payload();
            let merged = pass_merge::v2::merge_sync_payloads(local.clone(), remote.clone());
            let safety = evaluate_sync_safety(&local, Some(&remote), &merged, "merge");
            let local_count = visible_accounts(&local);
            let remote_count = visible_accounts(&remote);
            let merged_count = visible_accounts(&merged);
            if apply && safety.safe {
                v.begin("导入同步包写入本地前自动备份");
                v.apply_payload(merged.clone());
                v.save()?;
            }
            Ok(json!(serde_json::to_string(&json!({
                "ok": safety.safe,
                "safe": safety.safe,
                "reasons": safety.reasons,
                "localAccounts": local_count,
                "remoteAccounts": remote_count,
                "mergedAccounts": merged_count,
                "message": if safety.safe {
                    format!("同步包合并预览：本地 {local_count} → 合并 {merged_count}（远端 {remote_count}）")
                } else {
                    format!("同步包导入停止：安全检查未通过（{}）", safety.reasons.join("、"))
                },
                "payload": merged
            })).unwrap()))
        }
        _ => Err(format!("Web 版暂未实现命令：{command}")),
    }
}

fn derive_web_lock_key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations.max(1), &mut key);
    key
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right) {
        diff |= a ^ b;
    }
    diff == 0
}

fn verify_web_lock_password(lock: &WebLockData, password: &str) -> Result<[u8; 32], String> {
    if !lock.enabled || lock.verifier_b64.trim().is_empty() {
        return Err("应用锁未启用".into());
    }
    let salt = STANDARD
        .decode(lock.salt_b64.trim())
        .map_err(|_| "应用锁配置损坏".to_string())?;
    let expected = STANDARD
        .decode(lock.verifier_b64.trim())
        .map_err(|_| "应用锁配置损坏".to_string())?;
    let actual = derive_web_lock_key(password.trim(), &salt, lock.iterations);
    if !constant_time_equal(&Sha256::digest(actual), &expected) {
        return Err("主密码错误".into());
    }
    Ok(actual)
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    if token.trim().is_empty() {
        return true;
    }
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.strip_prefix("Bearer ").unwrap_or("") == token)
        .unwrap_or(false)
}

async fn invoke(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(command): Path<String>,
    Json(args): Json<Value>,
) -> Response {
    if !authorized(&headers, &state.auth_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"未授权，请配置 Web 访问令牌"})),
        )
            .into_response();
    }
    let vault = state.vault.clone();
    let command_for_worker = command.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut v = vault.lock().map_err(|_| "Web vault 锁定失败".to_string())?;
        do_command(&mut v, &command_for_worker, args)
    })
    .await
    .map_err(|error| format!("Web 命令任务异常：{error}"))
    .and_then(|result| result);
    match result {
        Ok(result) => Json(json!({"result":result})).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({"error":error}))).into_response(),
    }
}

async fn health() -> Json<Value> {
    Json(json!({"ok":true,"service":"pass-web","version":"0.1.0"}))
}

async fn static_file(State(state): State<AppState>, uri: Uri) -> Response {
    let rel = uri.path().trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    if rel.contains("..") {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = state.static_dir.join(rel);
    let path = if path.is_file() {
        path
    } else {
        state.static_dir.join("index.html")
    };
    match fs::read(&path) {
        Ok(bytes) => {
            let mime = match path.extension().and_then(|x| x.to_str()).unwrap_or("") {
                "html" => "text/html; charset=utf-8",
                "js" => "text/javascript; charset=utf-8",
                "css" => "text/css; charset=utf-8",
                "json" => "application/json",
                _ => "application/octet-stream",
            };
            Response::builder()
                .header(header::CONTENT_TYPE, mime)
                .body(Body::from(bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = PathBuf::from(env::var("PASS_WEB_DATA_DIR").unwrap_or_else(|_| "./data".into()));
    let static_dir = PathBuf::from(
        env::var("PASS_WEB_STATIC_DIR").unwrap_or_else(|_| "../codex-tauri/dist".into()),
    );
    let host = env::var("PASS_WEB_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let port: u16 = env::var("PASS_WEB_PORT")
        .ok()
        .and_then(|x| x.parse().ok())
        .unwrap_or(53335);
    let token = env::var("PASS_WEB_AUTH_TOKEN").unwrap_or_default();
    let state = AppState {
        vault: Arc::new(Mutex::new(Vault::open(data_dir)?)),
        auth_token: token,
        static_dir,
    };
    let app = Router::new()
        .route("/healthz", get(health))
        .route("/api/invoke/:command", post(invoke))
        .fallback(any(static_file))
        .with_state(state)
        .layer(TraceLayer::new_for_http());
    let listener = TcpListener::bind(format!("{host}:{port}")).await?;
    println!("Pass Web listening on http://{host}:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_empty_vault_and_fixed_folder() {
        let dir = std::env::temp_dir().join(format!("pass-web-test-{}", Uuid::new_v4()));
        let vault = Vault::open(dir.clone()).unwrap();
        assert!(vault.data.folders.iter().any(|f| f.id == FIXED_FOLDER_ID));
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn encrypt_round_trip() {
        let dir = std::env::temp_dir().join(format!("pass-web-crypto-{}", Uuid::new_v4()));
        let raw = b"secret";
        let enc = encrypt(&dir, raw).unwrap();
        assert_eq!(decrypt(&dir, &enc).unwrap(), raw);
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn sync_document_round_trips_with_optional_encryption() {
        let document = json!({
            "schema": "pass.sync.bundle.v2",
            "exportedAtMs": 1,
            "payload": SyncPayload::default()
        });
        let key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let encrypted = encrypt_sync_document(&document, key).unwrap();
        assert_eq!(decrypt_sync_document(&encrypted, key).unwrap(), document);
        let plain = encrypt_sync_document(&document, "").unwrap();
        assert_eq!(decrypt_sync_document(&plain, "").unwrap(), document);
        assert!(decrypt_sync_document(&plain, key).is_err());
    }
    #[test]
    fn web_lock_blocks_vault_commands_until_password_unlock() {
        let dir = std::env::temp_dir().join(format!("pass-web-lock-{}", Uuid::new_v4()));
        let mut vault = Vault::open(dir.clone()).unwrap();
        do_command(
            &mut vault,
            "lock_enable",
            json!({
                "password": "test-password",
                "confirm": "test-password",
                "idleLockMinutes": 5,
                "lockPolicy": "onceUntilQuit"
            }),
        )
        .unwrap();
        do_command(&mut vault, "lock_now", json!({})).unwrap();
        assert!(do_command(&mut vault, "get_app_state", json!({})).is_err());
        assert!(do_command(&mut vault, "lock_unlock", json!({"password": "wrong"}),).is_err());
        do_command(
            &mut vault,
            "lock_unlock",
            json!({"password": "test-password"}),
        )
        .unwrap();
        assert!(do_command(&mut vault, "get_app_state", json!({})).is_ok());
        let _ = fs::remove_dir_all(dir);
    }
}
