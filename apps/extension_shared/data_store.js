import {
  base64ToBytes,
  bytesToBase64,
  LOCK_PBKDF2_ITERATIONS,
  normalizeLockMasterCredential,
} from "./lock_crypto.js";

const DB_NAME = "pass.local.db.v1";
const DB_VERSION = 1;
const STORE_COLLECTIONS = "collections";

const COLLECTION_ACCOUNTS = "accounts";
const COLLECTION_PASSKEYS = "passkeys";
const COLLECTION_FOLDERS = "folders";
const COLLECTION_HISTORY = "history";
const HISTORY_MAX_ENTRIES = 500;

const LEGACY_STORAGE_KEY_ACCOUNTS = "pass.accounts";
const LEGACY_STORAGE_KEY_PASSKEYS = "pass.passkeys";
const LEGACY_STORAGE_KEY_FOLDERS = "pass.folders";
const STORAGE_KEY_MIGRATION_DONE = "pass.data.migratedToIndexedDb.v1";
const STORAGE_KEY_ENCRYPTION_KEY = "pass.data.encryptionKey.v1";
const STORAGE_KEY_WRAPPED_ENCRYPTION_KEY = "pass.data.wrappedEncryptionKey.v2";
const STORAGE_KEY_SESSION_ENCRYPTION_KEY = "pass.data.sessionEncryptionKey.v2";
const LEGACY_DATA_KEY_WRAP_AAD = "pass.data.encryptionKey.v2";
const DATA_KEY_WRAP_AAD = "pass.data.encryptionKey.v3";
const DATA_KEY_WRAP_VERSION = 3;
const DATA_KEY_WRAP_KDF = "PBKDF2-SHA-256";
const DATA_KEY_WRAP_SALT_BYTES = 16;
export const STORAGE_KEY_DATA_BUMP = "pass.data.bump.v1";

let dbPromise = null;
let readyPromise = null;
let unlockedEncryptionKey = null;

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
        db.createObjectStore(STORE_COLLECTIONS, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
  return dbPromise;
}

async function readCollection(key) {
  const db = await openDatabase();
  const tx = db.transaction(STORE_COLLECTIONS, "readonly");
  const store = tx.objectStore(STORE_COLLECTIONS);
  const row = await requestAsPromise(store.get(key));
  if (!row) return [];
  if (Array.isArray(row.value)) {
    await writeCollection(key, row.value);
    return row.value;
  }
  if (Number(row.version) !== 1 || !row.nonceBase64 || !row.ciphertextBase64) {
    throw new Error(`IndexedDB 集合格式无效: ${key}`);
  }
  const cryptoKey = await loadOrCreateEncryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(row.nonceBase64), additionalData: new TextEncoder().encode(key) },
    cryptoKey,
    base64ToBytes(row.ciphertextBase64)
  );
  const decoded = JSON.parse(new TextDecoder().decode(plaintext));
  return Array.isArray(decoded) ? decoded : [];
}

async function writeCollection(key, value) {
  const cryptoKey = await loadOrCreateEncryptionKey();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(Array.isArray(value) ? value : []));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(key) },
    cryptoKey,
    plaintext
  );
  const db = await openDatabase();
  const tx = db.transaction(STORE_COLLECTIONS, "readwrite");
  const store = tx.objectStore(STORE_COLLECTIONS);
  store.put({
    key,
    version: 1,
    nonceBase64: bytesToBase64(nonce),
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)),
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

