import { ensurePasskeyStorageShape, handlePasskeyBridgeOperation } from "./passkey_store.js";
import {
  buildAccountId,
  etldPlusOne,
  normalizeDomain,
  normalizeSites,
  normalizeUsername,
  syncAliasGroups,
} from "./account_core.js";
import {
  mergeAccountCollections as mergeAccountCollectionsCore,
  mergeFolderCollections as mergeFolderCollectionsCore,
  mergePasskeyCollections as mergePasskeyCollectionsCore,
  reconcileAccountFolders as reconcileAccountFoldersCore,
} from "../../core/pass_core/js/sync_merge_core.js";
import {
  appendHistoryEntry,
  ensureDataStorageReady,
  getAllData as getAllDataFromDataStore,
  getAccounts as getAccountsFromDataStore,
  setAllData as setAllDataToDataStore,
  setAccounts as setAccountsToDataStore,
} from "./data_store.js";

const STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
const STORAGE_KEY_SYNC_ENABLE_WEBDAV = "pass.sync.enableWebDAV.v3";
const STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER = "pass.sync.enableSelfHostedServer.v3";
const STORAGE_KEY_SYNC_WEBDAV_BASE_URL = "pass.sync.webdav.baseUrl.v2";
const STORAGE_KEY_SYNC_WEBDAV_PATH = "pass.sync.webdav.path.v2";
const STORAGE_KEY_SYNC_WEBDAV_USERNAME = "pass.sync.webdav.username.v2";
const STORAGE_KEY_SYNC_WEBDAV_PASSWORD = "pass.sync.webdav.password.v2";
const STORAGE_KEY_SYNC_SERVER_BASE_URL = "pass.sync.server.baseUrl.v2";
const STORAGE_KEY_SYNC_SERVER_TOKEN = "pass.sync.server.token.v2";
const STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES = "pass.sync.autoIntervalMinutes.v1";
const STORAGE_KEY_SYNC_DEVICE_ID = "pass.sync.deviceId.v1";
const CONTEXT_MENU_ID_ALL_ACCOUNTS = "pass.context.all_accounts";
const FIXED_NEW_ACCOUNT_FOLDER_ID = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";
const FIXED_NEW_ACCOUNT_FOLDER_NAME = "新账号";
const DEFAULT_SELF_HOSTED_SERVER_BASE_URL = "https://or.sbbz.tech:5443";
const DEFAULT_SELF_HOSTED_SERVER_TOKEN = "ClzgP2xsXHETVut9F6ddHVRdvvclz0QM0fDHveyOZFhGjs7l";
const SYNC_BUNDLE_SCHEMA_V2 = "pass.sync.bundle.v2";
const SYNC_MODE_MERGE = "merge";
const AUTO_SYNC_ALARM_NAME = "pass.sync.auto";

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);

  if (!stored[STORAGE_KEY_DEVICE_NAME]) {
    await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: "ChromeMac" });
  }

  await ensureDataStorageReady();
  await ensurePasskeyStorageShape();
  ensureActionContextMenu();
  await scheduleAutoSyncAlarm();
});

void ensureDataStorageReady();
void ensurePasskeyStorageShape();
ensureActionContextMenu();
void scheduleAutoSyncAlarm();

chrome.runtime.onStartup.addListener(() => {
  ensureActionContextMenu();
  void scheduleAutoSyncAlarm();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (
    changes[STORAGE_KEY_SYNC_ENABLE_WEBDAV] ||
    changes[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER] ||
    changes[STORAGE_KEY_SYNC_WEBDAV_BASE_URL] ||
    changes[STORAGE_KEY_SYNC_WEBDAV_PATH] ||
    changes[STORAGE_KEY_SYNC_WEBDAV_USERNAME] ||
    changes[STORAGE_KEY_SYNC_WEBDAV_PASSWORD] ||
    changes[STORAGE_KEY_SYNC_SERVER_BASE_URL] ||
    changes[STORAGE_KEY_SYNC_SERVER_TOKEN] ||
    changes[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]
  ) {
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
      title: "pass设置",
      contexts: ["action"],
    });
  });
}

