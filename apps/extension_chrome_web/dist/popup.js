(() => {
  // ../../core/pass_core/js/sync_policy.js
  var DEFAULT_DEVICE_NAME = "PassDevice";
  var FIXED_NEW_ACCOUNT_FOLDER_ID = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";
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
  var SYNC_OUTBOX_MAX_DELAY_MS = 60 * 60 * 1e3;
  function normalizeDeviceName(value, fallback = DEFAULT_DEVICE_NAME) {
    const trimmed = String(value || "").trim();
    return trimmed || fallback;
  }

  // ../../core/pass_core/js/sync_alias_core.js
  function syncAliasGroups(accounts2, helpers, options = {}) {
    if (!Array.isArray(accounts2) || accounts2.length < 2) {
      return { accounts: accounts2, changed: false };
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
    const n = accounts2.length;
    const siteSets = accounts2.map((a) => {
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
    const next = accounts2.map((a) => ({ ...a }));
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
        // Keep the common shorthand used by older records linked to the same
        // Microsoft sign-in provider as the fully qualified host names.
        "microsoftonline",
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
  function isPinnedAccount(account) {
    return Boolean(account?.isPinned);
  }
  function compareAccountsForDisplay(lhs, rhs) {
    const lhsPinned = isPinnedAccount(lhs);
    const rhsPinned = isPinnedAccount(rhs);
    if (lhsPinned !== rhsPinned) {
      return lhsPinned ? -1 : 1;
    }
    const lhsUpdatedAt = Number(lhs?.updatedAtMs || 0);
    const rhsUpdatedAt = Number(rhs?.updatedAtMs || 0);
    if (lhsUpdatedAt !== rhsUpdatedAt) return rhsUpdatedAt - lhsUpdatedAt;
    if (lhsPinned && rhsPinned) {
      const lo = lhs?.pinnedSortOrder;
      const ro = rhs?.pinnedSortOrder;
      if (lo != null && ro != null && lo !== ro) return lo - ro;
      if (lo != null && ro == null) return -1;
      if (lo == null && ro != null) return 1;
    } else {
      const lo = lhs?.regularSortOrder;
      const ro = rhs?.regularSortOrder;
      if (lo != null && ro != null && lo !== ro) return lo - ro;
      if (lo != null && ro == null) return -1;
      if (lo == null && ro != null) return 1;
    }
    const lhsCreatedAt = Number(lhs?.createdAtMs || 0);
    const rhsCreatedAt = Number(rhs?.createdAtMs || 0);
    if (lhsCreatedAt !== rhsCreatedAt) return rhsCreatedAt - lhsCreatedAt;
    return String(lhs?.accountId || "").localeCompare(String(rhs?.accountId || ""));
  }
  function sortAccountsForDisplay(inputAccounts) {
    return [...Array.isArray(inputAccounts) ? inputAccounts : []].sort(compareAccountsForDisplay);
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

  // data_store.js
  var DB_NAME = "pass.local.db.v1";
  var DB_VERSION = 1;
  var STORE_COLLECTIONS = "collections";
  var COLLECTION_ACCOUNTS = "accounts";
  var COLLECTION_PASSKEYS = "passkeys";
  var COLLECTION_FOLDERS = "folders";
  var COLLECTION_HISTORY = "history";
  var HISTORY_MAX_ENTRIES = 500;
  var LEGACY_STORAGE_KEY_ACCOUNTS = "pass.accounts";
  var LEGACY_STORAGE_KEY_PASSKEYS = "pass.passkeys";
  var LEGACY_STORAGE_KEY_FOLDERS = "pass.folders";
  var STORAGE_KEY_MIGRATION_DONE = "pass.data.migratedToIndexedDb.v1";
  var STORAGE_KEY_ENCRYPTION_KEY = "pass.data.encryptionKey.v1";
  var STORAGE_KEY_WRAPPED_ENCRYPTION_KEY = "pass.data.wrappedEncryptionKey.v2";
  var STORAGE_KEY_SESSION_ENCRYPTION_KEY = "pass.data.sessionEncryptionKey.v2";
  var STORAGE_KEY_DATA_BUMP = "pass.data.bump.v1";
  var dbPromise = null;
  var readyPromise = null;
  var unlockedEncryptionKey = null;
  var encryptionKeyPromise = null;
  function sanitizeHistoryAction(value) {
    const action = String(value || "").trim();
    if (!action) return "";
    const normalized = action.replace(/:/g, "\uFF1A");
    if (/(创建账号|created account)\s*[（(][\s\S]*?(密码改为|password\s*(?:changed|to)|password was set to)[\s\S]*?[）)]/i.test(normalized)) {
      return "\u65B0\u5EFA\u8D26\u53F7";
    }
    const separator = normalized.indexOf("\uFF1A");
    const prefix = separator >= 0 ? `${normalized.slice(0, separator)}\uFF1A` : "";
    if (/(密码改为|password\s*(?:changed|to)|password was set to)/i.test(normalized)) {
      return `${prefix}\u5BC6\u7801\u5DF2\u4FEE\u6539`;
    }
    if (/(TOTP\s*改为|totp\s*(?:changed|to)|otp\s*(?:changed|to))/i.test(normalized)) {
      return `${prefix}TOTP \u5DF2\u4FEE\u6539`;
    }
    if (/(恢复码改为|recovery(?:\s*codes?)?\s*(?:changed|to))/i.test(normalized)) {
      return `${prefix}\u6062\u590D\u7801\u5DF2\u4FEE\u6539`;
    }
    if (/(备注改为|note\s*(?:changed|to)|notes?\s*(?:changed|to))/i.test(normalized)) {
      return `${prefix}\u5907\u6CE8\u5DF2\u4FEE\u6539`;
    }
    return action;
  }
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
    await writeCollectionRows([{ key, value }]);
  }
  async function encryptCollectionRow(key, value) {
    const cryptoKey = await loadOrCreateEncryptionKey();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(Array.isArray(value) ? value : []));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(key) },
      cryptoKey,
      plaintext
    );
    return {
      key,
      version: 1,
      nonceBase64: bytesToBase64(nonce),
      ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext))
    };
  }
  async function writeCollectionRows(entries) {
    const rows = await Promise.all(entries.map((entry) => encryptCollectionRow(entry.key, entry.value)));
    const db = await openDatabase();
    const tx = db.transaction(STORE_COLLECTIONS, "readwrite");
    const store = tx.objectStore(STORE_COLLECTIONS);
    for (const row of rows) store.put(row);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  }
  async function loadOrCreateEncryptionKey() {
    if (unlockedEncryptionKey) return unlockedEncryptionKey;
    if (encryptionKeyPromise) return encryptionKeyPromise;
    encryptionKeyPromise = (async () => {
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
    })().catch((error) => {
      encryptionKeyPromise = null;
      throw error;
    });
    return encryptionKeyPromise;
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
  async function lockDataEncryption() {
    unlockedEncryptionKey = null;
    encryptionKeyPromise = null;
    await chrome.storage.session.remove(STORAGE_KEY_SESSION_ENCRYPTION_KEY);
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
      const [accounts2, passkeys2, folders2] = await Promise.all([
        readCollectionForMigration(COLLECTION_ACCOUNTS, legacyAccounts),
        readCollectionForMigration(COLLECTION_PASSKEYS, legacyPasskeys),
        readCollectionForMigration(COLLECTION_FOLDERS, legacyFolders)
      ]);
      await migrateLegacyCollections({ accounts: accounts2, passkeys: passkeys2, folders: folders2 }, legacy);
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
  async function setAccounts(accounts2) {
    await ensureDataStorageReady();
    await writeCollection(COLLECTION_ACCOUNTS, accounts2);
    await touchDataBump(COLLECTION_ACCOUNTS);
  }
  async function getPasskeys() {
    await ensureDataStorageReady();
    return await readCollection(COLLECTION_PASSKEYS);
  }
  async function setPasskeys(passkeys2) {
    await ensureDataStorageReady();
    await writeCollection(COLLECTION_PASSKEYS, passkeys2);
    await touchDataBump(COLLECTION_PASSKEYS);
  }
  async function getFolders() {
    await ensureDataStorageReady();
    return await readCollection(COLLECTION_FOLDERS);
  }
  async function getHistory() {
    await ensureDataStorageReady();
    const rawEntries = await readCollection(COLLECTION_HISTORY);
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    const normalized = entries.filter((item) => item && typeof item === "object").map((item) => ({
      id: String(item.id || ""),
      timestampMs: Number(item.timestampMs || 0),
      action: sanitizeHistoryAction(item.action)
    })).filter((item) => item.timestampMs > 0 && item.action.trim().length > 0).sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    });
    const needsMigration = entries.length !== normalized.length || entries.some(
      (item, index) => String(item?.action || "").trim() !== normalized[index]?.action
    );
    if (needsMigration) {
      await writeCollection(COLLECTION_HISTORY, normalized);
      await touchDataBump(COLLECTION_HISTORY);
    }
    return normalized;
  }
  async function setHistory(entries) {
    await ensureDataStorageReady();
    const normalized = (Array.isArray(entries) ? entries : []).filter((item) => item && typeof item === "object").map((item) => ({
      id: String(item.id || ""),
      timestampMs: Number(item.timestampMs || 0),
      action: sanitizeHistoryAction(item.action)
    })).filter((item) => item.timestampMs > 0 && item.action.length > 0).sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    }).slice(0, HISTORY_MAX_ENTRIES);
    await writeCollection(COLLECTION_HISTORY, normalized);
    await touchDataBump(COLLECTION_HISTORY);
  }
  async function appendHistoryEntry({ timestampMs, action }) {
    const normalizedAction = sanitizeHistoryAction(action);
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

  // lock_state.js
  var STORAGE_KEY_LOCK_ENABLED = "pass.lock.enabled";
  var STORAGE_KEY_LOCK_POLICY = "pass.lock.policy";
  var STORAGE_KEY_LOCK_IDLE_MINUTES = "pass.lock.idleMinutes";
  var STORAGE_KEY_LOCK_MASTER_CREDENTIAL = "pass.lock.masterCredential.v1";
  var LOCK_POLICY_ONCE_UNTIL_QUIT = "onceUntilQuit";
  var LOCK_POLICY_IDLE_TIMEOUT = "idleTimeout";
  var LOCK_POLICY_ON_BACKGROUND = "onBackground";
  var LOCK_IDLE_MINUTES_DEFAULT = 5;
  var LOCK_IDLE_MINUTES_MIN = 1;
  var LOCK_IDLE_MINUTES_MAX = 60;
  var LOCK_STATE_CHANGED_MESSAGE = "PASS_LOCK_STATE_CHANGED";
  var LOCK_STORAGE_KEYS = /* @__PURE__ */ new Set([
    STORAGE_KEY_LOCK_ENABLED,
    STORAGE_KEY_LOCK_POLICY,
    STORAGE_KEY_LOCK_IDLE_MINUTES,
    STORAGE_KEY_LOCK_MASTER_CREDENTIAL
  ]);
  function normalizeLockPolicy(value) {
    const policy = String(value || "").trim();
    if (policy === LOCK_POLICY_IDLE_TIMEOUT) return LOCK_POLICY_IDLE_TIMEOUT;
    if (policy === LOCK_POLICY_ON_BACKGROUND) return LOCK_POLICY_ON_BACKGROUND;
    return LOCK_POLICY_ONCE_UNTIL_QUIT;
  }
  function clampLockIdleMinutes(value) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return LOCK_IDLE_MINUTES_DEFAULT;
    return Math.min(Math.max(parsed, LOCK_IDLE_MINUTES_MIN), LOCK_IDLE_MINUTES_MAX);
  }
  async function applyLockStateChangedMessage(message, { lock, clear, unlock } = {}) {
    if (message?.type !== LOCK_STATE_CHANGED_MESSAGE) return false;
    if (message?.payload?.locked) {
      try {
        await lock?.();
      } finally {
        await clear?.();
      }
      return "locked";
    }
    await unlock?.();
    return "unlocked";
  }
  function createLockStateTransitionQueue() {
    let pending = Promise.resolve();
    return (message, callbacks) => {
      pending = pending.catch(() => {
      }).then(() => applyLockStateChangedMessage(message, callbacks));
      return pending;
    };
  }

  // popup.js
  var STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
  var TOTP_PERIOD_SECONDS = 30;
  var TOTP_DIGITS = 6;
  var TOTP_REFRESH_INTERVAL_MS = 1e3;
  var POPUP_TOAST_DURATION_MS = 3e3;
  var dom = {
    openCreateModalBtn: document.getElementById("openCreateModal"),
    openSortModalBtn: document.getElementById("openSortModal"),
    modeActiveBtn: document.getElementById("modeActive"),
    modeAllBtn: document.getElementById("modeAll"),
    modeRecycleBtn: document.getElementById("modeRecycle"),
    modePasskeyBtn: document.getElementById("modePasskey"),
    accountSearchSection: document.getElementById("accountSearchSection"),
    accountSearchFieldsBtn: document.getElementById("accountSearchFieldsBtn"),
    accountSearchFieldsPanel: document.getElementById("accountSearchFieldsPanel"),
    accountSearchFieldAll: document.getElementById("accountSearchFieldAll"),
    accountSearchFieldUsername: document.getElementById("accountSearchFieldUsername"),
    accountSearchFieldSites: document.getElementById("accountSearchFieldSites"),
    accountSearchFieldNote: document.getElementById("accountSearchFieldNote"),
    accountSearchFieldPassword: document.getElementById("accountSearchFieldPassword"),
    accountSearch: document.getElementById("accountSearch"),
    createSiteInput: document.getElementById("createSite"),
    createUsernameInput: document.getElementById("createUsername"),
    createPasswordInput: document.getElementById("createPassword"),
    createTotpInput: document.getElementById("createTotp"),
    createTotpPasteRawBtn: document.getElementById("createTotpPasteRawBtn"),
    createTotpPasteUriBtn: document.getElementById("createTotpPasteUriBtn"),
    createTotpPasteQrBtn: document.getElementById("createTotpPasteQrBtn"),
    createAccountBtn: document.getElementById("createAccount"),
    closeCreateModalBtn: document.getElementById("closeCreateModal"),
    createModal: document.getElementById("createModal"),
    closeSortModalBtn: document.getElementById("closeSortModal"),
    sortModal: document.getElementById("sortModal"),
    sortModalList: document.getElementById("sortModalList"),
    closeHistoryModalBtn: document.getElementById("closeHistoryModal"),
    historyModal: document.getElementById("historyModal"),
    historyModalList: document.getElementById("historyModalList"),
    lockOverlay: document.getElementById("lockOverlay"),
    lockMessage: document.getElementById("lockMessage"),
    unlockPasswordInput: document.getElementById("unlockPasswordInput"),
    unlockBtn: document.getElementById("unlockBtn"),
    openOptionsFromLockBtn: document.getElementById("openOptionsFromLockBtn"),
    passkeySection: document.getElementById("passkeySection"),
    passkeyCurrentSiteOnly: document.getElementById("passkeyCurrentSiteOnly"),
    passkeySearch: document.getElementById("passkeySearch"),
    passkeyList: document.getElementById("passkeyList"),
    accountList: document.getElementById("accountList"),
    status: document.getElementById("popupStatus")
  };
  var currentDomain = "";
  var accounts = [];
  var folders = [];
  var passkeys = [];
  var editingAccountId = null;
  var viewMode = "accounts";
  var totpRefreshTimer = null;
  var accountSearchUseAll = true;
  var accountSearchFields = /* @__PURE__ */ new Set();
  var popupToastTimer = null;
  var sortModalOrderIds = [];
  var sortModalDraggingAccountId = "";
  var historyEntries = [];
  var lockSettings = {
    enabled: false,
    policy: LOCK_POLICY_ONCE_UNTIL_QUIT,
    idleMinutes: LOCK_IDLE_MINUTES_DEFAULT,
    credential: null
  };
  var isPopupLocked = false;
  var popupLockMessage = "";
  var lockIdleTimer = null;
  var lockLastActivityAtMs = Date.now();
  var lockOperationInFlight = false;
  var enqueueLockStateTransition = createLockStateTransitionQueue();
  init().catch((error) => {
    console.error("[Pass popup] \u521D\u59CB\u5316\u5931\u8D25", error);
    const detail = [error?.name, error?.code, error?.message, String(error)].map((value) => String(value || "").trim()).filter((value, index, values) => value && values.indexOf(value) === index).join(" | ");
    setStatus(`\u521D\u59CB\u5316\u5931\u8D25: ${detail || "\u672A\u77E5\u9519\u8BEF\uFF0C\u8BF7\u67E5\u770B\u6269\u5C55 Service Worker \u63A7\u5236\u53F0"}\uFF1B\u6570\u636E\u672A\u88AB\u4FEE\u6539`);
  });
  async function init() {
    await resolveCurrentDomain();
    await loadLockSettingsFromStorage();
    bindEvents();
    renderLockOverlay();
    scheduleIdleAutoLockCheck();
    startTotpRefreshTicker();
    chrome.storage.onChanged.addListener(handleStorageChanged);
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    if (isLockedForInteraction()) return;
    await Promise.all([
      ensureDataStorageReady(),
      loadAccounts(),
      loadFolders(),
      loadHistory(),
      loadPasskeys()
    ]);
    renderAccounts();
  }
  function handleRuntimeMessage(message) {
    if (message?.type !== LOCK_STATE_CHANGED_MESSAGE) return;
    void enqueueLockStateTransition(message, {
      lock: async () => {
        setPopupLockedState(true, "\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u8BF7\u8F93\u5165\u4E3B\u5BC6\u7801\u89E3\u9501\u3002");
        await lockDataEncryption();
      },
      clear: clearPopupSensitiveState,
      unlock: resumePopupAfterExternalUnlock
    }).catch((error) => {
      console.warn("[Pass popup] \u9501\u72B6\u6001\u5207\u6362\u5931\u8D25", error);
    });
  }
  function clearPopupSensitiveState() {
    accounts = [];
    folders = [];
    passkeys = [];
    historyEntries = [];
    editingAccountId = null;
    sortModalOrderIds = [];
    sortModalDraggingAccountId = "";
    closeCreateModal();
    closeSortModal();
    closeHistoryModal();
    closeAccountSearchFieldsPanel();
  }
  async function resumePopupAfterExternalUnlock() {
    await loadLockSettingsFromStorage();
    if (isLockedForInteraction()) return;
    await Promise.all([
      ensureDataStorageReady(),
      loadAccounts(),
      loadFolders(),
      loadHistory(),
      loadPasskeys()
    ]);
    renderAccounts();
  }
  function handleStorageChanged(changes, areaName) {
    if (areaName !== "local") return;
    let shouldRender = false;
    if (changes[STORAGE_KEY_DATA_BUMP]) {
      void reloadBusinessData();
    }
    const lockChanged = Object.keys(changes).some((key) => LOCK_STORAGE_KEYS.has(key));
    if (lockChanged) {
      void loadLockSettingsFromStorage({
        relockIfEnabled: true,
        relockMessage: "\u89E3\u9501\u8BBE\u7F6E\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u91CD\u65B0\u8F93\u5165\u4E3B\u5BC6\u7801"
      });
      shouldRender = false;
    }
    if (shouldRender) {
      renderAccounts();
      if (!dom.sortModal.classList.contains("modal-hidden")) {
        renderSortModalList();
      }
    }
  }
  async function reloadBusinessData() {
    await Promise.all([loadAccounts(), loadFolders(), loadPasskeys(), loadHistory()]);
    renderAccounts();
    if (!dom.sortModal.classList.contains("modal-hidden")) {
      renderSortModalList();
    }
    if (!dom.historyModal.classList.contains("modal-hidden")) {
      renderHistoryModalList();
    }
  }
  function bindEvents() {
    dom.openCreateModalBtn.addEventListener("click", openCreateModal);
    dom.openSortModalBtn.addEventListener("click", openSortModal);
    dom.createAccountBtn.addEventListener("click", createAccountFromInputs);
    dom.createTotpPasteRawBtn.addEventListener("click", () => {
      void pasteRawTotpSecretFromClipboard({
        totpInput: dom.createTotpInput
      });
    });
    dom.createTotpPasteUriBtn.addEventListener("click", () => {
      void pasteOtpAuthUriFromClipboard({
        totpInput: dom.createTotpInput,
        sitesInput: dom.createSiteInput,
        usernameInput: dom.createUsernameInput
      });
    });
    dom.createTotpPasteQrBtn.addEventListener("click", () => {
      void pasteOtpAuthQrFromClipboard({
        totpInput: dom.createTotpInput,
        sitesInput: dom.createSiteInput,
        usernameInput: dom.createUsernameInput
      });
    });
    dom.closeCreateModalBtn.addEventListener("click", closeCreateModal);
    dom.closeSortModalBtn.addEventListener("click", closeSortModal);
    dom.closeHistoryModalBtn.addEventListener("click", closeHistoryModal);
    dom.createModal.addEventListener("click", (event) => {
      if (event.target === dom.createModal) {
        closeCreateModal();
      }
    });
    dom.sortModal.addEventListener("click", (event) => {
      if (event.target === dom.sortModal) {
        closeSortModal();
      }
    });
    dom.historyModal.addEventListener("click", (event) => {
      if (event.target === dom.historyModal) {
        closeHistoryModal();
      }
    });
    dom.unlockBtn.addEventListener("click", () => {
      void unlockPopupWithPassword();
    });
    dom.unlockPasswordInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void unlockPopupWithPassword();
    });
    dom.openOptionsFromLockBtn.addEventListener("click", () => {
      void chrome.runtime.openOptionsPage();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !dom.createModal.classList.contains("modal-hidden")) {
        closeCreateModal();
        return;
      }
      if (event.key === "Escape" && !dom.sortModal.classList.contains("modal-hidden")) {
        closeSortModal();
        return;
      }
      if (event.key === "Escape" && !dom.historyModal.classList.contains("modal-hidden")) {
        closeHistoryModal();
        return;
      }
      if (event.key === "Escape" && !dom.accountSearchFieldsPanel.classList.contains("hidden")) {
        closeAccountSearchFieldsPanel();
      }
      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) {
        if (isMultilineInputTarget(event.target)) return;
        const actionButton = findDefaultActionButtonForPopup();
        if (actionButton && !actionButton.disabled) {
          event.preventDefault();
          actionButton.click();
        }
      }
    });
    dom.accountSearchFieldsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      dom.accountSearchFieldsPanel.classList.toggle("hidden");
      syncAccountSearchFieldCheckboxes();
    });
    dom.accountSearchFieldAll.addEventListener("change", onAccountSearchFieldAllChanged);
    dom.accountSearchFieldUsername.addEventListener("change", onAccountSearchFieldChanged);
    dom.accountSearchFieldSites.addEventListener("change", onAccountSearchFieldChanged);
    dom.accountSearchFieldNote.addEventListener("change", onAccountSearchFieldChanged);
    dom.accountSearchFieldPassword.addEventListener("change", onAccountSearchFieldChanged);
    dom.accountSearchFieldsPanel.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    document.addEventListener("click", (event) => {
      if (dom.accountSearchFieldsPanel.classList.contains("hidden")) return;
      if (dom.accountSearchSection.contains(event.target)) return;
      closeAccountSearchFieldsPanel();
    });
    dom.modeActiveBtn.addEventListener("click", () => setViewMode("accounts"));
    dom.modeAllBtn.addEventListener("click", () => setViewMode("all"));
    dom.modeRecycleBtn.addEventListener("click", () => setViewMode("recycle"));
    dom.modePasskeyBtn.addEventListener("click", () => setViewMode("passkeys"));
    dom.accountSearch.addEventListener("input", renderAccounts);
    dom.passkeyCurrentSiteOnly.addEventListener("change", renderAccounts);
    dom.passkeySearch.addEventListener("input", renderAccounts);
    bindLockRuntimeEvents();
  }
  function bindLockRuntimeEvents() {
    const activityEvents = ["mousedown", "keydown", "scroll", "touchstart"];
    for (const eventName of activityEvents) {
      document.addEventListener(eventName, () => {
        registerPopupActivity();
      }, true);
    }
    window.addEventListener("focus", () => {
      registerPopupActivity();
    });
    window.addEventListener("blur", () => {
      if (document.hidden) return;
      lockForBackgroundIfNeeded("\u6269\u5C55\u5207\u5230\u540E\u53F0\uFF0C\u5DF2\u9501\u5B9A");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        lockForBackgroundIfNeeded("\u6269\u5C55\u5207\u5230\u540E\u53F0\uFF0C\u5DF2\u9501\u5B9A");
        return;
      }
      registerPopupActivity();
    });
  }
  function isMultilineInputTarget(target) {
    return target instanceof HTMLTextAreaElement || target?.isContentEditable;
  }
  function findDefaultActionButtonForPopup() {
    if (!dom.lockOverlay.classList.contains("hidden")) {
      return dom.unlockBtn;
    }
    if (!dom.createModal.classList.contains("modal-hidden")) {
      return dom.createAccountBtn;
    }
    return null;
  }
  function registerPopupActivity() {
    if (!isLockFeatureEnabled()) return;
    if (isPopupLocked) return;
    lockLastActivityAtMs = Date.now();
    void chrome.runtime.sendMessage({ type: "PASS_LOCK_ACTIVITY" });
    scheduleIdleAutoLockCheck();
  }
  function clearIdleLockTimer() {
    if (lockIdleTimer == null) return;
    clearTimeout(lockIdleTimer);
    lockIdleTimer = null;
  }
  function scheduleIdleAutoLockCheck() {
    clearIdleLockTimer();
    if (!isLockFeatureEnabled()) return;
    if (isPopupLocked) return;
    if (lockSettings.policy !== LOCK_POLICY_IDLE_TIMEOUT) return;
    const timeoutMs = lockSettings.idleMinutes * 60 * 1e3;
    lockIdleTimer = window.setTimeout(() => {
      lockIdleTimer = null;
      if (!isLockFeatureEnabled() || isPopupLocked) return;
      const idleForMs = Date.now() - lockLastActivityAtMs;
      if (idleForMs >= timeoutMs) {
        void chrome.runtime.sendMessage({ type: "PASS_LOCK_NOW" });
        setPopupLockedState(true, `\u8D85\u8FC7 ${lockSettings.idleMinutes} \u5206\u949F\u65E0\u64CD\u4F5C\uFF0C\u5DF2\u9501\u5B9A`);
        setStatus(`\u8D85\u8FC7 ${lockSettings.idleMinutes} \u5206\u949F\u65E0\u64CD\u4F5C\uFF0C\u5DF2\u9501\u5B9A`);
        return;
      }
      scheduleIdleAutoLockCheck();
    }, timeoutMs + 120);
  }
  function lockForBackgroundIfNeeded(reason) {
    if (!isLockFeatureEnabled()) return;
    if (isPopupLocked) return;
    if (lockSettings.policy !== LOCK_POLICY_ON_BACKGROUND) return;
    void chrome.runtime.sendMessage({ type: "PASS_LOCK_NOW" });
    setPopupLockedState(true, reason);
    setStatus(reason);
  }
  function isLockFeatureEnabled() {
    return Boolean(lockSettings.enabled && lockSettings.credential);
  }
  function isLockedForInteraction() {
    return isLockFeatureEnabled() && isPopupLocked;
  }
  function renderLockOverlay() {
    const showOverlay = isLockedForInteraction();
    dom.lockOverlay.classList.toggle("hidden", !showOverlay);
    dom.lockOverlay.setAttribute("aria-hidden", String(!showOverlay));
    dom.lockMessage.textContent = popupLockMessage || "\u8BF7\u8F93\u5165\u4E3B\u5BC6\u7801\u89E3\u9501\u3002";
    if (showOverlay) {
      dom.unlockPasswordInput.focus();
    }
  }
  function setPopupLockedState(nextLocked, message = "") {
    const lockEnabled = isLockFeatureEnabled();
    const locked = lockEnabled && Boolean(nextLocked);
    isPopupLocked = locked;
    popupLockMessage = locked ? message || "\u8BF7\u8F93\u5165\u4E3B\u5BC6\u7801\u89E3\u9501\u3002" : "";
    if (locked) {
      closeCreateModal();
      closeSortModal();
      closeHistoryModal();
      closeAccountSearchFieldsPanel();
      dom.unlockPasswordInput.value = "";
      clearIdleLockTimer();
    } else {
      registerPopupActivity();
    }
    renderLockOverlay();
    renderAccounts();
  }
  async function loadLockSettingsFromStorage({ relockIfEnabled = false, relockMessage = "" } = {}) {
    const result = await chrome.storage.local.get([
      STORAGE_KEY_LOCK_ENABLED,
      STORAGE_KEY_LOCK_POLICY,
      STORAGE_KEY_LOCK_IDLE_MINUTES,
      STORAGE_KEY_LOCK_MASTER_CREDENTIAL
    ]);
    lockSettings = {
      enabled: Boolean(result[STORAGE_KEY_LOCK_ENABLED]),
      policy: normalizeLockPolicy(result[STORAGE_KEY_LOCK_POLICY]),
      idleMinutes: clampLockIdleMinutes(result[STORAGE_KEY_LOCK_IDLE_MINUTES]),
      credential: normalizeLockMasterCredential(result[STORAGE_KEY_LOCK_MASTER_CREDENTIAL])
    };
    if (!isLockFeatureEnabled()) {
      setPopupLockedState(false);
      return;
    }
    if (relockIfEnabled) {
      await chrome.runtime.sendMessage({ type: "PASS_LOCK_NOW" });
      setPopupLockedState(true, relockMessage || "\u8BF7\u8F93\u5165\u4E3B\u5BC6\u7801\u89E3\u9501\u3002");
      return;
    }
    const status = await chrome.runtime.sendMessage({ type: "PASS_LOCK_STATUS" });
    setPopupLockedState(Boolean(status?.locked), status?.locked ? "\u8BF7\u8F93\u5165\u4E3B\u5BC6\u7801\u89E3\u9501\u3002" : "");
    if (!status?.locked) return;
    scheduleIdleAutoLockCheck();
    renderLockOverlay();
  }
  async function unlockPopupWithPassword() {
    if (!isLockFeatureEnabled()) {
      setPopupLockedState(false);
      return;
    }
    if (lockOperationInFlight) return;
    const password = String(dom.unlockPasswordInput.value || "");
    if (!password) {
      setStatus("\u8BF7\u8F93\u5165\u4E3B\u5BC6\u7801");
      return;
    }
    lockOperationInFlight = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "PASS_LOCK_UNLOCK",
        payload: { password }
      });
      if (!response?.ok || response?.locked) {
        popupLockMessage = "\u4E3B\u5BC6\u7801\u9519\u8BEF";
        renderLockOverlay();
        setStatus("\u4E3B\u5BC6\u7801\u9519\u8BEF");
        return;
      }
      const refreshed = await chrome.storage.local.get([STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
      lockSettings.credential = normalizeLockMasterCredential(refreshed[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
      setPopupLockedState(false);
      await Promise.all([
        ensureDataStorageReady(),
        loadAccounts(),
        loadFolders(),
        loadHistory(),
        loadPasskeys()
      ]);
      renderAccounts();
      setStatus("\u6269\u5C55\u5DF2\u89E3\u9501");
    } finally {
      lockOperationInFlight = false;
    }
  }
  function setViewMode(nextMode) {
    viewMode = nextMode;
    if (viewMode !== "accounts" && viewMode !== "all") {
      editingAccountId = null;
      closeCreateModal();
      closeSortModal();
    }
    if (viewMode === "passkeys") {
      closeAccountSearchFieldsPanel();
    }
    renderAccounts();
  }
  function openCreateModal() {
    if (isLockedForInteraction()) {
      setStatus("\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u8BF7\u5148\u89E3\u9501");
      return;
    }
    if (viewMode !== "accounts" && viewMode !== "all") return;
    const suggestedSite = getSuggestedCreateSite();
    dom.createSiteInput.value = suggestedSite;
    dom.createModal.classList.remove("modal-hidden");
    dom.createModal.setAttribute("aria-hidden", "false");
    dom.createSiteInput.focus();
  }
  function closeCreateModal() {
    dom.createModal.classList.add("modal-hidden");
    dom.createModal.setAttribute("aria-hidden", "true");
  }
  function openSortModal() {
    if (isLockedForInteraction()) {
      setStatus("\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u8BF7\u5148\u89E3\u9501");
      return;
    }
    if (viewMode !== "accounts" && viewMode !== "all") return;
    const visibleAccounts = getVisibleAccountsForCurrentMode();
    if (visibleAccounts.length === 0) {
      setStatus("\u5F53\u524D\u5217\u8868\u6CA1\u6709\u53EF\u6392\u5E8F\u8D26\u53F7");
      return;
    }
    sortModalOrderIds = visibleAccounts.map((account) => String(account.accountId || ""));
    sortModalDraggingAccountId = "";
    renderSortModalList();
    dom.sortModal.classList.remove("modal-hidden");
    dom.sortModal.setAttribute("aria-hidden", "false");
  }
  function closeSortModal() {
    sortModalDraggingAccountId = "";
    sortModalOrderIds = [];
    dom.sortModal.classList.add("modal-hidden");
    dom.sortModal.setAttribute("aria-hidden", "true");
    dom.sortModalList.innerHTML = "";
  }
  async function openHistoryModal() {
    await loadHistory();
    renderHistoryModalList();
    dom.historyModal.classList.remove("modal-hidden");
    dom.historyModal.setAttribute("aria-hidden", "false");
  }
  function closeHistoryModal() {
    dom.historyModal.classList.add("modal-hidden");
    dom.historyModal.setAttribute("aria-hidden", "true");
    dom.historyModalList.innerHTML = "";
  }
  function renderHistoryModalList() {
    dom.historyModalList.innerHTML = "";
    if (historyEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "\u6682\u65E0\u5386\u53F2\u8BB0\u5F55";
      dom.historyModalList.appendChild(empty);
      return;
    }
    for (const entry of historyEntries) {
      const item = document.createElement("div");
      item.className = "history-modal-item";
      const time = document.createElement("div");
      time.className = "history-modal-item-time";
      time.textContent = formatTime(entry.timestampMs);
      item.appendChild(time);
      const action = document.createElement("div");
      action.className = "history-modal-item-action";
      action.textContent = entry.action;
      item.appendChild(action);
      dom.historyModalList.appendChild(item);
    }
  }
  function closeAccountSearchFieldsPanel() {
    dom.accountSearchFieldsPanel.classList.add("hidden");
  }
  function getSuggestedCreateSite() {
    if (!currentDomain) return "";
    return etldPlusOne(currentDomain) || currentDomain;
  }
  async function resolveCurrentDomain() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = activeTab?.url || "";
    currentDomain = normalizeDomain(url);
  }
  async function getDeviceName() {
    const stored = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
    const value = String(stored[STORAGE_KEY_DEVICE_NAME] || "").trim();
    return normalizeDeviceName(value);
  }
  async function loadAccounts() {
    const raw = await getAccounts();
    accounts = raw.map(normalizeAccountShape);
  }
  async function loadFolders() {
    const raw = await getFolders();
    folders = (Array.isArray(raw) ? raw : []).map(normalizeFolderShape);
  }
  async function loadPasskeys() {
    const raw = await getPasskeys();
    passkeys = raw.map(normalizePasskeyShape);
  }
  async function loadHistory() {
    const raw = await getHistory();
    historyEntries = (Array.isArray(raw) ? raw : []).map((item) => ({
      id: String(item?.id || ""),
      timestampMs: Number(item?.timestampMs || 0),
      action: String(item?.action || "").trim()
    })).filter((item) => item.timestampMs > 0 && item.action.length > 0).sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    });
  }
  async function appendHistory(action, timestampMs = Date.now()) {
    const normalizedAction = String(action || "").trim();
    if (!normalizedAction) return;
    await appendHistoryEntry({ action: normalizedAction, timestampMs });
    if (!dom.historyModal.classList.contains("modal-hidden")) {
      await loadHistory();
      renderHistoryModalList();
    }
  }
  async function persistAccounts(nextAccounts) {
    accounts = nextAccounts.map(normalizeAccountShape);
    await setAccounts(accounts);
  }
  async function persistPasskeys(nextPasskeys) {
    passkeys = nextPasskeys.map(normalizePasskeyShape);
    await setPasskeys(passkeys);
  }
  function normalizeFolderShape(folder) {
    return {
      id: String(folder?.id || "").trim().toLowerCase(),
      name: String(folder?.name || "").trim(),
      matchedSites: normalizeSites(folder?.matchedSites || []),
      autoAddMatchingSites: Boolean(folder?.autoAddMatchingSites)
    };
  }
  function applyAutoFolderRulesToAccount(account) {
    if (!account || account.isDeleted) return account;
    const accountSites = normalizeSites([
      ...Array.isArray(account?.sites) ? account.sites : [],
      account?.canonicalSite || ""
    ]);
    if (accountSites.length === 0) return account;
    const matchedFolderIds = folders.filter((folder) => folder.autoAddMatchingSites).filter((folder) => folder.matchedSites.some(
      (folderSite) => accountSites.some((accountSite) => domainsMatch(accountSite, folderSite))
    )).map((folder) => String(folder.id || "")).filter(Boolean);
    if (matchedFolderIds.length === 0) return account;
    const nextFolderIds = normalizeFolderIdList([
      ...Array.isArray(account.folderIds) ? account.folderIds : account.folderId ? [account.folderId] : [],
      ...matchedFolderIds
    ]);
    return {
      ...account,
      folderId: nextFolderIds[0] || null,
      folderIds: nextFolderIds
    };
  }
  function normalizeAccountShape(account) {
    const now = Date.now();
    const sites = normalizeSites(account.sites || []);
    const passkeyCredentialIds = normalizePasskeyCredentialIds(account.passkeyCredentialIds || []);
    const canonical = account.canonicalSite || etldPlusOne(sites[0] || "");
    const createdAtMs = Number(account.createdAtMs || account.updatedAtMs || now);
    const username = account.username || "";
    const accountId = account.accountId || buildAccountId(canonical, username, createdAtMs);
    const recordId = normalizeRecordId(account, accountId, createdAtMs);
    return {
      recordId,
      accountId,
      canonicalSite: canonical,
      usernameAtCreate: account.usernameAtCreate || username,
      isPinned: Boolean(account.isPinned),
      pinnedSortOrder: account.pinnedSortOrder == null ? null : Number(account.pinnedSortOrder),
      regularSortOrder: account.regularSortOrder == null ? null : Number(account.regularSortOrder),
      folderId: account.folderId == null ? null : String(account.folderId),
      folderIds: Array.isArray(account.folderIds) ? account.folderIds.map((id) => String(id)) : account.folderId == null ? [] : [String(account.folderId)],
      sites,
      username,
      password: account.password || "",
      totpSecret: account.totpSecret || "",
      recoveryCodes: account.recoveryCodes || "",
      note: account.note || "",
      passkeyCredentialIds,
      usernameUpdatedAtMs: Number(account.usernameUpdatedAtMs || createdAtMs),
      usernameUpdatedDeviceName: String(account.usernameUpdatedDeviceName || account.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      passwordUpdatedAtMs: Number(account.passwordUpdatedAtMs || createdAtMs),
      passwordUpdatedDeviceName: String(account.passwordUpdatedDeviceName || account.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      totpUpdatedAtMs: Number(account.totpUpdatedAtMs || createdAtMs),
      totpUpdatedDeviceName: String(account.totpUpdatedDeviceName || account.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      recoveryCodesUpdatedAtMs: Number(account.recoveryCodesUpdatedAtMs || createdAtMs),
      recoveryCodesUpdatedDeviceName: String(account.recoveryCodesUpdatedDeviceName || account.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      noteUpdatedAtMs: Number(account.noteUpdatedAtMs || createdAtMs),
      noteUpdatedDeviceName: String(account.noteUpdatedDeviceName || account.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      passkeyUpdatedAtMs: Number(account.passkeyUpdatedAtMs || createdAtMs),
      passkeyUpdatedDeviceName: String(account.passkeyUpdatedDeviceName || account.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      isDeleted: Boolean(account.isDeleted),
      isPermanentlyDeleted: Boolean(account.isPermanentlyDeleted),
      deletedAtMs: account.deletedAtMs == null ? null : Number(account.deletedAtMs),
      deletedDeviceName: String(account.deletedDeviceName || "").trim(),
      lastOperatedDeviceName: account.lastOperatedDeviceName || DEFAULT_DEVICE_NAME,
      createdDeviceName: String(account.createdDeviceName || account.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      createdAtMs,
      updatedAtMs: Number(account.updatedAtMs || createdAtMs)
    };
  }
  function normalizePasskeyShape(item) {
    const now = Date.now();
    return {
      credentialIdB64u: String(item?.credentialIdB64u || item?.id || ""),
      rpId: normalizeDomain(item?.rpId || ""),
      userName: String(item?.userName || item?.username || "").trim(),
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
      createCompatMethod: normalizePasskeyCreateCompatMethod(item?.createCompatMethod, item?.alg)
    };
  }
  function renderAccounts() {
    const locked = isLockedForInteraction();
    const showPasskeyMode = viewMode === "passkeys";
    const showRecycleBinMode = viewMode === "recycle";
    const showAllAccountsMode = viewMode === "all";
    const showAccountMode = viewMode === "accounts";
    dom.modeActiveBtn.classList.toggle("mode-btn-active", showAccountMode);
    dom.modeAllBtn.classList.toggle("mode-btn-active", showAllAccountsMode);
    dom.modeRecycleBtn.classList.toggle("mode-btn-active", showRecycleBinMode);
    dom.modePasskeyBtn.classList.toggle("mode-btn-active", showPasskeyMode);
    dom.openCreateModalBtn.classList.toggle("hidden", locked || !(showAccountMode || showAllAccountsMode));
    dom.openSortModalBtn.classList.toggle("hidden", locked || !(showAccountMode || showAllAccountsMode));
    dom.accountSearchSection.classList.toggle("hidden", locked || showPasskeyMode);
    dom.passkeySection.classList.toggle("passkey-hidden", locked || !showPasskeyMode);
    dom.accountList.style.display = showPasskeyMode ? "none" : "grid";
    if (!editingAccountId) {
      closeHistoryModal();
    }
    if (locked) {
      closeSortModal();
      dom.accountList.innerHTML = "";
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u8BF7\u5148\u8F93\u5165\u4E3B\u5BC6\u7801\u89E3\u9501\u3002";
      dom.accountList.appendChild(empty);
      return;
    }
    if (showPasskeyMode) {
      closeSortModal();
      renderPasskeyList();
      return;
    }
    dom.accountList.innerHTML = "";
    const visibleAccounts = getVisibleAccountsForCurrentMode();
    if (visibleAccounts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      if (showAllAccountsMode) {
        empty.textContent = "\u6682\u65E0\u8D26\u53F7\u3002";
      } else if (!currentDomain) {
        empty.textContent = "\u5F53\u524D\u9875\u9762\u65E0\u7AD9\u70B9\u4FE1\u606F\uFF0C\u65E0\u6CD5\u5339\u914D\u8D26\u53F7\u3002";
      } else if (showRecycleBinMode) {
        empty.textContent = "\u5F53\u524D\u7AD9\u70B9\u5728\u56DE\u6536\u7AD9\u4E2D\u6CA1\u6709\u5339\u914D\u8D26\u53F7\u3002";
      } else {
        empty.textContent = "\u5F53\u524D\u7AD9\u70B9\u6CA1\u6709\u5339\u914D\u8D26\u53F7\u3002";
      }
      dom.accountList.appendChild(empty);
      return;
    }
    for (const account of visibleAccounts) {
      const card = document.createElement("article");
      card.className = "account";
      if (!showRecycleBinMode && isPinnedAccount2(account)) {
        card.classList.add("account-pinned");
      }
      const titleRow = document.createElement("div");
      titleRow.className = "account-title-row";
      const title = document.createElement("strong");
      title.textContent = account.accountId;
      titleRow.appendChild(title);
      card.appendChild(titleRow);
      const meta = document.createElement("div");
      meta.className = "meta";
      const sitesMultilineHtml = toMultilineHtml((account.sites || []).join("\n"));
      meta.innerHTML = `\u7528\u6237\u540D: ${escapeHtml(account.username || "-")}<br/>\u7AD9\u70B9\u522B\u540D:<div class="meta-multiline">${sitesMultilineHtml}</div>`;
      card.appendChild(meta);
      const totpCopyBtn = hasTotpSecret(account.totpSecret) ? createTotpCopyButton({
        accountId: account.accountId,
        username: account.username,
        totpSecret: account.totpSecret
      }) : null;
      const actions = document.createElement("div");
      actions.className = "actions";
      if (!showRecycleBinMode) {
        const aliasBtn = document.createElement("button");
        aliasBtn.textContent = "\u52A0\u5165\u5F53\u524D\u57DF\u540D";
        aliasBtn.addEventListener("click", () => addCurrentDomainToAccount(account.accountId));
        actions.appendChild(aliasBtn);
        const copyBtn = document.createElement("button");
        copyBtn.textContent = "\u590D\u5236\u5BC6\u7801";
        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(account.password || "");
            setStatus(`\u5DF2\u590D\u5236 ${account.username} \u7684\u5BC6\u7801`);
          } catch (error) {
            setStatus(`\u590D\u5236\u5931\u8D25: ${error.message}`);
          }
        });
        actions.appendChild(copyBtn);
        const fillBtn = document.createElement("button");
        fillBtn.textContent = "\u586B\u5145\u5F53\u524D\u9875";
        const hasUsername = Boolean(String(account.username || "").trim());
        const domainOk = !showAllAccountsMode || isAccountMatchCurrentDomain(account, currentDomain);
        const canFill = hasUsername && domainOk;
        fillBtn.disabled = !canFill;
        if (!hasUsername) {
          fillBtn.title = "\u8BE5\u8D26\u53F7\u6CA1\u6709\u7528\u6237\u540D\uFF0C\u65E0\u6CD5\u586B\u5145";
        } else if (!domainOk) {
          fillBtn.title = "\u4EC5\u5141\u8BB8\u586B\u5145\u4E0E\u5F53\u524D\u9875\u9762\u57DF\u540D\u5339\u914D\u7684\u8D26\u53F7";
        } else {
          fillBtn.title = "";
        }
        fillBtn.addEventListener("click", () => fillCurrentPage(account));
        actions.appendChild(fillBtn);
        const editBtn = document.createElement("button");
        editBtn.textContent = editingAccountId === account.accountId ? "\u6536\u8D77\u7F16\u8F91" : "\u7F16\u8F91";
        editBtn.addEventListener("click", () => {
          editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
          renderAccounts();
        });
        actions.appendChild(editBtn);
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "\u5220\u9664\u8D26\u53F7";
        deleteBtn.addEventListener("click", () => moveToRecycleBin(account.accountId));
        actions.appendChild(deleteBtn);
        if (totpCopyBtn) {
          actions.appendChild(totpCopyBtn);
        }
      } else {
        const restoreBtn = document.createElement("button");
        restoreBtn.textContent = "\u6062\u590D\u8D26\u53F7";
        restoreBtn.addEventListener("click", () => restoreFromRecycleBin(account.accountId));
        actions.appendChild(restoreBtn);
        const permanentDeleteBtn = document.createElement("button");
        permanentDeleteBtn.textContent = "\u6C38\u4E45\u5220\u9664";
        permanentDeleteBtn.addEventListener("click", () => permanentlyDelete(account.accountId));
        actions.appendChild(permanentDeleteBtn);
        if (totpCopyBtn) {
          actions.appendChild(totpCopyBtn);
        }
      }
      card.appendChild(actions);
      if (!showRecycleBinMode && editingAccountId === account.accountId) {
        card.appendChild(buildEditor(account));
      }
      dom.accountList.appendChild(card);
    }
    void refreshVisibleTotpButtons();
  }
  function getVisibleAccountsForCurrentMode({ includeSearch = true } = {}) {
    const showRecycleBinMode = viewMode === "recycle";
    const showAllAccountsMode = viewMode === "all";
    let visibleAccounts = showRecycleBinMode ? accounts.filter((account) => account.isDeleted && !account.isPermanentlyDeleted) : accounts.filter((account) => !account.isDeleted && !account.isPermanentlyDeleted);
    if (!showAllAccountsMode) {
      visibleAccounts = visibleAccounts.filter(
        (account) => isAccountMatchCurrentDomain(account, currentDomain)
      );
    }
    if (includeSearch) {
      const accountQuery = String(dom.accountSearch.value || "").trim().toLowerCase();
      if (accountQuery) {
        visibleAccounts = visibleAccounts.filter(
          (account) => isAccountMatchSearch(account, accountQuery)
        );
      }
    }
    return sortAccountsForDisplay(visibleAccounts);
  }
  function renderSortModalList() {
    dom.sortModalList.innerHTML = "";
    const accountById = new Map(accounts.map((account) => [String(account.accountId || ""), account]));
    const normalizedOrder = sortModalOrderIds.map((accountId) => String(accountId || "")).filter((accountId) => accountById.has(accountId));
    sortModalOrderIds = normalizedOrder;
    if (normalizedOrder.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "\u5F53\u524D\u5217\u8868\u6CA1\u6709\u53EF\u6392\u5E8F\u8D26\u53F7";
      dom.sortModalList.appendChild(empty);
      return;
    }
    for (const accountId of normalizedOrder) {
      const account = accountById.get(accountId);
      if (!account) continue;
      const item = document.createElement("div");
      item.className = "sort-modal-item";
      item.draggable = true;
      item.dataset.accountId = accountId;
      const row = document.createElement("div");
      row.className = "sort-modal-item-row";
      const label = document.createElement("span");
      label.className = "sort-modal-item-label";
      label.textContent = formatSortableAccountLabel(account);
      row.appendChild(label);
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "pin-btn sort-modal-pin-btn";
      const pinned = isPinnedAccount2(account);
      pinBtn.textContent = pinned ? "\u53D6\u6D88\u7F6E\u9876" : "\u7F6E\u9876";
      pinBtn.classList.toggle("is-unpin", pinned);
      pinBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void togglePin(accountId, { fromSortModal: true });
      });
      row.appendChild(pinBtn);
      item.appendChild(row);
      item.addEventListener("dragstart", (event) => {
        sortModalDraggingAccountId = accountId;
        if (event.dataTransfer) {
          event.dataTransfer.setData("text/plain", accountId);
          event.dataTransfer.effectAllowed = "move";
        }
      });
      item.addEventListener("dragover", (event) => {
        if (!sortModalDraggingAccountId || sortModalDraggingAccountId === accountId) return;
        if (!isSamePinnedGroupForSort(accountById, sortModalDraggingAccountId, accountId)) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        item.classList.add("sort-modal-item-target");
      });
      item.addEventListener("dragleave", () => {
        item.classList.remove("sort-modal-item-target");
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        item.classList.remove("sort-modal-item-target");
        const sourceId = sortModalDraggingAccountId;
        sortModalDraggingAccountId = "";
        if (!sourceId || sourceId === accountId) return;
        if (!isSamePinnedGroupForSort(accountById, sourceId, accountId)) {
          setStatus("\u4EC5\u652F\u6301\u7F6E\u9876\u9879\u4E4B\u95F4\u3001\u975E\u7F6E\u9876\u9879\u4E4B\u95F4\u6392\u5E8F");
          return;
        }
        const from = sortModalOrderIds.indexOf(sourceId);
        const to = sortModalOrderIds.indexOf(accountId);
        if (from < 0 || to < 0) return;
        sortModalOrderIds.splice(from, 1);
        sortModalOrderIds.splice(to, 0, sourceId);
        renderSortModalList();
        void persistSortOrderFromModal(sortModalOrderIds);
      });
      item.addEventListener("dragend", () => {
        sortModalDraggingAccountId = "";
        const highlighted = dom.sortModalList.querySelectorAll(".sort-modal-item-target");
        highlighted.forEach((node) => node.classList.remove("sort-modal-item-target"));
      });
      dom.sortModalList.appendChild(item);
    }
  }
  function isSamePinnedGroupForSort(accountById, sourceId, targetId) {
    const source = accountById.get(String(sourceId || ""));
    const target = accountById.get(String(targetId || ""));
    if (!source || !target) return false;
    return isPinnedAccount2(source) === isPinnedAccount2(target);
  }
  function formatSortableAccountLabel(account) {
    const site = etldPlusOne(account?.canonicalSite || account?.sites?.[0] || "") || "-";
    const createdText = formatYYMMDDHHmmss(Number(account?.createdAtMs || 0));
    const username = String(account?.username || "");
    return `${site}-${createdText}-${username}`;
  }
  async function persistSortOrderFromModal(orderedIds) {
    const normalizedOrderedIds = [...new Set((Array.isArray(orderedIds) ? orderedIds : []).map((value) => String(value || "")).filter(Boolean))];
    if (normalizedOrderedIds.length === 0) return;
    const next = accounts.map((item) => ({ ...item, sites: [...item.sites || []] }));
    const now = Date.now();
    const deviceName = await getDeviceName();
    let changed = false;
    const pinnedSubset = [];
    const regularSubset = [];
    for (const accountId of normalizedOrderedIds) {
      const target = next.find((item) => String(item.accountId || "") === accountId);
      if (!target || target.isDeleted) continue;
      if (isPinnedAccount2(target)) {
        pinnedSubset.push(accountId);
      } else {
        regularSubset.push(accountId);
      }
    }
    const allPinnedIds = sortAccountsForDisplay(
      next.filter((item) => !item.isDeleted && isPinnedAccount2(item))
    ).map((item) => String(item.accountId || ""));
    const allRegularIds = sortAccountsForDisplay(
      next.filter((item) => !item.isDeleted && !isPinnedAccount2(item))
    ).map((item) => String(item.accountId || ""));
    const mergedPinnedIds = buildMergedOrderIds(allPinnedIds, pinnedSubset);
    const mergedRegularIds = buildMergedOrderIds(allRegularIds, regularSubset);
    for (let i = 0; i < mergedPinnedIds.length; i += 1) {
      const id = mergedPinnedIds[i];
      const item = next.find((entry) => String(entry.accountId || "") === id);
      if (!item) continue;
      const currentOrder = item.pinnedSortOrder == null ? null : Number(item.pinnedSortOrder);
      if (currentOrder === i) continue;
      item.pinnedSortOrder = i;
      item.updatedAtMs = now;
      item.lastOperatedDeviceName = deviceName;
      changed = true;
    }
    for (let i = 0; i < mergedRegularIds.length; i += 1) {
      const id = mergedRegularIds[i];
      const item = next.find((entry) => String(entry.accountId || "") === id);
      if (!item) continue;
      const currentOrder = item.regularSortOrder == null ? null : Number(item.regularSortOrder);
      if (currentOrder === i) continue;
      item.regularSortOrder = i;
      item.updatedAtMs = now;
      item.lastOperatedDeviceName = deviceName;
      changed = true;
    }
    if (!changed) return;
    await persistAccounts(next);
    renderAccounts();
  }
  function buildMergedOrderIds(allIds, subsetIds) {
    const fullOrder = (Array.isArray(allIds) ? allIds : []).map((value) => String(value || "")).filter(Boolean);
    const fullSet = new Set(fullOrder);
    const requestedSubset = (Array.isArray(subsetIds) ? subsetIds : []).map((value) => String(value || "")).filter((value, index, values) => Boolean(value) && values.indexOf(value) === index).filter((value) => fullSet.has(value));
    if (requestedSubset.length === 0) {
      return fullOrder;
    }
    const subsetSet = new Set(requestedSubset);
    const merged = [];
    let cursor = 0;
    for (const id of fullOrder) {
      if (subsetSet.has(id)) {
        merged.push(requestedSubset[cursor]);
        cursor += 1;
      } else {
        merged.push(id);
      }
    }
    return merged;
  }
  function renderPasskeyList() {
    dom.passkeyList.innerHTML = "";
    const query = String(dom.passkeySearch.value || "").trim().toLowerCase();
    const currentOnly = Boolean(dom.passkeyCurrentSiteOnly.checked);
    const allPasskeys = collectUnifiedPasskeys();
    let visiblePasskeys = allPasskeys;
    if (currentOnly) {
      visiblePasskeys = visiblePasskeys.filter((item) => matchRpIdWithDomain(item.rpId, currentDomain));
    }
    if (query) {
      visiblePasskeys = visiblePasskeys.filter((item) => {
        const searchText = `${item.rpId} ${item.userName} ${item.displayName} ${item.credentialIdB64u}`.toLowerCase();
        return searchText.includes(query);
      });
    }
    if (visiblePasskeys.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = allPasskeys.length === 0 ? "\u6682\u65E0\u901A\u884C\u5BC6\u94A5\uFF08\u8BBF\u95EE\u652F\u6301 passkey \u7684\u7AD9\u70B9\u5E76\u6CE8\u518C\u540E\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\uFF09" : "\u6CA1\u6709\u5339\u914D\u7684\u901A\u884C\u5BC6\u94A5";
      dom.passkeyList.appendChild(empty);
      return;
    }
    visiblePasskeys.sort((a, b) => (b.lastUsedAtMs || b.updatedAtMs || 0) - (a.lastUsedAtMs || a.updatedAtMs || 0));
    for (const item of visiblePasskeys) {
      const card = document.createElement("article");
      card.className = "passkey-item";
      const title = document.createElement("strong");
      const name = item.userName || item.displayName || "-";
      const compatLabel = formatPasskeyCompatLabel(item);
      title.textContent = `${item.rpId} | ${name}${compatLabel ? ` | ${compatLabel}` : ""}`;
      card.appendChild(title);
      const meta = document.createElement("div");
      meta.className = "meta";
      const linkedCount = Number(item.linkedAccountCount || 0);
      meta.innerHTML = `credentialId: ${escapeHtml(shortenMiddle(item.credentialIdB64u, 20))}<br/>\u7B7E\u540D\u8BA1\u6570: ${item.signCount} | \u7B97\u6CD5: ${item.alg} | \u6A21\u5F0F: ${escapeHtml(item.mode)}<br/>\u521B\u5EFA: ${formatTime(item.createdAtMs)} | \u6700\u8FD1\u4F7F\u7528: ${formatTime(item.lastUsedAtMs)}<br/>\u5173\u8054\u8D26\u53F7\u6570: ${linkedCount}<br/>`;
      card.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "actions";
      const editUserBtn = document.createElement("button");
      editUserBtn.textContent = "\u7F16\u8F91\u7528\u6237\u540D";
      editUserBtn.addEventListener("click", async () => {
        await editPasskeyUsername(item.credentialIdB64u, item.userName || item.displayName || "");
      });
      actions.appendChild(editUserBtn);
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "button-danger";
      deleteBtn.textContent = "\u5220\u9664\u901A\u884C\u5BC6\u94A5";
      deleteBtn.addEventListener("click", async () => {
        await deletePasskey(item.credentialIdB64u);
      });
      actions.appendChild(deleteBtn);
      card.appendChild(actions);
      dom.passkeyList.appendChild(card);
    }
  }
  function collectUnifiedPasskeys() {
    const byId = /* @__PURE__ */ new Map();
    const now = Date.now();
    for (const item of passkeys) {
      const id = normalizePasskeyId(item?.credentialIdB64u || item?.id || "");
      if (!id) continue;
      byId.set(id, {
        ...item,
        credentialIdB64u: id,
        rpId: normalizeDomain(item?.rpId || ""),
        userName: normalizeUsername(item?.userName || item?.username || ""),
        displayName: String(item?.displayName || "").trim(),
        linkedAccountIds: [],
        linkedAccountCount: 0,
        mode: String(item?.mode || "managed"),
        createCompatMethod: normalizePasskeyCreateCompatMethod(item?.createCompatMethod, item?.alg),
        createdAtMs: Number(item?.createdAtMs || now),
        updatedAtMs: Number(item?.updatedAtMs || item?.createdAtMs || now),
        lastUsedAtMs: item?.lastUsedAtMs == null ? null : Number(item.lastUsedAtMs)
      });
    }
    for (const account of accounts) {
      const ids = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
      if (ids.length === 0) continue;
      const accountSite = normalizeDomain(
        account?.sites && account.sites[0] || account?.canonicalSite || ""
      );
      const accountUser = normalizeUsername(account?.username || "");
      const accountCreatedAt = Number(account?.createdAtMs || now);
      const accountUpdatedAt = Number(account?.passkeyUpdatedAtMs || account?.updatedAtMs || accountCreatedAt);
      const accountId = String(account?.accountId || "");
      for (const id of ids) {
        if (!byId.has(id)) {
          byId.set(id, {
            credentialIdB64u: id,
            rpId: accountSite,
            userName: accountUser,
            displayName: "",
            userHandleB64u: "",
            alg: -7,
            signCount: 0,
            privateJwk: null,
            publicJwk: null,
            createdAtMs: accountCreatedAt,
            updatedAtMs: accountUpdatedAt,
            lastUsedAtMs: null,
            mode: "linked-account",
            createCompatMethod: "unknown_linked",
            linkedAccountIds: [],
            linkedAccountCount: 0
          });
        }
        const target = byId.get(id);
        if (accountSite && !target.rpId) {
          target.rpId = accountSite;
        }
        if (accountUser && !target.userName) {
          target.userName = accountUser;
        }
        if (accountUpdatedAt > Number(target.updatedAtMs || 0)) {
          target.updatedAtMs = accountUpdatedAt;
        }
        if (!target.linkedAccountIds.includes(accountId)) {
          target.linkedAccountIds.push(accountId);
        }
        target.linkedAccountCount = target.linkedAccountIds.length;
      }
    }
    return Array.from(byId.values()).filter((item) => item.credentialIdB64u && item.rpId);
  }
  function buildEditor(account) {
    const editor = document.createElement("div");
    editor.className = "editor";
    const sitesInput = createEditorTextarea(editor, "\u7AD9\u70B9\u522B\u540D\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09", account.sites.join("\n"), {
      className: "editor-textarea editor-textarea-sites"
    });
    const usernameInput = createEditorField(editor, "\u7528\u6237\u540D", account.username);
    const passwordInput = createEditorField(editor, "\u5BC6\u7801", account.password);
    const totpInput = createEditorField(editor, "TOTP", account.totpSecret || "");
    appendTotpImportActions(editor, {
      totpInput,
      sitesInput,
      usernameInput
    });
    const recoveryInput = createEditorTextarea(editor, "\u6062\u590D\u7801\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09", account.recoveryCodes || "", {
      className: "editor-textarea editor-textarea-recovery"
    });
    const noteInput = createEditorTextarea(editor, "\u5907\u6CE8", account.note || "", {
      className: "editor-textarea"
    });
    const details = document.createElement("div");
    details.className = "meta editor-meta";
    details.innerHTML = `\u901A\u884C\u5BC6\u94A5: ${(account.passkeyCredentialIds || []).length} \u4E2A | \u901A\u884C\u5BC6\u94A5\u66F4\u65B0\u65F6\u95F4\uFF1A${formatTime(account.passkeyUpdatedAtMs)} | ${escapeHtml(String(account.passkeyUpdatedDeviceName || "").trim() || "-")}<br/>\u521B\u5EFA: ${formatTime(account.createdAtMs)} | \u66F4\u65B0: ${formatTime(account.updatedAtMs)}<br/>\u6700\u540E\u64CD\u4F5C\u8BBE\u5907: ${escapeHtml(String(account.lastOperatedDeviceName || "").trim() || "-")}<br/>\u5220\u9664: ${formatTime(account.deletedAtMs)}<br/>\u7528\u6237\u540D\uFF1A${formatTime(account.usernameUpdatedAtMs)} | ${escapeHtml(String(account.usernameUpdatedDeviceName || "").trim() || "-")}<br/>\u5BC6\u7801\uFF1A${formatTime(account.passwordUpdatedAtMs)} | ${escapeHtml(String(account.passwordUpdatedDeviceName || "").trim() || "-")}<br/>TOTP\uFF1A${formatTime(account.totpUpdatedAtMs)} | ${escapeHtml(String(account.totpUpdatedDeviceName || "").trim() || "-")}<br/>\u6062\u590D\u7801\uFF1A${formatTime(account.recoveryCodesUpdatedAtMs)} | ${escapeHtml(String(account.recoveryCodesUpdatedDeviceName || "").trim() || "-")}<br/>\u5907\u6CE8\uFF1A${formatTime(account.noteUpdatedAtMs)} | ${escapeHtml(String(account.noteUpdatedDeviceName || "").trim() || "-")}<br/>`;
    editor.appendChild(details);
    const buttons = document.createElement("div");
    buttons.className = "actions";
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "\u4FDD\u5B58\u7F16\u8F91";
    saveBtn.addEventListener("click", async () => {
      await saveAccountEdit(account.accountId, {
        sitesText: sitesInput.value,
        username: usernameInput.value,
        password: passwordInput.value,
        totpSecret: totpInput.value,
        recoveryCodes: recoveryInput.value,
        note: noteInput.value
      });
    });
    buttons.appendChild(saveBtn);
    const historyBtn = document.createElement("button");
    historyBtn.textContent = "\u5386\u53F2\u8BB0\u5F55";
    historyBtn.addEventListener("click", async () => {
      await openHistoryModal();
    });
    buttons.appendChild(historyBtn);
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "\u53D6\u6D88";
    cancelBtn.addEventListener("click", () => {
      editingAccountId = null;
      renderAccounts();
    });
    buttons.appendChild(cancelBtn);
    editor.appendChild(buttons);
    return editor;
  }
  function createEditorField(parent, labelText, value) {
    const wrap = document.createElement("label");
    wrap.className = "editor-row editor-row-inline";
    const label = document.createElement("span");
    label.textContent = labelText;
    wrap.appendChild(label);
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
  }
  function appendTotpImportActions(parent, { totpInput, sitesInput, usernameInput }) {
    const wrap = document.createElement("div");
    wrap.className = "editor-row editor-row-multiline totp-import-row";
    const label = document.createElement("span");
    label.textContent = "TOTP\u5BFC\u5165";
    wrap.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "totp-import-actions";
    wrap.appendChild(actions);
    const rawBtn = document.createElement("button");
    rawBtn.type = "button";
    rawBtn.textContent = "\u7C98\u8D34\u539F\u59CB\u5BC6\u94A5";
    rawBtn.addEventListener("click", () => {
      void pasteRawTotpSecretFromClipboard({
        totpInput
      });
    });
    actions.appendChild(rawBtn);
    const uriBtn = document.createElement("button");
    uriBtn.type = "button";
    uriBtn.textContent = "\u7C98\u8D34 otpauth URI";
    uriBtn.addEventListener("click", () => {
      void pasteOtpAuthUriFromClipboard({
        totpInput,
        sitesInput,
        usernameInput
      });
    });
    actions.appendChild(uriBtn);
    const qrBtn = document.createElement("button");
    qrBtn.type = "button";
    qrBtn.textContent = "\u8BC6\u522B\u526A\u8D34\u677F\u4E8C\u7EF4\u7801";
    qrBtn.addEventListener("click", () => {
      void pasteOtpAuthQrFromClipboard({
        totpInput,
        sitesInput,
        usernameInput
      });
    });
    actions.appendChild(qrBtn);
    parent.appendChild(wrap);
  }
  function createEditorTextarea(parent, labelText, value, { className = "" } = {}) {
    const wrap = document.createElement("label");
    wrap.className = "editor-row editor-row-multiline";
    const label = document.createElement("span");
    label.textContent = labelText;
    wrap.appendChild(label);
    const input = document.createElement("textarea");
    input.value = value || "";
    if (className) {
      input.className = className;
    }
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
  }
  async function createAccountFromInputs() {
    if (isLockedForInteraction()) {
      setStatus("\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u8BF7\u5148\u89E3\u9501");
      return;
    }
    const sites = parseSites(dom.createSiteInput.value);
    const username = dom.createUsernameInput.value.trim();
    const password = dom.createPasswordInput.value;
    const totpSecret = normalizeTotpSecret(dom.createTotpInput.value);
    if (sites.length === 0) {
      setStatus("\u7AD9\u70B9\u522B\u540D\u4E0D\u80FD\u4E3A\u7A7A");
      return;
    }
    if (!username) {
      setStatus("\u7528\u6237\u540D\u4E0D\u80FD\u4E3A\u7A7A");
      return;
    }
    if (!password) {
      setStatus("\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A");
      return;
    }
    if (totpSecret && !isValidTotpSecret(totpSecret)) {
      setStatus("TOTP \u5BC6\u94A5\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5\u540E\u518D\u521B\u5EFA");
      return;
    }
    const createdAtMs = Date.now();
    const deviceName = await getDeviceName();
    const next = accounts.map((item) => ({ ...item, sites: [...item.sites || []] }));
    const created = createAccount({
      site: sites[0],
      sites,
      username,
      password,
      totpSecret,
      createdAtMs,
      deviceName
    });
    next.push(applyAutoFolderRulesToAccount(created));
    const synced = syncAliasGroups2(next);
    await persistAccounts(synced);
    await appendHistory(
      "\u65B0\u5EFA\u8D26\u53F7",
      createdAtMs
    );
    dom.createSiteInput.value = "";
    dom.createUsernameInput.value = "";
    dom.createPasswordInput.value = "";
    dom.createTotpInput.value = "";
    closeCreateModal();
    setStatus("\u8D26\u53F7\u5DF2\u521B\u5EFA");
    renderAccounts();
  }
  async function addCurrentDomainToAccount(accountId) {
    const domain = normalizeDomain(currentDomain);
    if (!domain) {
      setStatus("\u5F53\u524D\u9875\u9762\u6CA1\u6709\u53EF\u7528\u57DF\u540D");
      return;
    }
    const next = accounts.map((item) => ({ ...item, sites: [...item.sites || []] }));
    const target = next.find((item) => item.accountId === accountId);
    if (!target) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u8D26\u53F7");
      return;
    }
    if (!target.sites.includes(domain)) {
      target.sites.push(domain);
      target.sites = normalizeSites(target.sites);
      target.updatedAtMs = Date.now();
    }
    const synced = syncAliasGroups2(next);
    await persistAccounts(synced);
    await appendHistory(`${target.accountId}\uFF1A\u7AD9\u70B9\u522B\u540D\u6539\u4E3A${historyValueSnippet(target.sites.join(", "))}`);
    setStatus(`\u5DF2\u5C06 ${domain} \u52A0\u5165\u8D26\u53F7\u522B\u540D\u7EC4\u5E76\u81EA\u52A8\u540C\u6B65`);
    renderAccounts();
  }
  async function saveAccountEdit(accountId, draft) {
    const next = accounts.map((item) => ({ ...item, sites: [...item.sites || []] }));
    const target = next.find((item) => item.accountId === accountId);
    if (!target) {
      setStatus("\u672A\u627E\u5230\u7F16\u8F91\u8D26\u53F7");
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    let changed = false;
    const historyMessages = [];
    const nextSites = parseSites(draft.sitesText);
    if (nextSites.length > 0 && JSON.stringify(nextSites) !== JSON.stringify(target.sites)) {
      target.sites = nextSites;
      changed = true;
      historyMessages.push(`\u7AD9\u70B9\u522B\u540D\u6539\u4E3A${historyValueSnippet(nextSites.join(", "))}`);
    }
    const nextUsername = draft.username.trim();
    if (nextUsername && nextUsername !== target.username) {
      target.username = nextUsername;
      target.usernameUpdatedAtMs = now;
      target.usernameUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push(`\u7528\u6237\u540D\u6539\u4E3A${historyValueSnippet(nextUsername)}`);
    }
    if (draft.password !== target.password) {
      target.password = draft.password;
      target.passwordUpdatedAtMs = now;
      target.passwordUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push("\u5BC6\u7801\u5DF2\u4FEE\u6539");
    }
    const nextTotpSecret = normalizeTotpSecret(draft.totpSecret);
    if (nextTotpSecret && !isValidTotpSecret(nextTotpSecret)) {
      setStatus("TOTP \u5BC6\u94A5\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5\u540E\u518D\u4FDD\u5B58");
      return;
    }
    if (nextTotpSecret !== normalizeTotpSecret(target.totpSecret)) {
      target.totpSecret = nextTotpSecret;
      target.totpUpdatedAtMs = now;
      target.totpUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push("TOTP \u5DF2\u4FEE\u6539");
    }
    if (draft.recoveryCodes !== target.recoveryCodes) {
      target.recoveryCodes = draft.recoveryCodes;
      target.recoveryCodesUpdatedAtMs = now;
      target.recoveryCodesUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push("\u6062\u590D\u7801\u5DF2\u4FEE\u6539");
    }
    if (draft.note !== target.note) {
      target.note = draft.note;
      target.noteUpdatedAtMs = now;
      target.noteUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push("\u5907\u6CE8\u5DF2\u4FEE\u6539");
    }
    if (!changed) {
      setStatus("\u6CA1\u6709\u53EF\u4FDD\u5B58\u7684\u53D8\u66F4");
      return;
    }
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    const withAutoFolders = next.map(
      (item) => item === target ? applyAutoFolderRulesToAccount(item) : item
    );
    const synced = syncAliasGroups2(withAutoFolders);
    await persistAccounts(synced);
    for (const message of historyMessages) {
      await appendHistory(`${target.accountId}\uFF1A${message}`, now);
    }
    editingAccountId = null;
    setStatus("\u8D26\u53F7\u7F16\u8F91\u5DF2\u4FDD\u5B58");
    renderAccounts();
  }
  async function moveToRecycleBin(accountId) {
    const next = accounts.map((item) => ({ ...item, sites: [...item.sites || []] }));
    const target = next.find((item) => item.accountId === accountId);
    if (!target) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u8D26\u53F7");
      return;
    }
    if (target.isDeleted) {
      setStatus("\u8D26\u53F7\u5DF2\u5728\u56DE\u6536\u7AD9");
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    target.isDeleted = true;
    target.deletedAtMs = now;
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    await persistAccounts(next);
    await appendHistory(`${target.accountId}\uFF1A\u79FB\u5165\u56DE\u6536\u7AD9`, now);
    setStatus("\u8D26\u53F7\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9");
    renderAccounts();
  }
  async function restoreFromRecycleBin(accountId) {
    const next = accounts.map((item) => ({ ...item, sites: [...item.sites || []] }));
    const target = next.find((item) => item.accountId === accountId);
    if (!target) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u8D26\u53F7");
      return;
    }
    if (!target.isDeleted) {
      setStatus("\u8BE5\u8D26\u53F7\u4E0D\u5728\u56DE\u6536\u7AD9");
      return;
    }
    if (target.isPermanentlyDeleted) {
      setStatus("\u8BE5\u8D26\u53F7\u5DF2\u6C38\u4E45\u5220\u9664\uFF0C\u4E0D\u80FD\u6062\u590D");
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    target.isDeleted = false;
    target.isPermanentlyDeleted = false;
    target.deletedAtMs = null;
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    await persistAccounts(next);
    await appendHistory(`${target.accountId}\uFF1A\u4ECE\u56DE\u6536\u7AD9\u6062\u590D`, now);
    setStatus("\u8D26\u53F7\u5DF2\u4ECE\u56DE\u6536\u7AD9\u6062\u590D");
    renderAccounts();
  }
  async function permanentlyDelete(accountId) {
    const target = accounts.find((item) => item.accountId === accountId);
    if (!target) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u8D26\u53F7");
      return;
    }
    if (!target.isDeleted) {
      setStatus("\u4EC5\u652F\u6301\u5728\u56DE\u6536\u7AD9\u4E2D\u6C38\u4E45\u5220\u9664");
      return;
    }
    if (target.isPermanentlyDeleted) {
      setStatus("\u8BE5\u8D26\u53F7\u5DF2\u6C38\u4E45\u5220\u9664");
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    const next = accounts.map((item) => item.accountId === accountId ? {
      ...item,
      isDeleted: true,
      isPermanentlyDeleted: true,
      deletedAtMs: now,
      deletedDeviceName: deviceName,
      updatedAtMs: now,
      lastOperatedDeviceName: deviceName
    } : item);
    if (editingAccountId === accountId) {
      editingAccountId = null;
    }
    await persistAccounts(next);
    await appendHistory(`${accountId}\uFF1A\u6C38\u4E45\u5220\u9664`);
    setStatus(`\u8D26\u53F7\u5DF2\u6C38\u4E45\u5220\u9664: ${accountId}`);
    renderAccounts();
  }
  async function deletePasskey(credentialIdB64u) {
    const targetId = normalizePasskeyId(credentialIdB64u);
    if (!targetId) {
      setStatus("\u901A\u884C\u5BC6\u94A5 ID \u975E\u6CD5");
      return;
    }
    const now = Date.now();
    const next = passkeys.filter((item) => item.credentialIdB64u !== targetId);
    let accountsChanged = false;
    const nextAccounts = accounts.map((account) => {
      const ids = normalizePasskeyCredentialIds(account.passkeyCredentialIds || []);
      if (!ids.includes(targetId)) {
        return account;
      }
      accountsChanged = true;
      return {
        ...account,
        passkeyCredentialIds: ids.filter((id) => id !== targetId),
        passkeyUpdatedAtMs: now,
        updatedAtMs: now
      };
    });
    if (next.length === passkeys.length && !accountsChanged) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u901A\u884C\u5BC6\u94A5");
      return;
    }
    if (next.length !== passkeys.length) {
      await persistPasskeys(next);
    }
    if (accountsChanged) {
      await persistAccounts(nextAccounts);
    }
    await appendHistory(`\u901A\u884C\u5BC6\u94A5\u5220\u9664\uFF1A${targetId}`, now);
    setStatus(`\u901A\u884C\u5BC6\u94A5\u5DF2\u79FB\u9664: ${shortenMiddle(targetId, 16)}`);
    renderAccounts();
  }
  async function editPasskeyUsername(credentialIdB64u, currentUserName = "") {
    const targetId = normalizePasskeyId(credentialIdB64u);
    if (!targetId) {
      setStatus("\u901A\u884C\u5BC6\u94A5 ID \u975E\u6CD5");
      return;
    }
    const input = window.prompt("\u7F16\u8F91\u901A\u884C\u5BC6\u94A5\u7528\u6237\u540D", String(currentUserName || ""));
    if (input == null) {
      return;
    }
    const nextUserName = String(input || "").trim();
    if (!nextUserName) {
      setStatus("\u7528\u6237\u540D\u4E0D\u80FD\u4E3A\u7A7A");
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    let passkeysChanged = false;
    const nextPasskeys = passkeys.map((item) => {
      if (normalizePasskeyId(item?.credentialIdB64u || item?.id || "") !== targetId) {
        return item;
      }
      passkeysChanged = true;
      return {
        ...item,
        userName: nextUserName,
        updatedAtMs: now
      };
    });
    let accountsChanged = false;
    const nextAccounts = accounts.map((account) => {
      const ids = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
      if (!ids.includes(targetId)) {
        return account;
      }
      accountsChanged = true;
      return {
        ...account,
        username: nextUserName,
        usernameUpdatedAtMs: now,
        usernameUpdatedDeviceName: deviceName,
        updatedAtMs: now,
        lastOperatedDeviceName: deviceName
      };
    });
    if (!passkeysChanged && !accountsChanged) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u901A\u884C\u5BC6\u94A5");
      return;
    }
    if (passkeysChanged) {
      await persistPasskeys(nextPasskeys);
    }
    if (accountsChanged) {
      await persistAccounts(nextAccounts);
    }
    await appendHistory(`\u901A\u884C\u5BC6\u94A5\u7528\u6237\u540D\u6539\u4E3A${historyValueSnippet(nextUserName)}\uFF1A${targetId}`, now);
    setStatus(`\u901A\u884C\u5BC6\u94A5\u7528\u6237\u540D\u5DF2\u66F4\u65B0: ${nextUserName}`);
    renderAccounts();
  }
  async function fillCurrentPage(account) {
    const response = await chrome.runtime.sendMessage({
      type: "PASS_FILL_ACTIVE_TAB",
      payload: {
        accountId: account.accountId,
        username: account.username,
        password: account.password
      }
    });
    if (response?.ok) {
      const parts = [];
      if (response.filledUsername) parts.push("\u7528\u6237\u540D");
      if (response.filledPassword) parts.push("\u5BC6\u7801");
      setStatus(parts.length > 0 ? `\u5DF2\u586B\u5145${parts.join("\u548C")}` : "\u5DF2\u586B\u5145");
    } else {
      setStatus(`\u586B\u5145\u5931\u8D25: ${response?.error || "\u672A\u77E5\u9519\u8BEF"}`);
    }
  }
  function createAccount({ site, sites = [], username, password, totpSecret = "", createdAtMs, deviceName }) {
    const normalizedSites = normalizeSites(Array.isArray(sites) && sites.length > 0 ? sites : [site]);
    const canonical = etldPlusOne(normalizedSites[0] || normalizeDomain(site));
    const accountId = buildAccountId(canonical, username, createdAtMs);
    const fixedFolderId = FIXED_NEW_ACCOUNT_FOLDER_ID;
    const normalizedTotpSecret = normalizeTotpSecret(totpSecret);
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
      sites: normalizedSites,
      username,
      password,
      totpSecret: normalizedTotpSecret,
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
  function isPinnedAccount2(account) {
    return Boolean(account?.isPinned);
  }
  async function togglePin(accountId, { fromSortModal = false } = {}) {
    const next = accounts.map((item) => ({ ...item, sites: [...item.sites || []] }));
    const target = next.find((item) => item.accountId === accountId);
    if (!target) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u8D26\u53F7");
      return;
    }
    if (target.isDeleted) {
      setStatus("\u56DE\u6536\u7AD9\u8D26\u53F7\u4E0D\u652F\u6301\u7F6E\u9876");
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    const nextPinned = !isPinnedAccount2(target);
    target.isPinned = nextPinned;
    if (nextPinned) {
      const maxOrder = next.filter((item) => !item.isDeleted && isPinnedAccount2(item)).reduce((maxValue, item) => Math.max(maxValue, Number(item.pinnedSortOrder ?? -1)), -1);
      target.pinnedSortOrder = maxOrder + 1;
    } else {
      target.pinnedSortOrder = null;
      target.regularSortOrder = null;
    }
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    await persistAccounts(next);
    await appendHistory(
      nextPinned ? `${target.accountId}\uFF1A\u8D26\u53F7\u7F6E\u9876` : `${target.accountId}\uFF1A\u53D6\u6D88\u8D26\u53F7\u7F6E\u9876`,
      now
    );
    setStatus(nextPinned ? "\u8D26\u53F7\u5DF2\u7F6E\u9876" : "\u5DF2\u53D6\u6D88\u7F6E\u9876");
    renderAccounts();
    if (fromSortModal && !dom.sortModal.classList.contains("modal-hidden")) {
      sortModalOrderIds = getVisibleAccountsForCurrentMode().map((account) => String(account.accountId || ""));
      renderSortModalList();
    }
  }
  function parseSites(raw) {
    return normalizeSites(
      raw.split(/[\s,;\n\t]+/g).map((value) => value.trim()).filter(Boolean)
    );
  }
  function historyValueSnippet(input, maxLength = 80) {
    const normalized = String(input || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!normalized) return "(\u7A7A)";
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}...`;
  }
  function normalizePasskeyId(value) {
    return String(value || "").trim();
  }
  function normalizePasskeyCreateCompatMethod(input, alg) {
    const value = String(input || "").trim().toLowerCase();
    if (value === "standard" || value === "user_name_fallback" || value === "rs256" || value === "user_name_fallback+rs256" || value === "unknown_linked") {
      return value;
    }
    return Number(alg) === -257 ? "rs256" : "standard";
  }
  function formatPasskeyCompatLabel(item) {
    const mode = String(item?.mode || "");
    const method = normalizePasskeyCreateCompatMethod(item?.createCompatMethod, item?.alg);
    if (mode === "linked-account") {
      return "\u547D\u4E2D\uFF1A\u672A\u77E5(\u4EC5\u8D26\u53F7\u5173\u8054)";
    }
    if (method === "user_name_fallback+rs256") {
      return "\u547D\u4E2D\uFF1A\u517C\u5BB92+3";
    }
    if (method === "user_name_fallback") {
      return "\u547D\u4E2D\uFF1A\u517C\u5BB92(user.name\u515C\u5E95)";
    }
    if (method === "rs256") {
      return "\u547D\u4E2D\uFF1A\u517C\u5BB93(RS256)";
    }
    return "\u547D\u4E2D\uFF1A\u6807\u51C6\u6258\u7BA1";
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
  function normalizePasskeyCredentialIds(input) {
    const values = Array.isArray(input) ? input : [];
    return [...new Set(values.map(normalizePasskeyId).filter(Boolean))].sort();
  }
  function isAccountMatchCurrentDomain(account, domain) {
    if (!domain) return false;
    const normalizedCurrent = normalizeDomain(domain);
    const sites = normalizeSites([
      ...Array.isArray(account?.sites) ? account.sites : [],
      account?.canonicalSite || ""
    ]);
    return Boolean(normalizedCurrent) && sites.some((site) => domainsMatch(site, normalizedCurrent));
  }
  function matchRpIdWithDomain(rpId, domain) {
    const normalizedRpId = normalizeDomain(rpId);
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedRpId || !normalizedDomain) return false;
    return normalizedDomain === normalizedRpId || normalizedDomain.endsWith(`.${normalizedRpId}`);
  }
  function isAccountMatchSearch(account, query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return true;
    const haystacks = [];
    const useAll = accountSearchUseAll;
    if (useAll || accountSearchFields.has("username")) {
      haystacks.push(account.username, account.usernameAtCreate);
    }
    if (useAll || accountSearchFields.has("sites")) {
      haystacks.push((account.sites || []).join(" "), account.canonicalSite);
    }
    if (useAll || accountSearchFields.has("note")) {
      haystacks.push(account.note);
    }
    if (useAll || accountSearchFields.has("password")) {
      haystacks.push(account.password);
    }
    if (haystacks.length === 0) return false;
    return haystacks.some((value) => String(value || "").toLowerCase().includes(needle));
  }
  function onAccountSearchFieldAllChanged() {
    if (dom.accountSearchFieldAll.checked) {
      accountSearchUseAll = true;
      accountSearchFields = /* @__PURE__ */ new Set();
    } else {
      accountSearchUseAll = false;
    }
    syncAccountSearchFieldCheckboxes();
    renderAccounts();
  }
  function onAccountSearchFieldChanged() {
    const next = /* @__PURE__ */ new Set();
    if (dom.accountSearchFieldUsername.checked) next.add("username");
    if (dom.accountSearchFieldSites.checked) next.add("sites");
    if (dom.accountSearchFieldNote.checked) next.add("note");
    if (dom.accountSearchFieldPassword.checked) next.add("password");
    accountSearchUseAll = false;
    accountSearchFields = next;
    syncAccountSearchFieldCheckboxes();
    renderAccounts();
  }
  function syncAccountSearchFieldCheckboxes() {
    dom.accountSearchFieldUsername.checked = accountSearchFields.has("username");
    dom.accountSearchFieldSites.checked = accountSearchFields.has("sites");
    dom.accountSearchFieldNote.checked = accountSearchFields.has("note");
    dom.accountSearchFieldPassword.checked = accountSearchFields.has("password");
    dom.accountSearchFieldAll.checked = accountSearchUseAll;
  }
  function formatTime(ms) {
    if (ms == null) return "-";
    const date = new Date(Number(ms));
    if (Number.isNaN(date.getTime())) return "-";
    const yy = String(date.getFullYear() % 100);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = date.getSeconds();
    return `${yy}-${month}-${day} ${hour}:${minute}:${second}`;
  }
  function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
  function toMultilineHtml(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!text) return "-";
    return escapeHtml(text).replaceAll("\n", "<br/>");
  }
  function shortenMiddle(value, keep = 18) {
    const text = String(value || "");
    if (text.length <= keep) return text;
    const head = Math.max(4, Math.floor(keep / 2));
    const tail = Math.max(4, keep - head);
    return `${text.slice(0, head)}...${text.slice(-tail)}`;
  }
  function classifyToastTone(message) {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    const errorTokens = [
      "\u5931\u8D25",
      "\u9519\u8BEF",
      "\u65E0\u6CD5",
      "\u4E0D\u80FD",
      "\u62D2\u7EDD",
      "\u65E0\u6548",
      "\u7981\u6B62",
      "\u4E0D\u5339\u914D",
      "\u5DF2\u505C\u6B62",
      "\u7F3A\u5931",
      "\u4E0D\u5B58\u5728",
      "\u8D85\u65F6",
      "\u5F02\u5E38",
      "\u672A\u627E\u5230",
      "\u4E0D\u6B63\u786E",
      "error",
      "failed",
      "fail"
    ];
    if (errorTokens.some((token) => text.includes(token) || lower.includes(token))) return "error";
    const warningTokens = [
      "\u8B66\u544A",
      "\u8BF7\u5148",
      "\u8BF7\u786E\u8BA4",
      "\u5DF2\u53D6\u6D88",
      "\u53D6\u6D88",
      "\u6682\u65E0",
      "\u672A\u542F\u7528",
      "\u672A\u914D\u7F6E",
      "\u6CE8\u610F",
      "\u8DF3\u8FC7",
      "\u672A\u9009\u62E9",
      "\u4E0D\u5B8C\u6574",
      "warning",
      "warn",
      "cancel"
    ];
    if (warningTokens.some((token) => text.includes(token) || lower.includes(token))) return "warning";
    return "success";
  }
  function setStatus(message) {
    const text = String(message || "").trim();
    if (!text) return;
    if (dom.status) {
      dom.status.textContent = "";
    }
    let toast = document.getElementById("popupToast");
    if (!(toast instanceof HTMLDivElement)) {
      toast = document.createElement("div");
      toast.id = "popupToast";
      toast.className = "popup-toast";
      document.body.appendChild(toast);
    }
    const tone = classifyToastTone(text);
    toast.textContent = text;
    toast.classList.remove("popup-toast-success", "popup-toast-error", "popup-toast-warning");
    toast.classList.add(`popup-toast-${tone}`);
    toast.classList.add("popup-toast-show");
    if (popupToastTimer != null) {
      clearTimeout(popupToastTimer);
    }
    popupToastTimer = window.setTimeout(() => {
      const current = document.getElementById("popupToast");
      if (!(current instanceof HTMLDivElement)) return;
      current.classList.remove("popup-toast-show");
    }, POPUP_TOAST_DURATION_MS);
  }
  function hasTotpSecret(value) {
    return String(value || "").trim().length > 0;
  }
  function isValidTotpSecret(secret) {
    const normalized = normalizeTotpSecret(secret);
    if (!normalized) return false;
    return decodeBase32(normalized).length > 0;
  }
  async function pasteRawTotpSecretFromClipboard({ totpInput }) {
    try {
      const raw = String(await navigator.clipboard.readText() || "");
      const secret = normalizeTotpSecret(raw);
      if (!secret) {
        setStatus("\u526A\u8D34\u677F\u6587\u672C\u4E3A\u7A7A");
        return;
      }
      if (!isValidTotpSecret(secret)) {
        setStatus("\u7C98\u8D34\u5931\u8D25\uFF1A\u539F\u59CB\u5BC6\u94A5\u4E0D\u662F\u6709\u6548 TOTP");
        return;
      }
      totpInput.value = secret;
      setStatus("\u5DF2\u586B\u5145 TOTP \u539F\u59CB\u5BC6\u94A5");
    } catch (error) {
      setStatus(`\u8BFB\u53D6\u526A\u8D34\u677F\u5931\u8D25: ${error.message}`);
    }
  }
  async function pasteOtpAuthUriFromClipboard({ totpInput, sitesInput, usernameInput }) {
    try {
      const raw = String(await navigator.clipboard.readText() || "");
      const payload = parseOtpAuthUriPayload(raw);
      if (!payload) {
        setStatus("\u7C98\u8D34\u5931\u8D25\uFF1A\u4E0D\u662F\u6709\u6548\u7684 otpauth://totp URI");
        return;
      }
      applyOtpAuthPayloadToInputs(payload, {
        totpInput,
        sitesInput,
        usernameInput,
        includeSiteAndUsername: true
      });
      setStatus("\u5DF2\u89E3\u6790 otpauth URI\uFF0C\u5E76\u586B\u5145 TOTP/\u7AD9\u70B9\u522B\u540D/\u7528\u6237\u540D");
    } catch (error) {
      setStatus(`\u8BFB\u53D6\u526A\u8D34\u677F\u5931\u8D25: ${error.message}`);
    }
  }
  async function pasteOtpAuthQrFromClipboard({ totpInput, sitesInput, usernameInput }) {
    try {
      const payloadText = await parseQrPayloadFromClipboard();
      if (!payloadText) {
        setStatus("\u7C98\u8D34\u5931\u8D25\uFF1A\u526A\u8D34\u677F\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u4E8C\u7EF4\u7801\u56FE\u7247");
        return;
      }
      const payload = parseOtpAuthUriPayload(payloadText);
      if (!payload) {
        setStatus("\u7C98\u8D34\u5931\u8D25\uFF1A\u4E8C\u7EF4\u7801\u5185\u5BB9\u4E0D\u662F\u6709\u6548\u7684 otpauth://totp URI");
        return;
      }
      applyOtpAuthPayloadToInputs(payload, {
        totpInput,
        sitesInput,
        usernameInput,
        includeSiteAndUsername: true
      });
      setStatus("\u5DF2\u89E3\u6790\u4E8C\u7EF4\u7801\uFF0C\u5E76\u586B\u5145 TOTP/\u7AD9\u70B9\u522B\u540D/\u7528\u6237\u540D");
    } catch (error) {
      setStatus(`\u8BC6\u522B\u4E8C\u7EF4\u7801\u5931\u8D25: ${error.message}`);
    }
  }
  function applyOtpAuthPayloadToInputs(payload, { totpInput, sitesInput, usernameInput, includeSiteAndUsername }) {
    totpInput.value = payload.secret;
    if (!includeSiteAndUsername) return;
    if (sitesInput && payload.siteAlias) {
      sitesInput.value = payload.siteAlias;
    }
    if (usernameInput && payload.username) {
      usernameInput.value = payload.username;
    }
  }
  function parseOtpAuthUriPayload(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return null;
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (String(parsed.protocol || "").toLowerCase() !== "otpauth:") return null;
    if (String(parsed.hostname || "").toLowerCase() !== "totp") return null;
    let secretRaw = "";
    let issuerFromQuery = "";
    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = String(key || "").toLowerCase();
      if (normalizedKey === "secret" && !secretRaw) {
        secretRaw = String(value || "");
      } else if (normalizedKey === "issuer" && !issuerFromQuery) {
        issuerFromQuery = String(value || "").trim();
      }
    }
    const secret = normalizeTotpSecret(secretRaw);
    if (!isValidTotpSecret(secret)) return null;
    let decodedPath = String(parsed.pathname || "");
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch {
    }
    const label = decodedPath.replace(/^\/+/g, "").trim();
    let labelIssuer = "";
    let labelUsername = "";
    const colonIndex = label.indexOf(":");
    if (colonIndex >= 0) {
      labelIssuer = label.slice(0, colonIndex).trim();
      labelUsername = label.slice(colonIndex + 1).trim();
    } else {
      labelUsername = label.trim();
    }
    const issuer = issuerFromQuery || labelIssuer;
    return {
      secret,
      siteAlias: siteAliasFromIssuer(issuer),
      username: labelUsername || ""
    };
  }
  function siteAliasFromIssuer(issuer) {
    const compactIssuer = String(issuer || "").trim().replaceAll(" ", "");
    if (!compactIssuer) return "";
    const normalized = normalizeDomain(compactIssuer);
    if (!normalized) return "";
    if (normalized.includes(".")) {
      return normalized;
    }
    return `${normalized}.com`;
  }
  async function parseQrPayloadFromClipboard() {
    if (typeof navigator?.clipboard?.read !== "function") {
      throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u8BFB\u53D6\u526A\u8D34\u677F\u56FE\u7247");
    }
    if (typeof BarcodeDetector === "undefined") {
      throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u4E8C\u7EF4\u7801\u8BC6\u522B");
    }
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => String(type).startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const payload = await parseQrPayloadFromBlob(blob, detector);
      if (payload) return payload;
    }
    return "";
  }
  async function parseQrPayloadFromBlob(blob, detector) {
    if (!blob) return "";
    const bitmap = await createImageBitmap(blob);
    try {
      const results = await detector.detect(bitmap);
      for (const result of results) {
        const payload = String(result?.rawValue || "").trim();
        if (payload) return payload;
      }
      return "";
    } finally {
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }
    }
  }
  function createTotpCopyButton({ accountId, username, totpSecret }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "totp-copy-button";
    button.dataset.passTotpSecret = String(totpSecret || "");
    button.dataset.passTotpAccountId = String(accountId || "");
    button.dataset.passTotpCode = "";
    button.textContent = "\u9A8C\u8BC1\u7801: \u8BA1\u7B97\u4E2D...";
    button.addEventListener("click", async () => {
      const code = String(button.dataset.passTotpCode || "");
      if (!code) {
        setStatus("\u9A8C\u8BC1\u7801\u6682\u4E0D\u53EF\u7528");
        return;
      }
      try {
        await navigator.clipboard.writeText(code);
        const label = String(username || accountId || "");
        setStatus(`\u9A8C\u8BC1\u7801\u5DF2\u590D\u5236: ${label}`);
      } catch (error) {
        setStatus(`\u590D\u5236\u9A8C\u8BC1\u7801\u5931\u8D25: ${error.message}`);
      }
    });
    return button;
  }
  function startTotpRefreshTicker() {
    if (totpRefreshTimer != null) return;
    totpRefreshTimer = window.setInterval(() => {
      void refreshVisibleTotpButtons();
    }, TOTP_REFRESH_INTERVAL_MS);
  }
  async function refreshVisibleTotpButtons() {
    if (viewMode === "passkeys") return;
    const buttons = Array.from(document.querySelectorAll(".totp-copy-button[data-pass-totp-secret]"));
    if (buttons.length === 0) return;
    const bySecret = /* @__PURE__ */ new Map();
    for (const button of buttons) {
      const rawSecret = String(button.dataset.passTotpSecret || "");
      const secret = normalizeTotpSecret(rawSecret);
      const key = secret || "__invalid__";
      if (!bySecret.has(key)) {
        bySecret.set(key, []);
      }
      bySecret.get(key).push(button);
    }
    for (const [secret, group] of bySecret.entries()) {
      const result = secret === "__invalid__" ? null : await generateTotpCode(secret, Date.now());
      for (const button of group) {
        applyTotpResultToButton(button, result);
      }
    }
  }
  function applyTotpResultToButton(button, result) {
    if (!(button instanceof HTMLButtonElement)) return;
    if (!button.isConnected) return;
    if (!result) {
      button.textContent = "\u9A8C\u8BC1\u7801: TOTP \u5BC6\u94A5\u65E0\u6548";
      button.dataset.passTotpCode = "";
      button.disabled = true;
      button.classList.add("totp-invalid");
      return;
    }
    button.textContent = `\u9A8C\u8BC1\u7801: ${result.code} (${result.remainingSeconds}s)`;
    button.dataset.passTotpCode = result.code;
    button.disabled = false;
    button.classList.remove("totp-invalid");
  }
  function normalizeTotpSecret(input) {
    return String(input || "").trim().toUpperCase().replaceAll(" ", "").replaceAll("-", "").replace(/=+$/g, "");
  }
  function decodeBase32(secret) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    const output = [];
    for (const char of secret) {
      const index = alphabet.indexOf(char);
      if (index < 0) {
        return new Uint8Array();
      }
      value = value << 5 | index;
      bits += 5;
      if (bits >= 8) {
        output.push(value >>> bits - 8 & 255);
        bits -= 8;
      }
    }
    return new Uint8Array(output);
  }
  async function generateTotpCode(secret, nowMs) {
    const normalized = normalizeTotpSecret(secret);
    if (!normalized) return null;
    const keyBytes = decodeBase32(normalized);
    if (keyBytes.length === 0) return null;
    const counter = BigInt(Math.floor(nowMs / 1e3 / TOTP_PERIOD_SECONDS));
    const counterBytes = new Uint8Array(8);
    let tempCounter = counter;
    for (let i = 7; i >= 0; i -= 1) {
      counterBytes[i] = Number(tempCounter & 0xffn);
      tempCounter >>= 8n;
    }
    let cryptoKey;
    try {
      cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    } catch {
      return null;
    }
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBytes));
    if (signature.length < 20) return null;
    const offset = signature[signature.length - 1] & 15;
    if (offset + 3 >= signature.length) return null;
    const binary = (signature[offset] & 127) << 24 | (signature[offset + 1] & 255) << 16 | (signature[offset + 2] & 255) << 8 | signature[offset + 3] & 255;
    const code = String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
    const remainingSeconds = TOTP_PERIOD_SECONDS - Math.floor(nowMs / 1e3) % TOTP_PERIOD_SECONDS;
    return { code, remainingSeconds };
  }
})();
