/*
 * Chrome adapter for the Tauri/Web workspace.
 *
 * The workspace UI talks to a small command surface (`invoke`).  Tauri owns
 * that surface in the desktop build; this file owns it in the standalone test
 * extension.  Its storage key is deliberately unique, so loading this plugin
 * cannot read or mutate the old extension's vault.
 */
(() => {
  const STORAGE_KEY = "pass.web.workspace.bridge.v1";
  const DATA_KEY = "pass.web.workspace.bridge.dataKey.v1";
  const PREFS_KEY = "pass.web.workspace.prefs.v1";
  const SYNC_KEY = "pass.web.workspace.sync.v1";
  const LOCK_KEY = "pass.web.workspace.lock.v1";
  const MAX_HISTORY = 100;
  const MAX_SNAPSHOTS = 5;
  let storePromise;

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

  const emptyData = () => ({
    accounts: [],
    folders: [],
    passkeys: [],
    allRegularAccountIds: [],
    folderOrderIds: [],
    deviceName: "",
  });

  const normalizeAccount = (raw) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const sites = unique(source.sites || (source.site ? [source.site] : []));
    const recordId = text(source.recordId || source.accountId || source.id) || id("account");
    const createdAtMs = Number(source.createdAtMs) || now();
    const updatedAtMs = Number(source.updatedAtMs) || createdAtMs;
    return {
      ...clone(source),
      id: text(source.id) || recordId,
      recordId,
      accountId: text(source.accountId) || recordId,
      sites,
      canonicalSite: text(source.canonicalSite) || sites[0] || "",
      username: String(source.username ?? ""),
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
      createdAtMs,
      updatedAtMs,
      deletedAtMs: Number(source.deletedAtMs || 0) || null,
      deletedFromFolderIds: unique(source.deletedFromFolderIds || []),
    };
  };

  const normalizeFolder = (raw) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const folderId = text(source.id) || id("folder");
    return {
      ...clone(source),
      id: folderId,
      name: text(source.name) || "未命名文件夹",
      regularAccountIds: unique(source.regularAccountIds || []),
      matchedSites: unique(source.matchedSites || []),
      autoAddMatchingSites: Boolean(source.autoAddMatchingSites),
      isDeleted: Boolean(source.isDeleted),
      isPermanentlyDeleted: Boolean(source.isPermanentlyDeleted),
      updatedAtMs: Number(source.updatedAtMs) || now(),
    };
  };

  const normalizeData = (raw) => {
    const source = raw && typeof raw === "object" ? raw : {};
    const folders = (Array.isArray(source.folders) ? source.folders : []).map(normalizeFolder);
    const accounts = (Array.isArray(source.accounts) ? source.accounts : []).map(normalizeAccount);
    const folderIds = new Set(folders.map((folder) => folder.id.toLowerCase()));
    for (const account of accounts) {
      account.folderIds = account.folderIds.filter((folderId) => folderIds.has(folderId.toLowerCase()));
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
      folderOrderIds,
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
  const loadDataKey = async () => {
    const result = await chrome.storage.local.get([DATA_KEY]);
    let raw = base64ToBytesEarly(result?.[DATA_KEY]);
    if (raw.length !== 32) {
      raw = crypto.getRandomValues(new Uint8Array(32));
      await chrome.storage.local.set({ [DATA_KEY]: bytesToBase64Early(raw) });
    }
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  };
  const decryptStore = async (raw) => {
    if (!raw?.ciphertextBase64 || !raw?.nonceBase64) return raw;
    const key = await loadDataKey();
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
        return {
          data: normalizeData(raw.data),
          undo: Array.isArray(raw.undo) ? raw.undo : [],
          redo: Array.isArray(raw.redo) ? raw.redo : [],
          snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : [],
        };
      }
      return defaultStore();
    })();
    return storePromise;
  };
  const persist = async (store) => {
    await chrome.storage.local.set({ [STORAGE_KEY]: await encryptStore(clone(store)) });
  };

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
      const after = clone(store.data);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        const entry = { id: id("operation"), title: text(title) || "本地操作", createdAtMs: now(), before, after };
        store.undo.push(entry);
        store.undo = store.undo.slice(-MAX_HISTORY);
        store.redo = [];
        store.snapshots.unshift({
          id: id("snapshot"), createdAtMs: now(), reason: text(title) || "本地安全快照",
          payload: { accounts: before.accounts, folders: before.folders, passkeys: before.passkeys },
        });
        store.snapshots = store.snapshots.slice(0, MAX_SNAPSHOTS);
        await persist(store);
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
  const removeFromOrders = (data, accountId) => {
    data.allRegularAccountIds = data.allRegularAccountIds.filter((item) => !sameId(item, accountId));
    for (const folder of data.folders) folder.regularAccountIds = folder.regularAccountIds.filter((item) => !sameId(item, accountId));
  };
  const addToTop = (list, value) => {
    const next = list.filter((item) => !sameId(item, value));
    next.unshift(value);
    return next;
  };
  const setMembership = (data, account, nextIds) => {
    const oldIds = new Set(account.folderIds.map((item) => item.toLowerCase()));
    const next = unique(nextIds).filter((folderId) => visibleFolders(data).some((folder) => sameId(folder.id, folderId)));
    const nextSet = new Set(next.map((item) => item.toLowerCase()));
    account.folderIds = next;
    for (const folder of data.folders) {
      const had = oldIds.has(folder.id.toLowerCase());
      const has = nextSet.has(folder.id.toLowerCase());
      if (had && !has) folder.regularAccountIds = folder.regularAccountIds.filter((item) => !sameId(item, account.recordId));
      if (!had && has && !account.isDeleted) folder.regularAccountIds = addToTop(folder.regularAccountIds, account.recordId);
    }
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
    };
  };
  const recordKey = (record, prefix) => text(record?.recordId || record?.accountId || record?.id) || `${prefix}:${text(record?.canonicalSite)}:${text(record?.username)}`;
  const newer = (local, remote, field) => {
    const clocks = (value) => value?.fieldUpdatedAtMs?.[field] ?? value?.[`${field}UpdatedAtMs`] ?? value?.updatedAtMs ?? value?.createdAtMs ?? 0;
    const left = Number(clocks(local)) || 0;
    const right = Number(clocks(remote)) || 0;
    if (right !== left) return right > left;
    const rv = remote?.[field];
    const lv = local?.[field];
    if (Array.isArray(rv)) return rv.length >= (Array.isArray(lv) ? lv.length : 0);
    return text(rv) !== "" && text(lv) === "";
  };
  const mergeRecord = (local, remote) => {
    if (!local) return clone(remote);
    if (!remote) return clone(local);
    if (remote.isPermanentlyDeleted || local.isPermanentlyDeleted) {
      return remote.isPermanentlyDeleted ? clone(remote) : clone(local);
    }
    const merged = { ...clone(local), ...clone(local) };
    const fields = new Set([...Object.keys(local), ...Object.keys(remote)]);
    for (const field of fields) if (field !== "recordId" && field !== "id" && field !== "accountId") {
      if (newer(local, remote, field)) merged[field] = clone(remote[field]);
    }
    merged.updatedAtMs = Math.max(Number(local.updatedAtMs) || 0, Number(remote.updatedAtMs) || 0);
    merged.isDeleted = Boolean(local.isDeleted || remote.isDeleted);
    return normalizeAccount(merged);
  };
  const mergePayload = (local, remote) => {
    const mergeCollection = (left, right, prefix, normalizer) => {
      const map = new Map();
      for (const item of left) map.set(recordKey(item, prefix), normalizer(item));
      for (const item of right) {
        const key = recordKey(item, prefix);
        map.set(key, mergeRecord(map.get(key), normalizer(item)));
      }
      return [...map.values()];
    };
    const accounts = mergeCollection(local.accounts || [], remote.accounts || [], "account", normalizeAccount);
    const folders = mergeCollection(local.folders || [], remote.folders || [], "folder", normalizeFolder);
    const passkeys = mergeCollection(local.passkeys || [], remote.passkeys || [], "passkey", (item) => clone(item));
    const allRegularAccountIds = unique([...(local.allRegularAccountIds || []), ...(remote.allRegularAccountIds || [])])
      .filter((accountId) => accounts.some((account) => sameId(account.recordId, accountId) && !account.isDeleted && !account.isPermanentlyDeleted));
    return { accounts, folders, passkeys, allRegularAccountIds };
  };
  const payloadFromData = (data) => ({ accounts: clone(data.accounts), folders: clone(data.folders), passkeys: clone(data.passkeys), allRegularAccountIds: clone(data.allRegularAccountIds) });
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

  const getPrefs = async () => {
    const result = await chrome.storage.local.get([PREFS_KEY]);
    return result?.[PREFS_KEY] || {
      fontFamily: "系统默认", textFontSize: 14, buttonFontSize: 13, toastDurationSeconds: 2.5,
      showPasswordsGlobally: false, exportDirectory: "", autoSyncIntervalMinutes: 0,
      previousEncryptionKey: "", webdavEnabled: false, webdavBaseUrl: "", webdavRemotePath: "pass-sync-bundle-v2.json",
      webdavUsername: "", webdavPassword: "", syncPrimarySource: "selfHosted",
    };
  };
  const getSync = async () => {
    const result = await chrome.storage.local.get([SYNC_KEY]);
    return result?.[SYNC_KEY] || { enabled: false, baseUrl: "", authToken: "", encryptionKey: "", mode: "merge" };
  };
  const lockDefault = () => ({ enabled: false, locked: false, lockPolicy: "onceUntilQuit", idleLockMinutes: 5, preferBiometrics: false, backgroundLockDelaySeconds: 60, biometricReady: false });
  const getLock = async () => {
    const result = await chrome.storage.local.get([LOCK_KEY]);
    return { ...lockDefault(), ...(result?.[LOCK_KEY] || {}) };
  };
  const saveJsonKey = async (key, value) => { await chrome.storage.local.set({ [key]: clone(value) }); return value; };

  const invokeCommand = async (command, args = {}) => {
    const store = await loadStore();
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
      case "set_ui_prefs": return saveJsonKey(PREFS_KEY, { ...(await getPrefs()), ...(args.prefs || {}) });
      case "get_sync_settings": return getSync();
      case "set_sync_settings": return saveJsonKey(SYNC_KEY, { ...(await getSync()), ...(args.settings || {}) });
      case "set_device_name": return mutate("修改设备名称", (data) => { data.deviceName = text(args.deviceName); return data.deviceName; });
      case "get_lock_state": return getLock();
      case "lock_biometric_available": return false;
      case "lock_touch": return true;
      case "lock_now": return saveJsonKey(LOCK_KEY, { ...(await getLock()), locked: true });
      case "lock_unlock": { const lock = await getLock(); if (!lock.enabled) return lock; if (!text(args.password)) throw new Error("请输入主密码"); return saveJsonKey(LOCK_KEY, { ...lock, locked: false }); }
      case "lock_unlock_biometric": throw new Error("当前 Chrome 测试插件不提供系统指纹解锁");
      case "lock_enable": { const lock = { ...(await getLock()), enabled: true, locked: false, lockPolicy: args.lockPolicy || "onceUntilQuit", idleLockMinutes: Number(args.idleLockMinutes || 5), preferBiometrics: false, biometricReady: false }; return saveJsonKey(LOCK_KEY, lock); }
      case "lock_disable": return saveJsonKey(LOCK_KEY, { ...lockDefault() });
      case "lock_save_preferences": return saveJsonKey(LOCK_KEY, { ...(await getLock()), lockPolicy: args.lockPolicy || "onceUntilQuit", idleLockMinutes: Number(args.idleLockMinutes || 5), backgroundLockDelaySeconds: Number(args.backgroundLockDelaySeconds || 60), preferBiometrics: false });
      case "lock_change_password": return getLock();
      case "get_undo_status": { const entry = store.undo.at(-1); return entry ? { title: entry.title, createdAtMs: entry.createdAtMs } : null; }
      case "get_redo_status": { const entry = store.redo.at(-1); return entry ? { title: entry.title, createdAtMs: entry.createdAtMs } : null; }
      case "get_operation_history": return [...store.undo.map((entry) => ({ ...entry, stack: "undo" })), ...store.redo.map((entry) => ({ ...entry, stack: "redo" }))].sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, MAX_HISTORY);
      case "undo_last_operation": return serialized(async () => { const current = await loadStore(); const entry = current.undo.pop(); if (!entry) throw new Error("没有可撤销的本地操作"); current.data = normalizeData(clone(entry.before)); current.redo.push(entry); await persist(current); return `已撤销：${entry.title}`; });
      case "redo_last_operation": return serialized(async () => { const current = await loadStore(); const entry = current.redo.pop(); if (!entry) throw new Error("没有可重做的本地操作"); current.data = normalizeData(clone(entry.after)); current.undo.push(entry); await persist(current); return `已重做：${entry.title}`; });
      case "create_account": {
        const input = args.input || {};
        return mutate("新建账号", (data) => { const account = normalizeAccount({ ...input, recordId: id("account"), createdAtMs: now(), updatedAtMs: now(), isDeleted: false }); data.accounts.push(account); data.allRegularAccountIds = addToTop(data.allRegularAccountIds, account.recordId); return clone(account); });
      }
      case "update_account": return mutate("编辑账号", (data) => { const account = findAccount(data, args.id); if (!account) throw new Error("账号不存在"); Object.assign(account, clone(args.input || {}), { updatedAtMs: now() }); account.sites = unique(account.sites); account.canonicalSite = account.sites[0] || account.canonicalSite || ""; return clone(account); });
      case "set_account_folders": return mutate("修改账号文件夹", (data) => { const account = findAccount(data, args.id); if (!account) throw new Error("账号不存在"); setMembership(data, account, args.folderIds || []); account.updatedAtMs = now(); return clone(account.folderIds); });
      case "set_accounts_folders": return mutate("批量修改账号文件夹", (data) => { for (const accountId of unique(args.accountIds || [])) { const account = findAccount(data, accountId); if (account && !account.isDeleted) setMembership(data, account, args.folderIds || []); } return true; });
      case "create_folder": return mutate("新建文件夹", (data) => { const folder = normalizeFolder({ id: id("folder"), name: args.name, updatedAtMs: now() }); data.folders.push(folder); data.folderOrderIds.push(folder.id); return clone(folder); });
      case "rename_folder": return mutate("重命名文件夹", (data) => { const folder = findFolder(data, args.id); if (!folder) throw new Error("文件夹不存在"); folder.name = text(args.name) || folder.name; folder.updatedAtMs = now(); return clone(folder); });
      case "delete_folder": return mutate("删除文件夹", (data) => { const folder = findFolder(data, args.id); if (!folder) throw new Error("文件夹不存在"); folder.isDeleted = true; for (const account of data.accounts) account.folderIds = account.folderIds.filter((folderId) => !sameId(folderId, folder.id)); return true; });
      case "reorder_folders": return mutate("调整文件夹顺序", (data) => { const ids = unique(args.orderedIds || []); const active = visibleFolders(data).map((folder) => folder.id); data.folderOrderIds = [...ids.filter((item) => active.some((id2) => sameId(id2, item))), ...active.filter((item) => !ids.some((id2) => sameId(id2, item)))]; return data.folderOrderIds; });
      case "reorder_accounts": return mutate("调整账号顺序", (data) => { const ids = unique(args.orderedIds || []); const scope = text(args.scopeId); if (scope.toLowerCase().startsWith("folder:")) { const folder = findFolder(data, scope.slice(7)); if (!folder) throw new Error("文件夹不存在"); folder.regularAccountIds = ids; } else if (args.pinned) { const ranks = new Map(ids.map((item, index) => [item.toLowerCase(), index])); for (const account of data.accounts) if (ranks.has(account.recordId.toLowerCase())) account.pinnedSortOrder = ranks.get(account.recordId.toLowerCase()); } else data.allRegularAccountIds = ids; return ids; });
      case "toggle_account_pin": return mutate("切换账号置顶", (data) => { const account = findAccount(data, args.id); if (!account) throw new Error("账号不存在"); account.isPinned = !account.isPinned; if (account.isPinned) account.pinnedSortOrder = 0; return account.isPinned; });
      case "set_accounts_pinned": return mutate(args.pinned ? "批量置顶账号" : "批量取消置顶", (data) => { for (const accountId of unique(args.accountIds || [])) { const account = findAccount(data, accountId); if (account) account.isPinned = Boolean(args.pinned); } return true; });
      case "soft_delete_account": return invokeCommand("soft_delete_accounts", { accountIds: [args.id] });
      case "soft_delete_accounts": return mutate("移入回收站", (data) => { let count = 0; for (const accountId of unique(args.accountIds || [])) { const account = findAccount(data, accountId); if (!account || account.isDeleted) continue; account.deletedFromFolderIds = [...account.folderIds]; account.isDeleted = true; account.deletedAtMs = now(); removeFromOrders(data, account.recordId); count += 1; } return count; });
      case "restore_account": return mutate("恢复账号", (data) => { const account = findAccount(data, args.id); if (!account) throw new Error("账号不存在"); account.isDeleted = false; account.deletedAtMs = null; account.folderIds = unique(account.deletedFromFolderIds || account.folderIds); data.allRegularAccountIds = addToTop(data.allRegularAccountIds, account.recordId); for (const folder of visibleFolders(data)) if (account.folderIds.some((folderId) => sameId(folderId, folder.id))) folder.regularAccountIds = addToTop(folder.regularAccountIds, account.recordId); return clone(account); });
      case "restore_all_deleted_accounts": return mutate("恢复全部回收站账号", (data) => { let count = 0; for (const account of data.accounts) if (account.isDeleted && !account.isPermanentlyDeleted) { account.isDeleted = false; account.folderIds = unique(account.deletedFromFolderIds || account.folderIds); data.allRegularAccountIds = addToTop(data.allRegularAccountIds, account.recordId); for (const folder of visibleFolders(data)) if (account.folderIds.some((folderId) => sameId(folderId, folder.id))) folder.regularAccountIds = addToTop(folder.regularAccountIds, account.recordId); count += 1; } return count; });
      case "hard_delete_account": return mutate("永久删除账号", (data) => { const account = findAccount(data, args.id); if (!account) throw new Error("账号不存在"); account.isPermanentlyDeleted = true; account.isDeleted = true; removeFromOrders(data, account.recordId); return true; });
      case "hard_delete_all_deleted_accounts": return mutate("清空回收站", (data) => { const before = data.accounts.length; data.accounts = data.accounts.filter((account) => !account.isDeleted); data.allRegularAccountIds = data.allRegularAccountIds.filter((id2) => data.accounts.some((account) => sameId(account.recordId, id2))); for (const folder of data.folders) folder.regularAccountIds = folder.regularAccountIds.filter((id2) => data.accounts.some((account) => sameId(account.recordId, id2))); return before - data.accounts.length; });
      case "configure_folder_site_rules": return mutate("配置文件夹网站规则", (data) => { const folder = findFolder(data, args.folderId); if (!folder) throw new Error("文件夹不存在"); folder.matchedSites = unique(args.siteInputs || []); folder.autoAddMatchingSites = Boolean(args.autoAdd); let addedCount = 0; if (folder.autoAddMatchingSites) for (const account of activeAccounts(data)) if (account.sites.some((site) => folder.matchedSites.some((input) => site.toLowerCase().includes(input.toLowerCase()))) && !account.folderIds.some((id2) => sameId(id2, folder.id))) { setMembership(data, account, [...account.folderIds, folder.id]); addedCount += 1; } return { addedCount, message: `已加入 ${addedCount} 个账号` }; });
      case "get_folder_duplicate_groups": return [];
      case "deduplicate_folder": return 0;
      case "generate_demo_accounts": return invokeCommand("create_account", { input: { sites: ["example.com"], username: "demo", password: "", note: "演示账号" } });
      case "health_check": return { ok: true, mode: "chrome-extension-web", storage: "chrome.storage.local", oldExtensionUntouched: true };
      case "sync_key_id": return syncKeyId(args.key);
      case "generate_sync_encryption_key": { const bytes = crypto.getRandomValues(new Uint8Array(32)); return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
      case "save_provision_draft": return saveJsonKey("pass.web.workspace.provision.v1", args.draft || {});
      case "get_provision_draft": { const result = await chrome.storage.local.get(["pass.web.workspace.provision.v1"]); return result?.["pass.web.workspace.provision.v1"] || {}; }
      case "get_ssh_credential": return {};
      case "save_ssh_credential_cmd": return true;
      case "verify_sync_endpoint": return { ok: false, message: "Chrome 测试插件未实现 SSH 服务部署" };
      case "detect_existing_sync_service": return { exists: false, message: "Chrome 测试插件未实现 SSH 服务部署" };
      case "provision_self_hosted_server": throw new Error("创建服务需要 Tauri 桌面端的 SSH 能力");
      case "choose_export_directory": return null;
      case "export_csv_to_path": return exportCsv("pass.csv");
      case "export_csv": return exportCsv("pass.csv");
      case "export_browser_csv_cmd": return exportCsv(`pass-${text(args.format) || "browser"}.csv`);
      case "import_browser_csv_text": return importCsv(text(args.content));
      case "import_google_authenticator_totp": return importTotpEntries(args.entries || []);
      case "export_sync_bundle": { const payload = payloadFromData(store.data); const settings = await getSync(); const bundle = await encryptDocument({ schema: "pass.sync.bundle.v2", exportedAtMs: now(), source: { app: "pass-extension-chrome-web", formatVersion: 2 }, payload }, settings.encryptionKey); downloadJson(bundle, "pass-sync-bundle.json"); return { message: `同步包已导出：账号 ${payload.accounts.filter((a) => !a.isPermanentlyDeleted).length}，文件夹 ${payload.folders.filter((f) => !f.isPermanentlyDeleted).length}` }; }
      case "import_sync_bundle_text": { const settings = await getSync(); const documentValue = await decryptDocument(JSON.parse(text(args.content)), settings.encryptionKey, settings.previousEncryptionKey); const remote = normalizePayload(documentValue); const local = payloadFromData(store.data); const merged = mergePayload(local, remote); const result = { safe: true, reasons: [], localPayload: local, payload: merged, report: { safe: true, message: `同步包预览：本地 ${local.accounts.filter((a) => !a.isPermanentlyDeleted).length} → 合并 ${merged.accounts.filter((a) => !a.isPermanentlyDeleted).length}` } }; if (args.apply) { await mutate("导入并合并同步包", (data) => { data.accounts = merged.accounts; data.folders = merged.folders; data.passkeys = merged.passkeys; data.allRegularAccountIds = merged.allRegularAccountIds; return true; }); result.message = "同步包已合并写入"; } return result; }
      case "merge_sync_payloads": { const local = normalizePayload(JSON.parse(text(args.localJson))); const remote = normalizePayload(JSON.parse(text(args.remoteJson))); return { safe: true, reasons: [], payload: mergePayload(local, remote) }; }
      case "sync_preview": return syncRemote("merge", true);
      case "sync_now_mode": return syncRemote(text(args.mode) || "merge", false);
      case "sync_webdav_now_mode": throw new Error("Chrome 测试插件尚未实现 WebDAV 同步");
      case "list_server_versions": return [];
      case "restore_server_version": throw new Error("Chrome 测试插件尚未实现服务器版本恢复");
      case "list_local_snapshots": return store.snapshots.map((snapshot) => ({ id: snapshot.id, reason: snapshot.reason, createdAtMs: snapshot.createdAtMs, accounts: (snapshot.payload.accounts || []).filter((a) => !a.isPermanentlyDeleted).length, folders: (snapshot.payload.folders || []).filter((f) => !f.isPermanentlyDeleted).length, passkeys: (snapshot.payload.passkeys || []).filter((p) => !p.isPermanentlyDeleted).length }));
      case "restore_local_snapshot": { const snapshot = store.snapshots.find((item) => sameId(item.id, args.snapshotId)); if (!snapshot) throw new Error("本地快照不存在"); return mutate("恢复本地安全快照", (data) => { data.accounts = clone(snapshot.payload.accounts || []); data.folders = clone(snapshot.payload.folders || []); data.passkeys = clone(snapshot.payload.passkeys || []); data.allRegularAccountIds = data.accounts.filter((a) => !a.isDeleted && !a.isPermanentlyDeleted).map((a) => a.recordId); return true; }).then(() => "本地安全快照已恢复"); }
      default: throw new Error(`Chrome 测试插件暂未实现命令：${command}`);
    }
  };

  async function exportCsv(filename) {
    const store = await loadStore();
    const rows = [["name","username","password","url","note"]];
    for (const account of activeAccounts(store.data)) rows.push([account.canonicalSite || account.sites[0] || "", account.username, account.password, account.sites[0] || "", account.note]);
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return { message: `已导出 ${rows.length - 1} 条账号`, path: filename };
  }
  async function importCsv(csv) {
    const lines = String(csv || "").split(/\r?\n/).filter(Boolean); if (lines.length < 2) return { imported: 0, message: "没有可导入的账号" };
    const parse = (line) => { const out = []; let cell = "", quoted = false; for (let i = 0; i < line.length; i += 1) { const c = line[i]; if (c === '"' && line[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = !quoted; else if (c === "," && !quoted) { out.push(cell); cell = ""; } else cell += c; } out.push(cell); return out; };
    const header = parse(lines[0]).map((v) => v.toLowerCase()); const index = (names) => names.map((name) => header.indexOf(name)).find((i) => i >= 0) ?? -1;
    const siteIndex = index(["url", "website", "name"]), userIndex = index(["username", "login_username"]), passIndex = index(["password", "login_password"]), noteIndex = index(["note", "extra"]); let imported = 0;
    await mutate("导入浏览器密码", (data) => { for (const line of lines.slice(1)) { const row = parse(line); const site = text(row[siteIndex]); if (!site) continue; const account = normalizeAccount({ recordId: id("account"), sites: [site], username: row[userIndex] || "", password: row[passIndex] || "", note: row[noteIndex] || "", createdAtMs: now(), updatedAtMs: now() }); data.accounts.push(account); data.allRegularAccountIds = addToTop(data.allRegularAccountIds, account.recordId); imported += 1; } });
    return { imported, message: `已导入 ${imported} 条账号` };
  }
  async function importTotpEntries(entries) {
    let created = 0, updated = 0, skipped = 0;
    await mutate("导入验证器账号", (data) => { for (const entry of entries) { const site = text(entry.site), username = String(entry.username || ""); if (!site || !text(entry.secret)) { skipped += 1; continue; } const existing = data.accounts.find((a) => a.username === username && a.sites.some((s) => s.toLowerCase() === site.toLowerCase())); if (existing) { existing.totpSecret = text(entry.secret); existing.updatedAtMs = now(); updated += 1; } else { const account = normalizeAccount({ recordId: id("account"), sites: [site], username, totpSecret: text(entry.secret), createdAtMs: now(), updatedAtMs: now() }); data.accounts.push(account); data.allRegularAccountIds = addToTop(data.allRegularAccountIds, account.recordId); created += 1; } } });
    return { created, updated, skipped };
  }
  async function syncRemote(mode, dryRun) {
    const settings = await getSync(); if (!settings.enabled) throw new Error("请先启用自建服务器同步"); if (!text(settings.baseUrl)) throw new Error("请先配置同步服务器 URL");
    const base = text(settings.baseUrl).replace(/\/$/, ""); const headers = { Accept: "application/json" }; if (text(settings.authToken)) headers.Authorization = `Bearer ${text(settings.authToken)}`;
    const response = await fetch(`${base}/v2/sync/state`, { headers }); if (!(response.ok || response.status === 404)) throw new Error(`拉取同步状态失败 HTTP ${response.status}`);
    const remote = response.status === 404 ? { accounts: [], folders: [], passkeys: [] } : normalizePayload(await decryptDocument(await response.json(), settings.encryptionKey, settings.previousEncryptionKey)); const store = await loadStore(); const local = payloadFromData(store.data); const payload = mode === "remoteOverwriteLocal" ? remote : mode === "localOverwriteRemote" ? local : mergePayload(local, remote); const report = { safe: true, ok: true, dryRun, mode, message: dryRun ? "预览完成（未写入）" : "同步完成", localAccounts: local.accounts.filter((a) => !a.isPermanentlyDeleted).length, remoteAccounts: remote.accounts.filter((a) => !a.isPermanentlyDeleted).length, mergedAccounts: payload.accounts.filter((a) => !a.isPermanentlyDeleted).length, applied: false, pushed: false };
    if (dryRun) return { report, localPayload: local, payload };
    if (mode !== "localOverwriteRemote") await mutate("同步写入本地", (data) => { data.accounts = payload.accounts; data.folders = payload.folders; data.passkeys = payload.passkeys; data.allRegularAccountIds = payload.allRegularAccountIds; });
    const putHeaders = { ...headers, "Content-Type": "application/json" }; const body = await encryptDocument({ schema: "pass.sync.bundle.v2", exportedAtMs: now(), source: { app: "pass-extension-chrome-web", formatVersion: 2 }, payload }, settings.encryptionKey); const put = await fetch(`${base}/v2/sync/state`, { method: "PUT", headers: putHeaders, body: JSON.stringify(body) }); if (!put.ok) throw new Error(`推送同步状态失败 HTTP ${put.status}`); report.applied = mode !== "localOverwriteRemote"; report.pushed = true; return { report };
  }

  globalThis.__PASS_EXTENSION_INVOKE__ = invokeCommand;
})();