function normalizeAutoSyncIntervalMinutes(value) {
  const normalized = Number(value);
  const allowed = new Set([0, 1, 3, 5, 10, 15, 30, 60]);
  return allowed.has(normalized) ? normalized : 0;
}

async function scheduleAutoSyncAlarm() {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_SYNC_ENABLE_WEBDAV,
    STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER,
    STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES,
  ]);
  const hasRemoteSource = Boolean(result[STORAGE_KEY_SYNC_ENABLE_WEBDAV]) || Boolean(result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER]);
  const intervalMinutes = normalizeAutoSyncIntervalMinutes(result[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]);

  await chrome.alarms.clear(AUTO_SYNC_ALARM_NAME);
  if (!hasRemoteSource || intervalMinutes <= 0) {
    return;
  }

  await chrome.alarms.create(AUTO_SYNC_ALARM_NAME, {
    periodInMinutes: intervalMinutes,
    delayInMinutes: intervalMinutes,
  });
}

async function runAutoSync() {
  const targets = await buildRemoteSyncTargetsFromStorage();
  if (!targets || targets.length === 0) return;

  const localStored = await readBusinessDataFromStore();
  const localAccounts = Array.isArray(localStored.accounts)
    ? localStored.accounts.map(normalizeAccountShape)
    : [];
  const localStoredPasskeys = Array.isArray(localStored.passkeys)
    ? localStored.passkeys.map(normalizePasskeyShape)
    : [];
  const localPasskeys = buildUnifiedPasskeys(localAccounts, localStoredPasskeys);
  const localFolders = Array.isArray(localStored.folders)
    ? localStored.folders.map(normalizeFolderShape)
    : [];

  let mergedAccounts = localAccounts;
  let mergedPasskeys = localPasskeys;
  let mergedFolders = localFolders;
  let remoteAggregate = null;

  for (const target of targets) {
    const remoteResponse = await pullRemotePayload(target);
    target.remoteEtag = remoteResponse.etag;
    const remotePayload = remoteResponse.payload;
    const remoteAccounts = remotePayload ? remotePayload.accounts.map(normalizeAccountShape) : [];
    const remotePasskeys = remotePayload ? buildUnifiedPasskeys(remoteAccounts, remotePayload.passkeys) : [];
    const remoteFolders = remotePayload ? remotePayload.folders.map(normalizeFolderShape) : [];

    if (!remoteAggregate) {
      remoteAggregate = {
        accounts: remoteAccounts,
        passkeys: remotePasskeys,
        folders: remoteFolders,
      };
      continue;
    }

    remoteAggregate.folders = mergeFolderCollections(remoteAggregate.folders, remoteFolders);
    remoteAggregate.accounts = mergeAccountCollections(remoteAggregate.accounts, remoteAccounts);
    remoteAggregate.accounts = syncAliasGroups(remoteAggregate.accounts);
    remoteAggregate.accounts = reconcileAccountFolders(remoteAggregate.accounts, remoteAggregate.folders);
    remoteAggregate.passkeys = mergePasskeyCollections(remoteAggregate.passkeys, remotePasskeys);
    remoteAggregate.passkeys = buildUnifiedPasskeys(remoteAggregate.accounts, remoteAggregate.passkeys);
  }

  if (remoteAggregate) {
    mergedFolders = mergeFolderCollections(localFolders, remoteAggregate.folders);
    mergedAccounts = mergeAccountCollections(localAccounts, remoteAggregate.accounts);
    mergedAccounts = syncAliasGroups(mergedAccounts);
    mergedAccounts = reconcileAccountFolders(mergedAccounts, mergedFolders);
    mergedPasskeys = mergePasskeyCollections(localPasskeys, remoteAggregate.passkeys);
    mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, mergedPasskeys);
  }

  await writeBusinessDataToStore({
    accounts: mergedAccounts,
    passkeys: mergedPasskeys,
    folders: mergedFolders,
  });

  const pushTargets = [...targets].sort((left, right) => Number(right.supportsEtag) - Number(left.supportsEtag));
  for (const target of pushTargets) {
    const result = await pushRemotePayloadWithMode(target, {
      accounts: mergedAccounts,
      passkeys: mergedPasskeys,
      folders: mergedFolders,
    }, SYNC_MODE_MERGE);
    mergedAccounts = result.payload.accounts.map(normalizeAccountShape);
    mergedFolders = result.payload.folders.map(normalizeFolderShape);
    mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, result.payload.passkeys);
  }

  await writeBusinessDataToStore({
    accounts: mergedAccounts,
    passkeys: mergedPasskeys,
    folders: mergedFolders,
  });
  await appendHistoryEntry({
    action: `自动同步完成（${targets.map((item) => item.label).join(" + ")}）`,
    timestampMs: Date.now(),
  });
}

