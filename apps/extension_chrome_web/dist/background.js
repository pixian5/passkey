(() => {
  // lock_crypto.js
  var LOCK_CREDENTIAL_VERSION = 2;
  var LOCK_PBKDF2_ITERATIONS = 31e4;
  function bytesToBase64(bytes) {
    let binary = "";
    for (const value of bytes) binary += String.fromCharCode(value);
    return btoa(binary);
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
  function normalizeLockMasterCredential(value) {
    if (!value || typeof value !== "object") return null;
    const version = Number(value.version || 1);
    const saltBase64 = String(value.saltBase64 || "");
    const digestBase64 = String(value.digestBase64 || "");
    if (![1, LOCK_CREDENTIAL_VERSION].includes(version) || !saltBase64 || !digestBase64) return null;
    const saltBytes = base64ToBytes(saltBase64);
    if (saltBytes.length < 16) return null;
    const iterations = version === LOCK_CREDENTIAL_VERSION ? Number(value.iterations || LOCK_PBKDF2_ITERATIONS) : 1;
    if (!Number.isInteger(iterations) || iterations < 1) return null;
    return { version, saltBase64, digestBase64, iterations };
  }
  async function legacyDigest(password, saltBytes) {
    const passwordBytes = new TextEncoder().encode(String(password || ""));
    const merged = new Uint8Array(saltBytes.length + passwordBytes.length);
    merged.set(saltBytes, 0);
    merged.set(passwordBytes, saltBytes.length);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", merged));
  }
  async function pbkdf2Digest(password, saltBytes, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(String(password || "")),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
      keyMaterial,
      256
    );
    return new Uint8Array(bits);
  }
  async function createLockMasterCredential(password) {
    const normalizedPassword = String(password || "").trim();
    if (!normalizedPassword) return null;
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const digest = await pbkdf2Digest(normalizedPassword, saltBytes, LOCK_PBKDF2_ITERATIONS);
    return {
      version: LOCK_CREDENTIAL_VERSION,
      saltBase64: bytesToBase64(saltBytes),
      digestBase64: bytesToBase64(digest),
      iterations: LOCK_PBKDF2_ITERATIONS
    };
  }
  async function verifyLockMasterPassword(credential, password) {
    const normalized = normalizeLockMasterCredential(credential);
    if (!normalized) return false;
    const saltBytes = base64ToBytes(normalized.saltBase64);
    const digest = normalized.version === 1 ? await legacyDigest(String(password || "").trim(), saltBytes) : await pbkdf2Digest(String(password || "").trim(), saltBytes, normalized.iterations);
    return timingSafeEqual(digest, base64ToBytes(normalized.digestBase64));
  }
  function timingSafeEqual(lhs, rhs) {
    if (lhs.length !== rhs.length) return false;
    let difference = 0;
    for (let i = 0; i < lhs.length; i += 1) difference |= lhs[i] ^ rhs[i];
    return difference === 0;
  }

  // ../../core/pass_core/js/sync_policy.js
  var DEFAULT_DEVICE_NAME = "PassDevice";
  var FIXED_NEW_ACCOUNT_FOLDER_ID = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";
  var FIXED_NEW_ACCOUNT_FOLDER_NAME = "\u65B0\u8D26\u53F7";
  var ETLD2_SUFFIXES = [
    "com.cn",
    "net.cn",
    "org.cn",
    "gov.cn",
    "edu.cn",
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "com.au",
    "net.au",
    "org.au",
    "com.br",
    "com.mx",
    "co.jp",
    "or.jp",
    "ne.jp",
    "co.kr",
    "co.in",
    "com.hk",
    "com.tw",
    "com.sg",
    "co.nz",
    "org.nz",
    "com.ar",
    "com.tr",
    "co.za",
    "com.ua"
  ];
  var SYNC_OUTBOX_MAX_ATTEMPTS = 12;
  var SYNC_OUTBOX_BASE_DELAY_MS = 5e3;
  var SYNC_OUTBOX_MAX_DELAY_MS = 60 * 60 * 1e3;
  var SYNC_PUSH_CONFLICT_MAX_ATTEMPTS = 3;
  function syncOutboxRetryDelayMs(attempts) {
    const exponent = Math.max(0, Math.min(Number(attempts || 1) - 1, 8));
    return Math.min(SYNC_OUTBOX_MAX_DELAY_MS, SYNC_OUTBOX_BASE_DELAY_MS * 2 ** exponent);
  }
  function normalizeDeviceName(value, fallback = DEFAULT_DEVICE_NAME) {
    const trimmed = String(value || "").trim();
    return trimmed || fallback;
  }

  // sync_outbox.js
  function syncTargetKey(target) {
    return `${String(target?.kind || "").trim()}|${String(target?.url || "").trim()}`;
  }
  function normalizeSyncOutboxItem(item, nowMs = Date.now()) {
    const targetKey = String(item?.targetKey || "").trim();
    const payload = item?.payload;
    if (!targetKey || !payload || typeof payload !== "object") return null;
    const nonNegativeNumber = (raw, fallback) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    return {
      targetKey,
      payload,
      createdAtMs: nonNegativeNumber(item?.createdAtMs, nowMs),
      attempts: Math.min(SYNC_OUTBOX_MAX_ATTEMPTS, Math.floor(nonNegativeNumber(item?.attempts, 0))),
      lastAttemptAtMs: nonNegativeNumber(item?.lastAttemptAtMs, 0),
      nextRetryAtMs: nonNegativeNumber(item?.nextRetryAtMs, 0),
      lastError: String(item?.lastError || "")
    };
  }
  function normalizeSyncOutbox(value, nowMs = Date.now()) {
    const byTarget = /* @__PURE__ */ new Map();
    for (const item of Array.isArray(value) ? value : []) {
      const normalized = normalizeSyncOutboxItem(item, nowMs);
      if (!normalized) continue;
      byTarget.set(normalized.targetKey, normalized);
    }
    return [...byTarget.values()].sort((left, right) => left.createdAtMs - right.createdAtMs);
  }
  function isSyncOutboxReady(item, nowMs = Date.now()) {
    return !item || Number(item.nextRetryAtMs || 0) <= nowMs;
  }
  function upsertSyncOutbox(value, { targetKey, payload, error, nowMs = Date.now() }) {
    const current = normalizeSyncOutbox(value, nowMs);
    const previous = current.find((item) => item.targetKey === targetKey);
    const attempts = Math.min(SYNC_OUTBOX_MAX_ATTEMPTS, Number(previous?.attempts || 0) + 1);
    const next = normalizeSyncOutboxItem({
      targetKey,
      payload,
      createdAtMs: previous?.createdAtMs || nowMs,
      attempts,
      lastAttemptAtMs: nowMs,
      nextRetryAtMs: nowMs + syncOutboxRetryDelayMs(attempts),
      lastError: String(error?.message || error || "")
    }, nowMs);
    return normalizeSyncOutbox(current.filter((item) => item.targetKey !== targetKey).concat(next), nowMs);
  }

  // data_store.js
  var DB_NAME = "pass.local.db.v1";
  var DB_VERSION = 1;
  var STORE_COLLECTIONS = "collections";
  var COLLECTION_ACCOUNTS = "accounts";
  var COLLECTION_PASSKEYS = "passkeys";
  var COLLECTION_FOLDERS = "folders";
  var COLLECTION_HISTORY = "history";
  var COLLECTION_SYNC_SECRETS = "syncSecrets";
  var COLLECTION_SYNC_SAFETY_SNAPSHOTS = "syncSafetySnapshots";
  var COLLECTION_SYNC_OUTBOX = "syncOutbox";
  var HISTORY_MAX_ENTRIES = 500;
  var SAFETY_SNAPSHOT_MAX_ENTRIES = 5;
  var LEGACY_STORAGE_KEY_ACCOUNTS = "pass.accounts";
  var LEGACY_STORAGE_KEY_PASSKEYS = "pass.passkeys";
  var LEGACY_STORAGE_KEY_FOLDERS = "pass.folders";
  var STORAGE_KEY_MIGRATION_DONE = "pass.data.migratedToIndexedDb.v1";
  var STORAGE_KEY_ENCRYPTION_KEY = "pass.data.encryptionKey.v1";
  var STORAGE_KEY_WRAPPED_ENCRYPTION_KEY = "pass.data.wrappedEncryptionKey.v2";
  var STORAGE_KEY_SESSION_ENCRYPTION_KEY = "pass.data.sessionEncryptionKey.v2";
  var LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD = "pass.sync.webdav.password.v2";
  var LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN = "pass.sync.server.token.v2";
  var LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY = "pass.sync.encryptionKey.v1";
  var LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS = "pass.localSafetySnapshots.v1";
  var LEGACY_DATA_KEY_WRAP_AAD = "pass.data.encryptionKey.v2";
  var DATA_KEY_WRAP_AAD = "pass.data.encryptionKey.v3";
  var DATA_KEY_WRAP_VERSION = 3;
  var DATA_KEY_WRAP_KDF = "PBKDF2-SHA-256";
  var DATA_KEY_WRAP_SALT_BYTES = 16;
  var STORAGE_KEY_DATA_BUMP = "pass.data.bump.v1";
  var dbPromise = null;
  var readyPromise = null;
  var unlockedEncryptionKey = null;
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
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("Failed to open IndexedDB"));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(new Error("Failed to open IndexedDB: blocked"));
      };
    }).catch((error) => {
      dbPromise = null;
      throw error;
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
      throw new Error(`IndexedDB \u96C6\u5408\u683C\u5F0F\u65E0\u6548: ${key}`);
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
      ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext))
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
      STORAGE_KEY_WRAPPED_ENCRYPTION_KEY
    ]);
    if (stored[STORAGE_KEY_WRAPPED_ENCRYPTION_KEY]) {
      throw new Error("\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u672C\u5730\u6570\u636E");
    }
    let rawKey = base64ToBytes(stored[STORAGE_KEY_ENCRYPTION_KEY]);
    if (rawKey.length !== 32) {
      if (await hasEncryptedCollections()) {
        throw new Error("\u672C\u5730\u6570\u636E\u5BC6\u94A5\u7F3A\u5931\uFF0C\u8BF7\u6062\u590D\u5BC6\u94A5\u6216\u4ECE\u5907\u4EFD\u5BFC\u5165");
      }
      rawKey = crypto.getRandomValues(new Uint8Array(32));
      await chrome.storage.local.set({ [STORAGE_KEY_ENCRYPTION_KEY]: bytesToBase64(rawKey) });
    }
    unlockedEncryptionKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
    return unlockedEncryptionKey;
  }
  async function hasEncryptedCollections() {
    return await new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
          db.createObjectStore(STORE_COLLECTIONS, { keyPath: "key" });
        }
      };
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction(STORE_COLLECTIONS, "readonly");
          const store = tx.objectStore(STORE_COLLECTIONS);
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const rows = Array.isArray(getAll.result) ? getAll.result : [];
            db.close();
            resolve(rows.some((row) => {
              return row && Number(row.version) === 1 && row.nonceBase64 && row.ciphertextBase64;
            }));
          };
          getAll.onerror = () => {
            db.close();
            resolve(false);
          };
        } catch {
          try {
            db.close();
          } catch {
          }
          resolve(false);
        }
      };
    });
  }
  async function unlockDataEncryption(password, rawCredential) {
    const credential = normalizeLockMasterCredential(rawCredential);
    if (!credential) throw new Error("\u4E3B\u5BC6\u7801\u51ED\u636E\u65E0\u6548");
    const stored = await chrome.storage.local.get([
      STORAGE_KEY_ENCRYPTION_KEY,
      STORAGE_KEY_WRAPPED_ENCRYPTION_KEY
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
        throw new Error("\u672C\u5730\u6570\u636E\u5BC6\u94A5\u683C\u5F0F\u65E0\u6548");
      }
    } else {
      const sessionExisting = await chrome.storage.session.get([STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
      const sessionExistingKey = base64ToBytes(sessionExisting[STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
      if (sessionExistingKey.length === 32) {
        rawKey = sessionExistingKey;
      } else {
        const legacy = base64ToBytes(stored[STORAGE_KEY_ENCRYPTION_KEY]);
        rawKey = legacy.length === 32 ? legacy : crypto.getRandomValues(new Uint8Array(32));
      }
      await storeWrappedDataKey(password, rawKey);
      await chrome.storage.local.remove(STORAGE_KEY_ENCRYPTION_KEY);
    }
    await cacheUnlockedDataKey(rawKey);
  }
  async function rewrapDataEncryption(currentPassword, currentCredential, nextPassword, nextCredential) {
    await unlockDataEncryption(currentPassword, currentCredential);
    const session = await chrome.storage.session.get([STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
    const rawKey = base64ToBytes(session[STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
    if (rawKey.length !== 32) throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u5DF2\u89E3\u9501\u7684\u6570\u636E\u5BC6\u94A5");
    normalizeCredential(nextCredential);
    await storeWrappedDataKey(nextPassword, rawKey);
  }
  async function lockDataEncryption() {
    unlockedEncryptionKey = null;
    await chrome.storage.session.remove(STORAGE_KEY_SESSION_ENCRYPTION_KEY);
  }
  async function disableDataEncryption(password, rawCredential) {
    await unlockDataEncryption(password, rawCredential);
    const session = await chrome.storage.session.get([STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
    const rawKey = base64ToBytes(session[STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
    if (rawKey.length !== 32) throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u5DF2\u89E3\u9501\u7684\u6570\u636E\u5BC6\u94A5");
    await chrome.storage.local.remove([STORAGE_KEY_WRAPPED_ENCRYPTION_KEY, STORAGE_KEY_ENCRYPTION_KEY]);
    unlockedEncryptionKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
    await chrome.storage.session.set({ [STORAGE_KEY_SESSION_ENCRYPTION_KEY]: bytesToBase64(rawKey) });
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
        iterations
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  function normalizeCredential(value) {
    const credential = normalizeLockMasterCredential(value);
    if (!credential) throw new Error("\u4E3B\u5BC6\u7801\u51ED\u636E\u65E0\u6548");
    return credential;
  }
  async function unwrapLegacyDataKey(wrappingKey, wrapped) {
    if (!wrapped || Number(wrapped.version) !== 2) throw new Error("\u672C\u5730\u6570\u636E\u5BC6\u94A5\u683C\u5F0F\u65E0\u6548");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(wrapped.nonceBase64),
        additionalData: new TextEncoder().encode(LEGACY_DATA_KEY_WRAP_AAD)
      },
      wrappingKey,
      base64ToBytes(wrapped.ciphertextBase64)
    );
    const rawKey = new Uint8Array(plaintext);
    if (rawKey.length !== 32) throw new Error("\u672C\u5730\u6570\u636E\u5BC6\u94A5\u957F\u5EA6\u65E0\u6548");
    return rawKey;
  }
  async function unwrapDataKey(password, wrapped) {
    if (!wrapped || Number(wrapped.version) !== DATA_KEY_WRAP_VERSION || String(wrapped.kdf || "") !== DATA_KEY_WRAP_KDF || Number(wrapped.iterations) !== LOCK_PBKDF2_ITERATIONS) {
      throw new Error("\u672C\u5730\u6570\u636E\u5BC6\u94A5\u683C\u5F0F\u65E0\u6548");
    }
    const saltBytes = base64ToBytes(wrapped.wrapSaltBase64);
    const nonce = base64ToBytes(wrapped.nonceBase64);
    const ciphertext = base64ToBytes(wrapped.ciphertextBase64);
    if (saltBytes.length !== DATA_KEY_WRAP_SALT_BYTES || nonce.length !== 12 || ciphertext.length !== 48) {
      throw new Error("\u672C\u5730\u6570\u636E\u5BC6\u94A5\u683C\u5F0F\u65E0\u6548");
    }
    const wrappingKey = await deriveWrappingKey(password, saltBytes, LOCK_PBKDF2_ITERATIONS);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(DATA_KEY_WRAP_AAD) },
      wrappingKey,
      ciphertext
    );
    const rawKey = new Uint8Array(plaintext);
    if (rawKey.length !== 32) throw new Error("\u672C\u5730\u6570\u636E\u5BC6\u94A5\u957F\u5EA6\u65E0\u6548");
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
        ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext))
      }
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
        "pass.data.bumpReason.v1": String(reason || "")
      });
    } catch {
    }
  }
  function legacyCollectionValue(legacy, key) {
    const value = legacy[key];
    return Array.isArray(value) ? value : [];
  }
  function collectionRecordIdentity(value, collectionKey, index) {
    if (!value || typeof value !== "object") return `index:${index}`;
    const candidates = collectionKey === COLLECTION_ACCOUNTS ? [value.accountId, value.recordId, value.id] : collectionKey === COLLECTION_PASSKEYS ? [value.credentialIdB64u, value.credentialId, value.id] : [value.id, value.folderId];
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
    const merged = /* @__PURE__ */ new Map();
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
      if (updatedAtMs > existing.updatedAtMs || preferOnEqual && updatedAtMs === existing.updatedAtMs) {
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
      [COLLECTION_FOLDERS, currentCollections.folders, legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_FOLDERS)]
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
      if (legacyValue.length > 0 && String(error?.name || "") === "OperationError") return [];
      throw error;
    }
  }
  async function migrateLegacyStorageIfNeeded() {
    const legacy = await chrome.storage.local.get([
      LEGACY_STORAGE_KEY_ACCOUNTS,
      LEGACY_STORAGE_KEY_PASSKEYS,
      LEGACY_STORAGE_KEY_FOLDERS
    ]);
    try {
      const legacyAccounts = legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_ACCOUNTS);
      const legacyPasskeys = legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_PASSKEYS);
      const legacyFolders = legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_FOLDERS);
      const [accounts, passkeys, folders] = await Promise.all([
        readCollectionForMigration(COLLECTION_ACCOUNTS, legacyAccounts),
        readCollectionForMigration(COLLECTION_PASSKEYS, legacyPasskeys),
        readCollectionForMigration(COLLECTION_FOLDERS, legacyFolders)
      ]);
      await migrateLegacyCollections({ accounts, passkeys, folders }, legacy);
    } catch (error) {
      if (String(error?.message || "") === "\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u672C\u5730\u6570\u636E") return;
      throw error;
    }
    await chrome.storage.local.set({ [STORAGE_KEY_MIGRATION_DONE]: true });
  }
  async function ensureDataStorageReady() {
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
  async function getAccounts() {
    await ensureDataStorageReady();
    return await readCollection(COLLECTION_ACCOUNTS);
  }
  async function setAccounts(accounts) {
    await ensureDataStorageReady();
    await writeCollection(COLLECTION_ACCOUNTS, accounts);
    await touchDataBump(COLLECTION_ACCOUNTS);
  }
  async function getPasskeys() {
    await ensureDataStorageReady();
    return await readCollection(COLLECTION_PASSKEYS);
  }
  async function setPasskeys(passkeys) {
    await ensureDataStorageReady();
    await writeCollection(COLLECTION_PASSKEYS, passkeys);
    await touchDataBump(COLLECTION_PASSKEYS);
  }
  async function getAllData() {
    await ensureDataStorageReady();
    const [accounts, passkeys, folders] = await Promise.all([
      readCollection(COLLECTION_ACCOUNTS),
      readCollection(COLLECTION_PASSKEYS),
      readCollection(COLLECTION_FOLDERS)
    ]);
    return { accounts, passkeys, folders };
  }
  async function setAllData({ accounts, passkeys, folders }) {
    await ensureDataStorageReady();
    await Promise.all([
      writeCollection(COLLECTION_ACCOUNTS, accounts),
      writeCollection(COLLECTION_PASSKEYS, passkeys),
      writeCollection(COLLECTION_FOLDERS, folders)
    ]);
    await touchDataBump("all");
  }
  function normalizeSyncSecrets(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      webdavPassword: String(source.webdavPassword || ""),
      serverToken: String(source.serverToken || "").trim(),
      encryptionKey: String(source.encryptionKey || "").trim(),
      previousEncryptionKey: String(source.previousEncryptionKey || "").trim()
    };
  }
  async function getSyncSecrets() {
    await ensureDataStorageReady();
    const entries = await readCollection(COLLECTION_SYNC_SECRETS);
    return normalizeSyncSecrets(Array.isArray(entries) ? entries[0] : null);
  }
  async function setSyncSecrets(value) {
    await ensureDataStorageReady();
    const normalized = normalizeSyncSecrets(value);
    await writeCollection(COLLECTION_SYNC_SECRETS, [normalized]);
    return normalized;
  }
  function normalizeSafetySnapshots(value) {
    return (Array.isArray(value) ? value : []).filter((item) => item && typeof item === "object" && item.payload && typeof item.payload === "object").map((item) => ({
      createdAtMs: Number(item.createdAtMs || 0),
      reason: String(item.reason || "\u540C\u6B65\u524D\u5907\u4EFD"),
      payload: item.payload
    })).filter((item) => Number.isFinite(item.createdAtMs) && item.createdAtMs > 0).sort((lhs, rhs) => rhs.createdAtMs - lhs.createdAtMs).slice(0, SAFETY_SNAPSHOT_MAX_ENTRIES);
  }
  async function getSafetySnapshots() {
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
    if (legacyResult[LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS] !== void 0) {
      await chrome.storage.local.remove(LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS);
    }
    return merged;
  }
  async function setSafetySnapshots(value) {
    await ensureDataStorageReady();
    const normalized = normalizeSafetySnapshots(value);
    await writeCollection(COLLECTION_SYNC_SAFETY_SNAPSHOTS, normalized);
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS);
    return normalized;
  }
  async function getSyncOutbox() {
    await ensureDataStorageReady();
    return normalizeSyncOutbox(await readCollection(COLLECTION_SYNC_OUTBOX));
  }
  async function setSyncOutbox(value) {
    await ensureDataStorageReady();
    const normalized = normalizeSyncOutbox(value);
    await writeCollection(COLLECTION_SYNC_OUTBOX, normalized);
    return normalized;
  }
  async function migrateLegacySyncSecrets() {
    let existing = normalizeSyncSecrets(null);
    let existingCollectionUnreadable = false;
    try {
      existing = await getSyncSecrets();
    } catch (error) {
      if (String(error?.name || "") !== "OperationError") throw error;
      existingCollectionUnreadable = true;
    }
    const legacy = await chrome.storage.local.get([
      LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD,
      LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN,
      LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY
    ]);
    const migrated = normalizeSyncSecrets({
      webdavPassword: existing.webdavPassword || legacy[LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD],
      serverToken: existing.serverToken || legacy[LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN],
      encryptionKey: existing.encryptionKey || legacy[LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY],
      previousEncryptionKey: existing.previousEncryptionKey
    });
    const hasLegacyRecoverySecrets = Boolean(
      migrated.webdavPassword || migrated.serverToken || migrated.encryptionKey
    );
    if (existingCollectionUnreadable && !hasLegacyRecoverySecrets) {
      const error = new Error("\u540C\u6B65\u51ED\u636E\u96C6\u5408\u65E0\u6CD5\u89E3\u5BC6\uFF0C\u4E14\u6CA1\u6709\u53EF\u7528\u65E7\u51ED\u636E\uFF1B\u539F\u6570\u636E\u672A\u8986\u76D6");
      error.code = "SYNC_SECRETS_UNREADABLE";
      throw error;
    }
    if (existingCollectionUnreadable || hasLegacyRecoverySecrets) {
      await setSyncSecrets(migrated);
    }
    await chrome.storage.local.remove([
      LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD,
      LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN,
      LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY
    ]);
    return migrated;
  }
  async function getHistory() {
    await ensureDataStorageReady();
    const entries = await readCollection(COLLECTION_HISTORY);
    return (Array.isArray(entries) ? entries : []).filter((item) => item && typeof item === "object").map((item) => ({
      id: String(item.id || ""),
      timestampMs: Number(item.timestampMs || 0),
      action: String(item.action || "")
    })).filter((item) => item.timestampMs > 0 && item.action.trim().length > 0).sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    });
  }
  async function setHistory(entries) {
    await ensureDataStorageReady();
    const normalized = (Array.isArray(entries) ? entries : []).filter((item) => item && typeof item === "object").map((item) => ({
      id: String(item.id || ""),
      timestampMs: Number(item.timestampMs || 0),
      action: String(item.action || "").trim()
    })).filter((item) => item.timestampMs > 0 && item.action.length > 0).sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    }).slice(0, HISTORY_MAX_ENTRIES);
    await writeCollection(COLLECTION_HISTORY, normalized);
    await touchDataBump(COLLECTION_HISTORY);
  }
  async function appendHistoryEntry({ timestampMs, action }) {
    const normalizedAction = String(action || "").trim();
    if (!normalizedAction) return;
    const ts = Number(timestampMs || Date.now());
    const entry = {
      id: (() => {
        try {
          if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
          const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
          return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
        } catch {
          throw new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u5B89\u5168\u968F\u673A\u6570");
        }
      })(),
      timestampMs: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      action: normalizedAction
    };
    const current = await getHistory();
    await setHistory([entry, ...current]);
  }

  // passkey_store.js
  var COSE_ALG_ES256 = -7;
  var COSE_ALG_RS256 = -257;
  var SUPPORTED_COSE_ALG_SET = /* @__PURE__ */ new Set([COSE_ALG_ES256, COSE_ALG_RS256]);
  var CREATE_COMPAT_STANDARD = "standard";
  var CREATE_COMPAT_USER_NAME_FALLBACK = "user_name_fallback";
  var CREATE_COMPAT_RS256 = "rs256";
  var CREATE_COMPAT_USER_NAME_FALLBACK_RS256 = "user_name_fallback+rs256";
  var AAGUID_ZERO = new Uint8Array(16);
  var PASSKEY_LOG_PREFIX = "[Pass passkey_store]";
  function logPasskeyStore(event, details = {}) {
    try {
      console.info(PASSKEY_LOG_PREFIX, event, details);
    } catch {
    }
  }
  var PasskeyError = class extends Error {
    constructor(name, message, code = "") {
      super(message);
      this.name = name;
      this.code = code;
    }
  };
  async function ensurePasskeyStorageShape() {
    await ensureDataStorageReady();
    const items = await getPasskeys();
    if (!Array.isArray(items)) {
      await setPasskeys([]);
    }
  }
  async function handlePasskeyBridgeOperation(payload) {
    try {
      const operation = payload?.operation;
      const origin = String(payload?.origin || "");
      const host = normalizeHost(payload?.host || hostFromOrigin(origin));
      const publicKey = payload?.publicKey || null;
      if (!operation || !origin || !host || !publicKey) {
        throw new PasskeyError("TypeError", "\u7F3A\u5C11\u901A\u884C\u5BC6\u94A5\u8BF7\u6C42\u53C2\u6570", "PASSKEY_BAD_REQUEST");
      }
      assertSecureOrigin(origin);
      switch (operation) {
        case "create":
          logPasskeyStore("bridge-create-start", {
            origin,
            host,
            rpId: String(publicKey?.rp?.id || host || ""),
            userName: String(publicKey?.user?.name || "").trim()
          });
          return { ok: true, result: await createManagedCredential({ origin, host, publicKey }) };
        case "get":
          logPasskeyStore("bridge-get-start", {
            origin,
            host,
            rpId: String(publicKey?.rpId || host || ""),
            allowCredentialsCount: Array.isArray(publicKey?.allowCredentials) ? publicKey.allowCredentials.length : 0
          });
          return { ok: true, result: await getManagedAssertion({ origin, host, publicKey }) };
        case "getCandidates":
          return { ok: true, result: await listManagedAssertionCandidates({ host, publicKey }) };
        default:
          throw new PasskeyError("NotSupportedError", `\u4E0D\u652F\u6301\u7684\u64CD\u4F5C: ${operation}`, "PASSKEY_OP_UNSUPPORTED");
      }
    } catch (error) {
      logPasskeyStore("bridge-operation-error", {
        name: error?.name || "Error",
        code: error?.code || "",
        message: error?.message || String(error || "")
      });
      return { ok: false, error: normalizeError(error) };
    }
  }
  async function createManagedCredential({ origin, host, publicKey }) {
    const challenge = base64urlToBytes(publicKey.challengeB64u);
    if (challenge.length === 0) {
      throw new PasskeyError("TypeError", "create \u7F3A\u5C11 challenge", "PASSKEY_CHALLENGE_MISSING");
    }
    const rpId = normalizeHost(publicKey?.rp?.id || host);
    if (!rpId) {
      throw new PasskeyError("SecurityError", "create \u7F3A\u5C11 rpId", "PASSKEY_RP_MISSING");
    }
    assertRpIdAllowedForHost(rpId, host);
    const userId = base64urlToBytes(publicKey?.user?.idB64u || "");
    const rawUserName = String(publicKey?.user?.name || "").trim();
    let userName = rawUserName;
    const displayNameRaw = String(publicKey?.user?.displayName || "").trim();
    const usedUserNameFallback = !rawUserName;
    const userHandleB64u = bytesToBase64url(userId);
    if (userId.length === 0) {
      throw new PasskeyError("TypeError", "create \u7F3A\u5C11 user.id", "PASSKEY_USER_MISSING");
    }
    if (!userName) {
      userName = displayNameRaw || `user_${userHandleB64u.slice(0, 16)}`;
    }
    const displayName = displayNameRaw || userName;
    const pubKeyCredParams = Array.isArray(publicKey?.pubKeyCredParams) ? publicKey.pubKeyCredParams : [];
    const selectedAlg = pickSupportedAlgorithm(pubKeyCredParams);
    if (!selectedAlg) {
      throw new PasskeyError("NotSupportedError", "\u4EC5\u652F\u6301 ES256(-7) \u6216 RS256(-257)", "PASSKEY_ALG_UNSUPPORTED");
    }
    const createCompatMethod = resolveCreateCompatMethod({
      alg: selectedAlg,
      usedUserNameFallback
    });
    const passkeys = await loadPasskeys();
    const excludeIds = normalizeCredentialIdList(publicKey?.excludeCredentials || []);
    logPasskeyStore("create-context", {
      rpId,
      host,
      userName,
      displayName,
      passkeysBefore: passkeys.length,
      excludeCredentialsCount: excludeIds.length,
      selectedAlg,
      createCompatMethod
    });
    if (excludeIds.some((id) => passkeys.some((item) => item.rpId === rpId && item.credentialIdB64u === id))) {
      logPasskeyStore("create-exclude-hit", {
        rpId,
        userName,
        excludeCredentialsCount: excludeIds.length
      });
      throw new PasskeyError("InvalidStateError", "\u51ED\u636E\u5DF2\u5B58\u5728\uFF08excludeCredentials \u547D\u4E2D\uFF09", "PASSKEY_CREDENTIAL_EXISTS");
    }
    const existing = pickLatestPasskeyForAccount(passkeys, rpId, userName, userHandleB64u);
    logPasskeyStore(existing ? "create-existing-account-passkey-found" : "create-no-existing-passkey", {
      rpId,
      userName,
      existingCredentialId: String(existing?.credentialIdB64u || "")
    });
    const nextPasskeys = existing ? passkeys.filter((item) => !isSamePasskeyAccount(item, rpId, userName, userHandleB64u)) : [...passkeys];
    const keyPair = await generateManagedKeyPair(selectedAlg);
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const cosePublicKey = buildCosePublicKeyFromJwk(selectedAlg, publicJwk);
    const credentialId = randomBytes(32);
    const credentialIdB64u = bytesToBase64url(credentialId);
    const clientDataJSON = buildClientDataJSON({
      type: "webauthn.create",
      challengeB64u: bytesToBase64url(challenge),
      origin,
      crossOrigin: Boolean(publicKey?.crossOrigin)
    });
    const rpIdHash = await sha256(utf8(rpId));
    const authData = concatBytes(
      rpIdHash,
      new Uint8Array([69]),
      // UP + UV + AT
      uint32be(0),
      AAGUID_ZERO,
      uint16be(credentialId.length),
      credentialId,
      cosePublicKey
    );
    const attestationObject = cborEncode(
      /* @__PURE__ */ new Map([
        ["fmt", "none"],
        ["authData", authData],
        ["attStmt", /* @__PURE__ */ new Map()]
      ])
    );
    const now = Date.now();
    nextPasskeys.push({
      credentialIdB64u,
      rpId,
      userHandleB64u,
      userName,
      displayName,
      alg: selectedAlg,
      privateJwk,
      publicJwk,
      signCount: 0,
      createCompatMethod,
      createdAtMs: now,
      updatedAtMs: now,
      lastUsedAtMs: null
    });
    await savePasskeys(nextPasskeys);
    logPasskeyStore("create-saved", {
      rpId,
      userName,
      credentialIdB64u,
      createMode: existing ? "replaced" : "created",
      passkeysAfter: nextPasskeys.length
    });
    return {
      credential: {
        id: credentialIdB64u,
        rawIdB64u: credentialIdB64u,
        type: "public-key",
        authenticatorAttachment: "platform",
        response: {
          clientDataJSONB64u: bytesToBase64url(clientDataJSON),
          attestationObjectB64u: bytesToBase64url(attestationObject),
          transports: ["internal"]
        },
        clientExtensionResults: {}
      },
      accountHint: {
        rpId,
        username: userName,
        credentialIdB64u,
        displayName
      },
      createMode: existing ? "replaced" : "created",
      createCompatMethod
    };
  }
  function pickLatestPasskeyForAccount(passkeys, rpId, userName, userHandleB64u = "") {
    const matched = (Array.isArray(passkeys) ? passkeys : []).filter((item) => {
      return isSamePasskeyAccount(item, rpId, userName, userHandleB64u);
    });
    if (matched.length === 0) return null;
    matched.sort((a, b) => {
      const aTs = Number(a?.updatedAtMs || a?.createdAtMs || 0);
      const bTs = Number(b?.updatedAtMs || b?.createdAtMs || 0);
      if (aTs !== bTs) return bTs - aTs;
      return String(a?.credentialIdB64u || "").localeCompare(String(b?.credentialIdB64u || ""));
    });
    return matched[0];
  }
  function isSamePasskeyAccount(item, rpId, userName, userHandleB64u = "") {
    if (item?.rpId !== rpId) return false;
    const lhsHandle = String(item?.userHandleB64u || "").trim();
    const rhsHandle = String(userHandleB64u || "").trim();
    if (lhsHandle && rhsHandle) {
      return lhsHandle === rhsHandle;
    }
    return String(item?.userName || "").trim() === String(userName || "").trim();
  }
  async function getManagedAssertion({ origin, host, publicKey }) {
    const challenge = base64urlToBytes(publicKey.challengeB64u);
    if (challenge.length === 0) {
      throw new PasskeyError("TypeError", "get \u7F3A\u5C11 challenge", "PASSKEY_CHALLENGE_MISSING");
    }
    const { rpId, passkeys, candidates } = await resolveGetCandidates({ host, publicKey });
    logPasskeyStore("get-candidates-resolved", {
      rpId,
      host,
      passkeysTotal: passkeys.length,
      candidateCount: candidates.length
    });
    if (candidates.length === 0) {
      throw new PasskeyError("NotAllowedError", "\u672A\u627E\u5230\u53EF\u7528\u901A\u884C\u5BC6\u94A5", "PASSKEY_NOT_FOUND");
    }
    const selected = candidates[0];
    const alg = normalizeManagedAlg(selected?.alg);
    const privateKey = await importManagedPrivateKey(alg, selected?.privateJwk);
    const clientDataJSON = buildClientDataJSON({
      type: "webauthn.get",
      challengeB64u: bytesToBase64url(challenge),
      origin,
      crossOrigin: Boolean(publicKey?.crossOrigin)
    });
    const clientDataHash = await sha256(clientDataJSON);
    const nextSignCount = Number(selected.signCount || 0) + 1;
    const authenticatorData = concatBytes(
      await sha256(utf8(rpId)),
      new Uint8Array([5]),
      // UP + UV
      uint32be(nextSignCount)
    );
    const signedPayload = concatBytes(authenticatorData, clientDataHash);
    const signature = await signManagedAssertion(alg, privateKey, signedPayload);
    const now = Date.now();
    const updateIndex = passkeys.findIndex((item) => item.credentialIdB64u === selected.credentialIdB64u);
    if (updateIndex >= 0) {
      passkeys[updateIndex] = {
        ...passkeys[updateIndex],
        signCount: nextSignCount,
        lastUsedAtMs: now,
        updatedAtMs: now
      };
      await savePasskeys(passkeys);
      logPasskeyStore("get-selected-saved", {
        rpId,
        credentialIdB64u: selected.credentialIdB64u,
        userName: String(selected.userName || ""),
        signCount: nextSignCount
      });
    }
    return {
      credential: {
        id: selected.credentialIdB64u,
        rawIdB64u: selected.credentialIdB64u,
        type: "public-key",
        authenticatorAttachment: "platform",
        response: {
          clientDataJSONB64u: bytesToBase64url(clientDataJSON),
          authenticatorDataB64u: bytesToBase64url(authenticatorData),
          signatureB64u: bytesToBase64url(signature),
          userHandleB64u: selected.userHandleB64u || null
        },
        clientExtensionResults: {}
      },
      assertionHint: {
        rpId: selected.rpId || rpId,
        userName: String(selected.userName || "").trim(),
        displayName: String(selected.displayName || "").trim(),
        credentialIdB64u: String(selected.credentialIdB64u || "")
      }
    };
  }
  async function listManagedAssertionCandidates({ host, publicKey }) {
    const { candidates } = await resolveGetCandidates({ host, publicKey });
    return {
      candidates: candidates.map((item) => ({
        credentialIdB64u: item.credentialIdB64u,
        rpId: item.rpId,
        userName: String(item.userName || ""),
        displayName: String(item.displayName || ""),
        signCount: Number(item.signCount || 0),
        createdAtMs: item.createdAtMs == null ? null : Number(item.createdAtMs),
        updatedAtMs: item.updatedAtMs == null ? null : Number(item.updatedAtMs),
        lastUsedAtMs: item.lastUsedAtMs == null ? null : Number(item.lastUsedAtMs)
      }))
    };
  }
  async function resolveGetCandidates({ host, publicKey }) {
    const rpId = normalizeHost(publicKey?.rpId || host);
    if (!rpId) {
      throw new PasskeyError("SecurityError", "get \u7F3A\u5C11 rpId", "PASSKEY_RP_MISSING");
    }
    assertRpIdAllowedForHost(rpId, host);
    const passkeys = await loadPasskeys();
    let candidates = passkeys.filter((item) => item.rpId === rpId);
    const allowCredentialIds = normalizeCredentialIdList(publicKey?.allowCredentials || []);
    if (allowCredentialIds.length > 0) {
      const allowSet = new Set(allowCredentialIds);
      candidates = candidates.filter((item) => allowSet.has(item.credentialIdB64u));
    }
    candidates.sort((a, b) => (b.lastUsedAtMs || b.updatedAtMs || 0) - (a.lastUsedAtMs || a.updatedAtMs || 0));
    logPasskeyStore("resolve-get-candidates", {
      host,
      rpId,
      storedPasskeys: passkeys.length,
      allowCredentialsCount: allowCredentialIds.length,
      candidateCount: candidates.length
    });
    return { rpId, passkeys, candidates };
  }
  async function loadPasskeys() {
    const raw = await getPasskeys();
    return raw.filter((item) => item && typeof item === "object");
  }
  async function savePasskeys(items) {
    await setPasskeys(items);
  }
  function normalizeCredentialIdList(input) {
    if (!Array.isArray(input)) return [];
    const values = input.map((item) => String(item?.idB64u || "")).filter(Boolean).map(normalizeBase64url);
    return [...new Set(values)];
  }
  function assertSecureOrigin(origin) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new PasskeyError("SecurityError", "origin \u975E\u6CD5", "PASSKEY_ORIGIN_INVALID");
    }
    if (url.protocol === "https:") return;
    const host = normalizeHost(url.hostname);
    const isLocalhost = host === "localhost" || host === "127.0.0.1";
    if (url.protocol === "http:" && isLocalhost) return;
    throw new PasskeyError("SecurityError", "\u4EC5\u5141\u8BB8 HTTPS \u6216 localhost", "PASSKEY_INSECURE_ORIGIN");
  }
  function assertRpIdAllowedForHost(rpId, host) {
    if (!rpId || !host) {
      throw new PasskeyError("SecurityError", "rpId \u6216 host \u7F3A\u5931", "PASSKEY_RP_HOST_MISSING");
    }
    if (host === rpId || host.endsWith(`.${rpId}`)) return;
    throw new PasskeyError("SecurityError", "rpId \u4E0E\u5F53\u524D\u57DF\u540D\u4E0D\u5339\u914D", "PASSKEY_RP_MISMATCH");
  }
  function hostFromOrigin(origin) {
    try {
      return new URL(origin).hostname || "";
    } catch {
      return "";
    }
  }
  function normalizeHost(input) {
    let value = String(input || "").trim().toLowerCase();
    while (value.endsWith(".")) {
      value = value.slice(0, -1);
    }
    return value;
  }
  function normalizeBase64url(input) {
    return String(input || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }
  function buildClientDataJSON({ type, challengeB64u, origin, crossOrigin = false }) {
    const payload = {
      type,
      challenge: normalizeBase64url(challengeB64u),
      origin,
      crossOrigin: Boolean(crossOrigin)
    };
    return utf8(JSON.stringify(payload));
  }
  function utf8(input) {
    return new TextEncoder().encode(String(input));
  }
  function uint16be(value) {
    const out = new Uint8Array(2);
    out[0] = value >> 8 & 255;
    out[1] = value & 255;
    return out;
  }
  function uint32be(value) {
    const out = new Uint8Array(4);
    out[0] = value >>> 24 & 255;
    out[1] = value >>> 16 & 255;
    out[2] = value >>> 8 & 255;
    out[3] = value & 255;
    return out;
  }
  function concatBytes(...parts) {
    const normalized = parts.filter(Boolean).map((part) => part instanceof Uint8Array ? part : new Uint8Array(part));
    const total = normalized.reduce((sum, item) => sum + item.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of normalized) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
  async function sha256(bytes) {
    const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  }
  function encodeCoseEc2PublicKey(x, y) {
    const cose = /* @__PURE__ */ new Map([
      [1, 2],
      // kty: EC2
      [3, COSE_ALG_ES256],
      // alg: ES256
      [-1, 1],
      // crv: P-256
      [-2, x],
      // x
      [-3, y]
      // y
    ]);
    return cborEncode(cose);
  }
  function encodeCoseRsaPublicKey(n, e) {
    const cose = /* @__PURE__ */ new Map([
      [1, 3],
      // kty: RSA
      [3, COSE_ALG_RS256],
      // alg: RS256
      [-1, n],
      // modulus
      [-2, e]
      // exponent
    ]);
    return cborEncode(cose);
  }
  function pickSupportedAlgorithm(pubKeyCredParams) {
    if (!Array.isArray(pubKeyCredParams)) return null;
    for (const item of pubKeyCredParams) {
      const type = String(item?.type || "public-key").toLowerCase();
      const alg = Number(item?.alg);
      if (type !== "public-key") continue;
      if (SUPPORTED_COSE_ALG_SET.has(alg)) {
        return alg;
      }
    }
    return null;
  }
  function normalizeManagedAlg(alg) {
    const parsed = Number(alg);
    if (SUPPORTED_COSE_ALG_SET.has(parsed)) {
      return parsed;
    }
    return COSE_ALG_ES256;
  }
  function resolveCreateCompatMethod({ alg, usedUserNameFallback }) {
    const safeAlg = normalizeManagedAlg(alg);
    if (safeAlg === COSE_ALG_RS256 && usedUserNameFallback) {
      return CREATE_COMPAT_USER_NAME_FALLBACK_RS256;
    }
    if (safeAlg === COSE_ALG_RS256) {
      return CREATE_COMPAT_RS256;
    }
    if (usedUserNameFallback) {
      return CREATE_COMPAT_USER_NAME_FALLBACK;
    }
    return CREATE_COMPAT_STANDARD;
  }
  async function generateManagedKeyPair(alg) {
    if (alg === COSE_ALG_RS256) {
      return await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256"
        },
        true,
        ["sign", "verify"]
      );
    }
    return await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
  }
  function buildCosePublicKeyFromJwk(alg, publicJwk) {
    if (alg === COSE_ALG_RS256) {
      const n = base64urlToBytes(publicJwk?.n || "");
      const e = base64urlToBytes(publicJwk?.e || "");
      if (n.length === 0 || e.length === 0) {
        throw new Error("RSA JWK invalid");
      }
      return encodeCoseRsaPublicKey(n, e);
    }
    const x = base64urlToBytes(publicJwk?.x || "");
    const y = base64urlToBytes(publicJwk?.y || "");
    if (x.length !== 32 || y.length !== 32) {
      throw new Error("EC JWK invalid");
    }
    return encodeCoseEc2PublicKey(x, y);
  }
  async function importManagedPrivateKey(alg, privateJwk) {
    if (alg === COSE_ALG_RS256) {
      return await crypto.subtle.importKey(
        "jwk",
        privateJwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
      );
    }
    return await crypto.subtle.importKey(
      "jwk",
      privateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
  }
  async function signManagedAssertion(alg, privateKey, payload) {
    if (alg === COSE_ALG_RS256) {
      return new Uint8Array(
        await crypto.subtle.sign(
          { name: "RSASSA-PKCS1-v1_5" },
          privateKey,
          payload
        )
      );
    }
    const rawSignature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        payload
      )
    );
    return ecdsaRawSignatureToDer(rawSignature);
  }
  function cborEncode(value) {
    const out = [];
    const pushUInt = (major, num) => {
      if (!Number.isInteger(num) || num < 0) {
        throw new PasskeyError("OperationError", "CBOR \u4EC5\u652F\u6301\u975E\u8D1F\u6574\u6570\u957F\u5EA6", "PASSKEY_CBOR_UINT");
      }
      if (num < 24) {
        out.push(major << 5 | num);
        return;
      }
      if (num < 256) {
        out.push(major << 5 | 24, num);
        return;
      }
      if (num < 65536) {
        out.push(major << 5 | 25, num >> 8 & 255, num & 255);
        return;
      }
      out.push(
        major << 5 | 26,
        num >>> 24 & 255,
        num >>> 16 & 255,
        num >>> 8 & 255,
        num & 255
      );
    };
    const encode = (input) => {
      if (input === null) {
        out.push(246);
        return;
      }
      if (typeof input === "boolean") {
        out.push(input ? 245 : 244);
        return;
      }
      if (typeof input === "number") {
        if (!Number.isInteger(input)) {
          throw new PasskeyError("OperationError", "CBOR \u4E0D\u652F\u6301\u6D6E\u70B9\u6570", "PASSKEY_CBOR_FLOAT");
        }
        if (input >= 0) {
          pushUInt(0, input);
        } else {
          pushUInt(1, -1 - input);
        }
        return;
      }
      if (typeof input === "string") {
        const bytes = utf8(input);
        pushUInt(3, bytes.length);
        out.push(...bytes);
        return;
      }
      if (input instanceof Uint8Array) {
        pushUInt(2, input.length);
        out.push(...input);
        return;
      }
      if (input instanceof ArrayBuffer) {
        encode(new Uint8Array(input));
        return;
      }
      if (Array.isArray(input)) {
        pushUInt(4, input.length);
        for (const item of input) {
          encode(item);
        }
        return;
      }
      if (input instanceof Map) {
        pushUInt(5, input.size);
        for (const [key, value2] of input.entries()) {
          encode(key);
          encode(value2);
        }
        return;
      }
      if (typeof input === "object") {
        const entries = Object.entries(input);
        pushUInt(5, entries.length);
        for (const [key, value2] of entries) {
          encode(key);
          encode(value2);
        }
        return;
      }
      throw new PasskeyError("OperationError", "CBOR \u4E0D\u652F\u6301\u7684\u6570\u636E\u7C7B\u578B", "PASSKEY_CBOR_TYPE");
    };
    encode(value);
    return new Uint8Array(out);
  }
  function ecdsaRawSignatureToDer(raw) {
    if (!(raw instanceof Uint8Array) || raw.length !== 64) {
      throw new PasskeyError("OperationError", "ECDSA \u7B7E\u540D\u957F\u5EA6\u975E\u6CD5", "PASSKEY_SIG_INVALID");
    }
    const r = raw.slice(0, 32);
    const s = raw.slice(32, 64);
    const normalizeInt = (input) => {
      let start = 0;
      while (start < input.length - 1 && input[start] === 0) {
        start += 1;
      }
      let value = input.slice(start);
      if (value[0] & 128) {
        value = concatBytes(new Uint8Array([0]), value);
      }
      return value;
    };
    const rNorm = normalizeInt(r);
    const sNorm = normalizeInt(s);
    const sequenceLen = 2 + rNorm.length + 2 + sNorm.length;
    return concatBytes(
      new Uint8Array([48, sequenceLen, 2, rNorm.length]),
      rNorm,
      new Uint8Array([2, sNorm.length]),
      sNorm
    );
  }
  function bytesToBase64url(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      bytes = new Uint8Array(bytes || []);
    }
    let bin = "";
    for (const byte of bytes) {
      bin += String.fromCharCode(byte);
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function base64urlToBytes(input) {
    const normalized = normalizeBase64url(input);
    if (!normalized) return new Uint8Array();
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    let bin;
    try {
      bin = atob(base64);
    } catch {
      return new Uint8Array();
    }
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  function normalizeError(error) {
    const message = error?.message || String(error || "\u672A\u77E5\u9519\u8BEF");
    const name = error?.name || "OperationError";
    const code = error?.code || "";
    return { name, message, code };
  }

  // extension_version.js
  var PASS_EXTENSION_VERSION = "0.2.6";

  // ../../core/pass_core/js/sync_alias_core.js
  function syncAliasGroups(accounts, helpers, options = {}) {
    if (!Array.isArray(accounts) || accounts.length < 2) {
      return { accounts, changed: false };
    }
    const normalize = helpers?.normalizeDomain || ((s) => String(s || "").trim().toLowerCase());
    const etldPlusOne2 = helpers?.etldPlusOne || ((s) => {
      const n2 = normalize(s);
      const parts = n2.split(".").filter(Boolean);
      if (parts.length < 2) return n2;
      return parts.slice(-2).join(".");
    });
    const domainAliasGroupKey2 = typeof helpers?.domainAliasGroupKey === "function" ? helpers.domainAliasGroupKey : () => "";
    const nowMs = options.nowMs ?? Date.now();
    const deviceName = options.deviceName || "Browser";
    const n = accounts.length;
    const siteSets = accounts.map((a) => {
      const sites = Array.isArray(a?.sites) ? a.sites : [];
      return new Set(sites.map(normalize).filter(Boolean));
    });
    const etldSets = siteSets.map((set) => {
      const out = /* @__PURE__ */ new Set();
      for (const s of set) {
        const e = etldPlusOne2(s);
        if (e) out.add(e);
      }
      return out;
    });
    const aliasGroupSets = siteSets.map((set) => {
      const out = /* @__PURE__ */ new Set();
      for (const site of set) {
        const group = domainAliasGroupKey2(site);
        if (group) out.add(group);
      }
      return out;
    });
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i) => {
      let cur = i;
      while (parent[cur] !== cur) cur = parent[cur];
      let c2 = i;
      while (parent[c2] !== c2) {
        const next2 = parent[c2];
        parent[c2] = cur;
        c2 = next2;
      }
      return cur;
    };
    const union = (a, b) => {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent[pb] = pa;
    };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let overlap = false;
        for (const s of siteSets[i]) {
          if (siteSets[j].has(s)) {
            overlap = true;
            break;
          }
        }
        let sameEtld = false;
        for (const e of etldSets[i]) {
          if (etldSets[j].has(e)) {
            sameEtld = true;
            break;
          }
        }
        const sameAliasGroup = [...aliasGroupSets[i]].some((group) => aliasGroupSets[j].has(group));
        if (overlap || sameEtld || sameAliasGroup) union(i, j);
      }
    }
    const components = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) components[find(i)].push(i);
    let changed = false;
    const next = accounts.map((a) => ({ ...a }));
    for (const component of components) {
      if (component.length < 2) continue;
      const merged = [];
      const seen = /* @__PURE__ */ new Set();
      for (const idx of component) {
        for (const s of siteSets[idx]) {
          if (!seen.has(s)) {
            seen.add(s);
            merged.push(s);
          }
        }
      }
      merged.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      for (const idx of component) {
        const prev = Array.isArray(next[idx].sites) ? [...new Set(next[idx].sites.map(normalize).filter(Boolean))].sort(
          (a, b) => a < b ? -1 : a > b ? 1 : 0
        ) : [];
        const same = prev.length === merged.length && prev.every((v, i) => v === merged[i]);
        if (!same) {
          next[idx] = {
            ...next[idx],
            sites: merged.slice(),
            updatedAtMs: nowMs,
            lastOperatedDeviceName: deviceName
          };
          changed = true;
        } else if (Array.isArray(next[idx].sites) && next[idx].sites.join("\0") !== merged.join("\0")) {
          next[idx] = {
            ...next[idx],
            sites: merged.slice()
          };
          changed = true;
        }
      }
    }
    return { accounts: next, changed };
  }

  // account_core.js
  var ETLD2_SUFFIXES2 = new Set(ETLD2_SUFFIXES);
  var DOMAIN_ALIAS_GROUPS = Object.freeze([
    Object.freeze({
      id: "apple",
      domains: Object.freeze(["apple.com", "apple.com.cn", "icloud.com", "icloud.com.cn"])
    }),
    Object.freeze({
      id: "qq",
      domains: Object.freeze(["qq.com", "wx.qq.com"])
    }),
    Object.freeze({
      id: "baidu",
      domains: Object.freeze(["baidu.com", "passport.baidu.com", "pan.baidu.com"])
    }),
    Object.freeze({
      id: "sina",
      domains: Object.freeze(["sina.com", "mail.sina.com", "weibo.com"])
    }),
    Object.freeze({
      id: "github",
      domains: Object.freeze(["github.com", "gist.github.com"])
    }),
    Object.freeze({
      id: "gitlab",
      domains: Object.freeze(["gitlab.com", "about.gitlab.com"])
    }),
    Object.freeze({
      id: "google",
      domains: Object.freeze(["google.com", "accounts.google.com"])
    }),
    Object.freeze({
      id: "youtube",
      domains: Object.freeze(["youtube.com", "studio.youtube.com"])
    }),
    Object.freeze({
      id: "x",
      domains: Object.freeze(["x.com", "twitter.com"])
    }),
    Object.freeze({
      id: "facebook",
      domains: Object.freeze(["facebook.com", "messenger.com"])
    }),
    Object.freeze({
      id: "amazon",
      domains: Object.freeze(["amazon.com", "smile.amazon.com"])
    }),
    Object.freeze({
      id: "microsoft",
      domains: Object.freeze([
        "microsoft.com",
        "microsoftonline.com",
        "login.microsoftonline.com",
        "login.microsoft.com",
        "account.microsoft.com",
        "live.com",
        "hotmail.com",
        "outlook.com",
        "account.live.com",
        "office.com",
        "outlook.office.com",
        "microsoft365.com",
        "office365.com",
        "azure.com",
        "msn.com"
      ])
    }),
    Object.freeze({
      id: "paypal",
      domains: Object.freeze(["paypal.com"])
    }),
    Object.freeze({
      id: "netflix",
      domains: Object.freeze(["netflix.com", "help.netflix.com"])
    }),
    Object.freeze({
      id: "spotify",
      domains: Object.freeze(["spotify.com", "open.spotify.com"])
    }),
    Object.freeze({
      id: "linkedin",
      domains: Object.freeze(["linkedin.com"])
    }),
    Object.freeze({
      id: "dropbox",
      domains: Object.freeze(["dropbox.com"])
    })
  ]);
  function normalizeDomain(input) {
    if (!input) return "";
    let value = String(input).trim().toLowerCase();
    try {
      if (value.startsWith("http://") || value.startsWith("https://")) {
        value = new URL(value).hostname;
      }
    } catch {
      return "";
    }
    while (value.endsWith(".")) {
      value = value.slice(0, -1);
    }
    return value;
  }
  function isIpHost(domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return false;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
      return normalized.split(".").every((part) => {
        const value = Number(part);
        return Number.isInteger(value) && value >= 0 && value <= 255;
      });
    }
    if (normalized.includes(":")) {
      return /^[0-9a-f:]+$/i.test(normalized);
    }
    return false;
  }
  function etldPlusOne(domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return "";
    if (isIpHost(normalized)) return normalized;
    const labels = normalized.split(".");
    if (labels.length < 2) return normalized;
    const tail2 = labels.slice(-2).join(".");
    if (ETLD2_SUFFIXES2.has(tail2) && labels.length >= 3) {
      return labels.slice(-3).join(".");
    }
    return tail2;
  }
  function domainAliasGroupKey(domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return "";
    for (const group of DOMAIN_ALIAS_GROUPS) {
      const matched = group.domains.some(
        (alias) => normalized === alias || normalized.endsWith(`.${alias}`)
      );
      if (matched) return group.id;
    }
    return "";
  }
  function domainsMatch(left, right) {
    const normalizedLeft = normalizeDomain(left);
    const normalizedRight = normalizeDomain(right);
    if (!normalizedLeft || !normalizedRight) return false;
    if (normalizedLeft === normalizedRight) return true;
    if (etldPlusOne(normalizedLeft) === etldPlusOne(normalizedRight)) return true;
    const leftGroup = domainAliasGroupKey(normalizedLeft);
    return Boolean(leftGroup && leftGroup === domainAliasGroupKey(normalizedRight));
  }
  function normalizeSites(sites) {
    const values = Array.isArray(sites) ? sites : [];
    return [...new Set(values.map(normalizeDomain).filter(Boolean))].sort();
  }
  function normalizeUsername(value) {
    return String(value || "").trim();
  }
  function formatYYMMDDHHmmss(ms) {
    const date = new Date(ms);
    const yy = String(date.getUTCFullYear() % 100).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(date.getUTCMinutes()).padStart(2, "0");
    const second = String(date.getUTCSeconds()).padStart(2, "0");
    return `${yy}${month}${day}${hour}${minute}${second}`;
  }
  function buildAccountId(canonicalSite, username, createdAtMs) {
    return `${canonicalSite}-${formatYYMMDDHHmmss(createdAtMs)}-${username}`;
  }
  function syncAliasGroups2(inputAccounts, options = {}) {
    const helpers = {
      domainAliasGroupKey,
      normalizeDomain,
      etldPlusOne
    };
    const result = syncAliasGroups(inputAccounts, helpers, {
      nowMs: options.nowMs,
      deviceName: options.deviceName || "Browser"
    });
    return result.accounts;
  }

  // ../../core/pass_core/js/sync_merge_core.js
  function asNumber(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function fallbackDeviceName(...candidates) {
    for (const value of candidates) {
      const trimmed = asString(value).trim();
      if (trimmed) return trimmed;
    }
    return DEFAULT_DEVICE_NAME;
  }
  function asString(value) {
    return String(value || "");
  }
  function stableTieValue(value) {
    return asString(value).trim().toLowerCase();
  }
  function requireFunction(helpers, name) {
    const candidate = helpers?.[name];
    if (typeof candidate !== "function") {
      throw new Error(`sync_merge_core missing helper: ${name}`);
    }
    return candidate;
  }
  function resolveHelpers(helpers) {
    return {
      normalizeAccountShape: requireFunction(helpers, "normalizeAccountShape"),
      normalizeFolderIdList: requireFunction(helpers, "normalizeFolderIdList"),
      normalizeFolderId: requireFunction(helpers, "normalizeFolderId"),
      extractAccountFolderIds: requireFunction(helpers, "extractAccountFolderIds"),
      normalizeSites: requireFunction(helpers, "normalizeSites"),
      etldPlusOne: requireFunction(helpers, "etldPlusOne"),
      normalizePasskeyCredentialIds: requireFunction(helpers, "normalizePasskeyCredentialIds"),
      stableUuidFromText: requireFunction(helpers, "stableUuidFromText"),
      normalizePasskeyShape: requireFunction(helpers, "normalizePasskeyShape"),
      normalizePasskeyCreateCompatMethod: requireFunction(helpers, "normalizePasskeyCreateCompatMethod"),
      normalizeFolderShape: requireFunction(helpers, "normalizeFolderShape"),
      sortFoldersForDisplay: requireFunction(helpers, "sortFoldersForDisplay"),
      fixedNewAccountFolderId: asString(helpers?.fixedNewAccountFolderId).trim().toLowerCase(),
      fixedNewAccountFolderName: asString(helpers?.fixedNewAccountFolderName).trim() || "\u65B0\u8D26\u53F7"
    };
  }
  function newerField(lhsValue, lhsUpdatedAt, lhsDeviceName, lhsAccountUpdatedAt, rhsValue, rhsUpdatedAt, rhsDeviceName, rhsAccountUpdatedAt) {
    const leftUpdated = asNumber(lhsUpdatedAt);
    const rightUpdated = asNumber(rhsUpdatedAt);
    if (leftUpdated > rightUpdated) return { value: asString(lhsValue), updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) };
    if (rightUpdated > leftUpdated) return { value: asString(rhsValue), updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
    const leftValue = asString(lhsValue);
    const rightValue = asString(rhsValue);
    if (leftValue === rightValue) {
      return {
        value: leftValue,
        updatedAtMs: leftUpdated,
        deviceName: fallbackDeviceName(lhsDeviceName, rhsDeviceName)
      };
    }
    if (!leftValue && rightValue) {
      return { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
    }
    if (leftValue && !rightValue) {
      return { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) };
    }
    const leftAccountUpdated = asNumber(lhsAccountUpdatedAt);
    const rightAccountUpdated = asNumber(rhsAccountUpdatedAt);
    if (leftAccountUpdated > rightAccountUpdated) {
      return { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) };
    }
    if (rightAccountUpdated > leftAccountUpdated) {
      return { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
    }
    const leftDevice = stableTieValue(lhsDeviceName);
    const rightDevice = stableTieValue(rhsDeviceName);
    if (leftDevice !== rightDevice) {
      return leftDevice > rightDevice ? { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) } : { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
    }
    return leftValue >= rightValue ? { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) } : { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
  }
  function mergeFolderMembershipStates(left, right) {
    const collect = (account) => {
      const states = account?.folderMembershipStates && typeof account.folderMembershipStates === "object" ? account.folderMembershipStates : {};
      const result = /* @__PURE__ */ new Map();
      for (const [rawId, rawState] of Object.entries(states)) {
        const id = asString(rawId).trim().toLowerCase();
        if (!id) continue;
        result.set(id, {
          isDeleted: Boolean(rawState?.isDeleted),
          updatedAtMs: asNumber(rawState?.updatedAtMs || account?.updatedAtMs || account?.createdAtMs),
          deviceName: asString(rawState?.deviceName || account?.lastOperatedDeviceName).trim()
        });
      }
      for (const rawId of account?.folderIds || []) {
        const id = asString(rawId).trim().toLowerCase();
        if (id && !result.has(id)) result.set(id, { isDeleted: false, updatedAtMs: asNumber(account?.updatedAtMs || account?.createdAtMs), deviceName: asString(account?.lastOperatedDeviceName).trim() });
      }
      return result;
    };
    const merged = collect(left);
    for (const [id, incoming] of collect(right)) {
      const current = merged.get(id);
      if (!current || shouldPreferRelationState(incoming, current)) {
        merged.set(id, incoming);
      }
    }
    return Object.fromEntries([...merged.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  function shouldPreferRelationState(incoming, current) {
    if (incoming.updatedAtMs > current.updatedAtMs) return true;
    if (incoming.updatedAtMs < current.updatedAtMs) return false;
    if (incoming.isDeleted && !current.isDeleted) return true;
    if (incoming.isDeleted === current.isDeleted) {
      return stableTieValue(incoming.deviceName) > stableTieValue(current.deviceName);
    }
    return false;
  }
  function mergeRelationStates(left, right, stateKey, leftValues, rightValues, normalizeId) {
    const collect = (account, values) => {
      const states = account?.[stateKey] && typeof account[stateKey] === "object" ? account[stateKey] : {};
      const result = /* @__PURE__ */ new Map();
      for (const [rawId, rawState] of Object.entries(states)) {
        const id = normalizeId(rawId);
        if (!id) continue;
        result.set(id, {
          isDeleted: Boolean(rawState?.isDeleted),
          updatedAtMs: asNumber(rawState?.updatedAtMs || account?.updatedAtMs || account?.createdAtMs),
          deviceName: asString(rawState?.deviceName || account?.lastOperatedDeviceName).trim()
        });
      }
      for (const rawId of values || []) {
        const id = normalizeId(rawId);
        if (id && !result.has(id)) result.set(id, { isDeleted: false, updatedAtMs: asNumber(account?.updatedAtMs || account?.createdAtMs), deviceName: asString(account?.lastOperatedDeviceName).trim() });
      }
      return result;
    };
    const merged = collect(left, leftValues);
    for (const [id, incoming] of collect(right, rightValues)) {
      const current = merged.get(id);
      if (!current || shouldPreferRelationState(incoming, current)) merged.set(id, incoming);
    }
    return Object.fromEntries([...merged.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  }
  function mergeSameAccount(lhs, rhs, h) {
    const left = h.normalizeAccountShape(lhs);
    const right = h.normalizeAccountShape(rhs);
    const primary = asNumber(left.createdAtMs) <= asNumber(right.createdAtMs) ? left : right;
    const secondary = primary === left ? right : left;
    const siteAliasStates = mergeRelationStates(left, right, "siteAliasStates", left.sites, right.sites, (id) => asString(id).trim().toLowerCase());
    const mergedSites = h.normalizeSites(Object.entries(siteAliasStates).filter(([, state]) => !state.isDeleted).map(([id]) => id));
    const canonicalBySites = h.etldPlusOne(mergedSites[0] || "");
    const canonicalSite = canonicalBySites || primary.canonicalSite || secondary.canonicalSite || "";
    const folderMembershipStates = mergeFolderMembershipStates(left, right);
    const mergedFolderIds = h.normalizeFolderIdList(Object.entries(folderMembershipStates).filter(([, state]) => !state.isDeleted).map(([id]) => id));
    const usernameField = newerField(
      left.username,
      left.usernameUpdatedAtMs,
      left.usernameUpdatedDeviceName,
      left.updatedAtMs,
      right.username,
      right.usernameUpdatedAtMs,
      right.usernameUpdatedDeviceName,
      right.updatedAtMs
    );
    const passwordField = newerField(
      left.password,
      left.passwordUpdatedAtMs,
      left.passwordUpdatedDeviceName,
      left.updatedAtMs,
      right.password,
      right.passwordUpdatedAtMs,
      right.passwordUpdatedDeviceName,
      right.updatedAtMs
    );
    const totpField = newerField(
      left.totpSecret,
      left.totpUpdatedAtMs,
      left.totpUpdatedDeviceName,
      left.updatedAtMs,
      right.totpSecret,
      right.totpUpdatedAtMs,
      right.totpUpdatedDeviceName,
      right.updatedAtMs
    );
    const recoveryField = newerField(
      left.recoveryCodes,
      left.recoveryCodesUpdatedAtMs,
      left.recoveryCodesUpdatedDeviceName,
      left.updatedAtMs,
      right.recoveryCodes,
      right.recoveryCodesUpdatedAtMs,
      right.recoveryCodesUpdatedDeviceName,
      right.updatedAtMs
    );
    const noteField = newerField(
      left.note,
      left.noteUpdatedAtMs,
      left.noteUpdatedDeviceName,
      left.updatedAtMs,
      right.note,
      right.noteUpdatedAtMs,
      right.noteUpdatedDeviceName,
      right.updatedAtMs
    );
    const passkeyLinkStates = mergeRelationStates(left, right, "passkeyLinkStates", left.passkeyCredentialIds, right.passkeyCredentialIds, (id) => asString(id).trim());
    const mergedPasskeyIds = h.normalizePasskeyCredentialIds(Object.entries(passkeyLinkStates).filter(([, state]) => !state.isDeleted).map(([id]) => id));
    const passkeyUpdatedAtMs = Math.max(
      asNumber(left.passkeyUpdatedAtMs || left.updatedAtMs || left.createdAtMs),
      asNumber(right.passkeyUpdatedAtMs || right.updatedAtMs || right.createdAtMs)
    );
    const passkeyUpdatedDeviceName = asNumber(left.passkeyUpdatedAtMs || left.updatedAtMs || left.createdAtMs) >= asNumber(right.passkeyUpdatedAtMs || right.updatedAtMs || right.createdAtMs) ? asString(left.passkeyUpdatedDeviceName).trim() || asString(left.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME : asString(right.passkeyUpdatedDeviceName).trim() || asString(right.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;
    const latestContentUpdatedAt = Math.max(
      usernameField.updatedAtMs,
      passwordField.updatedAtMs,
      totpField.updatedAtMs,
      recoveryField.updatedAtMs,
      noteField.updatedAtMs,
      passkeyUpdatedAtMs
    );
    const leftDeletedAt = left.isDeleted ? asNumber(left.deletedAtMs) : 0;
    const rightDeletedAt = right.isDeleted ? asNumber(right.deletedAtMs) : 0;
    const latestDeletedAt = Math.max(leftDeletedAt, rightDeletedAt);
    const latestActivityAt = Math.max(latestContentUpdatedAt, left.updatedAtMs, right.updatedAtMs);
    const keepDeleted = latestDeletedAt > 0 && latestDeletedAt >= latestActivityAt;
    const keepPermanentlyDeleted = Boolean(left.isPermanentlyDeleted || right.isPermanentlyDeleted);
    const deletedDeviceName = leftDeletedAt >= rightDeletedAt ? asString(left.deletedDeviceName).trim() : asString(right.deletedDeviceName).trim();
    const leftUpdatedAt = asNumber(left.updatedAtMs);
    const rightUpdatedAt = asNumber(right.updatedAtMs);
    const newerAccount = leftUpdatedAt >= rightUpdatedAt ? left : right;
    const olderAccount = newerAccount === left ? right : left;
    const createdAtMs = Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs));
    const updatedAtMs = Math.max(
      leftUpdatedAt,
      rightUpdatedAt,
      latestContentUpdatedAt,
      latestDeletedAt,
      createdAtMs
    );
    const usernameAtCreate = asString(primary.usernameAtCreate).trim() || asString(secondary.usernameAtCreate).trim() || asString(primary.username).trim() || asString(secondary.username).trim();
    const createdDeviceName = asString(primary.createdDeviceName).trim() || asString(secondary.createdDeviceName).trim() || asString(primary.lastOperatedDeviceName).trim() || asString(secondary.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;
    const lastOperatedDeviceName = asString(newerAccount.lastOperatedDeviceName).trim() || asString(olderAccount.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;
    return {
      recordId: primary.recordId || left.recordId || right.recordId || h.stableUuidFromText(`${primary.accountId}|${createdAtMs}`),
      accountId: primary.accountId,
      canonicalSite,
      usernameAtCreate,
      isPinned: Boolean(newerAccount.isPinned),
      pinnedSortOrder: newerAccount.pinnedSortOrder == null ? null : asNumber(newerAccount.pinnedSortOrder),
      regularSortOrder: newerAccount.regularSortOrder == null ? null : asNumber(newerAccount.regularSortOrder),
      // Pinned state is UI metadata, but it is still synchronized account state.
      // Keep the newest complete map instead of accidentally dropping it during
      // a field merge; the native client follows the same last-writer rule.
      pinnedViews: newerAccount.pinnedViews || olderAccount.pinnedViews || null,
      folderId: mergedFolderIds[0] || (newerAccount.folderId == null ? null : h.normalizeFolderId(newerAccount.folderId)),
      folderIds: mergedFolderIds,
      folderMembershipStates,
      // Empty is intentional: every site may be tombstoned. Never revive primary.sites.
      sites: mergedSites,
      siteAliasStates,
      username: usernameField.value,
      password: passwordField.value,
      totpSecret: totpField.value,
      recoveryCodes: recoveryField.value,
      note: noteField.value,
      passkeyCredentialIds: mergedPasskeyIds,
      passkeyLinkStates,
      usernameUpdatedAtMs: usernameField.updatedAtMs,
      usernameUpdatedDeviceName: usernameField.deviceName,
      passwordUpdatedAtMs: passwordField.updatedAtMs,
      passwordUpdatedDeviceName: passwordField.deviceName,
      totpUpdatedAtMs: totpField.updatedAtMs,
      totpUpdatedDeviceName: totpField.deviceName,
      recoveryCodesUpdatedAtMs: recoveryField.updatedAtMs,
      recoveryCodesUpdatedDeviceName: recoveryField.deviceName,
      noteUpdatedAtMs: noteField.updatedAtMs,
      noteUpdatedDeviceName: noteField.deviceName,
      passkeyUpdatedAtMs,
      passkeyUpdatedDeviceName,
      isDeleted: keepPermanentlyDeleted || keepDeleted,
      isPermanentlyDeleted: keepPermanentlyDeleted,
      deletedAtMs: keepPermanentlyDeleted || keepDeleted ? latestDeletedAt || updatedAtMs : null,
      deletedDeviceName: keepPermanentlyDeleted || keepDeleted ? deletedDeviceName || lastOperatedDeviceName : "",
      createdAtMs,
      updatedAtMs,
      lastOperatedDeviceName,
      createdDeviceName
    };
  }
  function mergeSamePasskey(lhs, rhs, h) {
    const left = h.normalizePasskeyShape(lhs);
    const right = h.normalizePasskeyShape(rhs);
    const leftUpdated = asNumber(left.updatedAtMs || left.createdAtMs);
    const rightUpdated = asNumber(right.updatedAtMs || right.createdAtMs);
    const leftDeletedAt = left.isDeleted ? asNumber(left.deletedAtMs) : 0;
    const rightDeletedAt = right.isDeleted ? asNumber(right.deletedAtMs) : 0;
    const latestDeletedAt = Math.max(leftDeletedAt, rightDeletedAt);
    const keepPermanentlyDeleted = Boolean(left.isPermanentlyDeleted || right.isPermanentlyDeleted);
    const keepDeleted = keepPermanentlyDeleted || latestDeletedAt > 0 && latestDeletedAt >= Math.max(leftUpdated, rightUpdated);
    const deletedDeviceName = leftDeletedAt >= rightDeletedAt ? asString(left.deletedDeviceName).trim() : asString(right.deletedDeviceName).trim();
    const newer = leftUpdated >= rightUpdated ? left : right;
    const older = newer === left ? right : left;
    const resolvedAlg = asNumber(newer.alg || older.alg || -7);
    return {
      credentialIdB64u: newer.credentialIdB64u || older.credentialIdB64u,
      rpId: newer.rpId || older.rpId,
      userName: newer.userName || older.userName,
      displayName: newer.displayName || older.displayName,
      userHandleB64u: newer.userHandleB64u || older.userHandleB64u,
      alg: asNumber(newer.alg || older.alg || -7),
      signCount: Math.max(asNumber(left.signCount), asNumber(right.signCount)),
      privateJwk: newer.privateJwk || older.privateJwk || null,
      publicJwk: newer.publicJwk || older.publicJwk || null,
      createdAtMs: Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs)),
      updatedAtMs: Math.max(leftUpdated, rightUpdated),
      lastUsedAtMs: Math.max(asNumber(left.lastUsedAtMs), asNumber(right.lastUsedAtMs)) || null,
      mode: newer.mode || older.mode || "managed",
      createCompatMethod: h.normalizePasskeyCreateCompatMethod(
        newer.createCompatMethod || older.createCompatMethod,
        resolvedAlg
      ),
      isDeleted: keepDeleted,
      isPermanentlyDeleted: keepPermanentlyDeleted,
      deletedAtMs: keepDeleted ? latestDeletedAt || Math.max(leftUpdated, rightUpdated) : null,
      deletedDeviceName: keepDeleted ? deletedDeviceName || DEFAULT_DEVICE_NAME : ""
    };
  }
  function mergeSameFolder(lhs, rhs, h) {
    const left = h.normalizeFolderShape(lhs);
    const right = h.normalizeFolderShape(rhs);
    const id = h.normalizeFolderId(left.id || right.id);
    const leftUpdatedAt = asNumber(left.updatedAtMs || left.createdAtMs);
    const rightUpdatedAt = asNumber(right.updatedAtMs || right.createdAtMs);
    const leftDeletedAt = left.isDeleted ? asNumber(left.deletedAtMs) : 0;
    const rightDeletedAt = right.isDeleted ? asNumber(right.deletedAtMs) : 0;
    const latestDeletedAt = Math.max(leftDeletedAt, rightDeletedAt);
    const keepPermanentlyDeleted = Boolean(left.isPermanentlyDeleted || right.isPermanentlyDeleted);
    const keepDeleted = keepPermanentlyDeleted || latestDeletedAt > 0 && latestDeletedAt >= Math.max(leftUpdatedAt, rightUpdatedAt);
    const deletedDeviceName = leftDeletedAt >= rightDeletedAt ? asString(left.deletedDeviceName).trim() : asString(right.deletedDeviceName).trim();
    if (id === h.fixedNewAccountFolderId) {
      return {
        id,
        name: h.fixedNewAccountFolderName,
        matchedSites: rightUpdatedAt >= leftUpdatedAt ? right.matchedSites || [] : left.matchedSites || [],
        autoAddMatchingSites: rightUpdatedAt >= leftUpdatedAt ? Boolean(right.autoAddMatchingSites) : Boolean(left.autoAddMatchingSites),
        isDeleted: false,
        isPermanentlyDeleted: false,
        deletedAtMs: null,
        deletedDeviceName: "",
        createdAtMs: Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs)),
        updatedAtMs: Math.max(leftUpdatedAt, rightUpdatedAt)
      };
    }
    const leftName = asString(left.name).trim();
    const rightName = asString(right.name).trim();
    let name = leftName || rightName || `\u672A\u547D\u540D\u6587\u4EF6\u5939 ${id.slice(0, 8)}`;
    if (rightUpdatedAt > leftUpdatedAt && rightName) {
      name = rightName;
    } else if (leftUpdatedAt > rightUpdatedAt && leftName) {
      name = leftName;
    }
    return {
      id,
      name,
      matchedSites: rightUpdatedAt > leftUpdatedAt ? right.matchedSites || [] : left.matchedSites || [],
      autoAddMatchingSites: rightUpdatedAt > leftUpdatedAt ? Boolean(right.autoAddMatchingSites) : Boolean(left.autoAddMatchingSites),
      isDeleted: keepDeleted,
      isPermanentlyDeleted: keepPermanentlyDeleted,
      deletedAtMs: keepDeleted ? latestDeletedAt || Math.max(leftUpdatedAt, rightUpdatedAt) : null,
      deletedDeviceName: keepDeleted ? deletedDeviceName || DEFAULT_DEVICE_NAME : "",
      createdAtMs: Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs)),
      updatedAtMs: Math.max(leftUpdatedAt, rightUpdatedAt)
    };
  }
  function mergeAccountCollections(local, remote, helpers) {
    const h = resolveHelpers(helpers);
    const merged = [];
    for (const account of [...Array.isArray(local) ? local : [], ...Array.isArray(remote) ? remote : []]) {
      const normalized = h.normalizeAccountShape(account);
      const accountId = asString(normalized.accountId).trim();
      const recordId = asString(normalized.recordId || normalized.id).trim().toLowerCase();
      if (!accountId && !recordId) continue;
      const existingIndex = merged.findIndex((candidate) => {
        const candidateAccountId = asString(candidate.accountId).trim();
        const candidateRecordId = asString(candidate.recordId || candidate.id).trim().toLowerCase();
        return accountId && candidateAccountId === accountId || recordId && candidateRecordId === recordId;
      });
      if (existingIndex >= 0) {
        merged[existingIndex] = mergeSameAccount(merged[existingIndex], normalized, h);
      } else {
        merged.push(normalized);
      }
    }
    return merged.filter(Boolean);
  }
  function mergePasskeyCollections(local, remote, helpers) {
    const h = resolveHelpers(helpers);
    const mergedById = /* @__PURE__ */ new Map();
    const source = [...Array.isArray(local) ? local : [], ...Array.isArray(remote) ? remote : []];
    for (const passkey of source) {
      const normalized = h.normalizePasskeyShape(passkey);
      const id = asString(normalized.credentialIdB64u).trim();
      if (!id) continue;
      if (mergedById.has(id)) {
        mergedById.set(id, mergeSamePasskey(mergedById.get(id), normalized, h));
      } else {
        mergedById.set(id, normalized);
      }
    }
    return Array.from(mergedById.values()).sort((a, b) => {
      const left = asNumber(a?.updatedAtMs || a?.createdAtMs);
      const right = asNumber(b?.updatedAtMs || b?.createdAtMs);
      if (left !== right) return right - left;
      const leftId = asString(a?.credentialIdB64u);
      const rightId = asString(b?.credentialIdB64u);
      if (leftId < rightId) return -1;
      if (leftId > rightId) return 1;
      return 0;
    });
  }
  function mergeFolderCollections(local, remote, helpers) {
    const h = resolveHelpers(helpers);
    const merged = /* @__PURE__ */ new Map();
    const source = [...Array.isArray(local) ? local : [], ...Array.isArray(remote) ? remote : []];
    for (const folder of source) {
      const normalized = h.normalizeFolderShape(folder);
      const id = h.normalizeFolderId(normalized.id);
      if (!id) continue;
      if (merged.has(id)) {
        merged.set(id, mergeSameFolder(merged.get(id), normalized, h));
      } else {
        merged.set(id, normalized);
      }
    }
    const existingFixed = merged.get(h.fixedNewAccountFolderId);
    if (!existingFixed) {
      merged.set(
        h.fixedNewAccountFolderId,
        h.normalizeFolderShape({
          id: h.fixedNewAccountFolderId,
          name: h.fixedNewAccountFolderName,
          createdAtMs: 0
        })
      );
    } else {
      merged.set(
        h.fixedNewAccountFolderId,
        {
          ...existingFixed,
          id: h.fixedNewAccountFolderId,
          name: h.fixedNewAccountFolderName
        }
      );
    }
    return h.sortFoldersForDisplay(Array.from(merged.values()));
  }
  function reconcileAccountFolders(accounts, folders, helpers) {
    const h = resolveHelpers(helpers);
    const validIds = new Set((Array.isArray(folders) ? folders : []).filter((folder) => !folder?.isDeleted).map((folder) => h.normalizeFolderId(folder?.id)));
    const values = Array.isArray(accounts) ? accounts : [];
    return values.map((account) => {
      const normalized = h.normalizeAccountShape(account);
      const previousIds = h.normalizeFolderIdList(h.extractAccountFolderIds(normalized));
      const resolved = h.normalizeFolderIdList(
        previousIds.filter((id) => validIds.has(h.normalizeFolderId(id)))
      );
      const previousSet = new Set(previousIds.map((id) => h.normalizeFolderId(id)));
      const resolvedSet = new Set(resolved.map((id) => h.normalizeFolderId(id)));
      const folderMembershipStates = {
        ...normalized.folderMembershipStates && typeof normalized.folderMembershipStates === "object" ? normalized.folderMembershipStates : {}
      };
      const tombstoneAt = Math.max(
        asNumber(normalized.updatedAtMs),
        asNumber(normalized.createdAtMs),
        Date.now()
      );
      const deviceName = asString(normalized.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;
      for (const id of previousSet) {
        if (!id || resolvedSet.has(id)) continue;
        const existing = folderMembershipStates[id] || {};
        folderMembershipStates[id] = {
          isDeleted: true,
          updatedAtMs: Math.max(asNumber(existing.updatedAtMs), tombstoneAt),
          deviceName: asString(existing.deviceName).trim() || deviceName
        };
      }
      for (const id of resolvedSet) {
        if (!id) continue;
        const existing = folderMembershipStates[id];
        if (!existing || existing.isDeleted) {
          folderMembershipStates[id] = {
            isDeleted: false,
            updatedAtMs: Math.max(asNumber(existing?.updatedAtMs), tombstoneAt),
            deviceName: asString(existing?.deviceName).trim() || deviceName
          };
        }
      }
      return {
        ...normalized,
        folderId: resolved[0] || null,
        folderIds: resolved,
        folderMembershipStates
      };
    });
  }
  function identitySet(values, identityFn) {
    const result = /* @__PURE__ */ new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const identity = identityFn(value);
      if (identity) result.add(identity);
    }
    return result;
  }
  function missingIdentities(source, target, identityFn) {
    const sourceIds = identitySet(source, identityFn);
    const targetIds = identitySet(target, identityFn);
    return Array.from(sourceIds).filter((identity) => !targetIds.has(identity));
  }
  function summarizeSyncPayload(payload, helpers) {
    const h = resolveHelpers(helpers);
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts.map(h.normalizeAccountShape) : [];
    const folders = Array.isArray(payload?.folders) ? payload.folders.map(h.normalizeFolderShape) : [];
    const passkeys = Array.isArray(payload?.passkeys) ? payload.passkeys.map(h.normalizePasskeyShape) : [];
    return {
      accounts: accounts.length,
      activeAccounts: accounts.filter((item) => !item?.isDeleted).length,
      deletedAccounts: accounts.filter((item) => Boolean(item?.isDeleted)).length,
      folders: folders.length,
      passkeys: passkeys.length,
      accountIds: identitySet(accounts, (item) => asString(item?.recordId || item?.id || item?.accountId).trim().toLowerCase()),
      folderIds: identitySet(folders, (item) => h.normalizeFolderId(item?.id)),
      passkeyIds: identitySet(passkeys, (item) => asString(item?.credentialIdB64u || item?.id).trim())
    };
  }
  function evaluateSyncSafety({ local, remote, merged, mode = "merge" }, helpers) {
    const localSummary = summarizeSyncPayload(local, helpers);
    const remoteSummary = remote == null ? null : summarizeSyncPayload(remote, helpers);
    const mergedSummary = summarizeSyncPayload(merged, helpers);
    const reasons = [];
    const localNonEmpty = localSummary.accounts + localSummary.folders + localSummary.passkeys > 0;
    const remoteNonEmpty = Boolean(remoteSummary) && remoteSummary.accounts + remoteSummary.folders + remoteSummary.passkeys > 0;
    if (mode === "merge") {
      if (localNonEmpty && remoteSummary && !remoteNonEmpty) {
        reasons.push("REMOTE_EMPTY_FOR_NON_EMPTY_LOCAL");
      }
      const missingAccounts = missingIdentities(
        local?.accounts,
        merged?.accounts,
        (item) => asString(item?.recordId || item?.id || item?.accountId).trim().toLowerCase()
      );
      const missingFolders = missingIdentities(
        local?.folders,
        merged?.folders,
        (item) => asString(item?.id).trim().toLowerCase()
      );
      const missingPasskeys = missingIdentities(
        local?.passkeys,
        merged?.passkeys,
        (item) => asString(item?.credentialIdB64u || item?.id).trim()
      );
      if (missingAccounts.length > 0) reasons.push("LOCAL_ACCOUNTS_DROPPED");
      if (missingFolders.length > 0) reasons.push("LOCAL_FOLDERS_DROPPED");
      if (missingPasskeys.length > 0) reasons.push("LOCAL_PASSKEYS_DROPPED");
      const missingRemoteAccounts = missingIdentities(
        remote?.accounts,
        merged?.accounts,
        (item) => asString(item?.recordId || item?.id || item?.accountId).trim().toLowerCase()
      );
      const missingRemoteFolders = missingIdentities(
        remote?.folders,
        merged?.folders,
        (item) => asString(item?.id).trim().toLowerCase()
      );
      const missingRemotePasskeys = missingIdentities(
        remote?.passkeys,
        merged?.passkeys,
        (item) => asString(item?.credentialIdB64u || item?.id).trim()
      );
      if (missingRemoteAccounts.length > 0) reasons.push("REMOTE_ACCOUNTS_DROPPED");
      if (missingRemoteFolders.length > 0) reasons.push("REMOTE_FOLDERS_DROPPED");
      if (missingRemotePasskeys.length > 0) reasons.push("REMOTE_PASSKEYS_DROPPED");
      return {
        safe: reasons.length === 0,
        reasons,
        local: { ...localSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 },
        remote: remoteSummary ? { ...remoteSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 } : null,
        merged: { ...mergedSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 }
      };
    }
    if (mode === "remoteOverwriteLocal") {
      if (!remoteNonEmpty && localNonEmpty) reasons.push("REMOTE_EMPTY_FOR_NON_EMPTY_LOCAL");
      return {
        safe: reasons.length === 0,
        reasons,
        local: { ...localSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 },
        remote: remoteSummary ? { ...remoteSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 } : null,
        merged: { ...mergedSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 }
      };
    }
    return {
      safe: true,
      reasons,
      local: { ...localSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 },
      remote: remoteSummary ? { ...remoteSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 } : null,
      merged: { ...mergedSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 }
    };
  }

  // sync_crypto.js
  var SYNC_ENCRYPTED_SCHEMA_V1 = "pass.sync.encrypted.v1";
  var SYNC_PLAINTEXT_SCHEMA = "pass.sync.bundle.v2";
  function normalizeSyncEncryptionKey(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    return base64UrlToBytes(normalized).length === 32 ? normalized : "";
  }
  function isSyncEncryptionEnabled(rawKey) {
    return Boolean(normalizeSyncEncryptionKey(rawKey));
  }
  async function syncEncryptionKeyId(rawKey) {
    const key = normalizeSyncEncryptionKey(rawKey);
    if (!key) return "";
    const digest = await crypto.subtle.digest("SHA-256", base64UrlToBytes(key));
    return `k1-${Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 16)}`;
  }
  async function encryptSyncBundleDocument(document2, rawKey) {
    const key = normalizeSyncEncryptionKey(rawKey);
    if (!key) {
      return document2;
    }
    const imported = await importSyncKey(key, ["encrypt"]);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(document2));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(SYNC_ENCRYPTED_SCHEMA_V1) },
      imported,
      plaintext
    );
    return {
      schema: SYNC_ENCRYPTED_SCHEMA_V1,
      exportedAtMs: Number(document2?.exportedAtMs || Date.now()),
      keyId: await syncEncryptionKeyId(key),
      cipher: "AES-256-GCM",
      nonceBase64: bytesToBase642(new Uint8Array(nonce)),
      ciphertextBase64: bytesToBase642(new Uint8Array(ciphertext))
    };
  }
  async function decryptSyncBundleDocument(envelope, rawKey, fallbackKeys = []) {
    const schema = String(envelope?.schema || "");
    if (schema === SYNC_PLAINTEXT_SCHEMA) {
      if (isSyncEncryptionEnabled(rawKey)) {
        throw new Error("\u540C\u6B65\u5BC6\u94A5\u5DF2\u914D\u7F6E\uFF0C\u62D2\u7EDD\u672A\u52A0\u5BC6\u540C\u6B65\u5305");
      }
      return envelope;
    }
    if (schema !== SYNC_ENCRYPTED_SCHEMA_V1) {
      throw new Error("\u4E0D\u652F\u6301\u7684\u540C\u6B65\u5305\u683C\u5F0F");
    }
    const candidates = [...new Set([rawKey, ...Array.isArray(fallbackKeys) ? fallbackKeys : []].map(normalizeSyncEncryptionKey).filter(Boolean))];
    if (candidates.length === 0) {
      throw new Error("\u8BE5\u540C\u6B65\u5305\u4E3A\u52A0\u5BC6\u4FE1\u5C01\uFF0C\u4F46\u5F53\u524D\u672A\u914D\u7F6E\u540C\u6B65\u52A0\u5BC6\u5BC6\u94A5");
    }
    if (envelope?.cipher !== "AES-256-GCM") throw new Error("\u4E0D\u652F\u6301\u7684\u540C\u6B65\u52A0\u5BC6\u7B97\u6CD5");
    const declaredKeyId = String(envelope?.keyId || "").trim();
    const matchingCandidates = declaredKeyId ? (await Promise.all(candidates.map(async (key) => ({ key, keyId: await syncEncryptionKeyId(key) })))).filter((candidate) => candidate.keyId === declaredKeyId).map((candidate) => candidate.key) : candidates;
    if (matchingCandidates.length === 0) {
      throw new Error("\u540C\u6B65\u5BC6\u94A5 ID \u4E0D\u5339\u914D\uFF0C\u8BF7\u9009\u62E9\u4E0E\u8FDC\u7AEF\u6570\u636E\u76F8\u540C\u7684\u540C\u6B65\u5BC6\u94A5\u6216\u5B8C\u6210\u5BC6\u94A5\u8F6E\u6362");
    }
    for (const key of matchingCandidates) {
      try {
        const imported = await importSyncKey(key, ["decrypt"]);
        const plaintext = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: base64ToBytes2(envelope.nonceBase64),
            additionalData: new TextEncoder().encode(SYNC_ENCRYPTED_SCHEMA_V1)
          },
          imported,
          base64ToBytes2(envelope.ciphertextBase64)
        );
        return JSON.parse(new TextDecoder().decode(plaintext));
      } catch {
      }
    }
    throw new Error("\u540C\u6B65\u5305\u89E3\u5BC6\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4\u6240\u6709\u8BBE\u5907\u4F7F\u7528\u540C\u4E00\u540C\u6B65\u5BC6\u94A5");
  }
  async function importSyncKey(rawKey, usages) {
    const normalized = normalizeSyncEncryptionKey(rawKey);
    if (!normalized) throw new Error("\u540C\u6B65\u52A0\u5BC6\u5BC6\u94A5\u65E0\u6548\uFF0C\u5FC5\u987B\u662F 256 \u4F4D\u5BC6\u94A5");
    return crypto.subtle.importKey("raw", base64UrlToBytes(normalized), "AES-GCM", false, usages);
  }
  function bytesToBase642(bytes) {
    let binary = "";
    for (const value of bytes) binary += String.fromCharCode(value);
    return btoa(binary);
  }
  function base64ToBytes2(base64) {
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
    return base64ToBytes2(base64 + "=".repeat((4 - base64.length % 4) % 4));
  }

  // message_security.js
  function isTrustedExtensionMessageSender(sender, runtimeId) {
    const expectedId = String(runtimeId || "").trim();
    return Boolean(expectedId && String(sender?.id || "") === expectedId);
  }

  // secure_random.js
  function secureRandomUuid(cryptoApi = globalThis.crypto) {
    if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
    if (typeof cryptoApi?.getRandomValues !== "function") {
      throw new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u5B89\u5168\u968F\u673A\u6570\uFF0C\u5DF2\u505C\u6B62\u540C\u6B65\u64CD\u4F5C");
    }
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
  function createSyncIdempotencyKey(now = Date.now(), cryptoApi = globalThis.crypto) {
    return `pass-${Number(now)}-${secureRandomUuid(cryptoApi)}`;
  }

  // background.js
  var PASSKEY_LOG_PREFIX2 = "[Pass background]";
  var SYNC_LOG_PREFIX = "[Pass sync]";
  function logPasskeyFlow(event, details = {}) {
    try {
      console.info(PASSKEY_LOG_PREFIX2, event, details);
    } catch {
    }
  }
  function logSyncFlow(event, details = {}) {
    try {
      console.info(SYNC_LOG_PREFIX, event, details);
    } catch {
    }
  }
  var STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
  var STORAGE_KEY_SYNC_ENABLE_WEBDAV = "pass.sync.enableWebDAV.v3";
  var STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER = "pass.sync.enableSelfHostedServer.v3";
  var STORAGE_KEY_SYNC_WEBDAV_BASE_URL = "pass.sync.webdav.baseUrl.v2";
  var STORAGE_KEY_SYNC_WEBDAV_PATH = "pass.sync.webdav.path.v2";
  var STORAGE_KEY_SYNC_WEBDAV_USERNAME = "pass.sync.webdav.username.v2";
  var STORAGE_KEY_SYNC_SERVER_BASE_URL = "pass.sync.server.baseUrl.v2";
  var STORAGE_KEY_SYNC_PRIMARY_SOURCE = "pass.sync.primarySource.v1";
  var STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES = "pass.sync.autoIntervalMinutes.v1";
  var STORAGE_KEY_SYNC_DEVICE_ID = "pass.sync.deviceId.v1";
  var CONTEXT_MENU_ID_ALL_ACCOUNTS = "pass.context.all_accounts";
  var DEFAULT_SELF_HOSTED_SERVER_BASE_URL = "https://uk.sbbz.tech:5443";
  var SYNC_BUNDLE_SCHEMA_V2 = "pass.sync.bundle.v2";
  var SYNC_MODE_MERGE = "merge";
  var SYNC_PRIMARY_SERVER = "server";
  var SYNC_PRIMARY_WEBDAV = "webdav";
  var AUTO_SYNC_ALARM_NAME = "pass.sync.auto";
  var STORAGE_KEY_LOCK_ENABLED = "pass.lock.enabled";
  var STORAGE_KEY_LOCK_POLICY = "pass.lock.policy";
  var STORAGE_KEY_LOCK_IDLE_MINUTES = "pass.lock.idleMinutes";
  var STORAGE_KEY_LOCK_MASTER_CREDENTIAL = "pass.lock.masterCredential.v1";
  var STORAGE_KEY_LOCK_UNLOCKED_AT = "pass.lock.unlockedAtMs.v1";
  var STORAGE_KEY_LOCK_LAST_ACTIVITY = "pass.lock.lastActivityAtMs.v1";
  var LOCK_POLICY_IDLE_TIMEOUT = "idleTimeout";
  var SENSITIVE_MESSAGE_TYPES = /* @__PURE__ */ new Set([
    "PASS_FILL_ACTIVE_TAB",
    "PASS_LOGIN_DETECTED",
    "PASS_SAVE_FROM_LOGIN",
    "PASS_PASSKEY_OPERATION",
    "PASS_CONTENT_GET_ACCOUNTS",
    "PASS_CONTENT_CHECK_LOGIN",
    "PASS_CONTENT_LIST_FILL_ACCOUNTS",
    "PASS_CONTENT_FILL_ACCOUNT",
    "PASS_WEB_BRIDGE_SYNC_DATA"
  ]);
  var webBridgeSyncChain = Promise.resolve();
  function normalizeLegacySelfHostedServerBaseUrl(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return DEFAULT_SELF_HOSTED_SERVER_BASE_URL;
    try {
      const parsed = new URL(trimmed);
      if (!isSecureSyncEndpoint(parsed)) return "";
      const host = String(parsed.hostname || "").toLowerCase();
      const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
      if ((host === "127.0.0.1" || host === "localhost") && port === 53333) {
        return DEFAULT_SELF_HOSTED_SERVER_BASE_URL;
      }
      if (host === "or.sbbz.tech" && port === 5443) {
        return DEFAULT_SELF_HOSTED_SERVER_BASE_URL;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  function isSecureSyncEndpoint(url) {
    if (url.protocol === "https:") return true;
    const host = String(url.hostname || "").toLowerCase();
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(host);
  }
  chrome.runtime.onInstalled.addListener(async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
    if (!stored[STORAGE_KEY_DEVICE_NAME]) {
      await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: DEFAULT_DEVICE_NAME });
    }
    await ensureDataStorageReady().catch(() => {
    });
    await ensurePasskeyStorageShape().catch(() => {
    });
    ensureActionContextMenu();
    await scheduleAutoSyncAlarm();
    void injectExistingTabScripts();
  });
  void ensureDataStorageReady().catch(() => {
  });
  void ensurePasskeyStorageShape().catch(() => {
  });
  ensureActionContextMenu();
  void scheduleAutoSyncAlarm();
  void injectExistingTabScripts();
  chrome.runtime.onStartup.addListener(() => {
    ensureActionContextMenu();
    void scheduleAutoSyncAlarm();
    void injectExistingTabScripts();
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    void ensureMainWorldPasskeyBridge(tabId, tab?.url || "");
  });
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      void ensureMainWorldPasskeyBridge(tabId, tab?.url || "");
    } catch {
    }
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes[STORAGE_KEY_SYNC_ENABLE_WEBDAV] || changes[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER] || changes[STORAGE_KEY_SYNC_WEBDAV_BASE_URL] || changes[STORAGE_KEY_SYNC_WEBDAV_PATH] || changes[STORAGE_KEY_SYNC_WEBDAV_USERNAME] || changes[STORAGE_KEY_SYNC_SERVER_BASE_URL] || changes[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]) {
      void scheduleAutoSyncAlarm();
    }
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== AUTO_SYNC_ALARM_NAME) return;
    void runAutoSync().catch((error) => {
      console.error("pass auto sync failed", error);
    });
  });
  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== CONTEXT_MENU_ID_ALL_ACCOUNTS) {
      return;
    }
    void chrome.runtime.openOptionsPage();
  });
  function ensureActionContextMenu() {
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        return;
      }
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID_ALL_ACCOUNTS,
        title: "pass\u8BBE\u7F6E",
        contexts: ["action"]
      });
    });
  }
  function normalizeAutoSyncIntervalMinutes(value) {
    const normalized = Number(value);
    const allowed = /* @__PURE__ */ new Set([0, 1, 3, 5, 10, 15, 30, 60]);
    return allowed.has(normalized) ? normalized : 0;
  }
  function shouldInjectMainWorldBridge(url) {
    const value = String(url || "").trim().toLowerCase();
    return value.startsWith("http://") || value.startsWith("https://");
  }
  async function ensureMainWorldPasskeyBridge(tabId, url) {
    if (!tabId || !shouldInjectMainWorldBridge(url)) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["dist/content.js"]
      });
      logPasskeyFlow("isolated-bridge-injected", {
        tabId,
        url
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (version) => {
          try {
            window.__passMainWorldProbe = version;
            document.documentElement?.setAttribute("data-pass-main-world-probe", version);
            console.warn("[Pass probe] main world reachable", {
              version,
              href: window.location.href
            });
          } catch {
          }
        },
        args: [PASS_EXTENSION_VERSION]
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["dist/webauthn_injected.js"],
        world: "MAIN"
      });
      logPasskeyFlow("main-world-bridge-injected", {
        tabId,
        url
      });
    } catch (error) {
      logPasskeyFlow("main-world-bridge-inject-failed", {
        tabId,
        url,
        message: error?.message || String(error || "")
      });
    }
  }
  async function injectExistingTabScripts() {
    try {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(
        tabs.filter((tab) => tab?.id && shouldInjectMainWorldBridge(tab.url || "")).map((tab) => ensureMainWorldPasskeyBridge(tab.id, tab.url || ""))
      );
    } catch (error) {
      logPasskeyFlow("existing-tab-injection-failed", {
        message: error?.message || String(error || "")
      });
    }
  }
  async function scheduleAutoSyncAlarm() {
    const result = await chrome.storage.local.get([
      STORAGE_KEY_SYNC_ENABLE_WEBDAV,
      STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER,
      STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES
    ]);
    const hasRemoteSource = Boolean(result[STORAGE_KEY_SYNC_ENABLE_WEBDAV]) || Boolean(result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER]);
    const intervalMinutes = normalizeAutoSyncIntervalMinutes(result[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]);
    await chrome.alarms.clear(AUTO_SYNC_ALARM_NAME);
    if (!hasRemoteSource || intervalMinutes <= 0) {
      return;
    }
    await chrome.alarms.create(AUTO_SYNC_ALARM_NAME, {
      periodInMinutes: intervalMinutes,
      delayInMinutes: intervalMinutes
    });
  }
  async function runAutoSync() {
    const lockStatus = await getBackgroundLockStatus();
    if (lockStatus.locked) {
      logSyncFlow("auto-sync-skipped-locked");
      return;
    }
    const targets = await buildRemoteSyncTargetsFromStorage();
    if (!targets || targets.length === 0) return;
    const encryptionKey = await getOrCreateSyncEncryptionKey();
    logSyncFlow("auto-sync-start", {
      targetLabels: targets.map((item) => item.label),
      targetUrls: targets.map((item) => item.url),
      encrypted: Boolean(encryptionKey),
      online: typeof navigator !== "undefined" ? navigator.onLine : null
    });
    const localStored = await readBusinessDataFromStore();
    const localAccounts = Array.isArray(localStored.accounts) ? localStored.accounts.map(normalizeAccountShape) : [];
    const localStoredPasskeys = Array.isArray(localStored.passkeys) ? localStored.passkeys.map(normalizePasskeyShape) : [];
    const localPasskeys = buildUnifiedPasskeys(localAccounts, localStoredPasskeys);
    const localFolders = Array.isArray(localStored.folders) ? localStored.folders.map(normalizeFolderShape) : [];
    try {
      await saveLocalSafetySnapshot("\u81EA\u52A8\u540C\u6B65\u524D\u81EA\u52A8\u5907\u4EFD");
    } catch (error) {
      logSyncFlow("auto-sync-aborted-backup-failed", { message: error?.message || String(error || "") });
      return;
    }
    let mergedAccounts = localAccounts;
    let mergedPasskeys = localPasskeys;
    let mergedFolders = localFolders;
    let remoteAggregate = null;
    for (const target of targets) {
      logSyncFlow("pull-start", {
        label: target.label,
        url: target.url,
        hasAuthHeader: Boolean(target.authHeader)
      });
      let remoteResponse;
      try {
        remoteResponse = await pullRemotePayload(target);
      } catch (error) {
        logSyncFlow("auto-sync-aborted-pull-failed", {
          label: target.label,
          message: error?.message || String(error || "")
        });
        return;
      }
      logSyncFlow("pull-success", {
        label: target.label,
        url: target.url,
        hasPayload: Boolean(remoteResponse.payload),
        etag: remoteResponse.etag
      });
      updateRemoteConcurrencyState(target, remoteResponse.etag);
      target.remotePayload = remoteResponse.payload;
      target.remoteEncrypted = remoteResponse.encrypted;
      const remotePayload = remoteResponse.payload;
      const remoteAccounts = remotePayload ? remotePayload.accounts.map(normalizeAccountShape) : [];
      const remotePasskeys = remotePayload ? buildUnifiedPasskeys(remoteAccounts, remotePayload.passkeys) : [];
      const remoteFolders = remotePayload ? remotePayload.folders.map(normalizeFolderShape) : [];
      if (!remoteAggregate) {
        remoteAggregate = {
          accounts: remoteAccounts,
          passkeys: remotePasskeys,
          folders: remoteFolders
        };
        continue;
      }
      remoteAggregate.folders = mergeFolderCollections2(remoteAggregate.folders, remoteFolders);
      remoteAggregate.accounts = mergeAccountCollections2(remoteAggregate.accounts, remoteAccounts);
      remoteAggregate.accounts = syncAliasGroups2(remoteAggregate.accounts);
      remoteAggregate.accounts = reconcileAccountFolders2(remoteAggregate.accounts, remoteAggregate.folders);
      remoteAggregate.passkeys = mergePasskeyCollections2(remoteAggregate.passkeys, remotePasskeys);
      remoteAggregate.passkeys = buildUnifiedPasskeys(remoteAggregate.accounts, remoteAggregate.passkeys);
    }
    if (remoteAggregate) {
      mergedFolders = mergeFolderCollections2(localFolders, remoteAggregate.folders);
      mergedAccounts = mergeAccountCollections2(localAccounts, remoteAggregate.accounts);
      mergedAccounts = syncAliasGroups2(mergedAccounts);
      mergedAccounts = reconcileAccountFolders2(mergedAccounts, mergedFolders);
      mergedPasskeys = mergePasskeyCollections2(localPasskeys, remoteAggregate.passkeys);
      mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, mergedPasskeys);
    }
    if (remoteAggregate) {
      const safety = validateSyncSafety(
        { accounts: localAccounts, folders: localFolders, passkeys: localPasskeys },
        remoteAggregate,
        { accounts: mergedAccounts, folders: mergedFolders, passkeys: mergedPasskeys },
        SYNC_MODE_MERGE
      );
      if (!safety.safe) {
        logSyncFlow("auto-sync-aborted-safety-check", {
          reasons: safety.reasons,
          local: safety.local,
          remote: safety.remote,
          merged: safety.merged
        });
        return;
      }
    }
    await writeBusinessDataToStore({
      accounts: mergedAccounts,
      passkeys: mergedPasskeys,
      folders: mergedFolders
    });
    const pushTargets = [...targets].sort(
      (left, right) => Number(right.isPrimary) - Number(left.isPrimary) || Number(right.supportsEtag) - Number(left.supportsEtag)
    );
    const pushErrors = [];
    const outboxByTarget = new Map((await getSyncOutbox()).map((item) => [item.targetKey, item]));
    for (const target of pushTargets) {
      const targetKey = syncTargetKey(target);
      const pendingOutbox = outboxByTarget.get(targetKey);
      if (pendingOutbox && !isSyncOutboxReady(pendingOutbox)) {
        const waitSeconds = Math.max(1, Math.ceil((pendingOutbox.nextRetryAtMs - Date.now()) / 1e3));
        pushErrors.push(`${target.label}: \u8865\u507F\u4EFB\u52A1\u5C06\u5728 ${waitSeconds} \u79D2\u540E\u91CD\u8BD5`);
        logSyncFlow("push-skipped-backoff", {
          label: target.label,
          nextRetryAtMs: pendingOutbox.nextRetryAtMs,
          attempts: pendingOutbox.attempts
        });
        continue;
      }
      logSyncFlow("push-start", {
        label: target.label,
        url: target.url,
        supportsEtag: Boolean(target.supportsEtag),
        remoteEtag: target.remoteEtag
      });
      let result;
      try {
        result = await pushRemotePayloadWithMode(target, {
          accounts: mergedAccounts,
          passkeys: mergedPasskeys,
          folders: mergedFolders
        }, SYNC_MODE_MERGE);
      } catch (error) {
        pushErrors.push(`${target.label}: ${error?.message || String(error || "")}`);
        const nextOutbox = upsertSyncOutbox([...outboxByTarget.values()], {
          targetKey,
          payload: { accounts: mergedAccounts, passkeys: mergedPasskeys, folders: mergedFolders },
          error
        });
        outboxByTarget.clear();
        for (const item of nextOutbox) outboxByTarget.set(item.targetKey, item);
        logSyncFlow("auto-sync-push-failed", {
          label: target.label,
          message: error?.message || String(error || "")
        });
        continue;
      }
      outboxByTarget.delete(targetKey);
      logSyncFlow("push-success", {
        label: target.label,
        url: target.url,
        itemCounts: {
          accounts: Array.isArray(result?.payload?.accounts) ? result.payload.accounts.length : 0,
          passkeys: Array.isArray(result?.payload?.passkeys) ? result.payload.passkeys.length : 0,
          folders: Array.isArray(result?.payload?.folders) ? result.payload.folders.length : 0
        }
      });
      mergedAccounts = result.payload.accounts.map(normalizeAccountShape);
      mergedFolders = result.payload.folders.map(normalizeFolderShape);
      mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, result.payload.passkeys);
    }
    await setSyncOutbox([...outboxByTarget.values()]);
    await writeBusinessDataToStore({
      accounts: mergedAccounts,
      passkeys: mergedPasskeys,
      folders: mergedFolders
    });
    await appendHistoryEntry({
      action: pushErrors.length > 0 ? `\u81EA\u52A8\u540C\u6B65\u90E8\u5206\u5B8C\u6210\uFF08${pushErrors.join("\uFF1B")}\uFF09` : `\u81EA\u52A8\u540C\u6B65\u5B8C\u6210\uFF08${targets.map((item) => item.label).join(" + ")}\uFF09`,
      timestampMs: Date.now()
    });
    logSyncFlow("auto-sync-complete", {
      targetLabels: targets.map((item) => item.label),
      pushErrors
    });
  }
  async function readBusinessDataFromStore() {
    const stored = await getAllData();
    return {
      accounts: Array.isArray(stored.accounts) ? stored.accounts : [],
      passkeys: Array.isArray(stored.passkeys) ? stored.passkeys : [],
      folders: Array.isArray(stored.folders) ? stored.folders : []
    };
  }
  async function saveLocalSafetySnapshot(reason) {
    const payload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
    const snapshots = await getSafetySnapshots();
    snapshots.unshift({ createdAtMs: Date.now(), reason: String(reason || "\u540C\u6B65\u524D\u5907\u4EFD"), payload });
    await setSafetySnapshots(snapshots);
  }
  function normalizeSyncPayloadShape(payload) {
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts.map(normalizeAccountShape) : [];
    const rawPasskeys = Array.isArray(payload?.passkeys) ? payload.passkeys.map(normalizePasskeyShape) : [];
    const folders = Array.isArray(payload?.folders) ? payload.folders.map(normalizeFolderShape) : [];
    return {
      accounts,
      passkeys: buildUnifiedPasskeys(accounts, rawPasskeys),
      folders
    };
  }
  function syncPayloadEquals(lhs, rhs) {
    return JSON.stringify(sortSyncPayloadCollections(normalizeSyncPayloadShape(lhs))) === JSON.stringify(sortSyncPayloadCollections(normalizeSyncPayloadShape(rhs)));
  }
  function sortSyncPayloadCollections(payload) {
    const compare = (lhs, rhs, keys) => {
      for (const key of keys) {
        const left = String(lhs?.[key] || "").trim().toLowerCase();
        const right = String(rhs?.[key] || "").trim().toLowerCase();
        if (left < right) return -1;
        if (left > right) return 1;
      }
      return 0;
    };
    return {
      ...payload,
      accounts: [...payload?.accounts || []].sort((lhs, rhs) => compare(lhs, rhs, ["recordId", "accountId"])),
      passkeys: [...payload?.passkeys || []].sort((lhs, rhs) => compare(lhs, rhs, ["credentialIdB64u"])),
      folders: [...payload?.folders || []].sort((lhs, rhs) => compare(lhs, rhs, ["id"]))
    };
  }
  async function writeBusinessDataToStore({ accounts, passkeys, folders }) {
    const nextPayload = normalizeSyncPayloadShape({ accounts, passkeys, folders });
    const currentPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
    if (syncPayloadEquals(currentPayload, nextPayload)) {
      return false;
    }
    await setAllData(nextPayload);
    return true;
  }
  async function buildRemoteSyncTargetsFromStorage() {
    const result = await chrome.storage.local.get([
      STORAGE_KEY_SYNC_ENABLE_WEBDAV,
      STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER,
      STORAGE_KEY_SYNC_WEBDAV_BASE_URL,
      STORAGE_KEY_SYNC_WEBDAV_PATH,
      STORAGE_KEY_SYNC_WEBDAV_USERNAME,
      STORAGE_KEY_SYNC_SERVER_BASE_URL,
      STORAGE_KEY_SYNC_PRIMARY_SOURCE
    ]);
    const secrets = await migrateLegacySyncSecrets();
    const primarySource = String(result[STORAGE_KEY_SYNC_PRIMARY_SOURCE] || "").trim() === SYNC_PRIMARY_WEBDAV ? SYNC_PRIMARY_WEBDAV : SYNC_PRIMARY_SERVER;
    const targets = [];
    if (Boolean(result[STORAGE_KEY_SYNC_ENABLE_WEBDAV])) {
      const baseUrl = String(result[STORAGE_KEY_SYNC_WEBDAV_BASE_URL] || "").trim();
      const remotePath = String(result[STORAGE_KEY_SYNC_WEBDAV_PATH] || "").trim() || "pass-sync-bundle-v2.json";
      if (!baseUrl) return null;
      let parsedBaseUrl;
      try {
        parsedBaseUrl = new URL(baseUrl);
      } catch {
        throw new Error("WebDAV \u540C\u6B65\u5730\u5740\u65E0\u6548");
      }
      if (!isSecureSyncEndpoint(parsedBaseUrl)) {
        throw new Error("WebDAV \u540C\u6B65\u5730\u5740\u5FC5\u987B\u4F7F\u7528 HTTPS\uFF08\u672C\u673A\u56DE\u73AF\u5730\u5740\u53EF\u4F7F\u7528 HTTP\uFF09");
      }
      const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
      const url = new URL(remotePath.replace(/^\/+/g, ""), normalizedBase).toString();
      const username = String(result[STORAGE_KEY_SYNC_WEBDAV_USERNAME] || "");
      const password = secrets.webdavPassword;
      let authHeader = null;
      if (username || password) {
        authHeader = `Basic ${base64EncodeUtf8(`${username}:${password}`)}`;
      }
      targets.push({ label: "WebDAV", kind: "webdav", url, authHeader, supportsEtag: false, remoteEtag: null, remoteEncrypted: false, isPrimary: primarySource === SYNC_PRIMARY_WEBDAV });
    }
    if (Boolean(result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER])) {
      const serverBaseUrl = normalizeLegacySelfHostedServerBaseUrl(
        result[STORAGE_KEY_SYNC_SERVER_BASE_URL] || DEFAULT_SELF_HOSTED_SERVER_BASE_URL
      );
      if (!serverBaseUrl) throw new Error("\u670D\u52A1\u5668\u540C\u6B65\u5730\u5740\u5FC5\u987B\u4F7F\u7528 HTTPS\uFF08\u672C\u673A\u56DE\u73AF\u5730\u5740\u53EF\u4F7F\u7528 HTTP\uFF09");
      const normalizedBase = serverBaseUrl.endsWith("/") ? serverBaseUrl : `${serverBaseUrl}/`;
      const url = new URL("v2/sync/state", normalizedBase).toString();
      const token = secrets.serverToken;
      const authHeader = token ? `Bearer ${token}` : null;
      targets.push({ label: "\u670D\u52A1\u5668", kind: "server", url, authHeader, supportsEtag: true, remoteEtag: null, remoteEncrypted: false, isPrimary: primarySource === SYNC_PRIMARY_SERVER });
    }
    const primaryTarget = targets.find((target) => target.kind === primarySource) || targets.find((target) => target.kind === SYNC_PRIMARY_SERVER) || targets[0];
    for (const target of targets) target.isPrimary = target === primaryTarget;
    logSyncFlow("targets-built", {
      webdavEnabled: Boolean(result[STORAGE_KEY_SYNC_ENABLE_WEBDAV]),
      serverEnabled: Boolean(result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER]),
      targets: targets.map((item) => ({
        label: item.label,
        url: item.url,
        hasAuthHeader: Boolean(item.authHeader),
        kind: item.kind === "webdav" ? "webdav" : "server",
        supportsEtag: Boolean(item.supportsEtag)
      }))
    });
    return targets.length > 0 ? targets : null;
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (!isTrustedExtensionMessageSender(sender, chrome.runtime.id)) {
        sendResponse({ ok: false, error: "\u62D2\u7EDD\u6765\u81EA\u5176\u4ED6\u6269\u5C55\u6216\u7F51\u9875\u7684\u6D88\u606F" });
        return;
      }
      if (SENSITIVE_MESSAGE_TYPES.has(message?.type)) {
        const lockStatus = await getBackgroundLockStatus();
        if (lockStatus.locked) {
          sendResponse({ ok: false, locked: true, error: "\u6269\u5C55\u5DF2\u9501\u5B9A" });
          return;
        }
      }
      switch (message?.type) {
        case "PASS_LOCK_STATUS":
          sendResponse(await getBackgroundLockStatus());
          return;
        case "PASS_LOCK_UNLOCK":
          sendResponse(await unlockBackground(message.payload?.password));
          return;
        case "PASS_LOCK_NOW":
          await lockBackground();
          sendResponse({ ok: true, locked: true });
          return;
        case "PASS_LOCK_CONFIGURE_DATA":
          sendResponse(await configureDataEncryption(message.payload));
          return;
        case "PASS_LOCK_DISABLE_DATA":
          sendResponse(await disableBackgroundDataEncryption(message.payload));
          return;
        case "PASS_LOCK_REWRAP_DATA":
          sendResponse(await rewrapBackgroundDataEncryption(message.payload));
          return;
        case "PASS_LOCK_ACTIVITY":
          await registerBackgroundLockActivity();
          sendResponse({ ok: true });
          return;
        case "PASS_FILL_ACTIVE_TAB":
          sendResponse(await handleFillActiveTab(message.payload));
          return;
        case "PASS_WEB_BRIDGE_SYNC_DATA":
          sendResponse(await handleWebBridgeSyncData(message.payload));
          return;
        case "PASS_CONTENT_LIST_FILL_ACCOUNTS":
          sendResponse(await handleContentListFillAccounts(sender));
          return;
        case "PASS_CONTENT_FILL_ACCOUNT":
          sendResponse(await handleContentFillAccount(message.payload, sender));
          return;
        case "PASS_LOGIN_DETECTED":
          sendResponse(await handleLoginDetected(message.payload));
          return;
        case "PASS_SAVE_FROM_LOGIN":
          sendResponse(await handleSaveFromLogin(message.payload));
          return;
        case "PASS_PASSKEY_OPERATION":
          sendResponse(await handlePasskeyOperationAndSyncAccount(message.payload));
          return;
        case "PASS_CONTENT_GET_ACCOUNTS":
          sendResponse(await handleContentGetAccounts());
          return;
        case "PASS_CONTENT_CHECK_LOGIN":
          sendResponse(await handleContentCheckLogin(message.payload, sender));
          return;
        default:
          return;
      }
    })().catch((error) => {
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  });
  async function getBackgroundLockStatus() {
    const settings = await chrome.storage.local.get([
      STORAGE_KEY_LOCK_ENABLED,
      STORAGE_KEY_LOCK_POLICY,
      STORAGE_KEY_LOCK_IDLE_MINUTES,
      STORAGE_KEY_LOCK_MASTER_CREDENTIAL
    ]);
    const enabled = Boolean(settings[STORAGE_KEY_LOCK_ENABLED]) && Boolean(normalizeLockMasterCredential(settings[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]));
    if (!enabled) return { ok: true, enabled: false, locked: false };
    const session = await chrome.storage.session.get([
      STORAGE_KEY_LOCK_UNLOCKED_AT,
      STORAGE_KEY_LOCK_LAST_ACTIVITY
    ]);
    const unlockedAtMs = Number(session[STORAGE_KEY_LOCK_UNLOCKED_AT] || 0);
    let locked = unlockedAtMs <= 0;
    if (!locked && settings[STORAGE_KEY_LOCK_POLICY] === LOCK_POLICY_IDLE_TIMEOUT) {
      const idleMinutes = Math.min(Math.max(Number(settings[STORAGE_KEY_LOCK_IDLE_MINUTES] || 5), 1), 60);
      const lastActivityAtMs = Number(session[STORAGE_KEY_LOCK_LAST_ACTIVITY] || unlockedAtMs);
      locked = Date.now() - lastActivityAtMs >= idleMinutes * 60 * 1e3;
      if (locked) await lockBackground();
    }
    return { ok: true, enabled: true, locked };
  }
  async function unlockBackground(rawPassword) {
    const password = String(rawPassword || "").trim();
    const stored = await chrome.storage.local.get([
      STORAGE_KEY_LOCK_ENABLED,
      STORAGE_KEY_LOCK_MASTER_CREDENTIAL
    ]);
    const credential = normalizeLockMasterCredential(stored[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
    if (!stored[STORAGE_KEY_LOCK_ENABLED] || !credential) {
      return { ok: true, enabled: false, locked: false };
    }
    if (!password || !await verifyLockMasterPassword(credential, password)) {
      return { ok: false, enabled: true, locked: true, error: "\u4E3B\u5BC6\u7801\u9519\u8BEF" };
    }
    let activeCredential = credential;
    if (credential.version === 1) {
      const upgraded = await createLockMasterCredential(password);
      await chrome.storage.local.set({ [STORAGE_KEY_LOCK_MASTER_CREDENTIAL]: upgraded });
      activeCredential = upgraded;
    }
    try {
      await unlockDataEncryption(password, activeCredential);
    } catch (error) {
      return { ok: false, enabled: true, locked: true, error: `\u65E0\u6CD5\u89E3\u9501\u672C\u5730\u6570\u636E: ${error?.message || error}` };
    }
    const now = Date.now();
    await chrome.storage.session.set({
      [STORAGE_KEY_LOCK_UNLOCKED_AT]: now,
      [STORAGE_KEY_LOCK_LAST_ACTIVITY]: now
    });
    await broadcastLockState(false);
    return { ok: true, enabled: true, locked: false };
  }
  async function lockBackground() {
    await chrome.storage.session.remove([
      STORAGE_KEY_LOCK_UNLOCKED_AT,
      STORAGE_KEY_LOCK_LAST_ACTIVITY
    ]);
    await lockDataEncryption();
    await broadcastLockState(true);
  }
  async function configureDataEncryption(payload) {
    const password = String(payload?.password || "").trim();
    const stored = await chrome.storage.local.get([STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
    const credential = normalizeLockMasterCredential(stored[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
    if (!password || !credential || !await verifyLockMasterPassword(credential, password)) {
      return { ok: false, error: "\u4E3B\u5BC6\u7801\u9519\u8BEF\uFF0C\u65E0\u6CD5\u4FDD\u62A4\u672C\u5730\u6570\u636E" };
    }
    try {
      let activeCredential = credential;
      if (credential.version === 1) {
        activeCredential = await createLockMasterCredential(password);
        await chrome.storage.local.set({ [STORAGE_KEY_LOCK_MASTER_CREDENTIAL]: activeCredential });
      }
      await unlockDataEncryption(password, activeCredential);
      return { ok: true, credential: activeCredential };
    } catch (error) {
      return { ok: false, error: `\u65E0\u6CD5\u4FDD\u62A4\u672C\u5730\u6570\u636E: ${error?.message || error}` };
    }
  }
  async function disableBackgroundDataEncryption(payload) {
    const password = String(payload?.password || "").trim();
    const stored = await chrome.storage.local.get([STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
    const credential = normalizeLockMasterCredential(stored[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
    if (!password || !credential || !await verifyLockMasterPassword(credential, password)) {
      return { ok: false, error: "\u4E3B\u5BC6\u7801\u9519\u8BEF\uFF0C\u65E0\u6CD5\u5173\u95ED\u672C\u5730\u6570\u636E\u4FDD\u62A4" };
    }
    try {
      await disableDataEncryption(password, credential);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `\u65E0\u6CD5\u5173\u95ED\u672C\u5730\u6570\u636E\u4FDD\u62A4: ${error?.message || error}` };
    }
  }
  async function rewrapBackgroundDataEncryption(payload) {
    const currentPassword = String(payload?.currentPassword || "").trim();
    const nextPassword = String(payload?.nextPassword || "").trim();
    const stored = await chrome.storage.local.get([STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
    const currentCredential = normalizeLockMasterCredential(stored[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
    const nextCredential = normalizeLockMasterCredential(payload?.nextCredential);
    if (!currentPassword || !nextPassword || !currentCredential || !nextCredential || !await verifyLockMasterPassword(currentCredential, currentPassword)) {
      return { ok: false, error: "\u5F53\u524D\u4E3B\u5BC6\u7801\u9519\u8BEF\uFF0C\u65E0\u6CD5\u66F4\u65B0\u4E3B\u5BC6\u7801" };
    }
    try {
      await rewrapDataEncryption(currentPassword, currentCredential, nextPassword, nextCredential);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `\u65E0\u6CD5\u66F4\u65B0\u672C\u5730\u6570\u636E\u4FDD\u62A4: ${error?.message || error}` };
    }
  }
  async function registerBackgroundLockActivity() {
    const status = await getBackgroundLockStatus();
    if (!status.enabled || status.locked) return;
    await chrome.storage.session.set({ [STORAGE_KEY_LOCK_LAST_ACTIVITY]: Date.now() });
  }
  async function broadcastLockState(locked) {
    try {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) => chrome.tabs.sendMessage(tab.id, { type: locked ? "PASS_LOCKED" : "PASS_UNLOCKED" })));
    } catch {
    }
  }
  async function handlePasskeyOperationAndSyncAccount(payload) {
    logPasskeyFlow("bridge-received", {
      operation: String(payload?.operation || ""),
      host: String(payload?.host || ""),
      origin: String(payload?.origin || "")
    });
    const response = await handlePasskeyBridgeOperation(payload);
    if (!response?.ok) {
      logPasskeyFlow("bridge-failed", {
        operation: String(payload?.operation || ""),
        error: response?.error || null
      });
      return response;
    }
    if (payload?.operation === "create") {
      logPasskeyFlow("bridge-create-succeeded", {
        accountHint: response.result?.accountHint || null,
        createMode: String(response.result?.createMode || ""),
        createCompatMethod: String(response.result?.createCompatMethod || "")
      });
      await upsertAccountForPasskey(response.result?.accountHint);
    }
    if (payload?.operation === "get") {
      logPasskeyFlow("bridge-get-succeeded", {
        assertionHint: response.result?.assertionHint || null
      });
    }
    return response;
  }
  function parseTabSecurityContext(urlValue) {
    let tabHost = "";
    let protocol = "";
    try {
      const parsed = new URL(String(urlValue || ""));
      tabHost = parsed.hostname;
      protocol = parsed.protocol;
    } catch {
      tabHost = "";
      protocol = "";
    }
    const isLocalhost = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(String(tabHost).toLowerCase());
    const allowedProtocol = protocol === "https:" || protocol === "http:" && isLocalhost;
    return { tabHost, protocol, allowedProtocol };
  }
  async function resolveFillAccountForHost(payload, tabHost) {
    let username = String(payload?.username || "");
    let password = String(payload?.password || "");
    const accountId = String(payload?.accountId || "").trim();
    if (accountId) {
      const accounts2 = await getAccounts2();
      const account = accounts2.find((item) => !item?.isDeleted && String(item?.accountId || "") === accountId);
      if (!account) {
        return { ok: false, error: "\u627E\u4E0D\u5230\u8981\u586B\u5145\u7684\u8D26\u53F7" };
      }
      if (!accountMatchesDomain(account, tabHost)) {
        return { ok: false, error: "\u5F53\u524D\u9875\u9762\u57DF\u540D\u4E0E\u8D26\u53F7\u7AD9\u70B9\u4E0D\u5339\u914D\uFF0C\u5DF2\u963B\u6B62\u8DE8\u57DF\u586B\u5145" };
      }
      return {
        ok: true,
        accountId: String(account.accountId || accountId),
        username: String(account.username || ""),
        password: String(account.password || "")
      };
    }
    const accounts = await getAccounts2();
    const matched = accounts.find((item) => {
      return !item?.isDeleted && accountMatchesDomain(item, tabHost) && String(item?.username || "") === username && String(item?.password || "") === password;
    });
    if (!matched) {
      return { ok: false, error: "\u5F53\u524D\u9875\u9762\u57DF\u540D\u4E0E\u8D26\u53F7\u7AD9\u70B9\u4E0D\u5339\u914D\uFF0C\u5DF2\u963B\u6B62\u8DE8\u57DF\u586B\u5145" };
    }
    return {
      ok: true,
      accountId: String(matched.accountId || ""),
      username,
      password
    };
  }
  async function handleFillActiveTab(payload) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) {
      return { ok: false, error: "\u627E\u4E0D\u5230\u6D3B\u52A8\u6807\u7B7E\u9875" };
    }
    const { tabHost, allowedProtocol } = parseTabSecurityContext(activeTab.url || "");
    if (!tabHost) {
      return { ok: false, error: "\u65E0\u6CD5\u8BC6\u522B\u5F53\u524D\u6807\u7B7E\u9875\u57DF\u540D" };
    }
    if (!allowedProtocol) {
      return { ok: false, error: "\u4EC5\u5141\u8BB8\u5411 HTTPS \u9875\u9762\uFF08\u6216\u672C\u673A HTTP\uFF09\u586B\u5145\u51ED\u636E" };
    }
    const resolved = await resolveFillAccountForHost(payload, tabHost);
    if (!resolved.ok) return resolved;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ["dist/content.js"]
      });
    } catch {
    }
    let response;
    try {
      response = await chrome.tabs.sendMessage(activeTab.id, {
        type: "PASS_FILL_CREDENTIALS",
        payload: {
          username: resolved.username,
          password: resolved.password
        }
      });
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "\u65E0\u6CD5\u8FDE\u63A5\u9875\u9762\u5185\u5BB9\u811A\u672C\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5"
      };
    }
    if (!response?.ok) {
      return { ok: false, error: response?.error || "\u9875\u9762\u586B\u5145\u5931\u8D25" };
    }
    return {
      ok: true,
      filledUsername: Boolean(response.filledUsername),
      filledPassword: Boolean(response.filledPassword)
    };
  }
  function handleWebBridgeSyncData(payload) {
    const run = webBridgeSyncChain.then(async () => {
      const source = payload && typeof payload === "object" ? payload : {};
      const accounts = Array.isArray(source.accounts) ? source.accounts.map(normalizeAccountShape) : [];
      const folders = Array.isArray(source.folders) ? source.folders.map(normalizeFolderShape) : [];
      const passkeys = buildUnifiedPasskeys(
        accounts,
        Array.isArray(source.passkeys) ? source.passkeys.map(normalizePasskeyShape) : []
      );
      await setAllData({ accounts, folders, passkeys });
      return {
        ok: true,
        accounts: accounts.length,
        folders: folders.length,
        passkeys: passkeys.length
      };
    });
    webBridgeSyncChain = run.catch(() => {
    });
    return run.catch((error) => ({
      ok: false,
      error: error?.message || String(error || "\u540E\u53F0\u6570\u636E\u955C\u50CF\u5931\u8D25")
    }));
  }
  async function handleContentListFillAccounts(sender) {
    const tabUrl = String(sender?.tab?.url || "");
    const { tabHost, allowedProtocol } = parseTabSecurityContext(tabUrl);
    if (!tabHost) {
      return { ok: false, error: "\u65E0\u6CD5\u8BC6\u522B\u5F53\u524D\u6807\u7B7E\u9875\u57DF\u540D", accounts: [] };
    }
    if (!allowedProtocol) {
      return { ok: false, error: "\u4EC5\u5141\u8BB8\u5728 HTTPS \u9875\u9762\uFF08\u6216\u672C\u673A HTTP\uFF09\u5217\u51FA\u53EF\u586B\u5145\u8D26\u53F7", accounts: [] };
    }
    const accounts = await getAccounts2();
    const matched = accounts.filter((item) => !item?.isDeleted && accountMatchesDomain(item, tabHost)).sort((left, right) => {
      const leftUpdated = Number(left?.updatedAtMs || left?.createdAtMs || 0);
      const rightUpdated = Number(right?.updatedAtMs || right?.createdAtMs || 0);
      if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
      return String(left?.username || "").localeCompare(String(right?.username || ""));
    }).slice(0, 20).map((item) => ({
      accountId: String(item.accountId || ""),
      username: String(item.username || ""),
      sites: normalizeSites(item.sites || [])
    })).filter((item) => item.accountId);
    return { ok: true, domain: normalizeDomain(tabHost), accounts: matched };
  }
  async function handleContentFillAccount(payload, sender) {
    const tabId = sender?.tab?.id;
    const tabUrl = String(sender?.tab?.url || "");
    if (!tabId) {
      return { ok: false, error: "\u627E\u4E0D\u5230\u6765\u6E90\u6807\u7B7E\u9875" };
    }
    const { tabHost, allowedProtocol } = parseTabSecurityContext(tabUrl);
    if (!tabHost) {
      return { ok: false, error: "\u65E0\u6CD5\u8BC6\u522B\u5F53\u524D\u6807\u7B7E\u9875\u57DF\u540D" };
    }
    if (!allowedProtocol) {
      return { ok: false, error: "\u4EC5\u5141\u8BB8\u5411 HTTPS \u9875\u9762\uFF08\u6216\u672C\u673A HTTP\uFF09\u586B\u5145\u51ED\u636E" };
    }
    const resolved = await resolveFillAccountForHost(payload, tabHost);
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      accountId: resolved.accountId,
      username: resolved.username,
      password: resolved.password
    };
  }
  async function handleLoginDetected(payload) {
    const domain = normalizeDomain(payload?.domain || "");
    const username = (payload?.username || "").trim();
    const password = payload?.password || "";
    if (!domain || !username || !password) {
      return { shouldPrompt: false };
    }
    const accounts = await getAccounts2();
    const active = accounts.filter((item) => !item.isDeleted);
    const exact = active.some((account) => {
      return accountMatchesDomain(account, domain) && account.username === username && account.password === password;
    });
    if (exact) {
      return { shouldPrompt: false };
    }
    const updateCandidate = active.some((account) => {
      return accountMatchesDomain(account, domain) && account.username === username && account.password !== password;
    });
    return { shouldPrompt: true, mode: updateCandidate ? "update" : "create" };
  }
  async function handleSaveFromLogin(payload) {
    const domain = normalizeDomain(payload?.domain || "");
    const username = (payload?.username || "").trim();
    const password = payload?.password || "";
    if (!domain || !username || !password) {
      return { ok: false, error: "\u7F3A\u5C11\u4FDD\u5B58\u6240\u9700\u53C2\u6570" };
    }
    const now = Date.now();
    const { [STORAGE_KEY_DEVICE_NAME]: deviceNameStored } = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
    const deviceName = normalizeDeviceName(deviceNameStored);
    const next = await getAccounts2();
    const existing = next.find((account) => {
      return !account.isDeleted && accountMatchesDomain(account, domain) && account.username === username;
    });
    if (existing) {
      let changed = false;
      if (existing.password !== password) {
        existing.password = password;
        existing.passwordUpdatedAtMs = now;
        existing.passwordUpdatedDeviceName = deviceName;
        changed = true;
      }
      if (!existing.sites.includes(domain)) {
        existing.sites.push(domain);
        existing.sites = normalizeSites(existing.sites);
        changed = true;
      }
      if (existing.isDeleted) {
        existing.isDeleted = false;
        existing.deletedAtMs = null;
        changed = true;
      }
      if (changed) {
        existing.updatedAtMs = now;
        existing.lastOperatedDeviceName = deviceName;
        const synced2 = syncAliasGroups2(next);
        await setAccounts2(synced2);
        return { ok: true, mode: "updated" };
      }
      return { ok: true, mode: "noop" };
    }
    next.push(
      createAccount({
        site: domain,
        username,
        password,
        createdAtMs: now,
        deviceName
      })
    );
    const synced = syncAliasGroups2(next);
    await setAccounts2(synced);
    return { ok: true, mode: "created" };
  }
  async function handleContentGetAccounts() {
    const accounts = await getAccounts2();
    return {
      ok: true,
      accounts: accounts.filter((account) => !account?.isDeleted).map((account) => ({
        sites: normalizeSites(account?.sites || []),
        username: String(account?.username || ""),
        isDeleted: false
      }))
    };
  }
  async function handleContentCheckLogin(payload, sender) {
    let domain = normalizeDomain(payload?.domain || "");
    try {
      const tabUrl = String(sender?.tab?.url || "");
      if (tabUrl) domain = normalizeDomain(new URL(tabUrl).hostname) || domain;
    } catch {
    }
    const username = String(payload?.username || "").trim();
    const password = String(payload?.password || "");
    if (!domain || !username || !password) {
      return { ok: true, shouldPrompt: false };
    }
    const accounts = await getAccounts2();
    const active = accounts.filter((item) => !item.isDeleted);
    const exact = active.some((account) => {
      return accountMatchesDomain(account, domain) && account.username === username && account.password === password;
    });
    if (exact) return { ok: true, shouldPrompt: false };
    const updateCandidate = active.some((account) => {
      return accountMatchesDomain(account, domain) && account.username === username && account.password !== password;
    });
    return { ok: true, shouldPrompt: true, mode: updateCandidate ? "update" : "create" };
  }
  async function getAccounts2() {
    const raw = await getAccounts();
    return raw.map(normalizeAccountShape);
  }
  async function setAccounts2(accounts) {
    const normalized = (Array.isArray(accounts) ? accounts : []).map(normalizeAccountShape);
    await setAccounts(normalized);
  }
  async function upsertAccountForPasskey(accountHint) {
    const domain = normalizeDomain(accountHint?.rpId || "");
    const username = normalizeUsername(accountHint?.username || "");
    const credentialIdB64u = normalizePasskeyId(accountHint?.credentialIdB64u || accountHint?.credentialId || "");
    if (!domain || !username) {
      logPasskeyFlow("upsert-skipped-missing-account-hint", {
        accountHint: accountHint || null
      });
      return;
    }
    const now = Date.now();
    const { [STORAGE_KEY_DEVICE_NAME]: deviceNameStored } = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
    const deviceName = normalizeDeviceName(deviceNameStored);
    const allAccounts = await getAccounts2();
    let matchIndexes = [];
    for (let i = 0; i < allAccounts.length; i += 1) {
      const account = allAccounts[i];
      if (accountMatchesDomain(account, domain) && normalizeUsername(account.username) === username) {
        matchIndexes.push(i);
      }
    }
    if (matchIndexes.length === 0) {
      const fallbackIndexes = [];
      for (let i = 0; i < allAccounts.length; i += 1) {
        const account = allAccounts[i];
        if (!account.isDeleted && accountMatchesDomain(account, domain)) {
          fallbackIndexes.push(i);
        }
      }
      if (fallbackIndexes.length === 1) {
        matchIndexes = fallbackIndexes;
        logPasskeyFlow("upsert-using-single-domain-fallback", {
          domain,
          username,
          fallbackAccountId: String(allAccounts[fallbackIndexes[0]]?.accountId || "")
        });
      }
    }
    if (matchIndexes.length === 0) {
      const created = createAccount({
        site: domain,
        username,
        password: "",
        createdAtMs: now,
        deviceName
      });
      if (credentialIdB64u) {
        created.passkeyCredentialIds = normalizePasskeyCredentialIds([credentialIdB64u]);
        created.passkeyUpdatedAtMs = now;
      }
      allAccounts.push(created);
      await setAccounts2(syncAliasGroups2(allAccounts));
      logPasskeyFlow("upsert-created-new-account", {
        domain,
        username,
        accountId: created.accountId,
        credentialIdB64u
      });
      return;
    }
    const matchedAccounts = matchIndexes.map((index) => allAccounts[index]);
    const primary = pickPrimaryAccountForMerge(matchedAccounts, now);
    const mergedAccount = mergeMatchedAccountsForPasskey({
      primary,
      matchedAccounts,
      domain,
      username,
      credentialIdB64u,
      now,
      deviceName
    });
    const removeIndexSet = new Set(matchIndexes);
    const next = allAccounts.filter((_, index) => !removeIndexSet.has(index));
    next.push(mergedAccount);
    await setAccounts2(syncAliasGroups2(next));
    logPasskeyFlow("upsert-merged-into-existing-account", {
      domain,
      username,
      mergedAccountId: mergedAccount.accountId,
      matchedAccountIds: matchedAccounts.map((item) => String(item?.accountId || "")),
      credentialIdB64u
    });
  }
  function mergeMatchedAccountsForPasskey({
    primary,
    matchedAccounts,
    domain,
    username,
    credentialIdB64u,
    now,
    deviceName
  }) {
    const mergedSites = normalizeSites([
      ...matchedAccounts.flatMap((account) => account?.sites || []),
      domain
    ]);
    const createdAtMs = matchedAccounts.reduce((minValue, account) => {
      return Math.min(minValue, asTimestamp(account?.createdAtMs, now));
    }, Number.POSITIVE_INFINITY);
    const safeCreatedAtMs = Number.isFinite(createdAtMs) ? createdAtMs : now;
    const usernameField = pickLatestTextField(matchedAccounts, "username", "usernameUpdatedAtMs", safeCreatedAtMs);
    const passwordField = pickLatestTextField(matchedAccounts, "password", "passwordUpdatedAtMs", safeCreatedAtMs);
    const totpField = pickLatestTextField(matchedAccounts, "totpSecret", "totpUpdatedAtMs", safeCreatedAtMs);
    const recoveryField = pickLatestTextField(
      matchedAccounts,
      "recoveryCodes",
      "recoveryCodesUpdatedAtMs",
      safeCreatedAtMs
    );
    const noteField = pickLatestTextField(matchedAccounts, "note", "noteUpdatedAtMs", safeCreatedAtMs);
    const existingPasskeyIds = normalizePasskeyCredentialIds(
      matchedAccounts.flatMap((account) => account?.passkeyCredentialIds || [])
    );
    const normalizedNewCredentialId = normalizePasskeyId(credentialIdB64u);
    const latestExistingCredentialId = pickLatestPasskeyCredentialId(matchedAccounts);
    const finalCredentialId = normalizedNewCredentialId || latestExistingCredentialId;
    const mergedPasskeyIds = finalCredentialId ? [finalCredentialId] : [];
    const passkeyUpdatedAtFromData = matchedAccounts.reduce((maxValue, account) => {
      return Math.max(maxValue, asTimestamp(account?.passkeyUpdatedAtMs, account?.createdAtMs));
    }, 0);
    const passkeyChanged = JSON.stringify(mergedPasskeyIds) !== JSON.stringify(existingPasskeyIds);
    const canonicalSite = primary?.canonicalSite || etldPlusOne(mergedSites[0] || domain);
    const hasExactUsernameMatch = matchedAccounts.some(
      (account) => normalizeUsername(account?.username || "") === username
    );
    const mergedUsername = hasExactUsernameMatch ? username : usernameField.value || username || normalizeUsername(primary?.username || "");
    const accountId = primary?.accountId || buildAccountId(canonicalSite, mergedUsername, safeCreatedAtMs);
    return {
      ...primary,
      recordId: normalizeRecordId(primary, accountId, safeCreatedAtMs),
      accountId,
      canonicalSite,
      usernameAtCreate: primary?.usernameAtCreate || normalizeUsername(primary?.username || "") || mergedUsername,
      isPinned: Boolean(primary?.isPinned),
      pinnedSortOrder: primary?.pinnedSortOrder == null ? null : Number(primary.pinnedSortOrder),
      regularSortOrder: primary?.regularSortOrder == null ? null : Number(primary.regularSortOrder),
      sites: mergedSites,
      username: mergedUsername,
      password: passwordField.value,
      totpSecret: totpField.value,
      recoveryCodes: recoveryField.value,
      note: noteField.value,
      usernameUpdatedAtMs: mergedUsername === usernameField.value ? usernameField.updatedAtMs : now,
      usernameUpdatedDeviceName: usernameField.deviceName || deviceName,
      passwordUpdatedAtMs: passwordField.updatedAtMs,
      passwordUpdatedDeviceName: passwordField.deviceName || deviceName,
      totpUpdatedAtMs: totpField.updatedAtMs,
      totpUpdatedDeviceName: totpField.deviceName || deviceName,
      recoveryCodesUpdatedAtMs: recoveryField.updatedAtMs,
      recoveryCodesUpdatedDeviceName: recoveryField.deviceName || deviceName,
      noteUpdatedAtMs: noteField.updatedAtMs,
      noteUpdatedDeviceName: noteField.deviceName || deviceName,
      passkeyCredentialIds: mergedPasskeyIds,
      passkeyUpdatedAtMs: passkeyChanged ? now : asTimestamp(passkeyUpdatedAtFromData, safeCreatedAtMs),
      passkeyUpdatedDeviceName: deviceName,
      isDeleted: false,
      deletedAtMs: null,
      lastOperatedDeviceName: deviceName,
      createdAtMs: safeCreatedAtMs,
      updatedAtMs: now
    };
  }
  function pickPrimaryAccountForMerge(accounts, fallbackTs) {
    if (!Array.isArray(accounts) || accounts.length === 0) return null;
    const sorted = accounts.map((account, index) => ({
      account,
      index,
      createdAtMs: asTimestamp(account?.createdAtMs, fallbackTs),
      accountId: String(account?.accountId || "")
    })).sort((a, b) => {
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
      if (a.accountId !== b.accountId) return a.accountId.localeCompare(b.accountId);
      return a.index - b.index;
    });
    return sorted[0]?.account || accounts[0];
  }
  function pickLatestTextField(accounts, valueKey, updatedAtKey, fallbackTs) {
    let best = null;
    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index];
      const value = String(account?.[valueKey] || "");
      const updatedAtMs = asTimestamp(account?.[updatedAtKey], account?.createdAtMs);
      const createdAtMs = asTimestamp(account?.createdAtMs, fallbackTs);
      const accountId = String(account?.accountId || "");
      if (!best) {
        best = { value, updatedAtMs, createdAtMs, accountId, index };
        continue;
      }
      if (updatedAtMs > best.updatedAtMs) {
        best = { value, updatedAtMs, createdAtMs, accountId, index };
        continue;
      }
      if (updatedAtMs < best.updatedAtMs) {
        continue;
      }
      if (createdAtMs < best.createdAtMs) {
        best = { value, updatedAtMs, createdAtMs, accountId, index };
        continue;
      }
      if (createdAtMs > best.createdAtMs) {
        continue;
      }
      if (accountId < best.accountId) {
        best = { value, updatedAtMs, createdAtMs, accountId, index };
        continue;
      }
      if (accountId > best.accountId) {
        continue;
      }
      if (index < best.index) {
        best = { value, updatedAtMs, createdAtMs, accountId, index };
      }
    }
    if (!best) {
      return { value: "", updatedAtMs: asTimestamp(fallbackTs, Date.now()) };
    }
    return {
      value: best.value,
      updatedAtMs: asTimestamp(best.updatedAtMs, fallbackTs)
    };
  }
  function pickLatestPasskeyCredentialId(accounts) {
    let best = "";
    let bestUpdatedAt = 0;
    const values = Array.isArray(accounts) ? accounts : [];
    for (const account of values) {
      const updatedAt = asTimestamp(account?.passkeyUpdatedAtMs, account?.updatedAtMs || account?.createdAtMs);
      const ids = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
      const candidate = ids[0] || "";
      if (!candidate) continue;
      if (!best || updatedAt > bestUpdatedAt) {
        best = candidate;
        bestUpdatedAt = updatedAt;
      }
    }
    return best;
  }
  function asTimestamp(value, fallbackTs = 0) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) {
      return number;
    }
    const fallback = Number(fallbackTs);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
  }
  function normalizePasskeyId(value) {
    return String(value || "").trim();
  }
  function normalizePasskeyCredentialIds(input) {
    const values = Array.isArray(input) ? input : [];
    return [...new Set(values.map(normalizePasskeyId).filter(Boolean))].sort();
  }
  function isUuidLower(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(value || ""));
  }
  function stableUuidFromText(input) {
    const raw = String(input || "");
    const seedParts = [2654435769, 2246822507, 3266489909, 668265263];
    for (let i = 0; i < raw.length; i += 1) {
      const code = raw.charCodeAt(i);
      const idx = i % 4;
      seedParts[idx] = Math.imul(seedParts[idx] ^ code, 73244475) >>> 0;
      seedParts[idx] = (seedParts[idx] ^ seedParts[idx] >>> 16) >>> 0;
    }
    const hex = seedParts.map((value) => value.toString(16).padStart(8, "0")).join("").slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  function normalizeRecordId(account, accountId, createdAtMs) {
    const direct = String(account?.recordId || account?.id || "").trim().toLowerCase();
    if (isUuidLower(direct)) return direct;
    const usernameSeed = String(account?.usernameAtCreate || account?.username || "").trim();
    return stableUuidFromText(`${String(accountId || "").trim()}|${Number(createdAtMs || 0)}|${usernameSeed}`);
  }
  function normalizeAccountShape(account) {
    const now = Date.now();
    const sites = normalizeSites(account?.sites || []);
    const canonicalSite = String(account?.canonicalSite || etldPlusOne(sites[0] || ""));
    const createdAtMs = asTimestamp(account?.createdAtMs, account?.updatedAtMs || now);
    const username = normalizeUsername(account?.username || "");
    const accountId = String(account?.accountId || buildAccountId(canonicalSite, username, createdAtMs));
    const passkeyCredentialIds = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
    return {
      ...account,
      recordId: normalizeRecordId(account, accountId, createdAtMs),
      accountId,
      canonicalSite,
      usernameAtCreate: normalizeUsername(account?.usernameAtCreate || username),
      isPinned: Boolean(account?.isPinned),
      pinnedSortOrder: account?.pinnedSortOrder == null ? null : Number(account.pinnedSortOrder),
      regularSortOrder: account?.regularSortOrder == null ? null : Number(account.regularSortOrder),
      folderId: account?.folderId == null ? null : String(account.folderId).trim().toLowerCase(),
      folderIds: Array.isArray(account?.folderIds) ? account.folderIds.map((id) => String(id || "").trim().toLowerCase()).filter(Boolean) : account?.folderId == null ? [] : [String(account.folderId).trim().toLowerCase()],
      folderMembershipStates: account?.folderMembershipStates && typeof account.folderMembershipStates === "object" ? account.folderMembershipStates : {},
      sites,
      siteAliasStates: account?.siteAliasStates && typeof account.siteAliasStates === "object" ? account.siteAliasStates : {},
      username,
      password: String(account?.password || ""),
      totpSecret: String(account?.totpSecret || ""),
      recoveryCodes: String(account?.recoveryCodes || ""),
      note: String(account?.note || ""),
      passkeyCredentialIds,
      passkeyLinkStates: account?.passkeyLinkStates && typeof account.passkeyLinkStates === "object" ? account.passkeyLinkStates : {},
      usernameUpdatedAtMs: asTimestamp(account?.usernameUpdatedAtMs, createdAtMs),
      usernameUpdatedDeviceName: normalizeUsername(account?.usernameUpdatedDeviceName || account?.lastOperatedDeviceName || "") || DEFAULT_DEVICE_NAME,
      passwordUpdatedAtMs: asTimestamp(account?.passwordUpdatedAtMs, createdAtMs),
      passwordUpdatedDeviceName: normalizeUsername(account?.passwordUpdatedDeviceName || account?.lastOperatedDeviceName || "") || DEFAULT_DEVICE_NAME,
      totpUpdatedAtMs: asTimestamp(account?.totpUpdatedAtMs, createdAtMs),
      totpUpdatedDeviceName: normalizeUsername(account?.totpUpdatedDeviceName || account?.lastOperatedDeviceName || "") || DEFAULT_DEVICE_NAME,
      recoveryCodesUpdatedAtMs: asTimestamp(account?.recoveryCodesUpdatedAtMs, createdAtMs),
      recoveryCodesUpdatedDeviceName: normalizeUsername(account?.recoveryCodesUpdatedDeviceName || account?.lastOperatedDeviceName || "") || DEFAULT_DEVICE_NAME,
      noteUpdatedAtMs: asTimestamp(account?.noteUpdatedAtMs, createdAtMs),
      noteUpdatedDeviceName: normalizeUsername(account?.noteUpdatedDeviceName || account?.lastOperatedDeviceName || "") || DEFAULT_DEVICE_NAME,
      passkeyUpdatedAtMs: asTimestamp(account?.passkeyUpdatedAtMs, createdAtMs),
      passkeyUpdatedDeviceName: normalizeUsername(account?.passkeyUpdatedDeviceName || account?.lastOperatedDeviceName || "") || DEFAULT_DEVICE_NAME,
      isDeleted: Boolean(account?.isDeleted),
      isPermanentlyDeleted: Boolean(account?.isPermanentlyDeleted),
      deletedAtMs: account?.deletedAtMs == null ? null : asTimestamp(account.deletedAtMs, 0),
      deletedDeviceName: normalizeUsername(account?.deletedDeviceName || "") || "",
      lastOperatedDeviceName: normalizeUsername(account?.lastOperatedDeviceName || "") || DEFAULT_DEVICE_NAME,
      createdDeviceName: normalizeUsername(account?.createdDeviceName || account?.lastOperatedDeviceName || "") || DEFAULT_DEVICE_NAME,
      createdAtMs,
      updatedAtMs: asTimestamp(account?.updatedAtMs, createdAtMs)
    };
  }
  function normalizePasskeyShape(item) {
    const now = Date.now();
    const normalizedCompat = normalizePasskeyCreateCompatMethod(item?.createCompatMethod, item?.alg);
    return {
      credentialIdB64u: String(item?.credentialIdB64u || item?.id || "").trim(),
      rpId: normalizeDomain(item?.rpId || ""),
      userName: normalizeUsername(item?.userName || item?.username || ""),
      displayName: String(item?.displayName || "").trim(),
      userHandleB64u: String(item?.userHandleB64u || ""),
      alg: Number(item?.alg || -7),
      signCount: Number(item?.signCount || 0),
      privateJwk: item?.privateJwk || null,
      publicJwk: item?.publicJwk || null,
      createdAtMs: Number(item?.createdAtMs || now),
      updatedAtMs: Number(item?.updatedAtMs || item?.createdAtMs || now),
      lastUsedAtMs: item?.lastUsedAtMs == null ? null : Number(item.lastUsedAtMs),
      mode: String(item?.mode || "managed"),
      createCompatMethod: normalizedCompat,
      isDeleted: Boolean(item?.isDeleted),
      isPermanentlyDeleted: Boolean(item?.isPermanentlyDeleted),
      deletedAtMs: item?.deletedAtMs == null ? null : Number(item.deletedAtMs),
      deletedDeviceName: String(item?.deletedDeviceName || "").trim()
    };
  }
  function normalizePasskeyCreateCompatMethod(input, alg) {
    const value = String(input || "").trim().toLowerCase();
    if (value === "standard" || value === "user_name_fallback" || value === "rs256" || value === "user_name_fallback+rs256" || value === "unknown_linked") {
      return value;
    }
    return Number(alg) === -257 ? "rs256" : "standard";
  }
  function normalizeFolderId(value) {
    return String(value || "").trim().toLowerCase();
  }
  function normalizeFolderIdList(values) {
    const source = Array.isArray(values) ? values : [];
    return [...new Set(source.map(normalizeFolderId).filter(Boolean))].sort();
  }
  function normalizeFolderShape(item) {
    const now = Date.now();
    const id = normalizeFolderId(item?.id || "");
    const rawName = String(item?.name || "").trim();
    const safeId = id || (globalThis.crypto?.randomUUID?.() || stableUuidFromText(`folder|${rawName}|${now}`)).toLowerCase();
    const createdAtMs = Number(item?.createdAtMs ?? now);
    const updatedAtMs = Number(item?.updatedAtMs ?? createdAtMs);
    const safeName = safeId === FIXED_NEW_ACCOUNT_FOLDER_ID ? FIXED_NEW_ACCOUNT_FOLDER_NAME : rawName || `\u672A\u547D\u540D\u6587\u4EF6\u5939 ${safeId.slice(0, 8)}`;
    return {
      id: safeId,
      name: safeName,
      matchedSites: normalizeSites(item?.matchedSites || []),
      autoAddMatchingSites: Boolean(item?.autoAddMatchingSites),
      isDeleted: Boolean(item?.isDeleted),
      isPermanentlyDeleted: Boolean(item?.isPermanentlyDeleted),
      deletedAtMs: item?.deletedAtMs == null ? null : Number(item.deletedAtMs),
      deletedDeviceName: String(item?.deletedDeviceName || "").trim(),
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : now,
      updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : Number.isFinite(createdAtMs) ? createdAtMs : now
    };
  }
  function sortFoldersForDisplay(inputFolders) {
    const folders = Array.isArray(inputFolders) ? inputFolders : [];
    return [...folders].sort((lhs, rhs) => {
      const lhsId = normalizeFolderId(lhs?.id);
      const rhsId = normalizeFolderId(rhs?.id);
      if (lhsId === FIXED_NEW_ACCOUNT_FOLDER_ID && rhsId !== FIXED_NEW_ACCOUNT_FOLDER_ID) return -1;
      if (rhsId === FIXED_NEW_ACCOUNT_FOLDER_ID && lhsId !== FIXED_NEW_ACCOUNT_FOLDER_ID) return 1;
      const lhsCreated = Number(lhs?.createdAtMs || 0);
      const rhsCreated = Number(rhs?.createdAtMs || 0);
      if (lhsCreated !== rhsCreated) return lhsCreated - rhsCreated;
      return String(lhs?.name || "").localeCompare(String(rhs?.name || ""));
    });
  }
  function extractAccountFolderIds(account) {
    if (Array.isArray(account?.folderIds) && account.folderIds.length > 0) {
      return account.folderIds.map((id) => String(id || ""));
    }
    if (account?.folderId != null) {
      return [String(account.folderId)];
    }
    return [];
  }
  function buildUnifiedPasskeys(accountsInput, passkeysInput) {
    const now = Date.now();
    const accounts = Array.isArray(accountsInput) ? accountsInput.map(normalizeAccountShape) : [];
    const storedPasskeys = Array.isArray(passkeysInput) ? passkeysInput.map(normalizePasskeyShape) : [];
    const linkedById = /* @__PURE__ */ new Map();
    for (const account of accounts) {
      const ids = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
      if (ids.length === 0) continue;
      const rpId = normalizeDomain(account?.sites && account.sites[0] || account?.canonicalSite || "");
      const userName = normalizeUsername(account?.username || account?.usernameAtCreate || "");
      const createdAtMs = Number(account?.createdAtMs || now);
      for (const rawId of ids) {
        const credentialIdB64u = String(rawId || "").trim();
        if (!credentialIdB64u) continue;
        const existing = linkedById.get(credentialIdB64u);
        if (existing) {
          if (!existing.rpId && rpId) existing.rpId = rpId;
          if (!existing.userName && userName) existing.userName = userName;
          continue;
        }
        linkedById.set(credentialIdB64u, {
          credentialIdB64u,
          rpId,
          userName,
          displayName: "",
          userHandleB64u: "",
          alg: -7,
          signCount: 0,
          privateJwk: null,
          publicJwk: null,
          createdAtMs,
          updatedAtMs: 0,
          lastUsedAtMs: null,
          mode: "linked-account",
          createCompatMethod: "unknown_linked"
        });
      }
    }
    const linkedPasskeys = Array.from(linkedById.values()).filter((item) => String(item.rpId || "").trim().length > 0);
    return mergePasskeyCollections2(storedPasskeys, linkedPasskeys);
  }
  function mergeAccountCollections2(local, remote) {
    return mergeAccountCollections(local, remote, syncMergeHelpers());
  }
  function mergePasskeyCollections2(local, remote) {
    return mergePasskeyCollections(local, remote, syncMergeHelpers());
  }
  function mergeFolderCollections2(local, remote) {
    return mergeFolderCollections(local, remote, syncMergeHelpers());
  }
  function reconcileAccountFolders2(accounts, folders) {
    return reconcileAccountFolders(accounts, folders, syncMergeHelpers());
  }
  function syncMergeHelpers() {
    return {
      normalizeAccountShape,
      normalizeFolderIdList,
      normalizeFolderId,
      extractAccountFolderIds,
      normalizeSites,
      etldPlusOne,
      normalizePasskeyCredentialIds,
      stableUuidFromText,
      normalizePasskeyShape,
      normalizePasskeyCreateCompatMethod,
      normalizeFolderShape,
      sortFoldersForDisplay,
      fixedNewAccountFolderId: FIXED_NEW_ACCOUNT_FOLDER_ID,
      fixedNewAccountFolderName: FIXED_NEW_ACCOUNT_FOLDER_NAME
    };
  }
  function validateSyncSafety(local, remote, merged, mode = SYNC_MODE_MERGE) {
    return evaluateSyncSafety({ local, remote, merged, mode }, syncMergeHelpers());
  }
  function parseSyncBundlePayload(input, { requireBundleSchema = false } = {}) {
    if (!input || typeof input !== "object") return null;
    const schema = String(input?.schema || "");
    const hasSchema = schema.length > 0;
    if (hasSchema && schema !== SYNC_BUNDLE_SCHEMA_V2) return null;
    if (requireBundleSchema && !hasSchema) return null;
    const rawPayload = hasSchema ? input.payload : input;
    if (!rawPayload || typeof rawPayload !== "object") return null;
    return {
      accounts: Array.isArray(rawPayload.accounts) ? rawPayload.accounts : [],
      passkeys: Array.isArray(rawPayload.passkeys) ? rawPayload.passkeys : [],
      folders: Array.isArray(rawPayload.folders) ? rawPayload.folders : []
    };
  }
  async function getDeviceName() {
    const result = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
    return normalizeDeviceName(result[STORAGE_KEY_DEVICE_NAME]);
  }
  async function getOrCreateSyncDeviceId() {
    const result = await chrome.storage.local.get([STORAGE_KEY_SYNC_DEVICE_ID]);
    const existing = String(result[STORAGE_KEY_SYNC_DEVICE_ID] || "").trim().toLowerCase();
    if (isUuidLower(existing)) return existing;
    const generated = secureRandomUuid().toLowerCase();
    await chrome.storage.local.set({ [STORAGE_KEY_SYNC_DEVICE_ID]: generated });
    return generated;
  }
  async function buildSyncBundleFromPayload(payload) {
    const [deviceName, deviceId] = await Promise.all([getDeviceName(), getOrCreateSyncDeviceId()]);
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts.map(normalizeAccountShape) : [];
    const rawPasskeys = Array.isArray(payload?.passkeys) ? payload.passkeys.map(normalizePasskeyShape) : [];
    const passkeys = buildUnifiedPasskeys(accounts, rawPasskeys);
    const folders = Array.isArray(payload?.folders) ? payload.folders.map(normalizeFolderShape) : [];
    return {
      schema: SYNC_BUNDLE_SCHEMA_V2,
      exportedAtMs: Date.now(),
      source: {
        app: "pass-extension",
        platform: "chrome-extension",
        deviceName,
        deviceId,
        logicalClockMs: Date.now(),
        formatVersion: 2
      },
      payload: sortSyncPayloadCollections({ accounts, passkeys, folders })
    };
  }
  function base64EncodeUtf8(input) {
    const bytes = new TextEncoder().encode(String(input || ""));
    let binary = "";
    for (const value of bytes) {
      binary += String.fromCharCode(value);
    }
    return btoa(binary);
  }
  async function pullRemotePayload(target) {
    const headers = { Accept: "application/json" };
    if (target.authHeader) headers.Authorization = target.authHeader;
    let response;
    try {
      response = await fetch(target.url, { method: "GET", headers, cache: "no-store" });
    } catch (error) {
      logSyncFlow("pull-fetch-error", {
        label: target.label,
        url: target.url,
        name: error?.name || "Error",
        message: error?.message || String(error || ""),
        stack: error?.stack || "",
        online: typeof navigator !== "undefined" ? navigator.onLine : null
      });
      throw new Error(`\u62C9\u53D6\u8FDC\u7AEF\u5931\u8D25\uFF08${target.label} ${target.url}\uFF09\uFF1A${error?.message || error}`);
    }
    logSyncFlow("pull-http-response", {
      label: target.label,
      url: target.url,
      status: response.status,
      etag: response.headers.get("ETag")
    });
    if (response.status === 404) return { payload: null, etag: null, encrypted: false };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!String(text || "").trim()) {
      return { payload: null, etag: response.headers.get("ETag"), encrypted: false };
    }
    const key = await getOrCreateSyncEncryptionKey();
    const fallbackKeys = await getSyncDecryptionFallbackKeys();
    const envelope = JSON.parse(text);
    const encrypted = String(envelope?.schema || "") === "pass.sync.encrypted.v1";
    const parsed = await decryptSyncBundleDocument(envelope, key, fallbackKeys);
    const payload = parseSyncBundlePayload(parsed, { requireBundleSchema: true });
    if (!payload) throw new Error("\u8FDC\u7AEF\u6570\u636E\u683C\u5F0F\u9519\u8BEF\uFF0C\u4EC5\u652F\u6301 pass.sync.bundle.v2");
    return { payload, etag: response.headers.get("ETag"), encrypted };
  }
  function updateRemoteConcurrencyState(target, etag) {
    const normalizedEtag = typeof etag === "string" && etag.trim() ? etag : null;
    target.remoteEtag = normalizedEtag;
    if (target.kind === "webdav") {
      target.supportsEtag = Boolean(normalizedEtag);
    }
  }
  async function verifySelfHostedWriteReceipt(response, idempotencyKey) {
    const scope = response.headers.get("X-Sync-Scope");
    const etag = response.headers.get("ETag");
    const payloadSha256 = response.headers.get("X-Payload-Sha256");
    if (!scope || !etag || !payloadSha256) {
      throw new Error("\u670D\u52A1\u5668\u672A\u8FD4\u56DE\u53EF\u9A8C\u8BC1\u7684\u540C\u6B65\u63D0\u4EA4\u56DE\u6267");
    }
    let receipt;
    try {
      receipt = await response.json();
    } catch {
      throw new Error("\u670D\u52A1\u5668\u63D0\u4EA4\u56DE\u6267\u4E0D\u662F\u6709\u6548 JSON");
    }
    if (!receipt?.ok || !receipt?.committed || receipt.scope !== scope || receipt.etag !== etag || receipt.payloadSha256 !== payloadSha256 || !Number.isInteger(receipt.revision) || receipt.revision < 1 || idempotencyKey && receipt.idempotencyKey !== idempotencyKey) {
      throw new Error("\u670D\u52A1\u5668\u63D0\u4EA4\u56DE\u6267\u6821\u9A8C\u5931\u8D25");
    }
    return etag;
  }
  async function pushRemotePayload(target, payload, ifMatch = null, idempotencyKey = null) {
    if (target.remoteEncrypted && target.remotePayload && syncPayloadEquals(target.remotePayload, payload)) {
      return { etag: target.remoteEtag, skipped: true };
    }
    const bundle = await buildSyncBundleFromPayload(payload);
    const encryptedBundle = await encryptSyncBundleDocument(bundle, await getOrCreateSyncEncryptionKey());
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (target.authHeader) headers.Authorization = target.authHeader;
    if (ifMatch) headers["If-Match"] = ifMatch;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let response;
    try {
      response = await fetch(target.url, {
        method: "PUT",
        headers,
        body: JSON.stringify(encryptedBundle, null, 2)
      });
    } catch (error) {
      logSyncFlow("push-fetch-error", {
        label: target.label,
        url: target.url,
        name: error?.name || "Error",
        message: error?.message || String(error || ""),
        stack: error?.stack || "",
        online: typeof navigator !== "undefined" ? navigator.onLine : null
      });
      throw new Error(`\u4E0A\u4F20\u8FDC\u7AEF\u5931\u8D25\uFF08${target.label} ${target.url}\uFF09\uFF1A${error?.message || error}`);
    }
    logSyncFlow("push-http-response", {
      label: target.label,
      url: target.url,
      status: response.status,
      etag: response.headers.get("ETag"),
      ifMatch
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const confirmedEtag = target.kind === "server" ? await verifySelfHostedWriteReceipt(response, idempotencyKey) : response.headers.get("ETag");
    target.remotePayload = payload;
    target.remoteEncrypted = true;
    return { etag: confirmedEtag };
  }
  async function getOrCreateSyncEncryptionKey() {
    const secrets = await migrateLegacySyncSecrets();
    return normalizeSyncEncryptionKey(secrets.encryptionKey);
  }
  async function getSyncDecryptionFallbackKeys() {
    const secrets = await migrateLegacySyncSecrets();
    const previous = normalizeSyncEncryptionKey(secrets.previousEncryptionKey);
    const current = normalizeSyncEncryptionKey(secrets.encryptionKey);
    return previous && previous !== current ? [previous] : [];
  }
  async function pushRemotePayloadWithRetry(target, payload) {
    let candidate = payload;
    const idempotencyKey = createSyncIdempotencyKey();
    for (let attempt = 0; attempt < SYNC_PUSH_CONFLICT_MAX_ATTEMPTS; attempt += 1) {
      try {
        const pushResult = await pushRemotePayload(target, candidate, target.remoteEtag, idempotencyKey);
        updateRemoteConcurrencyState(target, pushResult.etag);
        target.remotePayload = candidate;
        target.remoteEncrypted = true;
        return { payload: candidate };
      } catch (error) {
        if (!target.supportsEtag || error?.status !== 412 || attempt === 2) throw error;
      }
      const latestResponse = await pullRemotePayload(target);
      updateRemoteConcurrencyState(target, latestResponse.etag);
      target.remotePayload = latestResponse.payload;
      target.remoteEncrypted = latestResponse.encrypted;
      const remotePayload = latestResponse.payload || { accounts: [], passkeys: [], folders: [] };
      const localAccounts = Array.isArray(candidate.accounts) ? candidate.accounts.map(normalizeAccountShape) : [];
      const localPasskeys = buildUnifiedPasskeys(localAccounts, Array.isArray(candidate.passkeys) ? candidate.passkeys.map(normalizePasskeyShape) : []);
      const localFolders = Array.isArray(candidate.folders) ? candidate.folders.map(normalizeFolderShape) : [];
      const remoteAccounts = remotePayload.accounts.map(normalizeAccountShape);
      const remotePasskeys = buildUnifiedPasskeys(remoteAccounts, remotePayload.passkeys);
      const remoteFolders = remotePayload.folders.map(normalizeFolderShape);
      let mergedFolders = mergeFolderCollections2(localFolders, remoteFolders);
      let mergedAccounts = mergeAccountCollections2(localAccounts, remoteAccounts);
      mergedAccounts = syncAliasGroups2(mergedAccounts);
      mergedAccounts = reconcileAccountFolders2(mergedAccounts, mergedFolders);
      let mergedPasskeys = mergePasskeyCollections2(localPasskeys, remotePasskeys);
      mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, mergedPasskeys);
      candidate = { accounts: mergedAccounts, passkeys: mergedPasskeys, folders: mergedFolders };
      const safety = validateSyncSafety(
        { accounts: localAccounts, folders: localFolders, passkeys: localPasskeys },
        remotePayload,
        candidate,
        SYNC_MODE_MERGE
      );
      if (!safety.safe) {
        logSyncFlow("push-retry-aborted-safety-check", { reasons: safety.reasons });
        throw new Error(`\u5E76\u53D1\u91CD\u8BD5\u5408\u5E76\u88AB\u5B89\u5168\u68C0\u67E5\u963B\u6B62: ${safety.reasons.join(",")}`);
      }
      await writeBusinessDataToStore(candidate);
    }
    throw new Error("\u8FDC\u7AEF\u5E76\u53D1\u51B2\u7A81\u91CD\u8BD5\u6B21\u6570\u5DF2\u7528\u5C3D");
  }
  async function pushRemotePayloadWithMode(target, payload, syncMode) {
    if (syncMode !== SYNC_MODE_MERGE) {
      const pushResult = await pushRemotePayload(target, payload, null, createSyncIdempotencyKey());
      updateRemoteConcurrencyState(target, pushResult.etag);
      target.remotePayload = payload;
      target.remoteEncrypted = true;
      return { payload };
    }
    return pushRemotePayloadWithRetry(target, payload);
  }
  function createAccount({ site, username, password, createdAtMs, deviceName }) {
    const normalizedSite = normalizeDomain(site);
    const canonical = etldPlusOne(normalizedSite);
    const accountId = buildAccountId(canonical, username, createdAtMs);
    const fixedFolderId = FIXED_NEW_ACCOUNT_FOLDER_ID;
    return {
      recordId: stableUuidFromText(`${accountId}|${createdAtMs}|${username}`),
      accountId,
      canonicalSite: canonical,
      usernameAtCreate: username,
      isPinned: false,
      pinnedSortOrder: null,
      regularSortOrder: null,
      folderId: fixedFolderId,
      folderIds: [fixedFolderId],
      sites: normalizeSites([normalizedSite]),
      username,
      password,
      totpSecret: "",
      recoveryCodes: "",
      note: "",
      passkeyCredentialIds: [],
      usernameUpdatedAtMs: createdAtMs,
      usernameUpdatedDeviceName: deviceName,
      passwordUpdatedAtMs: createdAtMs,
      passwordUpdatedDeviceName: deviceName,
      totpUpdatedAtMs: createdAtMs,
      totpUpdatedDeviceName: deviceName,
      recoveryCodesUpdatedAtMs: createdAtMs,
      recoveryCodesUpdatedDeviceName: deviceName,
      noteUpdatedAtMs: createdAtMs,
      noteUpdatedDeviceName: deviceName,
      passkeyUpdatedAtMs: createdAtMs,
      passkeyUpdatedDeviceName: deviceName,
      isDeleted: false,
      deletedAtMs: null,
      deletedDeviceName: "",
      lastOperatedDeviceName: deviceName,
      createdDeviceName: deviceName,
      createdAtMs,
      updatedAtMs: createdAtMs
    };
  }
  function accountMatchesDomain(account, domain) {
    const normalized = normalizeDomain(domain);
    const sites = normalizeSites([
      ...Array.isArray(account?.sites) ? account.sites : [],
      account?.canonicalSite || ""
    ]);
    return Boolean(normalized) && sites.some((site) => domainsMatch(site, normalized));
  }
})();
