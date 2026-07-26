//! AES-256-GCM envelope compatible with macOS PassSyncCrypto / extension sync_crypto.js.
//! schema: pass.sync.encrypted.v1 ; AAD = schema string ; key = base64url 32 bytes.

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const ENCRYPTED_SCHEMA: &str = "pass.sync.encrypted.v1";
pub const PLAINTEXT_SCHEMA: &str = "pass.sync.bundle.v2";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    schema: String,
    exported_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    key_id: Option<String>,
    cipher: String,
    nonce_base64: String,
    ciphertext_base64: String,
}

pub fn generate_sync_key() -> String {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    URL_SAFE_NO_PAD.encode(key)
}

pub fn is_valid_sync_key(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return true; // empty = plaintext mode
    }
    decode_key(t).is_ok()
}

fn decode_key(raw: &str) -> Result<[u8; 32], String> {
    let t = raw.trim();
    let bytes = URL_SAFE_NO_PAD
        .decode(t)
        .or_else(|_| STANDARD.decode(t))
        .map_err(|_| "同步加密密钥无效，必须是 256 位密钥".to_string())?;
    if bytes.len() != 32 {
        return Err("同步加密密钥无效，必须是 256 位密钥".into());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

pub fn key_id(raw: &str) -> String {
    let Ok(key) = decode_key(raw) else {
        return String::new();
    };
    if raw.trim().is_empty() {
        return String::new();
    }
    let digest = Sha256::digest(key);
    let prefix: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("k1-{prefix}")
}

/// Encrypt a JSON bundle document (object) into envelope JSON bytes.
/// Empty key → returns original document bytes unchanged.
pub fn encrypt_bundle_document(document: &Value, key_string: &str) -> Result<Vec<u8>, String> {
    let key_string = key_string.trim();
    if key_string.is_empty() {
        return serde_json::to_vec(document).map_err(|e| e.to_string());
    }
    let key = decode_key(key_string)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = serde_json::to_vec(document).map_err(|e| e.to_string())?;
    let aad = ENCRYPTED_SCHEMA.as_bytes();
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: &plaintext,
                aad,
            },
        )
        .map_err(|e| format!("同步加密失败: {e}"))?;
    let exported_at_ms = document
        .get("exportedAtMs")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let envelope = Envelope {
        schema: ENCRYPTED_SCHEMA.into(),
        exported_at_ms,
        key_id: Some(key_id(key_string)),
        cipher: "AES-256-GCM".into(),
        nonce_base64: STANDARD.encode(nonce_bytes),
        ciphertext_base64: STANDARD.encode(ciphertext),
    };
    serde_json::to_vec(&envelope).map_err(|e| e.to_string())
}

/// Decrypt wire body into plaintext bundle JSON value.
pub fn decrypt_wire_body(body: &[u8], key_string: &str) -> Result<Value, String> {
    decrypt_wire_body_with_fallback(body, key_string, "")
}

pub fn decrypt_wire_body_with_fallback(
    body: &[u8],
    key_string: &str,
    fallback_key_string: &str,
) -> Result<Value, String> {
    let value: Value =
        serde_json::from_slice(body).map_err(|e| format!("同步响应不是 JSON: {e}"))?;
    let schema = value.get("schema").and_then(|v| v.as_str()).unwrap_or("");
    if schema == PLAINTEXT_SCHEMA {
        if !key_string.trim().is_empty() {
            return Err("同步密钥已配置，拒绝未加密同步包".into());
        }
        return Ok(value);
    }
    if schema != ENCRYPTED_SCHEMA {
        // Some servers store raw payload without schema; treat as plain if no cipher fields.
        if value.get("cipher").is_none() {
            if !key_string.trim().is_empty() {
                return Err("同步密钥已配置，拒绝未加密同步包".into());
            }
            return Ok(value);
        }
        return Err("不支持的同步包格式".into());
    }
    let keys: Vec<&str> = [key_string, fallback_key_string]
        .into_iter()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect();
    if keys.is_empty() {
        return Err("该同步包为加密信封，但当前未配置同步加密密钥".into());
    }
    let envelope: Envelope =
        serde_json::from_value(value).map_err(|e| format!("加密信封解析失败: {e}"))?;
    if envelope.cipher != "AES-256-GCM" {
        return Err("不支持的同步加密算法".into());
    }
    let declared = envelope.key_id.unwrap_or_default();
    let nonce_raw = STANDARD
        .decode(&envelope.nonce_base64)
        .map_err(|_| "nonce 无效".to_string())?;
    if nonce_raw.len() != 12 {
        return Err("nonce 长度无效".into());
    }
    let nonce = Nonce::from_slice(&nonce_raw);
    let ct = STANDARD
        .decode(&envelope.ciphertext_base64)
        .map_err(|_| "ciphertext 无效".to_string())?;
    for candidate in keys {
        let Ok(key) = decode_key(candidate) else {
            continue;
        };
        if !declared.is_empty() && declared != key_id(candidate) {
            continue;
        }
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
        if let Ok(plain) = cipher.decrypt(
            nonce,
            Payload {
                msg: &ct,
                aad: ENCRYPTED_SCHEMA.as_bytes(),
            },
        ) {
            return serde_json::from_slice(&plain).map_err(|e| format!("解密后不是合法 JSON: {e}"));
        }
    }
    Err("同步包解密失败，请确认所有设备使用同一同步密钥".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decrypts_with_previous_key_but_rejects_wrong_key_id() {
        let document = json!({
            "schema": PLAINTEXT_SCHEMA,
            "exportedAtMs": 1,
            "payload": { "accounts": [] }
        });
        let previous = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let current = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
        let encrypted = encrypt_bundle_document(&document, previous).unwrap();
        assert_eq!(
            decrypt_wire_body_with_fallback(&encrypted, current, previous).unwrap(),
            document
        );
        assert_eq!(
            decrypt_wire_body_with_fallback(&encrypted, "invalid-current-key", previous).unwrap(),
            document
        );
        assert!(decrypt_wire_body_with_fallback(&encrypted, current, current).is_err());
    }

    #[test]
    fn empty_key_keeps_plaintext_mode() {
        let document = json!({ "schema": PLAINTEXT_SCHEMA, "payload": {} });
        let plain = encrypt_bundle_document(&document, "").unwrap();
        assert_eq!(
            decrypt_wire_body_with_fallback(&plain, "", "").unwrap(),
            document
        );
        assert!(decrypt_wire_body_with_fallback(
            &plain,
            "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            ""
        )
        .is_err());
    }
}