async function readBusinessDataFromStore() {
  const stored = await getAllDataFromDataStore();
  return {
    accounts: Array.isArray(stored.accounts) ? stored.accounts : [],
    passkeys: Array.isArray(stored.passkeys) ? stored.passkeys : [],
    folders: Array.isArray(stored.folders) ? stored.folders : [],
  };
}

function normalizeSyncPayloadShape(payload) {
  const accounts = Array.isArray(payload?.accounts)
    ? payload.accounts.map(normalizeAccountShape)
    : [];
  const rawPasskeys = Array.isArray(payload?.passkeys)
    ? payload.passkeys.map(normalizePasskeyShape)
    : [];
  const folders = Array.isArray(payload?.folders)
    ? payload.folders.map(normalizeFolderShape)
    : [];
  return {
    accounts,
    passkeys: buildUnifiedPasskeys(accounts, rawPasskeys),
    folders,
  };
}

function syncPayloadEquals(lhs, rhs) {
  return JSON.stringify(normalizeSyncPayloadShape(lhs)) === JSON.stringify(normalizeSyncPayloadShape(rhs));
}

async function writeBusinessDataToStore({ accounts, passkeys, folders }) {
  const nextPayload = normalizeSyncPayloadShape({ accounts, passkeys, folders });
  const currentPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
  if (syncPayloadEquals(currentPayload, nextPayload)) {
    return false;
  }
  await setAllDataToDataStore(nextPayload);
  return true;
}

async function buildRemoteSyncTargetsFromStorage() {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_SYNC_ENABLE_WEBDAV,
    STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER,
    STORAGE_KEY_SYNC_WEBDAV_BASE_URL,
    STORAGE_KEY_SYNC_WEBDAV_PATH,
    STORAGE_KEY_SYNC_WEBDAV_USERNAME,
    STORAGE_KEY_SYNC_WEBDAV_PASSWORD,
    STORAGE_KEY_SYNC_SERVER_BASE_URL,
    STORAGE_KEY_SYNC_SERVER_TOKEN,
  ]);

  const targets = [];
  if (Boolean(result[STORAGE_KEY_SYNC_ENABLE_WEBDAV])) {
    const baseUrl = String(result[STORAGE_KEY_SYNC_WEBDAV_BASE_URL] || "").trim();
    const remotePath = String(result[STORAGE_KEY_SYNC_WEBDAV_PATH] || "").trim() || "pass-sync-bundle-v2.json";
    if (!baseUrl) return null;
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = new URL(remotePath.replace(/^\/+/g, ""), normalizedBase).toString();
    const username = String(result[STORAGE_KEY_SYNC_WEBDAV_USERNAME] || "");
    const password = String(result[STORAGE_KEY_SYNC_WEBDAV_PASSWORD] || "");
    let authHeader = null;
    if (username || password) {
      authHeader = `Basic ${base64EncodeUtf8(`${username}:${password}`)}`;
    }
    targets.push({ label: "WebDAV", url, authHeader, supportsEtag: false, remoteEtag: null });
  }

  if (Boolean(result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER])) {
    const serverBaseUrl = String(result[STORAGE_KEY_SYNC_SERVER_BASE_URL] || DEFAULT_SELF_HOSTED_SERVER_BASE_URL).trim();
    if (!serverBaseUrl) return null;
    const normalizedBase = serverBaseUrl.endsWith("/") ? serverBaseUrl : `${serverBaseUrl}/`;
    const url = new URL("v1/sync/payload", normalizedBase).toString();
    const token = String(result[STORAGE_KEY_SYNC_SERVER_TOKEN] || DEFAULT_SELF_HOSTED_SERVER_TOKEN).trim();
    const authHeader = token ? `Bearer ${token}` : null;
    targets.push({ label: "服务器", url, authHeader, supportsEtag: true, remoteEtag: null });
  }

  return targets.length > 0 ? targets : null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "PASS_FILL_ACTIVE_TAB":
        sendResponse(await handleFillActiveTab(message.payload));
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
      default:
        return;
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error) });
  });

  return true;
});

