import {
  base64ToBytes,
  bytesToBase64,
  LOCK_PBKDF2_ITERATIONS,
  normalizeLockMasterCredential,
} from "./lock_crypto.js";
import { normalizeSyncOutbox } from "./sync_outbox.js";

const DB_NAME = "pass.local.db.v1";
const DB_VERSION = 1;
const STORE_COLLECTIONS = "collections";

const COLLECTION_ACCOUNTS = "accounts";
const COLLECTION_PASSKEYS = "passkeys";
const COLLECTION_FOLDERS = "folders";
const COLLECTION_HISTORY = "history";
const COLLECTION_SYNC_SECRETS = "syncSecrets";
const COLLECTION_SYNC_SAFETY_SNAPSHOTS = "syncSafetySnapshots";
const COLLECTION_SYNC_OUTBOX = "syncOutbox";
const HISTORY_MAX_ENTRIES = 500;
const SAFETY_SNAPSHOT_MAX_ENTRIES = 5;

const LEGACY_STORAGE_KEY_ACCOUNTS = "pass.accounts";
const LEGACY_STORAGE_KEY_PASSKEYS = "pass.passkeys";
const LEGACY_STORAGE_KEY_FOLDERS = "pass.folders";
const STORAGE_KEY_MIGRATION_DONE = "pass.data.migratedToIndexedDb.v1";
const STORAGE_KEY_ENCRYPTION_KEY = "pass.data.encryptionKey.v1";
const STORAGE_KEY_WRAPPED_ENCRYPTION_KEY = "pass.data.wrappedEncryptionKey.v2";
const STORAGE_KEY_SESSION_ENCRYPTION_KEY = "pass.data.sessionEncryptionKey.v2";
const LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD = "pass.sync.webdav.password.v2";
const LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN = "pass.sync.server.token.v2";
const LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY = "pass.sync.encryptionKey.v1";
const LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS = "pass.localSafetySnapshots.v1";
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
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(row.nonceBase64), additionalData: new TextEncoder().encode(key) },
      cryptoKey,
      base64ToBytes(row.ciphertextBase64)
    );
  } catch (error) {
    // History is auxiliary data. A stale browser-origin key must not prevent
    // the account store from starting; the next history write uses the current key.
    if (key === COLLECTION_HISTORY && String(error?.name || "") === "OperationError") return [];
    throw error;
  }
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

function legacyCollectionValue(legacy, key) {
  const value = legacy[key];
  return Array.isArray(value) ? value : [];
}

function collectionRecordIdentity(value, collectionKey, index) {
  if (!value || typeof value !== "object") return `index:${index}`;
  const candidates = collectionKey === COLLECTION_ACCOUNTS
    ? [value.accountId, value.recordId, value.id]
    : collectionKey === COLLECTION_PASSKEYS
      ? [value.credentialIdB64u, value.credentialId, value.id]
      : [value.id, value.folderId];
  const identity = candidates.find((candidate) => String(candidate || "").trim());
  if (!identity) return `index:${index}`;
  const normalized = String(identity).trim();
  return collectionKey === COLLECTION_FOLDERS ? normalized.toLowerCase() : normalized;
}

function collectionRecordUpdatedAt(value) {
  const timestamp = Number(value?.updatedAtMs ?? value?.createdAtMs ?? 0);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeLegacyCollection(current, legacy, collectionKey) {
  const merged = new Map();
  const order = [];
  const add = (value, index, preferOnEqual) => {
    const identity = collectionRecordIdentity(value, collectionKey, index);
    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, { value, updatedAtMs: collectionRecordUpdatedAt(value) });
      order.push(identity);
      return;
    }
    const updatedAtMs = collectionRecordUpdatedAt(value);
    if (updatedAtMs > existing.updatedAtMs || (preferOnEqual && updatedAtMs === existing.updatedAtMs)) {
      merged.set(identity, { value, updatedAtMs });
    }
  };
  legacy.forEach((value, index) => add(value, index, false));
  current.forEach((value, index) => add(value, index, true));
  return order.map((identity) => merged.get(identity).value);
}

async function migrateLegacyCollections(currentCollections, legacy) {
  const collectionPairs = [
    [COLLECTION_ACCOUNTS, currentCollections.accounts, legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_ACCOUNTS)],
    [COLLECTION_PASSKEYS, currentCollections.passkeys, legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_PASSKEYS)],
    [COLLECTION_FOLDERS, currentCollections.folders, legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_FOLDERS)],
  ];
  let changed = false;
  for (const [collectionKey, current, legacyValue] of collectionPairs) {
    if (legacyValue.length === 0) continue;
    const merged = mergeLegacyCollection(current, legacyValue, collectionKey);
    if (JSON.stringify(merged) === JSON.stringify(current)) continue;
    await writeCollection(collectionKey, merged);
    changed = true;
  }
  if (changed) await touchDataBump("legacy-migration");
  return changed;
}

async function readCollectionForMigration(key, legacyValue) {
  try {
    return await readCollection(key);
  } catch (error) {
    // A browser update can leave a collection encrypted with a discarded
    // origin key. If a legacy collection exists, rewrite it with the current key.
    if (legacyValue.length > 0 && String(error?.name || "") === "OperationError") return [];
    throw error;
  }
}

