//! Small encrypted-file layer for local Tauri state.
//!
//! The local key is deliberately independent from the optional app-lock
//! password, mirroring PassMac's encrypted SQLite collection storage. App lock
//! can still add a second layer for sync secrets while a session is locked.

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use std::fs;
use std::io::Write;
use std::path::Path;
use uuid::Uuid;

const KEY_FILE: &str = "pass-local-vault-key-v1";
const PREFIX: &str = "pass.local.encrypted.v1:";

fn set_private_permissions(path: &Path, directory: bool) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if directory { 0o700 } else { 0o600 };
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    let _ = (path, directory);
}

fn ensure_data_dir(data_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|e| format!("创建本地数据目录失败: {e}"))?;
    set_private_permissions(data_dir, true);
    Ok(())
}

fn write_private_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "本地文件没有父目录".to_string())?;
    ensure_data_dir(parent)?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("pass"),
        Uuid::new_v4()
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| format!("创建本地临时文件失败: {e}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("持久化本地临时文件失败: {e}"))?;
    drop(file);
    set_private_permissions(&temp, false);
    fs::rename(&temp, path).map_err(|e| format!("更新本地文件失败: {e}"))?;
    set_private_permissions(path, false);
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|e| format!("持久化本地目录失败: {e}"))?;
    Ok(())
}

fn load_or_create_key(data_dir: &Path) -> Result<[u8; 32], String> {
    ensure_data_dir(data_dir)?;
    let path = data_dir.join(KEY_FILE);
    if path.exists() {
        let raw = fs::read(&path).map_err(|e| format!("读取本地加密密钥失败: {e}"))?;
        if raw.len() != 32 {
            return Err("本地加密密钥无效，拒绝使用或重建数据".into());
        }
        set_private_permissions(&path, false);
        let mut key = [0u8; 32];
        key.copy_from_slice(&raw);
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    write_private_atomically(&path, &key)?;
    Ok(key)
}

/// Returns `None` for legacy plaintext so callers can transparently migrate it.
pub fn decrypt_text(
    data_dir: &Path,
    context: &str,
    stored: &str,
) -> Result<Option<String>, String> {
    let Some(encoded) = stored.strip_prefix(PREFIX) else {
        return Ok(None);
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "本地加密数据格式无效".to_string())?;
    if bytes.len() < 12 + 16 {
        return Err("本地加密数据过短".into());
    }
    let (nonce, ciphertext) = bytes.split_at(12);
    let key = load_or_create_key(data_dir)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let plain = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: context.as_bytes(),
            },
        )
        .map_err(|_| "本地加密数据无法解密".to_string())?;
    String::from_utf8(plain)
        .map(Some)
        .map_err(|_| "本地加密数据不是有效 UTF-8".to_string())
}

pub fn encrypt_text(data_dir: &Path, context: &str, plain: &str) -> Result<String, String> {
    let key = load_or_create_key(data_dir)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plain.as_bytes(),
                aad: context.as_bytes(),
            },
        )
        .map_err(|e| format!("加密本地数据失败: {e}"))?;
    let mut combined = nonce.to_vec();
    combined.extend(ciphertext);
    Ok(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(combined)))
}

pub fn read_text(data_dir: &Path, path: &Path, context: &str) -> Result<Option<String>, String> {
    let stored = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("读取本地文件失败: {e}")),
    };
    match decrypt_text(data_dir, context, &stored)? {
        Some(plain) => Ok(Some(plain)),
        None => {
            // One-time migration from the earlier 0600 plaintext files.
            write_text(data_dir, path, context, &stored)?;
            Ok(Some(stored))
        }
    }
}

pub fn write_text(data_dir: &Path, path: &Path, context: &str, plain: &str) -> Result<(), String> {
    let encrypted = encrypt_text(data_dir, context, plain)?;
    write_private_atomically(path, encrypted.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_context_binding() {
        let root = std::env::temp_dir().join(format!("pass-tauri-vault-test-{}", Uuid::new_v4()));
        let stored = encrypt_text(&root, "test.context", "secret").unwrap();
        assert_ne!(stored, "secret");
        assert_eq!(
            decrypt_text(&root, "test.context", &stored)
                .unwrap()
                .as_deref(),
            Some("secret")
        );
        assert!(decrypt_text(&root, "other.context", &stored).is_err());
        let _ = fs::remove_dir_all(root);
    }
}