async function handlePasskeyOperationAndSyncAccount(payload) {
  const response = await handlePasskeyBridgeOperation(payload);
  if (!response?.ok) {
    return response;
  }

  if (payload?.operation === "create") {
    await upsertAccountForPasskey(response.result?.accountHint);
  }
  return response;
}

async function handleFillActiveTab(payload) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    return { ok: false, error: "找不到活动标签页" };
  }

  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    func: fillCredentialInPage,
    args: [payload?.username || "", payload?.password || ""],
  });

  return { ok: true };
}

async function handleLoginDetected(payload) {
  const domain = normalizeDomain(payload?.domain || "");
  const username = (payload?.username || "").trim();
  const password = payload?.password || "";

  if (!domain || !username || !password) {
    return { shouldPrompt: false };
  }

  const accounts = await getAccounts();
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
    return { ok: false, error: "缺少保存所需参数" };
  }

  const now = Date.now();
  const { [STORAGE_KEY_DEVICE_NAME]: deviceNameStored } = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  const deviceName = (deviceNameStored || "ChromeMac").trim() || "ChromeMac";

  const next = await getAccounts();
  const existing = next.find((account) => {
    return !account.isDeleted && accountMatchesDomain(account, domain) && account.username === username;
  });

  if (existing) {
    let changed = false;

    if (existing.password !== password) {
      existing.password = password;
      existing.passwordUpdatedAtMs = now;
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
      const synced = syncAliasGroups(next);
      await setAccounts(synced);
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
      deviceName,
    })
  );
  const synced = syncAliasGroups(next);
  await setAccounts(synced);
  return { ok: true, mode: "created" };
}

async function handleContentGetAccounts() {
  const accounts = await getAccounts();
  return {
    ok: true,
    accounts: accounts.map((account) => ({
      sites: normalizeSites(account?.sites || []),
      username: String(account?.username || ""),
      password: String(account?.password || ""),
      isDeleted: Boolean(account?.isDeleted),
    })),
  };
}

async function getAccounts() {
  const raw = await getAccountsFromDataStore();
  return raw.map(normalizeAccountShape);
}

async function setAccounts(accounts) {
  const normalized = (Array.isArray(accounts) ? accounts : []).map(normalizeAccountShape);
  await setAccountsToDataStore(normalized);
}

async function upsertAccountForPasskey(accountHint) {
  const domain = normalizeDomain(accountHint?.rpId || "");
  const username = normalizeUsername(accountHint?.username || "");
  const credentialIdB64u = normalizePasskeyId(accountHint?.credentialIdB64u || accountHint?.credentialId || "");
  if (!domain || !username) {
    return;
  }

  const now = Date.now();
  const { [STORAGE_KEY_DEVICE_NAME]: deviceNameStored } = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  const deviceName = (deviceNameStored || "ChromeMac").trim() || "ChromeMac";

  const allAccounts = await getAccounts();
  let matchIndexes = [];
  for (let i = 0; i < allAccounts.length; i += 1) {
    const account = allAccounts[i];
    if (accountMatchesDomain(account, domain) && normalizeUsername(account.username) === username) {
      matchIndexes.push(i);
    }
  }

  // Some RPs may register passkey with an internal username that differs from the saved login username.
  // If there is only one active account under this domain/alias group, reuse it as a safe fallback.
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
    }
  }

  if (matchIndexes.length === 0) {
    const created = createAccount({
      site: domain,
      username,
      password: "",
      createdAtMs: now,
      deviceName,
    });
    if (credentialIdB64u) {
      created.passkeyCredentialIds = normalizePasskeyCredentialIds([credentialIdB64u]);
      created.passkeyUpdatedAtMs = now;
    }
    allAccounts.push(created);
    await setAccounts(syncAliasGroups(allAccounts));
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
    deviceName,
  });

  const removeIndexSet = new Set(matchIndexes);
  const next = allAccounts.filter((_, index) => !removeIndexSet.has(index));
  next.push(mergedAccount);
  await setAccounts(syncAliasGroups(next));
}