async function loadOrCreateEncryptionKey() {
  if (unlockedEncryptionKey) return unlockedEncryptionKey;
  const session = await chrome.storage.session.get([STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
  const sessionKey = base64ToBytes(session[STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
  if (sessionKey.length === 32) {
    unlockedEncryptionKey = await crypto.subtle.importKey("raw", sessionKey, "AES-GCM", false, ["encrypt", "decrypt"]);
    return unlockedEncryptionKey;
  }

  const stored = await chrome.storage.local.get([
    STORAGE_KEY_ENCRYPTION_KEY,
    STORAGE_KEY_WRAPPED_ENCRYPTION_KEY,
  ]);
  if (stored[STORAGE_KEY_WRAPPED_ENCRYPTION_KEY]) {
    throw new Error("扩展已锁定，无法读取本地数据");
  }
  let rawKey = base64ToBytes(stored[STORAGE_KEY_ENCRYPTION_KEY]);
  if (rawKey.length !== 32) {
    rawKey = crypto.getRandomValues(new Uint8Array(32));
    await chrome.storage.local.set({ [STORAGE_KEY_ENCRYPTION_KEY]: bytesToBase64(rawKey) });
  }
  unlockedEncryptionKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
  return unlockedEncryptionKey;
}

export async function unlockDataEncryption(password, rawCredential) {
  const credential = normalizeLockMasterCredential(rawCredential);
  if (!credential) throw new Error("主密码凭据无效");
  const stored = await chrome.storage.local.get([
    STORAGE_KEY_ENCRYPTION_KEY,
    STORAGE_KEY_WRAPPED_ENCRYPTION_KEY,
  ]);
  let rawKey = null;
  const wrapped = stored[STORAGE_KEY_WRAPPED_ENCRYPTION_KEY];
  if (wrapped) {
    if (Number(wrapped.version) === DATA_KEY_WRAP_VERSION) {
      rawKey = await unwrapDataKey(password, wrapped);
    } else if (Number(wrapped.version) === 2) {
      const legacyWrappingKey = await deriveWrappingKey(
        password,
        base64ToBytes(credential.saltBase64),
        credential.iterations
      );
      rawKey = await unwrapLegacyDataKey(legacyWrappingKey, wrapped);
      await storeWrappedDataKey(password, rawKey);
    } else {
      throw new Error("本地数据密钥格式无效");
    }
  } else {
    const legacy = base64ToBytes(stored[STORAGE_KEY_ENCRYPTION_KEY]);
    rawKey = legacy.length === 32 ? legacy : crypto.getRandomValues(new Uint8Array(32));
    await storeWrappedDataKey(password, rawKey);
    await chrome.storage.local.remove(STORAGE_KEY_ENCRYPTION_KEY);
  }
  await cacheUnlockedDataKey(rawKey);
}

export async function rewrapDataEncryption(currentPassword, currentCredential, nextPassword, nextCredential) {
  await unlockDataEncryption(currentPassword, currentCredential);
  const session = await chrome.storage.session.get([STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
  const rawKey = base64ToBytes(session[STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
  if (rawKey.length !== 32) throw new Error("无法读取已解锁的数据密钥");
  normalizeCredential(nextCredential);
  await storeWrappedDataKey(nextPassword, rawKey);
}

export async function lockDataEncryption() {
  unlockedEncryptionKey = null;
  await chrome.storage.session.remove(STORAGE_KEY_SESSION_ENCRYPTION_KEY);
}

export async function disableDataEncryption(password, rawCredential) {
  await unlockDataEncryption(password, rawCredential);
  const session = await chrome.storage.session.get([STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
  const rawKey = base64ToBytes(session[STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
  if (rawKey.length !== 32) throw new Error("无法读取已解锁的数据密钥");
  await chrome.storage.local.set({ [STORAGE_KEY_ENCRYPTION_KEY]: bytesToBase64(rawKey) });
  await chrome.storage.local.remove(STORAGE_KEY_WRAPPED_ENCRYPTION_KEY);
  await lockDataEncryption();
}

async function deriveWrappingKey(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password || "").trim()),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes,
      iterations,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function normalizeCredential(value) {
  const credential = normalizeLockMasterCredential(value);
  if (!credential) throw new Error("主密码凭据无效");
  return credential;
}

async function unwrapLegacyDataKey(wrappingKey, wrapped) {
  if (!wrapped || Number(wrapped.version) !== 2) throw new Error("本地数据密钥格式无效");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(wrapped.nonceBase64),
      additionalData: new TextEncoder().encode(LEGACY_DATA_KEY_WRAP_AAD),
    },
    wrappingKey,
    base64ToBytes(wrapped.ciphertextBase64)
  );
  const rawKey = new Uint8Array(plaintext);
  if (rawKey.length !== 32) throw new Error("本地数据密钥长度无效");
  return rawKey;
}

async function unwrapDataKey(password, wrapped) {
  if (!wrapped || Number(wrapped.version) !== DATA_KEY_WRAP_VERSION ||
      String(wrapped.kdf || "") !== DATA_KEY_WRAP_KDF ||
      Number(wrapped.iterations) !== LOCK_PBKDF2_ITERATIONS) {
    throw new Error("本地数据密钥格式无效");
  }
  const saltBytes = base64ToBytes(wrapped.wrapSaltBase64);
  const nonce = base64ToBytes(wrapped.nonceBase64);
  const ciphertext = base64ToBytes(wrapped.ciphertextBase64);
  if (saltBytes.length !== DATA_KEY_WRAP_SALT_BYTES || nonce.length !== 12 || ciphertext.length !== 48) {
    throw new Error("本地数据密钥格式无效");
  }
  const wrappingKey = await deriveWrappingKey(password, saltBytes, LOCK_PBKDF2_ITERATIONS);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(DATA_KEY_WRAP_AAD) },
    wrappingKey,
    ciphertext
  );
  const rawKey = new Uint8Array(plaintext);
  if (rawKey.length !== 32) throw new Error("本地数据密钥长度无效");
  return rawKey;
}

async function storeWrappedDataKey(password, rawKey) {
  const wrapSalt = crypto.getRandomValues(new Uint8Array(DATA_KEY_WRAP_SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(password, wrapSalt, LOCK_PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(DATA_KEY_WRAP_AAD) },
    wrappingKey,
    rawKey
  );
  await chrome.storage.local.set({
    [STORAGE_KEY_WRAPPED_ENCRYPTION_KEY]: {
      version: DATA_KEY_WRAP_VERSION,
      kdf: DATA_KEY_WRAP_KDF,
      iterations: LOCK_PBKDF2_ITERATIONS,
      wrapSaltBase64: bytesToBase64(wrapSalt),
      nonceBase64: bytesToBase64(nonce),
      ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)),
    },
  });
}

async function cacheUnlockedDataKey(rawKey) {
  await chrome.storage.session.set({ [STORAGE_KEY_SESSION_ENCRYPTION_KEY]: bytesToBase64(rawKey) });
  unlockedEncryptionKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function touchDataBump(reason) {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY_DATA_BUMP]: Date.now(),
      "pass.data.bumpReason.v1": String(reason || ""),
    });
  } catch {
    // Ignore bump write failures. Data remains persisted in IndexedDB.
  }
}

async function migrateLegacyStorageIfNeeded() {
  const result = await chrome.storage.local.get([STORAGE_KEY_MIGRATION_DONE]);
  if (Boolean(result[STORAGE_KEY_MIGRATION_DONE])) return;

  const [accounts, passkeys, folders] = await Promise.all([
    readCollection(COLLECTION_ACCOUNTS),
    readCollection(COLLECTION_PASSKEYS),
    readCollection(COLLECTION_FOLDERS),
  ]);
  const idbHasData = accounts.length > 0 || passkeys.length > 0 || folders.length > 0;
  if (idbHasData) {
    await chrome.storage.local.set({ [STORAGE_KEY_MIGRATION_DONE]: true });
    return;
  }

  const legacy = await chrome.storage.local.get([
    LEGACY_STORAGE_KEY_ACCOUNTS,
    LEGACY_STORAGE_KEY_PASSKEYS,
    LEGACY_STORAGE_KEY_FOLDERS,
  ]);
  const legacyAccounts = Array.isArray(legacy[LEGACY_STORAGE_KEY_ACCOUNTS]) ? legacy[LEGACY_STORAGE_KEY_ACCOUNTS] : [];
  const legacyPasskeys = Array.isArray(legacy[LEGACY_STORAGE_KEY_PASSKEYS]) ? legacy[LEGACY_STORAGE_KEY_PASSKEYS] : [];
  const legacyFolders = Array.isArray(legacy[LEGACY_STORAGE_KEY_FOLDERS]) ? legacy[LEGACY_STORAGE_KEY_FOLDERS] : [];

  if (legacyAccounts.length > 0 || legacyPasskeys.length > 0 || legacyFolders.length > 0) {
    await Promise.all([
      writeCollection(COLLECTION_ACCOUNTS, legacyAccounts),
      writeCollection(COLLECTION_PASSKEYS, legacyPasskeys),
      writeCollection(COLLECTION_FOLDERS, legacyFolders),
    ]);
    await touchDataBump("legacy-migration");
  }

  await chrome.storage.local.set({ [STORAGE_KEY_MIGRATION_DONE]: true });
}

export async function ensureDataStorageReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await openDatabase();
      await migrateLegacyStorageIfNeeded();
    })().catch((error) => {
      readyPromise = null;
      throw error;
    });
  }
  return readyPromise;
}

