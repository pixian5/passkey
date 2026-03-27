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
export const STORAGE_KEY_DATA_BUMP = "pass.data.bump.v1";

let dbPromise = null;
let readyPromise = null;

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
  return Array.isArray(row?.value) ? row.value : [];
}

async function writeCollection(key, value) {
  const db = await openDatabase();
  const tx = db.transaction(STORE_COLLECTIONS, "readwrite");
  const store = tx.objectStore(STORE_COLLECTIONS);
  store.put({ key, value: Array.isArray(value) ? value : [] });
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
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
    })();
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
