export const SYNC_ENCRYPTED_SCHEMA_V1 = "pass.sync.encrypted.v1";
export const SYNC_PLAINTEXT_SCHEMA = "pass.sync.bundle.v2";

export function generateSyncEncryptionKey() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function normalizeSyncEncryptionKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return base64UrlToBytes(normalized).length === 32 ? normalized : "";
}

export function isSyncEncryptionEnabled(rawKey) {
  return Boolean(normalizeSyncEncryptionKey(rawKey));
}

export async function syncEncryptionKeyId(rawKey) {
  const key = normalizeSyncEncryptionKey(rawKey);
  if (!key) return "";
  const digest = await crypto.subtle.digest("SHA-256", base64UrlToBytes(key));
  return `k1-${Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 16)}`;
}

export async function encryptSyncBundleDocument(document, rawKey) {
  const key = normalizeSyncEncryptionKey(rawKey);
  if (!key) {
    return { ...document, schema: document?.schema || SYNC_PLAINTEXT_SCHEMA };
  }
  const imported = await importSyncKey(key, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(document));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(SYNC_ENCRYPTED_SCHEMA_V1) },
    imported,
    plaintext
  );
  return {
    schema: SYNC_ENCRYPTED_SCHEMA_V1,
    exportedAtMs: Number(document?.exportedAtMs || Date.now()),
    keyId: await syncEncryptionKeyId(key),
    cipher: "AES-256-GCM",
    nonceBase64: bytesToBase64(new Uint8Array(nonce)),
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptSyncBundleDocument(envelope, rawKey, fallbackKeys = []) {
  const schema = String(envelope?.schema || "");
  if (schema === SYNC_PLAINTEXT_SCHEMA) return envelope;
  if (schema !== SYNC_ENCRYPTED_SCHEMA_V1) {
    throw new Error("不支持的同步包格式");
  }
  const candidates = [...new Set([rawKey, ...(Array.isArray(fallbackKeys) ? fallbackKeys : [])]
    .map(normalizeSyncEncryptionKey)
    .filter(Boolean))];
  if (candidates.length === 0) {
    throw new Error("该同步包为加密信封，但当前未配置同步加密密钥");
  }
  if (envelope?.cipher !== "AES-256-GCM") throw new Error("不支持的同步加密算法");
  const declaredKeyId = String(envelope?.keyId || "").trim();
  const matchingCandidates = declaredKeyId
    ? (await Promise.all(candidates.map(async (key) => ({ key, keyId: await syncEncryptionKeyId(key) }))))
      .filter((candidate) => candidate.keyId === declaredKeyId)
      .map((candidate) => candidate.key)
    : candidates;
  if (matchingCandidates.length === 0) {
    throw new Error("同步密钥 ID 不匹配，请选择与远端数据相同的同步密钥或完成密钥轮换");
  }
  for (const key of matchingCandidates) {
    try {
      const imported = await importSyncKey(key, ["decrypt"]);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToBytes(envelope.nonceBase64),
          additionalData: new TextEncoder().encode(SYNC_ENCRYPTED_SCHEMA_V1),
        },
        imported,
        base64ToBytes(envelope.ciphertextBase64)
      );
      return JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      // Try a retained previous key during a planned key rotation.
    }
  }
  throw new Error("同步包解密失败，请确认所有设备使用同一同步密钥");
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