function mergeMatchedAccountsForPasskey({
  primary,
  matchedAccounts,
  domain,
  username,
  credentialIdB64u,
  now,
  deviceName,
}) {
  const mergedSites = normalizeSites([
    ...matchedAccounts.flatMap((account) => account?.sites || []),
    domain,
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
  const mergedUsername = hasExactUsernameMatch
    ? username
    : (usernameField.value || username || normalizeUsername(primary?.username || ""));
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
    passwordUpdatedAtMs: passwordField.updatedAtMs,
    totpUpdatedAtMs: totpField.updatedAtMs,
    recoveryCodesUpdatedAtMs: recoveryField.updatedAtMs,
    noteUpdatedAtMs: noteField.updatedAtMs,
    passkeyCredentialIds: mergedPasskeyIds,
    passkeyUpdatedAtMs: passkeyChanged ? now : asTimestamp(passkeyUpdatedAtFromData, safeCreatedAtMs),
    isDeleted: false,
    deletedAtMs: null,
    lastOperatedDeviceName: deviceName,
    createdAtMs: safeCreatedAtMs,
    updatedAtMs: now,
  };
}

function pickPrimaryAccountForMerge(accounts, fallbackTs) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const sorted = accounts
    .map((account, index) => ({
      account,
      index,
      createdAtMs: asTimestamp(account?.createdAtMs, fallbackTs),
      accountId: String(account?.accountId || ""),
    }))
    .sort((a, b) => {
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
    updatedAtMs: asTimestamp(best.updatedAtMs, fallbackTs),
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
  const seedParts = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f];
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const idx = i % 4;
    seedParts[idx] = Math.imul(seedParts[idx] ^ code, 0x45d9f3b) >>> 0;
    seedParts[idx] = (seedParts[idx] ^ (seedParts[idx] >>> 16)) >>> 0;
  }
  const hex = seedParts
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("")
    .slice(0, 32);
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
    folderIds: Array.isArray(account?.folderIds)
      ? account.folderIds.map((id) => String(id || "").trim().toLowerCase()).filter(Boolean)
      : (account?.folderId == null ? [] : [String(account.folderId).trim().toLowerCase()]),
    sites,
    username,
    password: String(account?.password || ""),
    totpSecret: String(account?.totpSecret || ""),
    recoveryCodes: String(account?.recoveryCodes || ""),
    note: String(account?.note || ""),
    passkeyCredentialIds,
    usernameUpdatedAtMs: asTimestamp(account?.usernameUpdatedAtMs, createdAtMs),
    passwordUpdatedAtMs: asTimestamp(account?.passwordUpdatedAtMs, createdAtMs),
    totpUpdatedAtMs: asTimestamp(account?.totpUpdatedAtMs, createdAtMs),
    recoveryCodesUpdatedAtMs: asTimestamp(account?.recoveryCodesUpdatedAtMs, createdAtMs),
    noteUpdatedAtMs: asTimestamp(account?.noteUpdatedAtMs, createdAtMs),
    passkeyUpdatedAtMs: asTimestamp(account?.passkeyUpdatedAtMs, createdAtMs),
    isDeleted: Boolean(account?.isDeleted),
    deletedAtMs: account?.deletedAtMs == null ? null : asTimestamp(account.deletedAtMs, 0),
    lastOperatedDeviceName: normalizeUsername(account?.lastOperatedDeviceName || "") || "ChromeMac",
    createdAtMs,
    updatedAtMs: asTimestamp(account?.updatedAtMs, createdAtMs),
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
  };
}