async function migrateLegacyStorageIfNeeded() {
  const legacy = await chrome.storage.local.get([
    LEGACY_STORAGE_KEY_ACCOUNTS,
    LEGACY_STORAGE_KEY_PASSKEYS,
    LEGACY_STORAGE_KEY_FOLDERS,
  ]);
  // Always read the IndexedDB rows before marking migration complete. A browser
  // origin can retain the flag while its new IndexedDB contains only a partial
  // dataset; merge the legacy rows by record timestamp instead of discarding them.
  try {
    const legacyAccounts = legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_ACCOUNTS);
    const legacyPasskeys = legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_PASSKEYS);
    const legacyFolders = legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_FOLDERS);
    const [accounts, passkeys, folders] = await Promise.all([
      readCollectionForMigration(COLLECTION_ACCOUNTS, legacyAccounts),
      readCollectionForMigration(COLLECTION_PASSKEYS, legacyPasskeys),
      readCollectionForMigration(COLLECTION_FOLDERS, legacyFolders),
    ]);
    await migrateLegacyCollections({ accounts, passkeys, folders }, legacy);
  } catch (error) {
    if (String(error?.message || "") === "扩展已锁定，无法读取本地数据") return;
    throw error;
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

function normalizeSyncSecrets(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    webdavPassword: String(source.webdavPassword || ""),
    serverToken: String(source.serverToken || "").trim(),
    encryptionKey: String(source.encryptionKey || "").trim(),
    previousEncryptionKey: String(source.previousEncryptionKey || "").trim(),
  };
}

export async function getSyncSecrets() {
  await ensureDataStorageReady();
  const entries = await readCollection(COLLECTION_SYNC_SECRETS);
  return normalizeSyncSecrets(Array.isArray(entries) ? entries[0] : null);
}

export async function setSyncSecrets(value) {
  await ensureDataStorageReady();
  const normalized = normalizeSyncSecrets(value);
  await writeCollection(COLLECTION_SYNC_SECRETS, [normalized]);
  return normalized;
}

function normalizeSafetySnapshots(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && item.payload && typeof item.payload === "object")
    .map((item) => ({
      createdAtMs: Number(item.createdAtMs || 0),
      reason: String(item.reason || "同步前备份"),
      payload: item.payload,
    }))
    .filter((item) => Number.isFinite(item.createdAtMs) && item.createdAtMs > 0)
    .sort((lhs, rhs) => rhs.createdAtMs - lhs.createdAtMs)
    .slice(0, SAFETY_SNAPSHOT_MAX_ENTRIES);
}

export async function getSafetySnapshots() {
  await ensureDataStorageReady();
  const legacyResult = await chrome.storage.local.get([LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS]);
  const legacy = normalizeSafetySnapshots(legacyResult[LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS]);
  let encrypted;
  try {
    encrypted = normalizeSafetySnapshots(await readCollection(COLLECTION_SYNC_SAFETY_SNAPSHOTS));
  } catch (error) {
    if (String(error?.name || "") !== "OperationError" || legacy.length === 0) throw error;
    encrypted = [];
  }
  const merged = normalizeSafetySnapshots([...encrypted, ...legacy]);
  if (legacy.length > 0 || JSON.stringify(merged) !== JSON.stringify(encrypted)) {
    await writeCollection(COLLECTION_SYNC_SAFETY_SNAPSHOTS, merged);
  }
  if (legacyResult[LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS] !== undefined) {
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS);
  }
  return merged;
}

export async function setSafetySnapshots(value) {
  await ensureDataStorageReady();
  const normalized = normalizeSafetySnapshots(value);
  await writeCollection(COLLECTION_SYNC_SAFETY_SNAPSHOTS, normalized);
  await chrome.storage.local.remove(LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS);
  return normalized;
}

export async function getSyncOutbox() {
  await ensureDataStorageReady();
  return normalizeSyncOutbox(await readCollection(COLLECTION_SYNC_OUTBOX));
}

export async function setSyncOutbox(value) {
  await ensureDataStorageReady();
  const normalized = normalizeSyncOutbox(value);
  await writeCollection(COLLECTION_SYNC_OUTBOX, normalized);
  return normalized;
}

export async function migrateLegacySyncSecrets() {
  let existing = normalizeSyncSecrets(null);
  let existingCollectionUnreadable = false;
  try {
    existing = await getSyncSecrets();
  } catch (error) {
    // A browser-origin migration can leave this auxiliary collection encrypted
    // with a discarded origin key. Do not let stale sync credentials prevent
    // the options page or popup from initializing; legacy storage below is
    // still available as the recovery source.
    if (String(error?.name || "") !== "OperationError") throw error;
    existingCollectionUnreadable = true;
  }
  const legacy = await chrome.storage.local.get([
    LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD,
    LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN,
    LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY,
  ]);
  const migrated = normalizeSyncSecrets({
    webdavPassword: existing.webdavPassword || legacy[LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD],
    serverToken: existing.serverToken || legacy[LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN],
    encryptionKey: existing.encryptionKey || legacy[LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY],
    previousEncryptionKey: existing.previousEncryptionKey,
  });
  const hasLegacyRecoverySecrets = Boolean(
    migrated.webdavPassword || migrated.serverToken || migrated.encryptionKey
  );
  if (existingCollectionUnreadable && !hasLegacyRecoverySecrets) {
    const error = new Error("同步凭据集合无法解密，且没有可用旧凭据；原数据未覆盖");
    error.code = "SYNC_SECRETS_UNREADABLE";
    throw error;
  }
  if (existingCollectionUnreadable || hasLegacyRecoverySecrets) {
    await setSyncSecrets(migrated);
  }
  await chrome.storage.local.remove([
    LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD,
    LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN,
    LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY,
  ]);
  return migrated;
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
