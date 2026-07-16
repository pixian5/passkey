export const SYNC_ENCRYPTED_SCHEMA_V1 = "pass.sync.encrypted.v1";

export function generateSyncEncryptionKey() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function normalizeSyncEncryptionKey(value) {
  const normalized = String(value || "").trim();
  return base64UrlToBytes(normalized).length === 32 ? normalized : "";
}

export async function encryptSyncBundleDocument(document, rawKey) {
  const key = await importSyncKey(rawKey, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(document));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(SYNC_ENCRYPTED_SCHEMA_V1) },
    key,
    plaintext
  );
  return {
    schema: SYNC_ENCRYPTED_SCHEMA_V1,
    exportedAtMs: Number(document?.exportedAtMs || Date.now()),
    cipher: "AES-256-GCM",
    nonceBase64: bytesToBase64(new Uint8Array(nonce)),
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptSyncBundleDocument(envelope, rawKey) {
  if (String(envelope?.schema || "") !== SYNC_ENCRYPTED_SCHEMA_V1) {
    return envelope;
  }
  const key = await importSyncKey(rawKey, ["decrypt"]);
  if (envelope?.cipher !== "AES-256-GCM") throw new Error("不支持的同步加密算法");
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(envelope.nonceBase64),
        additionalData: new TextEncoder().encode(SYNC_ENCRYPTED_SCHEMA_V1),
      },
      key,
      base64ToBytes(envelope.ciphertextBase64)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("同步包解密失败，请确认所有设备使用同一同步加密密钥");
  }
}

async function importSyncKey(rawKey, usages) {
  const normalized = normalizeSyncEncryptionKey(rawKey);
  if (!normalized) throw new Error("同步加密密钥无效，必须是 256 位密钥");
  return crypto.subtle.importKey("raw", base64UrlToBytes(normalized), "AES-GCM", false, usages);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64ToBytes(base64) {
  try {
    const binary = atob(String(base64 || ""));
    const output = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
    return output;
  } catch {
    return new Uint8Array();
  }
}

function base64UrlToBytes(value) {
  const base64 = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  return base64ToBytes(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
}
