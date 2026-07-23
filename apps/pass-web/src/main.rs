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
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use pass_csvio::build_csv;
use pass_merge::v2::{Folder, Passkey, PasswordAccount, SyncPayload};
use rand::RngCore;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::net::TcpListener;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

const KEY_FILE: &str = "pass-web-vault-key-v1";
const VAULT_FILE: &str = "pass-web-vault-v1.enc";
const FIXED_FOLDER_ID: &str = pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID;
const FIXED_FOLDER_NAME: &str = pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_NAME;

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
struct VaultData {
    device_name: String,
    accounts: Vec<PasswordAccount>,
    folders: Vec<Folder>,
    passkeys: Vec<Passkey>,
    ui_prefs: Value,
    sync_settings: Value,
    undo: Vec<HistoryItem>,
    redo: Vec<HistoryItem>,
}

struct Vault {
    dir: PathBuf,
    data: VaultData,
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
        let mut vault = Self { dir, data };
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
    fn begin(&mut self, title: &str) {
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

fn do_command(v: &mut Vault, command: &str, args: Value) -> Result<Value, String> {
    match command {
        "health_check" => Ok(
            json!({"app":"pass-web","rustBackend":"ok","mode":"headless-web","featureParityTarget":["account-crud","folders","recycle-bin","undo-redo","snapshots" ]}),
        ),
        "get_lock_state" => Ok(
            json!({"enabled":false,"locked":false,"idleLockMinutes":0,"hasPassword":false,"lockPolicy":"onceUntilQuit","preferBiometrics":false,"backgroundLockDelaySeconds":0,"biometricReady":false}),
        ),
        "lock_touch" | "lock_biometric_available" => Ok(json!(false)),
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
            let mut h = Sha256::new();
            h.update(key.as_bytes());
            Ok(json!(format!("sha256:{}", hex_lower(&h.finalize()))))
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
            fs::write(
                &out,
                serde_json::to_vec_pretty(&bundle_document(v)).unwrap(),
            )
            .map_err(|e| format!("写入同步包失败：{e}"))?;
            Ok(
                json!({"path":out.to_string_lossy(),"message":format!("已导出同步包：{}",out.display())}),
            )
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
            fs::write(&out, csv).map_err(|e| format!("写入 CSV 失败：{e}"))?;
            if command == "export_csv" {
                Ok(json!({"csvPath":out.to_string_lossy()}))
            } else {
                Ok(
                    json!({"path":out.to_string_lossy(),"message":format!("已导出 CSV：{}",out.display())}),
                )
            }
        }
        "import_sync_bundle_text" => {
            let content: String = arg(&args, "content")?;
            let apply: bool = arg(&args, "apply").unwrap_or(false);
            let remote = extract_payload(
                serde_json::from_str(&content).map_err(|e| format!("同步包 JSON 无效：{e}"))?,
            )?;
            let local = v.payload();
            let merged = pass_merge::v2::merge_sync_payloads(local.clone(), remote.clone());
            let local_count = local
                .accounts
                .iter()
                .filter(|a| !a.is_deleted && !a.is_permanently_deleted)
                .count();
            let remote_count = remote
                .accounts
                .iter()
                .filter(|a| !a.is_deleted && !a.is_permanently_deleted)
                .count();
            let merged_count = merged
                .accounts
                .iter()
                .filter(|a| !a.is_deleted && !a.is_permanently_deleted)
                .count();
            if apply {
                v.begin("导入同步包");
                v.apply_payload(merged.clone());
                v.save()?;
            }
            Ok(json!(serde_json::to_string(&json!({"ok":true,"safe":true,"localAccounts":local_count,"remoteAccounts":remote_count,"mergedAccounts":merged_count,"message":format!("同步包合并预览：本地 {local_count} → 合并 {merged_count}（远端 {remote_count}）"),"payload":merged})).unwrap()))
        }
        _ => Err(format!("Web 版暂未实现命令：{command}")),
    }
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
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
    let result = state
        .vault
        .lock()
        .map_err(|_| "Web vault 锁定失败".to_string())
        .and_then(|mut v| do_command(&mut v, &command, args));
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
}