function normalizePasskeyCreateCompatMethod(input, alg) {
  const value = String(input || "").trim().toLowerCase();
  if (
    value === "standard" ||
    value === "user_name_fallback" ||
    value === "rs256" ||
    value === "user_name_fallback+rs256" ||
    value === "unknown_linked"
  ) {
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
  const createdAtMs = Number(item?.createdAtMs || now);
  const safeName = safeId === FIXED_NEW_ACCOUNT_FOLDER_ID
    ? FIXED_NEW_ACCOUNT_FOLDER_NAME
    : (rawName || `未命名文件夹 ${safeId.slice(0, 8)}`);
  return {
    id: safeId,
    name: safeName,
    matchedSites: normalizeSites(item?.matchedSites || []),
    autoAddMatchingSites: Boolean(item?.autoAddMatchingSites),
    createdAtMs,
    updatedAtMs: Number(item?.updatedAtMs || createdAtMs),
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
  const linkedById = new Map();

  for (const account of accounts) {
    const ids = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
    if (ids.length === 0) continue;
    const rpId = normalizeDomain((account?.sites && account.sites[0]) || account?.canonicalSite || "");
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
        createCompatMethod: "unknown_linked",
      });
    }
  }

  const linkedPasskeys = Array.from(linkedById.values()).filter((item) => String(item.rpId || "").trim().length > 0);
  return mergePasskeyCollections(storedPasskeys, linkedPasskeys);
}

function mergeAccountCollections(local, remote) {
  return mergeAccountCollectionsCore(local, remote, syncMergeHelpers());
}

function mergePasskeyCollections(local, remote) {
  return mergePasskeyCollectionsCore(local, remote, syncMergeHelpers());
}

function mergeFolderCollections(local, remote) {
  return mergeFolderCollectionsCore(local, remote, syncMergeHelpers());
}

function reconcileAccountFolders(accounts, folders) {
  return reconcileAccountFoldersCore(accounts, folders, syncMergeHelpers());
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
    fixedNewAccountFolderName: FIXED_NEW_ACCOUNT_FOLDER_NAME,
  };
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
    folders: Array.isArray(rawPayload.folders) ? rawPayload.folders : [],
  };
}

async function getDeviceName() {
  const result = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  return String(result[STORAGE_KEY_DEVICE_NAME] || "").trim() || "ChromeMac";
}

async function getOrCreateSyncDeviceId() {
  const result = await chrome.storage.local.get([STORAGE_KEY_SYNC_DEVICE_ID]);
  const existing = String(result[STORAGE_KEY_SYNC_DEVICE_ID] || "").trim().toLowerCase();
  if (isUuidLower(existing)) return existing;
  const generated = String(
    globalThis.crypto?.randomUUID?.() || stableUuidFromText(`sync-device|${Date.now()}|${Math.random()}`)
  ).toLowerCase();
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
      formatVersion: 2,
    },
    payload: {
      accounts,
      passkeys,
      folders,
    },
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
  const response = await fetch(target.url, { method: "GET", headers, cache: "no-store" });
  if (response.status === 404) return { payload: null, etag: null };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (!String(text || "").trim()) {
    return { payload: null, etag: response.headers.get("ETag") };
  }
  const parsed = JSON.parse(text);
  const payload = parseSyncBundlePayload(parsed, { requireBundleSchema: true });
  if (!payload) throw new Error("远端数据格式错误，仅支持 pass.sync.bundle.v2");
  return { payload, etag: response.headers.get("ETag") };
}

