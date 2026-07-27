import { mergeSyncPayloads, evaluateSyncSafety } from "./sync_merge_core.js";
import { syncAliasGroups } from "./sync_alias_core.js";
import { accountsToBrowserCsv, browserCsvToAccountDrafts, escapeCsvCell, buildCsv } from "./csv_core.js";
import { softDeleteAccount, permanentlyDeleteAccount, permanentlyDeleteFolder, restoreAccountFields, setAccountPinned, markFolderMembership, FIXED_NEW_ACCOUNT_FOLDER_ID } from "./vault_mutate_core.js";

/*
 * Chrome adapter for the Tauri/Web workspace.
 *
 * The workspace UI talks to a small command surface (`invoke`).  Tauri owns
 * that surface in the desktop build; this file owns it in the Chrome extension.
 * Storage remains isolated by the extension ID.
 */
(() => {
  const STORAGE_KEY = "pass.web.workspace.bridge.v1";
  const DATA_KEY = "pass.web.workspace.bridge.dataKey.v1";
  const PREFS_KEY = "pass.web.workspace.prefs.v1";
  const SYNC_KEY = "pass.web.workspace.sync.v1";
  const LOCK_KEY = "pass.web.workspace.lock.v1";
  const PROVISION_KEY = "pass.web.workspace.provision.v1";
  const MAX_HISTORY = 100;
  const MAX_SNAPSHOTS = 20;
  const LOCK_PBKDF2_ITERATIONS = 310000;
  let storePromise;
  let dataKeyPromise;

  const clone = (value) => {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  };
  const now = () => Date.now();
  const id = (prefix) => {
    const uuid = globalThis.crypto?.randomUUID?.();
    return `${prefix || "record"}-${uuid || `${now()}-${Math.random().toString(36).slice(2)}`}`;
  };
  const text = (value) => String(value ?? "").trim();
  const sameId = (left, right) => text(left).toLowerCase() === text(right).toLowerCase();
  const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
  const syncPayloadEquals = (left, right) => JSON.stringify(normalizePayload(left)) === JSON.stringify(normalizePayload(right));
  const syncBaseUrl = (raw) => {
    const value = text(raw).replace(/\/$/, "");
    if (!value) throw new Error("请先配置同步服务器 URL");
    let parsed;
    try { parsed = new URL(value); } catch (_) { throw new Error("同步服务器 URL 无效"); }
    const scheme = String(parsed.protocol || "").toLowerCase();
    const host = String(parsed.hostname || "").toLowerCase();
    const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (scheme !== "https:" && !(scheme === "http:" && loopback)) {
      throw new Error("同步服务器必须使用 HTTPS（本机回环地址可使用 HTTP）");
    }
    return value;
  };
  const fetchWithSyncTimeout = async (resource, options = {}, timeoutMs = 30000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(resource, { ...options, signal: options.signal || controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("同步请求超时（30 秒）");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  const emptyData = () => ({
    accounts: [],
    folders: [],
    passkeys: [],
    allRegularAccountIds: [],
    allRegularOrderUpdatedAtMs: 0,
    allRegularOrderUpdatedDeviceName: "",
    folderOrderIds: [],
    folderOrderUpdatedAtMs: 0,
    folderOrderUpdatedDeviceName: "",
    deviceName: "",
  });

  const normalizeAccount = (raw) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const sites = unique(source.sites || (source.site ? [source.site] : []));
    const recordId = text(source.recordId || source.accountId || source.id) || id("account");
    const createdAtMs = Number(source.createdAtMs) || now();
    const updatedAtMs = Number(source.updatedAtMs) || createdAtMs;
    const deviceName = text(source.lastOperatedDeviceName || source.createdDeviceName) || "Chrome";
    return {
      ...clone(source),
      id: text(source.id) || recordId,
      recordId,
      accountId: text(source.accountId) || recordId,
      sites,
      canonicalSite: text(source.canonicalSite) || sites[0] || "",
      username: String(source.username ?? ""),
      usernameAtCreate: String(source.usernameAtCreate ?? source.username ?? ""),
      password: String(source.password ?? ""),
      totpSecret: String(source.totpSecret ?? ""),
      recoveryCodes: String(source.recoveryCodes ?? ""),
      note: String(source.note ?? ""),
      folderIds: unique(source.folderIds || (source.folderId ? [source.folderId] : [])),
      isDeleted: Boolean(source.isDeleted),
      isPermanentlyDeleted: Boolean(source.isPermanentlyDeleted),
      isPinned: Boolean(source.isPinned),
      pinnedSortOrder: source.pinnedSortOrder == null ? null : Number(source.pinnedSortOrder),
      regularSortOrder: source.regularSortOrder == null ? null : Number(source.regularSortOrder),
      folderMembershipStates: clone(source.folderMembershipStates || {}),
      siteAliasStates: clone(source.siteAliasStates || {}),
      passkeyLinkStates: clone(source.passkeyLinkStates || {}),
      usernameUpdatedAtMs: Number(source.usernameUpdatedAtMs) || updatedAtMs,
      usernameUpdatedDeviceName: text(source.usernameUpdatedDeviceName) || deviceName,
      passwordUpdatedAtMs: Number(source.passwordUpdatedAtMs) || updatedAtMs,
      passwordUpdatedDeviceName: text(source.passwordUpdatedDeviceName) || deviceName,
      totpUpdatedAtMs: Number(source.totpUpdatedAtMs) || updatedAtMs,
      totpUpdatedDeviceName: text(source.totpUpdatedDeviceName) || deviceName,
      recoveryCodesUpdatedAtMs: Number(source.recoveryCodesUpdatedAtMs) || updatedAtMs,
      recoveryCodesUpdatedDeviceName: text(source.recoveryCodesUpdatedDeviceName) || deviceName,
      noteUpdatedAtMs: Number(source.noteUpdatedAtMs) || updatedAtMs,
      noteUpdatedDeviceName: text(source.noteUpdatedDeviceName) || deviceName,
      passkeyUpdatedAtMs: Number(source.passkeyUpdatedAtMs) || updatedAtMs,
      passkeyUpdatedDeviceName: text(source.passkeyUpdatedDeviceName) || deviceName,
      createdAtMs,
      updatedAtMs,
      deletedAtMs: Number(source.deletedAtMs || 0) || null,
      deletedFromFolderIds: unique(source.deletedFromFolderIds || []),
      deletedDeviceName: text(source.deletedDeviceName),
      lastOperatedDeviceName: deviceName,
      createdDeviceName: text(source.createdDeviceName) || deviceName,
    };
  };

  const normalizeFolder = (raw) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const folderId = text(source.id) || id("folder");
    const createdAtMs = Number(source.createdAtMs) || Number(source.updatedAtMs) || now();
    return {
      ...clone(source),
      id: folderId,
      name: text(source.name) || "未命名文件夹",
      regularAccountIds: unique(source.regularAccountIds || []),
      regularOrderUpdatedAtMs: Number(source.regularOrderUpdatedAtMs) || 0,
      regularOrderUpdatedDeviceName: text(source.regularOrderUpdatedDeviceName),
      matchedSites: unique(source.matchedSites || []),
      autoAddMatchingSites: Boolean(source.autoAddMatchingSites),
      isDeleted: Boolean(source.isDeleted),
      isPermanentlyDeleted: Boolean(source.isPermanentlyDeleted),
      createdAtMs,
      updatedAtMs: Number(source.updatedAtMs) || createdAtMs,
      deletedAtMs: Number(source.deletedAtMs || 0) || null,
      deletedDeviceName: text(source.deletedDeviceName),
    };
  };

  const normalizeData = (raw) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const folders = (Array.isArray(source.folders) ? source.folders : []).map(normalizeFolder);
    const accounts = (Array.isArray(source.accounts) ? source.accounts : []).map(normalizeAccount);
    const folderIds = new Set(folders.map((folder) => folder.id.toLowerCase()));
    for (const account of accounts) {
      account.folderIds = account.folderIds.filter((folderId) => folderIds.has(folderId.toLowerCase()));
      account.folderId = account.folderIds[0] || null;
    }
    const activeIds = new Set(accounts.filter((account) => !account.isDeleted && !account.isPermanentlyDeleted).map((account) => account.recordId));
    const allRegularAccountIds = unique(source.allRegularAccountIds || [])
      .filter((accountId) => activeIds.has(accountId));
    for (const account of accounts) {
      if (!account.isDeleted && !account.isPermanentlyDeleted && !allRegularAccountIds.some((item) => sameId(item, account.recordId))) {
        allRegularAccountIds.push(account.recordId);
      }
    }
    for (const folder of folders) {
      folder.regularAccountIds = folder.regularAccountIds.filter((accountId) => activeIds.has(accountId));
      for (const account of accounts) {
        if (!account.isDeleted && account.folderIds.some((folderId) => sameId(folderId, folder.id)) &&
            !folder.regularAccountIds.some((accountId) => sameId(accountId, account.recordId))) {
          folder.regularAccountIds.push(account.recordId);
        }
      }
    }
    const folderOrderIds = unique(source.folderOrderIds || []).filter((folderId) => folders.some((folder) => sameId(folder.id, folderId)));
    for (const folder of folders) if (!folderOrderIds.some((folderId) => sameId(folder.id, folderId))) folderOrderIds.push(folder.id);
    return {
      accounts,
      folders,
      passkeys: Array.isArray(source.passkeys) ? clone(source.passkeys) : [],
      allRegularAccountIds,
      allRegularOrderUpdatedAtMs: Number(source.allRegularOrderUpdatedAtMs) || 0,
      allRegularOrderUpdatedDeviceName: text(source.allRegularOrderUpdatedDeviceName),
      folderOrderIds,
      folderOrderUpdatedAtMs: Number(source.folderOrderUpdatedAtMs) || 0,
      folderOrderUpdatedDeviceName: text(source.folderOrderUpdatedDeviceName),
      deviceName: text(source.deviceName),
    };
  };

  const defaultStore = () => ({ data: emptyData(), undo: [], redo: [], snapshots: [] });
  const bytesToBinary = (bytes) => {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return binary;
  };
  const bytesToBase64Early = (bytes) => btoa(bytesToBinary(bytes));
  const base64ToBytesEarly = (value) => { try { return Uint8Array.from(atob(String(value || "")), (char) => char.charCodeAt(0)); } catch (_) { return new Uint8Array(); } };
  const loadDataKey = async ({ createIfMissing = true } = {}) => {
    if (dataKeyPromise) return dataKeyPromise;
    dataKeyPromise = (async () => {
      const lockState = await getLock();
      if (lockState.enabled && lockState.locked) throw new Error("应用已锁定，请先解锁");
      const result = await chrome.storage.local.get([DATA_KEY]);
      let raw = base64ToBytesEarly(result?.[DATA_KEY]);
      if (raw.length !== 32) {
        if (!createIfMissing) {
          throw new Error("Chrome 扩展数据密钥缺失，原数据未覆盖；请重新加载扩展或导入备份");
        }
        raw = crypto.getRandomValues(new Uint8Array(32));
        await chrome.storage.local.set({ [DATA_KEY]: bytesToBase64Early(raw) });
      }
      return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    })().catch((error) => {
      dataKeyPromise = null;
      throw error;
    });
    return dataKeyPromise;
  };
  const decryptStore = async (raw) => {
    if (!raw?.ciphertextBase64 || !raw?.nonceBase64) return raw;
    const key = await loadDataKey({ createIfMissing: false });
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytesEarly(raw.nonceBase64), additionalData: new TextEncoder().encode(STORAGE_KEY) }, key, base64ToBytesEarly(raw.ciphertextBase64));
    return JSON.parse(new TextDecoder().decode(plaintext));
  };
  const encryptStore = async (value) => {
    const key = await loadDataKey();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(STORAGE_KEY) }, key, new TextEncoder().encode(JSON.stringify(value)));
    return { version: 1, nonceBase64: bytesToBase64Early(nonce), ciphertextBase64: bytesToBase64Early(new Uint8Array(ciphertext)) };
  };
  const loadStore = async () => {
    if (storePromise) return storePromise;
    storePromise = (async () => {
      const result = await chrome.storage.local.get([STORAGE_KEY]);
      const raw = await decryptStore(result?.[STORAGE_KEY]);
      if (raw?.data) {
        const store = {
          data: normalizeData(raw.data),
          undo: Array.isArray(raw.undo) ? raw.undo : [],
          redo: Array.isArray(raw.redo) ? raw.redo : [],
          snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
        };
        await syncWebBridgeData(store.data);
        return store;
      }
      const store = defaultStore();
      await syncWebBridgeData(store.data);
      return store;
    })();
    return storePromise;
  };
  const persist = async (store) => {
    const snapshot = clone(store);
    await chrome.storage.local.set({ [STORAGE_KEY]: await encryptStore(snapshot) });
    await syncWebBridgeData(snapshot.data);
  };

  // The web workspace and the content-script service worker have separate
  // vault implementations. Mirror only business records through an internal
  // extension message so autofill sees changes made in the web UI.
  const syncWebBridgeData = async (data) => {
    if (typeof globalThis.chrome?.runtime?.sendMessage !== "function") return;
    try {
      const response = await new Promise((resolve) => {
        globalThis.chrome.runtime.sendMessage({
          type: "PASS_WEB_BRIDGE_SYNC_DATA",
          payload: {
            accounts: clone(data?.accounts || []),
            folders: clone(data?.folders || []),
            passkeys: clone(data?.passkeys || []),
            allRegularAccountIds: clone(data?.allRegularAccountIds || []),
            allRegularOrderUpdatedAtMs: Number(data?.allRegularOrderUpdatedAtMs) || 0,
            allRegularOrderUpdatedDeviceName: text(data?.allRegularOrderUpdatedDeviceName),
            folderOrderIds: clone(data?.folderOrderIds || []),
            folderOrderUpdatedAtMs: Number(data?.folderOrderUpdatedAtMs) || 0,
            folderOrderUpdatedDeviceName: text(data?.folderOrderUpdatedDeviceName),
            deviceName: text(data?.deviceName),
          },
        }, (result) => {
          if (globalThis.chrome.runtime.lastError) {
            resolve({ ok: false, error: globalThis.chrome.runtime.lastError.message || "后台数据镜像失败" });
            return;
          }
          resolve(result || { ok: false, error: "后台数据镜像没有响应" });
        });
      });
      if (response?.ok === false) {
        console.warn("Pass Web 数据镜像未完成", response.error || response);
      }
    } catch (error) {
      // This page can also run in Tauri or a normal browser without a listener.
      console.warn("Pass Web 数据镜像失败", error);
    }
  };

  if (typeof globalThis.chrome?.runtime?.onMessage?.addListener === "function") {
    globalThis.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "PASS_WEB_BRIDGE_DATA_CHANGED") return false;
      const run = serialized(async () => {
        const store = await loadStore();
        store.data = normalizeData(message.payload || {});
        await persist(store);
      });
      run.then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    });
  }

  let mutationChain = Promise.resolve();
  const serialized = (callback) => {
    const run = mutationChain.then(callback);
    mutationChain = run.catch(() => {});
    return run;
  };
  const mutate = (title, callback) => {
    const run = serialized(async () => {
      const store = await loadStore();
      const before = clone(store.data);
      const result = await callback(store.data);
      const aliasResult = syncAliasGroups(store.data.accounts, syncMergeHelpers, {
        nowMs: now(),
        deviceName: store.data.deviceName || "Chrome",
      });
      store.data.accounts = aliasResult.accounts;
      const after = clone(store.data);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        const entry = { id: id("operation"), title: text(title) || "本地操作", createdAtMs: now(), before, after };
        const undoLength = store.undo.length;
        const snapshotLength = store.snapshots.length;
        const previousRedo = store.redo;
        store.undo.push(entry);
        store.undo = store.undo.slice(-MAX_HISTORY);
        store.redo = [];
        store.snapshots.unshift({
          id: id("snapshot"), createdAtMs: now(), reason: text(title) || "本地安全快照",
          payload: payloadFromData(before),
        });
        store.snapshots = store.snapshots.slice(0, MAX_SNAPSHOTS);
        try {
          await persist(store);
        } catch (error) {
          store.data = before;
          store.undo.length = undoLength;
          store.snapshots.length = snapshotLength;
          store.redo = previousRedo;
          throw error;
        }
      }
      return result;
    });
    return run;
  };

  const findAccount = (data, value) => data.accounts.find((account) =>
    sameId(account.recordId, value) || sameId(account.id, value) || sameId(account.accountId, value));
  const findFolder = (data, value) => data.folders.find((folder) => sameId(folder.id, value));
  const activeAccounts = (data) => data.accounts.filter((account) => !account.isDeleted && !account.isPermanentlyDeleted);
  const visibleFolders = (data) => data.folders.filter((folder) => !folder.isDeleted && !folder.isPermanentlyDeleted);
  const touchAllRegularOrder = (data) => {
    data.allRegularOrderUpdatedAtMs = now();
    data.allRegularOrderUpdatedDeviceName = data.deviceName || "Chrome";
  };
  const touchFolderRegularOrder = (data, folder) => {
    folder.regularOrderUpdatedAtMs = now();
    folder.regularOrderUpdatedDeviceName = data.deviceName || "Chrome";
  };
  const markAccountField = (account, field, value, updatedAtMs, deviceName) => {
    const changed = JSON.stringify(account[field] ?? null) !== JSON.stringify(value ?? null);
    account[field] = clone(value);
    if (changed) {
      const clockField = ({ totpSecret: "totp", recoveryCodes: "recoveryCodes" })[field] || field;
      account[`${clockField}UpdatedAtMs`] = updatedAtMs;
      account[`${clockField}UpdatedDeviceName`] = deviceName;
      account.updatedAtMs = updatedAtMs;
      account.lastOperatedDeviceName = deviceName;
    }
    return changed;
  };
  const markFolderRelation = (account, folderId, isDeleted, updatedAtMs, deviceName) => {
    markFolderMembership(account, folderId, isDeleted, updatedAtMs, deviceName);
  };
  const removeFromOrders = (data, accountId) => {
    data.allRegularAccountIds = data.allRegularAccountIds.filter((item) => !sameId(item, accountId));
    touchAllRegularOrder(data);
    for (const folder of data.folders) {
      const next = folder.regularAccountIds.filter((item) => !sameId(item, accountId));
      if (next.length !== folder.regularAccountIds.length) {
        folder.regularAccountIds = next;
        touchFolderRegularOrder(data, folder);
      }
    }
  };
  const softDeleteAccountState = (data, account, updatedAtMs = now()) => {
    if (!softDeleteAccount(account, updatedAtMs, data.deviceName || "Chrome")) return false;
    if (!account.deletedFromFolderIds?.length) account.deletedFromFolderIds = unique(account.folderIds || []);
    removeFromOrders(data, account.recordId);
    return true;
  };
  const permanentlyDeleteAccountState = (data, account, updatedAtMs = now()) => {
    if (!permanentlyDeleteAccount(account, updatedAtMs, data.deviceName || "Chrome")) return false;
    removeFromOrders(data, account.recordId);
    return true;
  };
  const addToTop = (list, value) => {
    const next = list.filter((item) => !sameId(item, value));
    next.unshift(value);
    return next;
  };
  const setMembership = (data, account, nextIds) => {
    const updatedAtMs = now();
    const deviceName = data.deviceName || "Chrome";
    const oldIds = new Set(account.folderIds.map((item) => item.toLowerCase()));
    const visible = visibleFolders(data);
    const requested = unique(nextIds);
    const invalid = requested.filter((folderId) => !visible.some((folder) => sameId(folder.id, folderId)));
    if (invalid.length) throw new Error(`文件夹不存在：${invalid.join("、")}`);
    const next = requested;
    const nextSet = new Set(next.map((item) => item.toLowerCase()));
    account.folderIds = next;
    account.folderId = next[0] || null;
    for (const folder of data.folders) {
      const had = oldIds.has(folder.id.toLowerCase());
      const has = nextSet.has(folder.id.toLowerCase());
      if (had && !has) {
        folder.regularAccountIds = folder.regularAccountIds.filter((item) => !sameId(item, account.recordId));
        touchFolderRegularOrder(data, folder);
        markFolderRelation(account, folder.id, true, updatedAtMs, deviceName);
      }
      if (!had && has && !account.isDeleted) {
        folder.regularAccountIds = addToTop(folder.regularAccountIds, account.recordId);
        touchFolderRegularOrder(data, folder);
        markFolderRelation(account, folder.id, false, updatedAtMs, deviceName);
      }
    }
    account.updatedAtMs = Math.max(Number(account.updatedAtMs) || 0, updatedAtMs);
    account.lastOperatedDeviceName = deviceName;
  };

  const normalizePayload = (payload) => {
    const source = payload?.payload && typeof payload.payload === "object" ? payload.payload : payload;
    if (!source || typeof source !== "object") throw new Error("同步包格式无效");
    const accountRows = Array.isArray(source.accounts) ? source.accounts : [];
    const folderRows = Array.isArray(source.folders) ? source.folders : [];
    const passkeyRows = Array.isArray(source.passkeys) ? source.passkeys : [];
    if (accountRows.some((item) => !text(item?.recordId || item?.accountId || item?.id))) throw new Error("同步包包含缺少稳定 ID 的账号，已停止写入");
    if (folderRows.some((item) => !text(item?.id))) throw new Error("同步包包含缺少稳定 ID 的文件夹，已停止写入");
    if (passkeyRows.some((item) => !text(item?.recordId || item?.credentialIdB64u || item?.credentialId || item?.id))) throw new Error("同步包包含缺少稳定 ID 的通行密钥，已停止写入");
    return {
      accounts: accountRows.map(normalizeAccount),
      folders: folderRows.map(normalizeFolder),
      passkeys: clone(passkeyRows),
      allRegularAccountIds: unique(source.allRegularAccountIds || []),
      allRegularOrderUpdatedAtMs: Number(source.allRegularOrderUpdatedAtMs) || 0,
      allRegularOrderUpdatedDeviceName: text(source.allRegularOrderUpdatedDeviceName),
      folderOrderIds: unique(source.folderOrderIds || []),
      folderOrderUpdatedAtMs: Number(source.folderOrderUpdatedAtMs) || 0,
      folderOrderUpdatedDeviceName: text(source.folderOrderUpdatedDeviceName),
    };
  };
  const domainAliasGroups = [
    ["apple.com", "apple.com.cn", "icloud.com", "icloud.com.cn"],
    ["qq.com", "wx.qq.com"],
    ["baidu.com", "passport.baidu.com", "pan.baidu.com"],
    ["sina.com", "mail.sina.com", "weibo.com"],
    ["github.com", "gist.github.com"],
    ["gitlab.com", "about.gitlab.com"],
    ["google.com", "accounts.google.com"],
    ["youtube.com", "studio.youtube.com"],
    ["x.com", "twitter.com"],
    ["facebook.com", "messenger.com"],
    ["amazon.com", "smile.amazon.com"],
    ["microsoft.com", "microsoftonline.com", "microsoftonline", "login.microsoftonline.com", "login.microsoft.com", "account.microsoft.com", "live.com", "hotmail.com", "outlook.com", "account.live.com", "office.com", "outlook.office.com", "microsoft365.com", "office365.com", "azure.com", "msn.com"],
    ["paypal.com"],
    ["netflix.com", "help.netflix.com"],
    ["spotify.com", "open.spotify.com"],
    ["linkedin.com"],
    ["dropbox.com"],
  ];
  const domainAliasGroupKey = (value) => {
    const domain = text(value).toLowerCase();
    const group = domainAliasGroups.find((aliases) => aliases.some((alias) => domain === alias || domain.endsWith(`.${alias}`)));
    return group ? group[0] : "";
  };
  const siteRuleMatches = (site, input) => {
    const normalizedSite = text(site).toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "");
    const normalizedInput = text(input).toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, "");
    if (!normalizedSite || !normalizedInput) return false;
    if (normalizedSite === normalizedInput || normalizedSite.endsWith(`.${normalizedInput}`)) return true;
    const siteGroup = domainAliasGroupKey(normalizedSite);
    const inputGroup = domainAliasGroupKey(normalizedInput);
    return Boolean(siteGroup && inputGroup && siteGroup === inputGroup);
  };
  const syncMergeHelpers = {
    normalizeAccountShape: normalizeAccount,
    normalizeFolderIdList: (values) => unique(values).map((value) => value.toLowerCase()),
    normalizeFolderId: (value) => text(value).toLowerCase(),
    extractAccountFolderIds: (account) => account?.folderIds || (account?.folderId ? [account.folderId] : []),
    normalizeSites: (values) => unique(values).map((value) => value.toLowerCase()).sort(),
    etldPlusOne: (value) => {
      const labels = text(value).toLowerCase().split(".").filter(Boolean);
      if (labels.length < 2) return labels.join(".");
      const suffixes = new Set(["com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "co.uk", "org.uk", "com.au", "co.jp", "co.kr", "com.hk", "com.tw", "co.nz"]);
      const suffix = labels.slice(-2).join(".");
      return suffixes.has(suffix) && labels.length >= 3 ? labels.slice(-3).join(".") : suffix;
    },
    normalizeDomain: (value) => text(value).toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/\.$/, ""),
    domainAliasGroupKey,
    normalizePasskeyCredentialIds: (values) => unique(values),
    stableUuidFromText: (value) => text(value),
    normalizePasskeyShape: (value) => ({ ...clone(value || {}), credentialIdB64u: text(value?.credentialIdB64u || value?.credentialId || value?.id) }),
    normalizePasskeyCreateCompatMethod: (value) => text(value) || "standard",
    normalizeFolderShape: normalizeFolder,
    sortFoldersForDisplay: (folders) => folders,
    fixedNewAccountFolderId: "f16a2c4e-4a2a-43d5-a670-3f1767d41001",
    fixedNewAccountFolderName: "新账号",
  };
  const mergePayload = (local, remote) => {
    const merged = mergeSyncPayloads(local, remote, syncMergeHelpers);
    const aliasResult = syncAliasGroups(merged.accounts, syncMergeHelpers, {
      nowMs: now(),
      deviceName: local?.deviceName || "Chrome",
    });
    return { ...merged, accounts: aliasResult.accounts };
  };
  const payloadFromData = (data) => ({ accounts: clone(data.accounts), folders: clone(data.folders), passkeys: clone(data.passkeys), allRegularAccountIds: clone(data.allRegularAccountIds), allRegularOrderUpdatedAtMs: Number(data.allRegularOrderUpdatedAtMs) || 0, allRegularOrderUpdatedDeviceName: text(data.allRegularOrderUpdatedDeviceName), folderOrderIds: clone(data.folderOrderIds), folderOrderUpdatedAtMs: Number(data.folderOrderUpdatedAtMs) || 0, folderOrderUpdatedDeviceName: text(data.folderOrderUpdatedDeviceName) });
  const bytesToBase64 = (bytes) => btoa(bytesToBinary(bytes));
  const base64ToBytes = (value) => { try { return Uint8Array.from(atob(String(value || "")), (char) => char.charCodeAt(0)); } catch (_) { return new Uint8Array(); } };
  const base64UrlToBytes = (value) => { const base64 = text(value).replaceAll("-", "+").replaceAll("_", "/"); return base64ToBytes(base64 + "=".repeat((4 - (base64.length % 4)) % 4)); };
  const normalizeSyncKey = (value) => { const key = text(value); return base64UrlToBytes(key).length === 32 ? key : ""; };
  const syncKeyId = async (value) => { const key = normalizeSyncKey(value); if (!key) return ""; const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", base64UrlToBytes(key))); return `k1-${Array.from(digest).map((item) => item.toString(16).padStart(2, "0")).join("").slice(0, 16)}`; };
  const encryptDocument = async (documentValue, rawKey) => {
    const key = normalizeSyncKey(rawKey); if (!key) return documentValue;
    const imported = await crypto.subtle.importKey("raw", base64UrlToBytes(key), "AES-GCM", false, ["encrypt"]);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode("pass.sync.encrypted.v1") }, imported, new TextEncoder().encode(JSON.stringify(documentValue)));
    return { schema: "pass.sync.encrypted.v1", exportedAtMs: Number(documentValue?.exportedAtMs || now()), keyId: await syncKeyId(key), cipher: "AES-256-GCM", nonceBase64: bytesToBase64(nonce), ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)) };
  };
  const decryptDocument = async (envelope, rawKey, fallbackKey = "") => {
    if (envelope?.schema === "pass.sync.bundle.v2" || envelope?.payload) { if (normalizeSyncKey(rawKey)) throw new Error("同步密钥已配置，拒绝未加密同步包"); return envelope; }
    if (envelope?.schema !== "pass.sync.encrypted.v1") throw new Error("不支持的同步包格式");
    const candidates = [rawKey, fallbackKey].map(normalizeSyncKey).filter(Boolean); if (!candidates.length) throw new Error("该同步包为加密信封，但当前未配置同步加密密钥");
    for (const key of candidates) {
      if (envelope.keyId && envelope.keyId !== await syncKeyId(key)) continue;
      try {
        const imported = await crypto.subtle.importKey("raw", base64UrlToBytes(key), "AES-GCM", false, ["decrypt"]);
        const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(envelope.nonceBase64), additionalData: new TextEncoder().encode("pass.sync.encrypted.v1") }, imported, base64ToBytes(envelope.ciphertextBase64));
        return JSON.parse(new TextDecoder().decode(plaintext));
      } catch (_) {}
    }
    throw new Error("同步包解密失败，请确认同步密钥一致");
  };
  const downloadJson = (value, filename) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const verifyRestoreReceipt = async (response, idempotencyKey) => {
    const scope = text(response.headers.get("X-Sync-Scope"));
    const etag = text(response.headers.get("ETag"));
    const payloadSha256 = text(response.headers.get("X-Payload-Sha256"));
    const revision = Number(response.headers.get("X-Sync-Revision"));
    const responseKey = text(response.headers.get("X-Sync-Idempotency-Key"));
    let receipt;
    try { receipt = await response.json(); } catch (_) { throw new Error("服务器恢复回执不是有效 JSON"); }
    if (!receipt?.ok || !receipt?.committed || !scope || receipt.scope !== scope
      || !etag || receipt.etag !== etag || !payloadSha256 || receipt.payloadSha256 !== payloadSha256
      || !Number.isInteger(revision) || revision < 1 || receipt.revision !== revision
      || responseKey !== idempotencyKey || receipt.idempotencyKey !== idempotencyKey) {
      throw new Error("服务器恢复回执校验失败");
    }
    return { etag, payloadSha256, revision };
  };

  const getPrefs = async () => {
    const result = await chrome.storage.local.get([PREFS_KEY]);
    const stored = result?.[PREFS_KEY];
    const decoded = await decryptStore(stored).catch(() => null);
    const prefs = decoded?.uiPrefs || (decoded && !decoded.ciphertextBase64 ? decoded : null);
    const normalized = { ...{
      fontFamily: "系统默认", textFontSize: 14, buttonFontSize: 13, toastDurationSeconds: 2.5,
      showPasswordsGlobally: false, exportDirectory: "", autoSyncIntervalMinutes: 0,
      previousEncryptionKey: "", webdavEnabled: false, webdavBaseUrl: "", webdavRemotePath: "pass-sync-bundle-v2.json",
      webdavUsername: "", webdavPassword: "", syncPrimarySource: "selfHosted",
    }, ...(prefs || {}) };
    if (prefs && stored && !stored.ciphertextBase64) await savePrefs(normalized);
    return normalized;
  };
  const savePrefs = async (prefs) => {
    await chrome.storage.local.set({ [PREFS_KEY]: await encryptStore({ uiPrefs: clone(prefs) }) });
    return prefs;
  };
  const syncDefault = () => ({ enabled: false, baseUrl: "", authToken: "", encryptionKey: "", mode: "merge" });
  const getSync = async () => {
    const result = await chrome.storage.local.get([SYNC_KEY]);
    const stored = result?.[SYNC_KEY];
    const decoded = await decryptStore(stored).catch(() => null);
    const settings = decoded?.syncSettings || (decoded && !decoded.ciphertextBase64 ? decoded : null);
    const normalized = { ...syncDefault(), ...(settings || {}) };
    if (settings && stored && !stored.ciphertextBase64) await saveSync(normalized);
    return normalized;
  };
  const saveSync = async (settings) => {
    await chrome.storage.local.set({ [SYNC_KEY]: await encryptStore({ syncSettings: clone(settings) }) });
    return settings;
  };
  const lockDefault = () => ({ enabled: false, locked: false, lockPolicy: "onceUntilQuit", idleLockMinutes: 5, preferBiometrics: false, backgroundLockDelaySeconds: 60, biometricReady: false, saltBase64: "", verifierBase64: "", iterations: LOCK_PBKDF2_ITERATIONS, lastActivityAtMs: 0 });
  const getLock = async () => {
    const result = await chrome.storage.local.get([LOCK_KEY]);
    return { ...lockDefault(), ...(result?.[LOCK_KEY] || {}) };
  };
  const deriveLockVerifier = async (password, saltBase64, iterations = LOCK_PBKDF2_ITERATIONS) => {
    const passwordKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveBits"]);
    const salt = base64ToBytesEarly(saltBase64);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Math.max(1, Number(iterations) || LOCK_PBKDF2_ITERATIONS), hash: "SHA-256" }, passwordKey, 256);
    return new Uint8Array(bits);
  };
  const equalBytes = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
  const verifyLockPassword = async (lock, password) => {
    if (!lock.enabled || !lock.saltBase64 || !lock.verifierBase64) throw new Error("应用锁未启用");
    const actual = await deriveLockVerifier(password, lock.saltBase64, lock.iterations);
    if (!equalBytes(actual, base64ToBytesEarly(lock.verifierBase64))) throw new Error("主密码错误");
  };
  const refreshLock = async () => {
    const lock = await getLock();
    if (lock.enabled && !lock.locked && lock.lockPolicy === "idleTimeout" && Number(lock.idleLockMinutes) > 0 && now() - Number(lock.lastActivityAtMs || 0) >= Number(lock.idleLockMinutes) * 60000) {
      lock.locked = true;
      await saveJsonKey(LOCK_KEY, lock);
    }
    return lock;
  };
  const lockExemptCommands = new Set(["health_check", "get_lock_state", "get_sync_settings", "lock_enable", "lock_unlock", "lock_unlock_biometric", "lock_biometric_available", "lock_touch"]);
  const saveJsonKey = async (key, value) => { await chrome.storage.local.set({ [key]: clone(value) }); return value; };


  const accountInFolder = (account, folderId) => (account.folderIds || []).some((id) => sameId(id, folderId));
  const folderDuplicateGroups = (data, folderId) => {
    const groups = new Map();
    for (const account of activeAccounts(data).filter((item) => accountInFolder(item, folderId))) {
      const sites = unique([...(account.sites || []), account.canonicalSite].filter(Boolean)).map((site) => site.toLowerCase()).sort();
      const key = `${sites.join("|")}\n${text(account.username).toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(clone(account));
    }
    return [...groups.entries()]
      .map(([id, accounts]) => {
        accounts.sort((left, right) => (Number(right.updatedAtMs) || 0) - (Number(left.updatedAtMs) || 0) || (Number(right.createdAtMs) || 0) - (Number(left.createdAtMs) || 0));
        return {
          id,
          siteAliases: unique(accounts.flatMap((account) => account.sites || []).concat(accounts.map((account) => account.canonicalSite)).filter(Boolean)),
          username: text(accounts[0]?.username) || "(空用户名)",
          accounts,
        };
      })
      .filter((group) => group.accounts.length > 1)
      .sort((left, right) => (Number(right.accounts[0]?.updatedAtMs) || 0) - (Number(left.accounts[0]?.updatedAtMs) || 0));
  };

  const invokeCommand = async (command, args = {}) => {
    const lock = await refreshLock();
    if (lock.enabled && lock.locked && !lockExemptCommands.has(command)) {
      throw new Error("应用已锁定，请先解锁");
    }
    if (lock.enabled && !lock.locked && !lockExemptCommands.has(command)) {
      lock.lastActivityAtMs = now();
      await saveJsonKey(LOCK_KEY, lock);
    }
    const store = lockExemptCommands.has(command) ? null : await loadStore();
    switch (command) {
      case "get_app_state": {
        const data = store.data;
        const orderedFolders = [...data.folderOrderIds.map((folderId) => data.folders.find((folder) => sameId(folder.id, folderId))).filter(Boolean), ...data.folders.filter((folder) => !data.folderOrderIds.some((folderId) => sameId(folder.id, folderId)))];
        return {
          activeAccounts: clone(activeAccounts(data)),
          deletedAccounts: clone(data.accounts.filter((account) => account.isDeleted && !account.isPermanentlyDeleted)),
          folders: clone(orderedFolders), passkeys: clone(data.passkeys),
          allRegularAccountIds: clone(data.allRegularAccountIds), deviceName: data.deviceName || "",
        };
      }
      case "get_ui_prefs": return getPrefs();
      case "set_ui_prefs": return savePrefs({ ...(await getPrefs()), ...(args.prefs || {}) });
      case "get_sync_settings": { const settings = await getSync(); return lock.enabled && lock.locked ? { ...settings, authToken: "", encryptionKey: "" } : settings; }
      case "set_sync_settings": return saveSync({ ...(await getSync()), ...(args.settings || {}) });
      case "set_device_name": return mutate("修改设备名称", (data) => { data.deviceName = text(args.deviceName); return data.deviceName; });
      case "get_lock_state": return getLock();
      case "lock_biometric_available": return false;
      case "lock_touch": { const current = await getLock(); if (current.enabled && !current.locked) { current.lastActivityAtMs = now(); await saveJsonKey(LOCK_KEY, current); } return true; }
      case "lock_now": return saveJsonKey(LOCK_KEY, { ...(await getLock()), locked: true });
      case "lock_unlock": { const current = await getLock(); if (!current.enabled) return current; await verifyLockPassword(current, args.password); current.locked = false; current.lastActivityAtMs = now(); return saveJsonKey(LOCK_KEY, current); }
      case "lock_unlock_biometric": throw new Error("Chrome 扩展不提供系统指纹解锁");
      case "lock_enable": { const existing = await getLock(); if (existing.enabled) throw new Error("应用锁已启用，请先关闭后再设置新的主密码"); const password = String(args.password || ""); const confirm = String(args.confirm || ""); if (!password.trim()) throw new Error("请输入主密码"); if (password !== confirm) throw new Error("两次输入的主密码不一致"); const salt = crypto.getRandomValues(new Uint8Array(16)); const verifier = await deriveLockVerifier(password, bytesToBase64Early(salt)); const next = { ...existing, enabled: true, locked: false, lockPolicy: args.lockPolicy || "onceUntilQuit", idleLockMinutes: Number(args.idleLockMinutes || 5), preferBiometrics: false, biometricReady: false, saltBase64: bytesToBase64Early(salt), verifierBase64: bytesToBase64Early(verifier), iterations: LOCK_PBKDF2_ITERATIONS, lastActivityAtMs: now() }; return saveJsonKey(LOCK_KEY, next); }
      case "lock_disable": { const current = await getLock(); await verifyLockPassword(current, args.password); return saveJsonKey(LOCK_KEY, lockDefault()); }
      case "lock_save_preferences": { const current = await getLock(); if (!current.enabled) throw new Error("应用锁未启用"); return saveJsonKey(LOCK_KEY, { ...current, lockPolicy: args.lockPolicy || "onceUntilQuit", idleLockMinutes: Number(args.idleLockMinutes || 5), backgroundLockDelaySeconds: Number(args.backgroundLockDelaySeconds || 60), preferBiometrics: false, lastActivityAtMs: now() }); }
      case "lock_change_password": { const current = await getLock(); await verifyLockPassword(current, args.oldPassword); const password = String(args.newPassword || ""); if (!password.trim()) throw new Error("请输入新主密码"); if (password !== String(args.confirm || "")) throw new Error("两次输入的新主密码不一致"); const salt = crypto.getRandomValues(new Uint8Array(16)); const verifier = await deriveLockVerifier(password, bytesToBase64Early(salt)); return saveJsonKey(LOCK_KEY, { ...current, saltBase64: bytesToBase64Early(salt), verifierBase64: bytesToBase64Early(verifier), iterations: LOCK_PBKDF2_ITERATIONS, locked: false, lastActivityAtMs: now() }); }
      case "get_undo_status": { const entry = store.undo.at(-1); return entry ? { title: entry.title, createdAtMs: entry.createdAtMs } : null; }
      case "get_redo_status": { const entry = store.redo.at(-1); return entry ? { title: entry.title, createdAtMs: entry.createdAtMs } : null; }
      case "get_operation_history": return [...store.undo.map((entry) => ({ ...entry, stack: "undo" })), ...store.redo.map((entry) => ({ ...entry, stack: "redo" }))].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, MAX_HISTORY);
      case "undo_last_operation": return serialized(async () => { const current = await loadStore(); const entry = current.undo.pop(); if (!entry) throw new Error("没有可撤销的本地操作"); current.data = normalizeData(clone(entry.before)); current.redo.push(entry); await persist(current); return `已撤销：${entry.title}`; });
      case "redo_last_operation": return serialized(async () => { const current = await loadStore(); const entry = current.redo.pop(); if (!entry) throw new Error("没有可重做的本地操作"); current.data = normalizeData(clone(entry.after)); current.undo.push(entry); await persist(current); return `已重做：${entry.title}`; });
      case "create_account": {
        const input = args.input || {};
        return mutate("新建账号", (data) => { const requestedFolderIds = input.folderIds || []; const account = normalizeAccount({ ...input, folderIds: [], recordId: id("account"), createdAtMs: now(), updatedAtMs: now(), isDeleted: false }); data.accounts.push(account); data.allRegularAccountIds = addToTop(data.allRegularAccountIds, account.recordId); touchAllRegularOrder(data); setMembership(data, account, requestedFolderIds); return clone(account); });
      }
      case "update_account": return mutate("编辑账号", (data) => {
        const account = findAccount(data, args.id);
        if (!account) throw new Error("账号不存在");
        const input = args.input || {};
        const updatedAtMs = now();
        const deviceName = data.deviceName || "Chrome";
        markAccountField(account, "username", String(input.username ?? ""), updatedAtMs, deviceName);
        markAccountField(account, "password", String(input.password ?? ""), updatedAtMs, deviceName);
        markAccountField(account, "totpSecret", String(input.totpSecret ?? ""), updatedAtMs, deviceName);
        markAccountField(account, "recoveryCodes", String(input.recoveryCodes ?? ""), updatedAtMs, deviceName);
        markAccountField(account, "note", String(input.note ?? ""), updatedAtMs, deviceName);
        const sites = unique(input.sites || []);
        const previousSites = new Set(account.sites || []);
        account.sites = sites;
        account.canonicalSite = sites[0] || account.canonicalSite || "";
        account.siteAliasStates = { ...(account.siteAliasStates || {}) };
        for (const site of previousSites) if (!sites.some((value) => value.toLowerCase() === site.toLowerCase())) account.siteAliasStates[site.toLowerCase()] = { isDeleted: true, updatedAtMs, deviceName };
        for (const site of sites) account.siteAliasStates[site.toLowerCase()] = { isDeleted: false, updatedAtMs, deviceName };
        account.updatedAtMs = Math.max(Number(account.updatedAtMs) || 0, updatedAtMs);
        account.lastOperatedDeviceName = deviceName;
        return clone(account);
      });
      case "set_account_folders": return mutate("修改账号文件夹", (data) => { const account = findAccount(data, args.id); if (!account) throw new Error("账号不存在"); setMembership(data, account, args.folderIds || []); account.updatedAtMs = now(); return clone(account.folderIds); });
      case "set_accounts_folders": return mutate("批量修改账号文件夹", (data) => { const accounts = unique(args.accountIds || []).map((accountId) => findAccount(data, accountId)); if (accounts.some((account) => !account)) throw new Error("包含不存在的账号"); for (const account of accounts) if (!account.isDeleted && !account.isPermanentlyDeleted) setMembership(data, account, args.folderIds || []); return true; });
      case "create_folder": return mutate("新建文件夹", (data) => { const name = text(args.name); if (!name) throw new Error("文件夹名不能为空"); const updatedAtMs = now(); const folder = normalizeFolder({ id: id("folder"), name, createdAtMs: updatedAtMs, updatedAtMs }); data.folders.push(folder); data.folderOrderIds.push(folder.id); data.folderOrderUpdatedAtMs = updatedAtMs; data.folderOrderUpdatedDeviceName = data.deviceName || "Chrome"; return clone(folder); });
      case "rename_folder": return mutate("重命名文件夹", (data) => { const folder = findFolder(data, args.id); if (!folder) throw new Error("文件夹不存在"); if (sameId(folder.id, FIXED_NEW_ACCOUNT_FOLDER_ID)) throw new Error("固定文件夹不可重命名"); if (folder.isDeleted || folder.isPermanentlyDeleted) throw new Error("文件夹已删除"); const name = text(args.name); if (!name) throw new Error("文件夹名不能为空"); folder.name = name; folder.updatedAtMs = now(); return clone(folder); });
      case "delete_folder": return mutate("删除文件夹", (data) => { const folder = findFolder(data, args.id); if (!folder) throw new Error("文件夹不存在"); if (sameId(folder.id, FIXED_NEW_ACCOUNT_FOLDER_ID)) throw new Error("固定文件夹不可删除"); const updatedAtMs = now(); const deviceName = data.deviceName || "Chrome"; if (!permanentlyDeleteFolder(folder, updatedAtMs, deviceName)) throw new Error("文件夹已删除"); data.folderOrderIds = data.folderOrderIds.filter((folderId) => !sameId(folderId, folder.id)); data.folderOrderUpdatedAtMs = updatedAtMs; data.folderOrderUpdatedDeviceName = deviceName; for (const account of data.accounts) if (account.folderIds.some((folderId) => sameId(folderId, folder.id))) { account.deletedFromFolderIds = unique([...(account.deletedFromFolderIds || []), folder.id]); account.folderIds = account.folderIds.filter((folderId) => !sameId(folderId, folder.id)); markFolderRelation(account, folder.id, true, updatedAtMs, deviceName); account.updatedAtMs = updatedAtMs; account.lastOperatedDeviceName = deviceName; } return true; });
      case "reorder_folders": return mutate("调整文件夹顺序", (data) => { const ids = unique(args.orderedIds || []); const active = visibleFolders(data).map((folder) => folder.id); data.folderOrderIds = [...ids.filter((item) => active.some((id2) => sameId(id2, item))), ...active.filter((item) => !ids.some((id2) => sameId(id2, item)))]; data.folderOrderUpdatedAtMs = now(); data.folderOrderUpdatedDeviceName = data.deviceName || "Chrome"; return data.folderOrderIds; });
      case "reorder_accounts": return mutate("调整账号顺序", (data) => { const requested = unique(args.orderedIds || []); const scope = text(args.scopeId); if (scope.toLowerCase().startsWith("folder:")) { const folder = findFolder(data, scope.slice(7)); if (!folder) throw new Error("文件夹不存在"); const active = activeAccounts(data).filter((account) => account.folderIds.some((folderId) => sameId(folderId, folder.id))).map((account) => account.recordId); const ids = [...requested.filter((id) => active.some((item) => sameId(item, id))), ...active.filter((id) => !requested.some((item) => sameId(item, id)))]; folder.regularAccountIds = ids; touchFolderRegularOrder(data, folder); return ids; } if (args.pinned) { const activePinned = activeAccounts(data).filter((account) => account.isPinned); const ranks = new Map(requested.map((item, index) => [item.toLowerCase(), index])); for (const account of activePinned) if (ranks.has(account.recordId.toLowerCase())) account.pinnedSortOrder = ranks.get(account.recordId.toLowerCase()); return requested; } const active = activeAccounts(data).map((account) => account.recordId); const ids = [...requested.filter((id) => active.some((item) => sameId(item, id))), ...active.filter((id) => !requested.some((item) => sameId(item, id)))]; data.allRegularAccountIds = ids; touchAllRegularOrder(data); return ids; });
      case "toggle_account_pin": return mutate("切换账号置顶", (data) => { const account = findAccount(data, args.id); if (!account) throw new Error("账号不存在"); const updatedAtMs = now(); const deviceName = data.deviceName || "Chrome"; const nextPinned = !account.isPinned; const nextOrder = nextPinned ? Math.max(-1, ...activeAccounts(data).filter((item) => item !== account && item.isPinned).map((item) => Number(item.pinnedSortOrder) || 0)) + 1 : null; setAccountPinned(account, nextPinned, nextOrder, updatedAtMs, deviceName); return clone(account); });
      case "set_accounts_pinned": return mutate(args.pinned ? "批量置顶账号" : "批量取消置顶", (data) => { const selected = unique(args.accountIds || []).map((accountId) => findAccount(data, accountId)); if (selected.some((account) => !account)) throw new Error("包含不存在的账号"); if (!selected.length) throw new Error("没有可置顶的账号"); const updatedAtMs = now(); const deviceName = data.deviceName || "Chrome"; let nextOrder = Math.max(-1, ...activeAccounts(data).filter((account) => account.isPinned).map((account) => Number(account.pinnedSortOrder) || 0)) + 1; for (const account of selected) { const wasPinned = account.isPinned; setAccountPinned(account, Boolean(args.pinned), wasPinned ? account.pinnedSortOrder : nextOrder, updatedAtMs, deviceName); if (args.pinned && !wasPinned) nextOrder += 1; } return true; });
      case "soft_delete_account": return invokeCommand("soft_delete_accounts", { accountIds: [args.id] });
      case "soft_delete_accounts": return mutate("移入回收站", (data) => { let count = 0; const updatedAtMs = now(); for (const accountId of unique(args.accountIds || [])) { const account = findAccount(data, accountId); if (!account) throw new Error("包含不存在的账号"); if (softDeleteAccountState(data, account, updatedAtMs)) count += 1; } return count; });
      case "restore_account": return mutate("恢复账号", (data) => { const account = findAccount(data, args.id); if (!account) throw new Error("账号不存在"); const updatedAtMs = now(); const deviceName = data.deviceName || "Chrome"; if (!restoreAccountFields(account, updatedAtMs, deviceName)) throw new Error("账号未在回收站"); account.folderIds = unique(account.deletedFromFolderIds || account.folderIds).filter((folderId) => visibleFolders(data).some((folder) => sameId(folder.id, folderId))); data.allRegularAccountIds = addToTop(data.allRegularAccountIds, account.recordId); touchAllRegularOrder(data); for (const folder of visibleFolders(data)) if (account.folderIds.some((folderId) => sameId(folderId, folder.id))) { folder.regularAccountIds = addToTop(folder.regularAccountIds, account.recordId); touchFolderRegularOrder(data, folder); markFolderRelation(account, folder.id, false, updatedAtMs, deviceName); } return clone(account); });
      case "restore_all_deleted_accounts": return mutate("恢复全部回收站账号", (data) => { const restored = data.accounts.filter((account) => account.isDeleted && !account.isPermanentlyDeleted); const updatedAtMs = now(); const deviceName = data.deviceName || "Chrome"; for (const account of restored) { if (!restoreAccountFields(account, updatedAtMs, deviceName)) continue; account.folderIds = unique(account.deletedFromFolderIds?.length ? account.deletedFromFolderIds : account.folderIds).filter((folderId) => visibleFolders(data).some((folder) => sameId(folder.id, folderId))); for (const folderId of account.folderIds) markFolderRelation(account, folderId, false, updatedAtMs, deviceName); } if (restored.length) { const restoredIds = restored.map((account) => account.recordId); data.allRegularAccountIds = [...restoredIds, ...data.allRegularAccountIds.filter((item) => !restoredIds.some((id2) => sameId(id2, item)))]; touchAllRegularOrder(data); for (const folder of visibleFolders(data)) { const folderIds = restored.filter((account) => account.folderIds.some((folderId) => sameId(folderId, folder.id))).map((account) => account.recordId); if (folderIds.length) { folder.regularAccountIds = [...folderIds, ...folder.regularAccountIds.filter((item) => !folderIds.some((id2) => sameId(id2, item)))]; touchFolderRegularOrder(data, folder); } } } return restored.length; });
      case "hard_delete_account": return mutate("永久删除账号", (data) => { const account = findAccount(data, args.id); if (!account) throw new Error("账号不存在"); return permanentlyDeleteAccountState(data, account); });
      case "hard_delete_all_deleted_accounts": return mutate("清空回收站", (data) => { let count = 0; const updatedAtMs = now(); for (const account of data.accounts) if (account.isDeleted && !account.isPermanentlyDeleted && permanentlyDeleteAccountState(data, account, updatedAtMs)) count += 1; return count; });
      case "configure_folder_site_rules": return mutate("配置文件夹网站规则", (data) => { const folder = findFolder(data, args.folderId); if (!folder) throw new Error("文件夹不存在"); folder.matchedSites = unique(args.siteInputs || []); folder.autoAddMatchingSites = Boolean(args.autoAdd); let addedCount = 0; if (folder.autoAddMatchingSites) for (const account of activeAccounts(data)) if (account.sites.some((site) => folder.matchedSites.some((input) => siteRuleMatches(site, input))) && !account.folderIds.some((id2) => sameId(id2, folder.id))) { setMembership(data, account, [...account.folderIds, folder.id]); addedCount += 1; } return { addedCount, message: `已加入 ${addedCount} 个账号` }; });
      case "get_folder_duplicate_groups": {
        if (!findFolder(store.data, args.folderId) || findFolder(store.data, args.folderId).isDeleted) throw new Error("未找到文件夹");
        return folderDuplicateGroups(store.data, text(args.folderId));
      }
      case "deduplicate_folder": return mutate("文件夹去重", (data) => {
        const folder = findFolder(data, args.folderId);
        if (!folder || folder.isDeleted) throw new Error("未找到文件夹");
        const groups = folderDuplicateGroups(data, folder.id);
        if (!groups.length) return { deletedCount: 0, keptCount: 0, groupCount: 0, message: "当前文件夹暂无重复账号" };
        const mode = text(args.mode).toLowerCase() || "latest";
        const keepIds = new Set();
        if (mode === "latest") for (const group of groups) keepIds.add(group.accounts[0].recordId);
        else if (mode === "earliest") for (const group of groups) keepIds.add(group.accounts[group.accounts.length - 1].recordId);
        else if (mode === "account") {
          const requested = text(args.accountId);
          const group = groups.find((item) => item.accounts.some((account) => sameId(account.recordId, requested) || sameId(account.accountId, requested)));
          if (!group) throw new Error("当前重复分组中未找到指定账号");
          const keep = group.accounts.find((account) => sameId(account.recordId, requested) || sameId(account.accountId, requested));
          keepIds.add(keep.recordId);
        } else throw new Error("未知去重方式");
        const duplicateIds = new Set(groups.flatMap((group) => group.accounts.map((account) => account.recordId)));
        let deletedCount = 0;
        for (const account of data.accounts) {
          if (duplicateIds.has(account.recordId) && !keepIds.has(account.recordId) && !account.isDeleted) {
            if (softDeleteAccountState(data, account)) deletedCount += 1;
          }
        }
        return { deletedCount, keptCount: keepIds.size, groupCount: groups.length, message: `去重完成，已移入回收站 ${deletedCount} 个重复账号，保留 ${keepIds.size} 个账号` };
      });
      case "generate_demo_accounts": return invokeCommand("create_account", { input: { sites: ["example.com"], username: "demo", password: "", note: "演示账号" } });
      case "health_check": return {
        ok: true,
        app: "pass-extension-chrome-web",
        surface: "chrome-extension-web",
        mode: "chrome-extension-web",
        storage: "chrome.storage.local",
        sharedCore: ["pass-merge-js-local", "sync-alias-js", "sync-safety-js"],
        capabilities: {
          nativeFilePicker: false,
          sshProvision: false,
          biometricUnlock: false,
          webdavSync: false,
          serverVersions: true,
          folderDedup: true,
          selfHostedSync: true,
          localSnapshots: true,
          syncSafetyEvaluation: true,
          fieldLevelTimestamps: true,
          relationTombstones: true,
          domainAliasSync: true,
          sharedWebUi: true,
        },
      };
      case "sync_key_id": return syncKeyId(args.key);
      case "generate_sync_encryption_key": { const bytes = crypto.getRandomValues(new Uint8Array(32)); return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
      case "save_provision_draft": { const draft = clone(args.draft || {}); await chrome.storage.local.set({ [PROVISION_KEY]: await encryptStore({ provisionDraft: draft }) }); return draft; }
      case "get_provision_draft": { const result = await chrome.storage.local.get([PROVISION_KEY]); const stored = result?.[PROVISION_KEY]; const decoded = await decryptStore(stored).catch(() => null); const draft = decoded?.provisionDraft || (decoded && !decoded.ciphertextBase64 ? decoded : {}); if (draft && stored && !stored.ciphertextBase64) await chrome.storage.local.set({ [PROVISION_KEY]: await encryptStore({ provisionDraft: clone(draft) }) }); return draft || {}; }
      case "get_ssh_credential": return {};
      case "save_ssh_credential_cmd": return true;
      case "verify_sync_endpoint": {
        const settings = await getSync();
        if (!text(settings.baseUrl)) return { ok: false, message: "请先配置同步服务器 URL" };
        try {
          const base = syncBaseUrl(settings.baseUrl);
          const headers = {};
          if (text(settings.authToken)) headers.Authorization = `Bearer ${text(settings.authToken)}`;
          const response = await fetchWithSyncTimeout(`${base}/healthz`, { headers });
          return { ok: response.ok, status: response.status, message: response.ok ? "端点可访问" : `端点返回 HTTP ${response.status}` };
        } catch (error) {
          return { ok: false, message: String(error) };
        }
      }
      case "detect_existing_sync_service": return { exists: false, message: "Chrome 扩展不提供 SSH 部署检测；请在桌面端创建服务，或手动配置已有服务器地址" };
      case "provision_self_hosted_server": throw new Error("创建服务需要桌面端 SSH 能力；Chrome 扩展只保存草稿并支持已有服务器同步");
      case "choose_export_directory": return null;
      case "export_csv_to_path": return exportCsv("pass.csv");
      case "export_csv": return exportCsv("pass.csv");
      case "export_browser_csv_cmd": return exportCsv(`pass-${text(args.format) || "browser"}.csv`);
      case "import_browser_csv_text": return importCsv(text(args.content));
      case "import_google_authenticator_totp": return importTotpEntries(args.entries || []);
      case "export_sync_bundle": { const payload = payloadFromData(store.data); const settings = await getSync(); const bundle = await encryptDocument({ schema: "pass.sync.bundle.v2", exportedAtMs: now(), source: { app: "pass-extension-chrome-web", formatVersion: 2 }, payload }, settings.encryptionKey); downloadJson(bundle, "pass-sync-bundle.json"); return { message: `同步包已导出：账号 ${payload.accounts.filter((a) => !a.isPermanentlyDeleted).length}，文件夹 ${payload.folders.filter((f) => !f.isPermanentlyDeleted).length}` }; }
      case "import_sync_bundle_text": { const settings = await getSync(); const documentValue = await decryptDocument(JSON.parse(text(args.content)), settings.encryptionKey, settings.previousEncryptionKey); const remote = normalizePayload(documentValue); const local = payloadFromData(store.data); const merged = mergePayload(local, remote); const safety = evaluateSyncSafety({ local, remote, merged, mode: "merge" }, syncMergeHelpers); const result = { safe: safety.safe, reasons: safety.reasons, localPayload: local, payload: merged, report: { safe: safety.safe, reasons: safety.reasons, message: safety.safe ? `同步包预览：本地 ${local.accounts.filter((a) => !a.isPermanentlyDeleted).length} → 合并 ${merged.accounts.filter((a) => !a.isPermanentlyDeleted).length}` : `同步包导入停止：安全检查未通过（${safety.reasons.join("、")}）` } }; if (args.apply && safety.safe) { await mutate("导入并合并同步包", (data) => { Object.assign(data, merged); return true; }); result.message = "同步包已合并写入"; } return result; }
      case "merge_sync_payloads": { const local = normalizePayload(JSON.parse(text(args.localJson))); const remote = normalizePayload(JSON.parse(text(args.remoteJson))); const payload = mergePayload(local, remote); const safety = evaluateSyncSafety({ local, remote, merged: payload, mode: "merge" }, syncMergeHelpers); return { ...safety, safe: safety.safe, reasons: safety.reasons, payload }; }
      case "sync_preview": return syncRemote("merge", true);
      case "sync_now_mode": return syncRemote(text(args.mode) || "merge", false);
      case "sync_webdav_now_mode": throw new Error("当前 Chrome 扩展表面尚未实现 WebDAV；请使用桌面端或 Docker Web，或改用自建服务器同步");
      case "list_server_versions": {
        const settings = await getSync();
        if (!text(settings.baseUrl)) return [];
        const base = syncBaseUrl(settings.baseUrl);
        const headers = { Accept: "application/json" };
        if (text(settings.authToken)) headers.Authorization = `Bearer ${text(settings.authToken)}`;
        const response = await fetchWithSyncTimeout(`${base}/v2/sync/versions`, { headers, cache: "no-store" });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`读取服务器快照失败 HTTP ${response.status}${body ? `：${body}` : ""}`);
        }
        const value = await response.json();
        const rows = Array.isArray(value) ? value : (Array.isArray(value?.versions) ? value.versions : []);
        return rows.map((item) => {
          const rawId = item?.id ?? item?.versionId;
          const id = rawId == null ? "" : String(rawId);
          if (!id) return null;
          return {
            id,
            exportedAtMs: Number(item?.exportedAtMs) || 0,
            savedAtMs: Number(item?.savedAtMs) || 0,
            payloadSha256: text(item?.payloadSha256 || item?.sha256 || ""),
          };
        }).filter(Boolean);
      }
      case "restore_server_version": {
        const versionId = text(args.versionId);
        if (!/^\d+$/.test(versionId)) throw new Error("服务器快照编号无效");
        const settings = await getSync();
        const base = syncBaseUrl(settings.baseUrl);
        if (!base) throw new Error("请先配置同步服务器 URL");
        const headers = { Accept: "application/json" };
        if (text(settings.authToken)) headers.Authorization = `Bearer ${text(settings.authToken)}`;
        const current = await fetchWithSyncTimeout(`${base}/v2/sync/state`, { headers, cache: "no-store" });
        if (!current.ok) {
          const body = await current.text().catch(() => "");
          throw new Error(`读取服务器当前状态失败 HTTP ${current.status}${body ? `：${body}` : ""}`);
        }
        const etag = text(current.headers.get("ETag"));
        if (!etag) throw new Error("服务器当前状态没有 ETag，无法安全恢复");
        const idempotencyKey = id("restore");
        const restoreHeaders = { ...headers, "If-Match": etag, "Idempotency-Key": idempotencyKey };
        const restore = await fetchWithSyncTimeout(`${base}/v2/sync/versions/${encodeURIComponent(versionId)}/restore`, { method: "POST", headers: restoreHeaders, cache: "no-store" });
        if (!restore.ok) {
          const body = await restore.text().catch(() => "");
          throw new Error(`恢复服务器快照失败 HTTP ${restore.status}${body ? `：${body}` : ""}`);
        }
        await verifyRestoreReceipt(restore, idempotencyKey);
        const response = await fetchWithSyncTimeout(`${base}/v2/sync/state`, { headers, cache: "no-store" });
        if (!response.ok) throw new Error(`读取恢复后的服务器状态失败 HTTP ${response.status}`);
        const envelope = await response.json();
        const document = await decryptDocument(envelope, settings.encryptionKey, settings.previousEncryptionKey || "");
        const restoredPayload = normalizePayload(document);
        return mutate("恢复服务器快照前自动备份", (data) => {
          const deviceName = data.deviceName || "Chrome";
          Object.assign(data, restoredPayload);
          data.deviceName = deviceName;
          return true;
        }).then(() => {
          const accounts = (restoredPayload.accounts || []).filter((account) => !account.isPermanentlyDeleted).length;
          const folders = (restoredPayload.folders || []).filter((folder) => !folder.isPermanentlyDeleted).length;
          const passkeys = (restoredPayload.passkeys || []).filter((passkey) => !passkey.isPermanentlyDeleted).length;
          return `已恢复快照 ${versionId}：账号 ${accounts}，文件夹 ${folders}，通行密钥 ${passkeys}`;
        });
      }
      case "list_local_snapshots": return store.snapshots.map((snapshot) => ({ id: snapshot.id, reason: snapshot.reason, createdAtMs: snapshot.createdAtMs, accounts: (snapshot.payload.accounts || []).filter((a) => !a.isPermanentlyDeleted).length, folders: (snapshot.payload.folders || []).filter((f) => !f.isPermanentlyDeleted).length, passkeys: (snapshot.payload.passkeys || []).filter((p) => !p.isPermanentlyDeleted).length }));
      case "restore_local_snapshot": { const snapshot = store.snapshots.find((item) => sameId(item.id, args.snapshotId)); if (!snapshot) throw new Error("本地快照不存在"); return mutate("恢复本地安全快照", (data) => { const restored = normalizePayload(snapshot.payload); Object.assign(data, restored); return true; }).then(() => "本地安全快照已恢复"); }
      default: throw new Error(`Chrome 扩展暂未实现命令：${command}`);
    }
  };

  async function exportCsv(filename) {
    const store = await loadStore();
    const accounts = activeAccounts(store.data);
    const csv = accountsToBrowserCsv(accounts);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return { message: `已导出 ${accounts.length} 条账号`, path: filename };
  }
  async function importCsv(csv) {
    const drafts = browserCsvToAccountDrafts(csv);
    if (!drafts.length) return { imported: 0, message: "CSV 为空或未识别到账号" };
    let imported = 0;
    await mutate("导入浏览器密码", (data) => {
      const importedIds = [];
      for (const draft of drafts) {
        const sites = unique(draft.sites || []);
        if (!sites.length) continue;
        const account = normalizeAccount({
          recordId: id("account"),
          sites,
          username: draft.username || "",
          password: draft.password || "",
          note: draft.note || "",
          totpSecret: draft.totpSecret || "",
          createdAtMs: now(),
          updatedAtMs: now(),
        });
        data.accounts.push(account);
        importedIds.push(account.recordId);
        imported += 1;
      }
      if (importedIds.length) {
        data.allRegularAccountIds = [...importedIds, ...data.allRegularAccountIds];
        touchAllRegularOrder(data);
      }
    });
    return { imported, message: `已导入 ${imported} 条账号` };
  }
  async function importTotpEntries(entries) {
    let created = 0, updated = 0, skipped = 0;
    await mutate("导入验证器账号", (data) => { const createdIds = []; for (const entry of entries) { const site = text(entry.site), username = String(entry.username || ""); if (!site || !text(entry.secret)) { skipped += 1; continue; } const existing = data.accounts.find((a) => a.username === username && a.sites.some((s) => s.toLowerCase() === site.toLowerCase())); if (existing) { existing.totpSecret = text(entry.secret); existing.updatedAtMs = now(); updated += 1; } else { const account = normalizeAccount({ recordId: id("account"), sites: [site], username, totpSecret: text(entry.secret), createdAtMs: now(), updatedAtMs: now() }); data.accounts.push(account); createdIds.push(account.recordId); created += 1; } } if (createdIds.length) { data.allRegularAccountIds = [...createdIds, ...data.allRegularAccountIds]; touchAllRegularOrder(data); } });
    return { created, updated, skipped };
  }
  async function syncRemote(mode, dryRun) {
    const settings = await getSync();
    if (!settings.enabled) throw new Error("请先启用自建服务器同步");
    if (!text(settings.baseUrl)) throw new Error("请先配置同步服务器 URL");

    const base = syncBaseUrl(settings.baseUrl);
    const headers = { Accept: "application/json" };
    if (text(settings.authToken)) headers.Authorization = `Bearer ${text(settings.authToken)}`;

    const pull = async () => {
      const response = await fetchWithSyncTimeout(`${base}/v2/sync/state`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      if (response.status === 404) {
        return {
          payload: { accounts: [], folders: [], passkeys: [], allRegularAccountIds: [] },
          etag: null,
          hasState: false,
        };
      }
      if (!response.ok) {
        throw new Error(`拉取同步状态失败 HTTP ${response.status}`);
      }
      const envelope = await response.json();
      const etag = text(response.headers?.get?.("ETag")) || null;
      if (!etag) {
        throw new Error("服务器返回同步数据但没有 ETag，无法安全更新（请检查服务器版本）");
      }
      return {
        payload: normalizePayload(await decryptDocument(envelope, settings.encryptionKey, settings.previousEncryptionKey)),
        etag,
        hasState: true,
      };
    };

    const initialRemote = await pull();
    const store = await loadStore();
    const local = payloadFromData(store.data);
    const choosePayload = (remote) => mode === "remoteOverwriteLocal"
      ? remote
      : mode === "localOverwriteRemote"
        ? local
        : mergePayload(local, remote);
    let remoteState = initialRemote;
    let payload = choosePayload(remoteState.payload);
    const safety = evaluateSyncSafety({ local, remote: remoteState.payload, merged: payload, mode }, syncMergeHelpers);
    const report = {
      safe: safety.safe,
      reasons: safety.reasons,
      ok: true,
      dryRun,
      mode,
      message: dryRun ? "预览完成（未写入）" : "同步完成",
      localAccounts: local.accounts.filter((account) => !account.isPermanentlyDeleted).length,
      remoteAccounts: remoteState.payload.accounts.filter((account) => !account.isPermanentlyDeleted).length,
      mergedAccounts: payload.accounts.filter((account) => !account.isPermanentlyDeleted).length,
      applied: false,
      pushed: false,
    };
    if (dryRun) return { report, localPayload: local, payload };
    if (!safety.safe) throw new Error(`同步安全检查未通过：${safety.reasons.join("、")}`);

    if (mode !== "localOverwriteRemote") {
      await mutate("同步写入本地", (data) => {
        Object.assign(data, payload);
      });
    }

    // Keep one key for the logical write. The server can safely replay it if a
    // response is lost after it committed the payload.
    const idempotencyKey = id("sync");
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const putHeaders = { ...headers, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };
      if (remoteState.etag) putHeaders["If-Match"] = remoteState.etag;
      const body = await encryptDocument({
        schema: "pass.sync.bundle.v2",
        exportedAtMs: now(),
        source: { app: "pass-extension-chrome-web", formatVersion: 2 },
        payload,
      }, settings.encryptionKey);
      const put = await fetchWithSyncTimeout(`${base}/v2/sync/state`, {
        method: "PUT",
        headers: putHeaders,
        body: JSON.stringify(body),
      });
      if (put.ok) {
        await verifyRestoreReceipt(put, idempotencyKey);
        report.remoteAccounts = remoteState.payload.accounts.filter((account) => !account.isPermanentlyDeleted).length;
        report.mergedAccounts = payload.accounts.filter((account) => !account.isPermanentlyDeleted).length;
        report.applied = mode !== "localOverwriteRemote";
        report.pushed = true;
        return { report };
      }
      if (put.status !== 412) {
        if (put.status === 428) {
          throw new Error("推送同步状态失败 HTTP 428：服务器要求 If-Match，但当前远端状态没有可用 ETag");
        }
        throw new Error(`推送同步状态失败 HTTP ${put.status}`);
      }
      if (attempt === maxAttempts - 1) {
        throw new Error("推送同步状态失败 HTTP 412：远端持续发生并发更新，已停止重试");
      }

      // The remote changed between GET and PUT. Pull its new ETag and merge
      // again before retrying, so a concurrent device's fields are preserved.
      const currentStore = await loadStore();
      const currentLocal = payloadFromData(currentStore.data);
      if (!syncPayloadEquals(currentLocal, payload)) {
        throw new Error("本地数据在远端冲突重试期间发生变化，已停止写入，请重新同步");
      }
      remoteState = await pull();
      payload = choosePayload(remoteState.payload);
      if (mode !== "localOverwriteRemote") {
        await mutate("同步冲突重试写入本地", (data) => {
          Object.assign(data, payload);
        });
      }
    }
    throw new Error("远端并发冲突重试次数已用尽");
  }

  globalThis.__PASS_EXTENSION_INVOKE__ = invokeCommand;
})();
