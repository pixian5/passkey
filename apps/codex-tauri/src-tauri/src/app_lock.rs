//! App lock: PBKDF2-SHA256 password verifier + idle lock policy.
//! Also derives a session key to encrypt sync secrets at rest.

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use hmac::Hmac;
use pbkdf2::pbkdf2;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Manager};

use crate::local_vault;

const LOCK_FILE: &str = "app_lock.json";
const SECRETS_FILE: &str = "sync_secrets.enc";
const BIOMETRIC_SESSION_FILE: &str = "biometric_session.enc";
const BIOMETRIC_SESSION_SCOPE: &str = "pass.tauri.biometric_session.v1";
const PBKDF2_ITERS: u32 = 310_000;
const SALT_LEN: usize = 16;
const KEY_LEN: usize = 32;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLockPublicState {
    pub enabled: bool,
    pub locked: bool,
    pub idle_lock_minutes: u32,
    pub has_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppLockRecord {
    enabled: bool,
    salt_b64: String,
    verifier_b64: String,
    iterations: u32,
    idle_lock_minutes: u32,
}

#[derive(Debug, Default)]
struct SessionInner {
    unlocked: bool,
    /// Session key used to decrypt sync secrets while unlocked (32 bytes).
    session_key: Option<[u8; KEY_LEN]>,
    last_activity_ms: i64,
}

pub struct AppLockState {
    inner: Mutex<SessionInner>,
}

impl Default for AppLockState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(SessionInner {
                unlocked: false,
                session_key: None,
                last_activity_ms: now_ms(),
            }),
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn lock_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join(LOCK_FILE)
}

fn secrets_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join(SECRETS_FILE)
}