export async function getAccounts() {
  await ensureDataStorageReady();
  return await readCollection(COLLECTION_ACCOUNTS);
}

export async function setAccounts(accounts) {
  await ensureDataStorageReady();
  await writeCollection(COLLECTION_ACCOUNTS, accounts);
  await touchDataBump(COLLECTION_ACCOUNTS);
}

export async function getPasskeys() {
  await ensureDataStorageReady();
  return await readCollection(COLLECTION_PASSKEYS);
}

export async function setPasskeys(passkeys) {
  await ensureDataStorageReady();
  await writeCollection(COLLECTION_PASSKEYS, passkeys);
  await touchDataBump(COLLECTION_PASSKEYS);
}

export async function getFolders() {
  await ensureDataStorageReady();
  return await readCollection(COLLECTION_FOLDERS);
}

export async function setFolders(folders) {
  await ensureDataStorageReady();
  await writeCollection(COLLECTION_FOLDERS, folders);
  await touchDataBump(COLLECTION_FOLDERS);
}

export async function getAllData() {
  await ensureDataStorageReady();
  const [accounts, passkeys, folders] = await Promise.all([
    readCollection(COLLECTION_ACCOUNTS),
    readCollection(COLLECTION_PASSKEYS),
    readCollection(COLLECTION_FOLDERS),
  ]);
  return { accounts, passkeys, folders };
}