async function pushRemotePayload(target, payload, ifMatch = null) {
  const bundle = await buildSyncBundleFromPayload(payload);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (target.authHeader) headers.Authorization = target.authHeader;
  if (ifMatch) headers["If-Match"] = ifMatch;
  const response = await fetch(target.url, {
    method: "PUT",
    headers,
    body: JSON.stringify(bundle, null, 2),
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return { etag: response.headers.get("ETag") };
}

async function pushRemotePayloadWithRetry(target, payload) {
  try {
    const pushResult = await pushRemotePayload(target, payload, target.remoteEtag);
    target.remoteEtag = pushResult.etag;
    return { payload };
  } catch (error) {
    if (!target.supportsEtag || error?.status !== 412) throw error;
  }

  const latestResponse = await pullRemotePayload(target);
  target.remoteEtag = latestResponse.etag;
  const remotePayload = latestResponse.payload || { accounts: [], passkeys: [], folders: [] };
  const localAccounts = Array.isArray(payload.accounts) ? payload.accounts.map(normalizeAccountShape) : [];
  const localPasskeys = buildUnifiedPasskeys(localAccounts, Array.isArray(payload.passkeys) ? payload.passkeys.map(normalizePasskeyShape) : []);
  const localFolders = Array.isArray(payload.folders) ? payload.folders.map(normalizeFolderShape) : [];
  const remoteAccounts = remotePayload.accounts.map(normalizeAccountShape);
  const remotePasskeys = buildUnifiedPasskeys(remoteAccounts, remotePayload.passkeys);
  const remoteFolders = remotePayload.folders.map(normalizeFolderShape);

  let mergedFolders = mergeFolderCollections(localFolders, remoteFolders);
  let mergedAccounts = mergeAccountCollections(localAccounts, remoteAccounts);
  mergedAccounts = syncAliasGroups(mergedAccounts);
  mergedAccounts = reconcileAccountFolders(mergedAccounts, mergedFolders);
  let mergedPasskeys = mergePasskeyCollections(localPasskeys, remotePasskeys);
  mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, mergedPasskeys);
  const reconciledPayload = { accounts: mergedAccounts, passkeys: mergedPasskeys, folders: mergedFolders };

  await writeBusinessDataToStore(reconciledPayload);
  const retryResult = await pushRemotePayload(target, reconciledPayload, target.remoteEtag);
  target.remoteEtag = retryResult.etag;
  return { payload: reconciledPayload };
}

async function pushRemotePayloadWithMode(target, payload, syncMode) {
  if (syncMode !== SYNC_MODE_MERGE) {
    const pushResult = await pushRemotePayload(target, payload, null);
    target.remoteEtag = pushResult.etag;
    return { payload };
  }
  return pushRemotePayloadWithRetry(target, payload);
}

function fillCredentialInPage(username, password) {
  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (element.hasAttribute("disabled") || element.hasAttribute("readonly")) return false;
    return true;
  };

  const forms = Array.from(document.forms);
  const allInputs = Array.from(document.querySelectorAll("input"));
  const passwordInputs = allInputs.filter((input) => input.type === "password" && visible(input));
  if (passwordInputs.length === 0) return;

  const usernameCandidates = allInputs.filter((input) => {
    const type = (input.type || "").toLowerCase();
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const autocomplete = (input.autocomplete || "").toLowerCase();
    const typeMatch = type === "text" || type === "email" || type === "tel";
    const semanticMatch =
      name.includes("user") ||
      name.includes("email") ||
      id.includes("user") ||
      id.includes("email") ||
      autocomplete.includes("username");
    return visible(input) && (typeMatch || semanticMatch);
  });

  const passwordInput = passwordInputs[0];
  let usernameInput = usernameCandidates[0] || null;

  if (!usernameInput) {
    const form = forms.find((formItem) => formItem.contains(passwordInput));
    if (form) {
      const localCandidates = Array.from(form.querySelectorAll("input")).filter((input) => {
        const type = (input.type || "").toLowerCase();
        return visible(input) && (type === "text" || type === "email");
      });
      usernameInput = localCandidates[0] || null;
    }
  }

  const setInputValue = (input, value) => {
    if (!input) return;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  setInputValue(usernameInput, username);
  setInputValue(passwordInput, password);
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
    passwordUpdatedAtMs: createdAtMs,
    totpUpdatedAtMs: createdAtMs,
    recoveryCodesUpdatedAtMs: createdAtMs,
    noteUpdatedAtMs: createdAtMs,
    passkeyUpdatedAtMs: createdAtMs,
    isDeleted: false,
    deletedAtMs: null,
    lastOperatedDeviceName: deviceName,
    createdAtMs,
    updatedAtMs: createdAtMs,
  };
}

function accountMatchesDomain(account, domain) {
  const normalized = normalizeDomain(domain);
  const etld1 = etldPlusOne(normalized);
  const sites = normalizeSites(account.sites || []);
  return sites.some((site) => site === normalized || etldPlusOne(site) === etld1);
}