fn load_record(data_dir: &PathBuf) -> Option<AppLockRecord> {
    let raw = std::fs::read_to_string(lock_path(data_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_record(data_dir: &PathBuf, record: &AppLockRecord) -> Result<(), String> {
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let path = lock_path(data_dir);
    let raw = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    std::fs::write(&path, raw).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn derive_key(password: &str, salt: &[u8], iterations: u32) -> Result<[u8; KEY_LEN], String> {
    let mut key = [0u8; KEY_LEN];
    pbkdf2::<HmacSha256>(password.as_bytes(), salt, iterations, &mut key)
        .map_err(|e| format!("PBKDF2 failed: {e}"))?;
    Ok(key)
}

fn verifier_from_key(key: &[u8; KEY_LEN]) -> String {
    let digest = Sha256::digest(key);
    STANDARD.encode(digest)
}

fn timing_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut d = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        d |= x ^ y;
    }
    d == 0
}

impl AppLockState {
    pub fn public_state(&self, data_dir: &PathBuf) -> AppLockPublicState {
        let record = load_record(data_dir);
        let enabled = record.as_ref().map(|r| r.enabled).unwrap_or(false);
        let has_password = record.is_some();
        let idle = record
            .as_ref()
            .map(|r| r.idle_lock_minutes)
            .unwrap_or(5)
            .clamp(1, 60);
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if enabled {
            // Auto-lock on idle
            let elapsed = now_ms().saturating_sub(guard.last_activity_ms);
            if guard.unlocked && elapsed >= (idle as i64) * 60_000 {
                guard.unlocked = false;
                guard.session_key = None;
            }
        } else {
            // Lock disabled → treat as unlocked for vault access
            guard.unlocked = true;
        }
        AppLockPublicState {
            enabled,
            locked: enabled && !guard.unlocked,
            idle_lock_minutes: idle,
            has_password,
        }
    }

    pub fn touch(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.last_activity_ms = now_ms();
        }
    }

    pub fn require_unlocked(&self, data_dir: &PathBuf) -> Result<(), String> {
        let st = self.public_state(data_dir);
        if st.locked {
            return Err("应用已锁定，请先解锁".into());
        }
        self.touch();
        Ok(())
    }

    pub fn enable(
        &self,
        data_dir: &PathBuf,
        password: &str,
        confirm: &str,
        idle_lock_minutes: u32,
    ) -> Result<AppLockPublicState, String> {
        let password = password.trim();
        let confirm = confirm.trim();
        if password.len() < 6 {
            return Err("主密码至少 6 位".into());
        }
        if password != confirm {
            return Err("两次输入的主密码不一致".into());
        }
        let mut salt = [0u8; SALT_LEN];
        rand::thread_rng().fill_bytes(&mut salt);
        let key = derive_key(password, &salt, PBKDF2_ITERS)?;
        let record = AppLockRecord {
            enabled: true,
            salt_b64: STANDARD.encode(salt),
            verifier_b64: verifier_from_key(&key),
            iterations: PBKDF2_ITERS,
            idle_lock_minutes: idle_lock_minutes.clamp(1, 60),
        };
        save_record(data_dir, &record)?;
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.unlocked = true;
        guard.session_key = Some(key);
        guard.last_activity_ms = now_ms();
        drop(guard);
        // Re-seal any plaintext secrets with the new session key if present.
        Ok(self.public_state(data_dir))
    }

    pub fn disable(
        &self,
        data_dir: &PathBuf,
        password: &str,
    ) -> Result<AppLockPublicState, String> {
        self.unlock(data_dir, password)?;
        if let Some(mut record) = load_record(data_dir) {
            record.enabled = false;
            save_record(data_dir, &record)?;
        }
        // Keep verifier so re-enable can reuse or user can set again; for simplicity remove lock file secrets stay encrypted.
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.unlocked = true;
        Ok(self.public_state(data_dir))
    }

    pub fn unlock(&self, data_dir: &PathBuf, password: &str) -> Result<AppLockPublicState, String> {
        let record = load_record(data_dir).ok_or_else(|| "尚未设置主密码".to_string())?;
        if !record.enabled {
            let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            guard.unlocked = true;
            return Ok(self.public_state(data_dir));
        }
        let salt = STANDARD
            .decode(&record.salt_b64)
            .map_err(|_| "锁配置损坏".to_string())?;
        let key = derive_key(password.trim(), &salt, record.iterations)?;
        let expected = STANDARD
            .decode(&record.verifier_b64)
            .map_err(|_| "锁配置损坏".to_string())?;
        let actual = Sha256::digest(key);
        if !timing_eq(&actual, &expected) {
            return Err("主密码错误".into());
        }
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.unlocked = true;
        guard.session_key = Some(key);
        guard.last_activity_ms = now_ms();
        Ok(self.public_state(data_dir))
    }

    #[cfg(target_os = "macos")]
    pub fn store_biometric_key(&self, app: &AppHandle) -> Result<(), String> {
        let key = self.session_key()?;
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("解析应用数据目录失败: {e}"))?;
        local_vault::write_text(
            &dir,
            &dir.join(BIOMETRIC_SESSION_FILE),
            BIOMETRIC_SESSION_SCOPE,
            &STANDARD.encode(key),
        )
    }

    #[cfg(not(target_os = "macos"))]
    pub fn store_biometric_key(&self, _app: &tauri::AppHandle) -> Result<(), String> {
        Err("当前平台不支持指纹解锁".into())
    }

    #[cfg(target_os = "macos")]
    pub fn unlock_biometric(
        &self,
        app: &AppHandle,
        data_dir: &PathBuf,
    ) -> Result<AppLockPublicState, String> {
        let raw = local_vault::read_text(
            data_dir,
            &data_dir.join(BIOMETRIC_SESSION_FILE),
            BIOMETRIC_SESSION_SCOPE,
        )?
        .ok_or_else(|| "尚未使用主密码初始化指纹解锁".to_string())?;
        run_biometric_helper(app)?;
        let bytes = STANDARD
            .decode(raw.trim())
            .map_err(|_| "指纹解锁返回的会话密钥无效".to_string())?;
        if bytes.len() != KEY_LEN {
            return Err("指纹解锁返回的会话密钥长度无效".into());
        }
        let record = load_record(data_dir).ok_or_else(|| "尚未设置主密码".to_string())?;
        if !record.enabled {
            return Ok(self.public_state(data_dir));
        }
        let mut key = [0u8; KEY_LEN];
        key.copy_from_slice(&bytes);
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.unlocked = true;
        guard.session_key = Some(key);
        guard.last_activity_ms = now_ms();
        drop(guard);
        Ok(self.public_state(data_dir))
    }

    #[cfg(not(target_os = "macos"))]
    pub fn unlock_biometric(
        &self,
        _app: &tauri::AppHandle,
        _data_dir: &PathBuf,
    ) -> Result<AppLockPublicState, String> {
        Err("当前平台不支持指纹解锁".into())
    }

    #[cfg(target_os = "macos")]
    pub fn clear_biometric_key(&self, app: &AppHandle) -> Result<(), String> {
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("解析应用数据目录失败: {e}"))?;
        let _ = std::fs::remove_file(dir.join(BIOMETRIC_SESSION_FILE));
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    pub fn clear_biometric_key(&self, _app: &tauri::AppHandle) -> Result<(), String> {
        Ok(())
    }

    pub fn lock_now(&self) -> AppLockPublicState {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.unlocked = false;
        guard.session_key = None;
        // Return approximate state without data_dir — caller should refresh.
        AppLockPublicState {
            enabled: true,
            locked: true,
            idle_lock_minutes: 5,
            has_password: true,
        }
    }

    pub fn set_idle_minutes(&self, data_dir: &PathBuf, minutes: u32) -> Result<(), String> {
        let mut record = load_record(data_dir).ok_or_else(|| "尚未设置主密码".to_string())?;
        record.idle_lock_minutes = minutes.clamp(1, 60);
        save_record(data_dir, &record)
    }

    fn session_key(&self) -> Result<[u8; KEY_LEN], String> {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .session_key
            .ok_or_else(|| "未解锁，无法访问加密密钥".to_string())
    }

    /// Encrypt sensitive sync fields for disk when lock is enabled.
    pub fn seal_sync_secrets(
        &self,
        data_dir: &PathBuf,
        auth_token: &str,
        encryption_key: &str,
    ) -> Result<(), String> {
        let record = load_record(data_dir);
        if record.as_ref().map(|r| r.enabled).unwrap_or(false) {
            let key = self.session_key()?;
            let payload = serde_json::json!({
                "authToken": auth_token,
                "encryptionKey": encryption_key,
            });
            let plain = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
            let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
            let mut nonce = [0u8; 12];
            rand::thread_rng().fill_bytes(&mut nonce);
            let ct = cipher
                .encrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &plain,
                        aad: b"pass.tauri.sync_secrets.v1",
                    },
                )
                .map_err(|e| format!("加密同步密钥失败: {e}"))?;
            let file = serde_json::json!({
                "v": 1,
                "nonceB64": STANDARD.encode(nonce),
                "ctB64": STANDARD.encode(ct),
            });
            let path = secrets_path(data_dir);
            std::fs::write(
                &path,
                serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
        }
        Ok(())
    }

    pub fn open_sync_secrets(&self, data_dir: &PathBuf) -> Result<(String, String), String> {
        let path = secrets_path(data_dir);
        if !path.exists() {
            return Ok((String::new(), String::new()));
        }
        let record = load_record(data_dir);
        if !record.as_ref().map(|r| r.enabled).unwrap_or(false) {
            // Should not normally use enc file without lock; try read as plain json fallback
            if let Ok(raw) = std::fs::read_to_string(&path) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if v.get("authToken").is_some() {
                        return Ok((
                            v.get("authToken")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_string(),
                            v.get("encryptionKey")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_string(),
                        ));
                    }
                }
            }
        }
        let key = self.session_key()?;
        let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let file: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("同步密钥文件损坏: {e}"))?;
        let nonce = STANDARD
            .decode(file.get("nonceB64").and_then(|x| x.as_str()).unwrap_or(""))
            .map_err(|_| "nonce 无效".to_string())?;
        let ct = STANDARD
            .decode(file.get("ctB64").and_then(|x| x.as_str()).unwrap_or(""))
            .map_err(|_| "密文无效".to_string())?;
        if nonce.len() != 12 {
            return Err("nonce 长度无效".into());
        }
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
        let plain = cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ct,
                    aad: b"pass.tauri.sync_secrets.v1",
                },
            )
            .map_err(|_| "解密同步密钥失败，请解锁后重试".to_string())?;
        let v: serde_json::Value =
            serde_json::from_slice(&plain).map_err(|e| format!("密钥 JSON 无效: {e}"))?;
        Ok((
            v.get("authToken")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            v.get("encryptionKey")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
        ))
    }
}

#[cfg(target_os = "macos")]
fn biometric_helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("解析应用资源目录失败: {e}"))?
        .join("resources/pass-biometric-helper");
    let source_path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/pass-biometric-helper");
    [resource_path, source_path]
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "指纹解锁组件未安装，请重新打包应用".into())
}

#[cfg(target_os = "macos")]
fn run_biometric_helper(app: &AppHandle) -> Result<(), String> {
    let helper = biometric_helper_path(app)?;
    let mut command = Command::new(helper);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = command
        .spawn()
        .map_err(|e| format!("启动指纹解锁组件失败: {e}"))?;
    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待指纹解锁结果失败: {e}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "指纹解锁失败".into()
        } else {
            message
        });
    }
    Ok(())
}