export async function setAllData({ accounts, passkeys, folders }) {
  await ensureDataStorageReady();
  await Promise.all([
    writeCollection(COLLECTION_ACCOUNTS, accounts),
    writeCollection(COLLECTION_PASSKEYS, passkeys),
    writeCollection(COLLECTION_FOLDERS, folders),
  ]);
  await touchDataBump("all");
}

export async function getHistory() {
  await ensureDataStorageReady();
  const entries = await readCollection(COLLECTION_HISTORY);
  return (Array.isArray(entries) ? entries : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id || ""),
      timestampMs: Number(item.timestampMs || 0),
      action: String(item.action || ""),
    }))
    .filter((item) => item.timestampMs > 0 && item.action.trim().length > 0)
    .sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    });
}

export async function setHistory(entries) {
  await ensureDataStorageReady();
  const normalized = (Array.isArray(entries) ? entries : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id || ""),
      timestampMs: Number(item.timestampMs || 0),
      action: String(item.action || "").trim(),
    }))
    .filter((item) => item.timestampMs > 0 && item.action.length > 0)
    .sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    })
    .slice(0, HISTORY_MAX_ENTRIES);
  await writeCollection(COLLECTION_HISTORY, normalized);
  await touchDataBump(COLLECTION_HISTORY);
}

export async function appendHistoryEntry({ timestampMs, action }) {
  const normalizedAction = String(action || "").trim();
  if (!normalizedAction) return;
  const ts = Number(timestampMs || Date.now());
  const entry = {
    id: String(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
    timestampMs: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    action: normalizedAction,
  };
  const current = await getHistory();
  await setHistory([entry, ...current]);
}
