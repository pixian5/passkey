import { ensurePasskeyStorageShape, handlePasskeyBridgeOperation } from "./passkey_store.js";
import { PASS_EXTENSION_VERSION } from "./extension_version.js";
import {
  appendPasskeyDiagnostic,
  buildPasskeyBridgeDiagnostic,
  buildPasskeyPageDiagnostic,
  getLatestCreateDiagnosticReport,
  STORAGE_KEY_PASSKEY_DIAGNOSTICS,
} from "./webauthn_diagnostics.js";
import {
  buildAccountId,
  domainsMatch,
  etldPlusOne,
  normalizeDomain,
  normalizeSites,
  normalizeUsername,
  syncAliasGroups,
} from "./account_core.js";
import {
  evaluateSyncSafety,
  mergeSyncPayloads as mergeSyncPayloadsCore,
  mergeAccountCollections as mergeAccountCollectionsCore,
  mergeFolderCollections as mergeFolderCollectionsCore,
  mergePasskeyCollections as mergePasskeyCollectionsCore,
  reconcileAccountFolders as reconcileAccountFoldersCore,
} from "../../core/pass_core/js/sync_merge_core.js";
import {
  appendHistoryEntry,
  disableDataEncryption,
  ensureDataStorageReady,
  getAllData as getAllDataFromDataStore,
  getAccounts as getAccountsFromDataStore,
  getSafetySnapshots,
  getSyncOutbox,
  lockDataEncryption,
  migrateLegacySyncSecrets,
  rewrapDataEncryption,
  setAllData as setAllDataToDataStore,
  setSafetySnapshots,
  setSyncOutbox,
  setSyncSecrets,
  unlockDataEncryption,
} from "./data_store.js";
import {
  createLockMasterCredential,
  normalizeLockMasterCredential,
  verifyLockMasterPassword,
} from "./lock_crypto.js";
import {
  LOCK_POLICY_IDLE_TIMEOUT,
  LOCK_STATE_CHANGED_MESSAGE,
  STORAGE_KEY_LOCK_ENABLED,
  STORAGE_KEY_LOCK_IDLE_MINUTES,
  STORAGE_KEY_LOCK_LAST_ACTIVITY,
  STORAGE_KEY_LOCK_MASTER_CREDENTIAL,
  STORAGE_KEY_LOCK_POLICY,
  STORAGE_KEY_LOCK_UNLOCKED_AT,
} from "./lock_state.js";
import {
  isSyncOutboxReady,
  matchingSyncOutboxItem,
  removeOrphanedSyncOutbox,
  syncPayloadSha256,
  syncTargetKey,
  upsertSyncOutbox,
} from "./sync_outbox.js";
import {
  decryptSyncBundleDocument,
  encryptSyncBundleDocument,
  generateSyncEncryptionKey,
  normalizeSyncEncryptionKey,
} from "./sync_crypto.js";
import { isTrustedExtensionMessageSender } from "./message_security.js";
import { createSyncIdempotencyKey, secureRandomUuid } from "./secure_random.js";
import { buildSyncOperationReport } from "./sync_report.js";

import {
  DEFAULT_DEVICE_NAME,
  FIXED_NEW_ACCOUNT_FOLDER_ID,
  FIXED_NEW_ACCOUNT_FOLDER_NAME,
  SYNC_PUSH_CONFLICT_MAX_ATTEMPTS,
  normalizeDeviceName,
} from "../../core/pass_core/js/sync_policy.js";

const PASSKEY_LOG_PREFIX = "[Pass background]";
const SYNC_LOG_PREFIX = "[Pass sync]";

function logPasskeyFlow(event, details = {}) {
  try {
    console.info(PASSKEY_LOG_PREFIX, event, details);
  } catch {
    // Ignore logging failures.
  }
}

function logSyncFlow(event, details = {}) {
  try {
    console.info(SYNC_LOG_PREFIX, event, details);
  } catch {
    // Ignore logging failures.
  }
}

function visibleSyncCount(values) {
  return (Array.isArray(values) ? values : [])
    .filter((item) => item?.isPermanentlyDeleted !== true)
    .length;
}

const STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
const STORAGE_KEY_SYNC_ENABLE_WEBDAV = "pass.sync.enableWebDAV.v3";
const STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER = "pass.sync.enableSelfHostedServer.v3";
const STORAGE_KEY_SYNC_WEBDAV_BASE_URL = "pass.sync.webdav.baseUrl.v2";
const STORAGE_KEY_SYNC_WEBDAV_PATH = "pass.sync.webdav.path.v2";
const STORAGE_KEY_SYNC_WEBDAV_USERNAME = "pass.sync.webdav.username.v2";
const STORAGE_KEY_SYNC_SERVER_BASE_URL = "pass.sync.server.baseUrl.v2";
const STORAGE_KEY_SYNC_PRIMARY_SOURCE = "pass.sync.primarySource.v1";
const STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES = "pass.sync.autoIntervalMinutes.v1";
const STORAGE_KEY_SYNC_DEVICE_ID = "pass.sync.deviceId.v1";
const STORAGE_KEY_SYNC_OPERATION_LOCK = "pass.sync.operationLock.v1";
const SYNC_OPERATION_LOCK_TTL_MS = 10 * 60 * 1000;
const CONTEXT_MENU_ID_ALL_ACCOUNTS = "pass.context.all_accounts";
const DEFAULT_SELF_HOSTED_SERVER_BASE_URL = "https://uk.sbbz.tech:5443";
const SYNC_BUNDLE_SCHEMA_V2 = "pass.sync.bundle.v2";
const SYNC_MODE_MERGE = "merge";
const SYNC_PRIMARY_SERVER = "server";
const SYNC_PRIMARY_WEBDAV = "webdav";
const AUTO_SYNC_ALARM_NAME = "pass.sync.auto";
let autoSyncInFlight = false;

async function acquireSyncOperationLock(owner) {
  const storage = chrome.storage?.session;
  if (!storage) return owner;
  const now = Date.now();
  const current = await storage.get([STORAGE_KEY_SYNC_OPERATION_LOCK]);
  const lock = current[STORAGE_KEY_SYNC_OPERATION_LOCK];
  if (lock && Number(lock.expiresAtMs) > now && lock.owner !== owner) return null;
  await storage.set({
    [STORAGE_KEY_SYNC_OPERATION_LOCK]: { owner, expiresAtMs: now + SYNC_OPERATION_LOCK_TTL_MS },
  });
  const verified = await storage.get([STORAGE_KEY_SYNC_OPERATION_LOCK]);
  return verified[STORAGE_KEY_SYNC_OPERATION_LOCK]?.owner === owner ? owner : null;
}

async function releaseSyncOperationLock(owner) {
  const storage = chrome.storage?.session;
  if (!storage) return;
  const current = await storage.get([STORAGE_KEY_SYNC_OPERATION_LOCK]);
  if (current[STORAGE_KEY_SYNC_OPERATION_LOCK]?.owner === owner) {
    await storage.remove(STORAGE_KEY_SYNC_OPERATION_LOCK);
  }
}
const SENSITIVE_MESSAGE_TYPES = new Set([
  "PASS_FILL_ACTIVE_TAB",
  "PASS_LOGIN_DETECTED",
  "PASS_SAVE_FROM_LOGIN",
  "PASS_PASSKEY_OPERATION",
  "PASS_CONTENT_GET_ACCOUNTS",
  "PASS_CONTENT_CHECK_LOGIN",
  "PASS_CONTENT_LIST_FILL_ACCOUNTS",
  "PASS_CONTENT_FILL_ACCOUNT",
  "PASS_WEB_BRIDGE_SYNC_DATA",
  "PASS_WEB_SYNC_CONFIGURE",
  "PASS_SYNC_RUN",
  "PASS_SYNC_OUTBOX_STATUS",
  "PASS_SYNC_OUTBOX_CLEAR_INACTIVE",
  "PASS_SYNC_SNAPSHOTS_LIST",
  "PASS_SYNC_SNAPSHOT_RESTORE",
]);

let webBridgeSyncChain = Promise.resolve();
const SYNC_HTTP_TIMEOUT_MS = 30_000;

async function fetchWithSyncTimeout(url, options = {}, stage = "同步请求") {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), SYNC_HTTP_TIMEOUT_MS) : null;
  try {
    return await fetch(url, controller ? { ...options, signal: controller.signal } : options);
  } catch (error) {
    if (controller?.signal.aborted) throw new Error(`${stage}超时（${SYNC_HTTP_TIMEOUT_MS / 1000} 秒）`);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function normalizeWebdavRemotePath(value) {
  const raw = String(value || "").trim();
  if (!raw || /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.includes("?") || raw.includes("#")) {
    throw new Error("WebDAV 远端路径必须是相对路径，且不能包含查询串或锚点");
  }
  const path = raw.replace(/^\/+/, "");
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("WebDAV 远端路径包含非法路径段");
  }
  return parts.join("/");
}

function normalizeLegacySelfHostedServerBaseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return DEFAULT_SELF_HOSTED_SERVER_BASE_URL;
  try {
    const parsed = new URL(trimmed);
    if (!isSecureSyncEndpoint(parsed)) return "";
    const host = String(parsed.hostname || "").toLowerCase();
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80);
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

async function migrateLegacySelfHostedServerSettings() {
  return;
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);

  if (!stored[STORAGE_KEY_DEVICE_NAME]) {
    await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: DEFAULT_DEVICE_NAME });
  }

  await ensureDataStorageReady().catch(() => {});
  await ensurePasskeyStorageShape().catch(() => {});
  ensureActionContextMenu();
  await scheduleAutoSyncAlarm();
  void injectExistingTabScripts();
});

void ensureDataStorageReady().catch(() => {});
void ensurePasskeyStorageShape().catch(() => {});
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
    // Ignore activation lookup failures.
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (
    changes[STORAGE_KEY_SYNC_ENABLE_WEBDAV] ||
    changes[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER] ||
    changes[STORAGE_KEY_SYNC_WEBDAV_BASE_URL] ||
    changes[STORAGE_KEY_SYNC_WEBDAV_PATH] ||
    changes[STORAGE_KEY_SYNC_WEBDAV_USERNAME] ||
    changes[STORAGE_KEY_SYNC_SERVER_BASE_URL] ||
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

function shouldInjectMainWorldBridge(url) {
  const value = String(url || "").trim().toLowerCase();
  return value.startsWith("http://") || value.startsWith("https://");
}

async function ensureMainWorldPasskeyBridge(tabId, url) {
  if (!tabId || !shouldInjectMainWorldBridge(url)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["dist/content.js"],
    });
    logPasskeyFlow("isolated-bridge-injected", {
      tabId,
      url,
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: (version) => {
        try {
          window.__passMainWorldProbe = version;
          document.documentElement?.setAttribute("data-pass-main-world-probe", version);
          console.warn("[Pass probe] main world reachable", {
            version,
            href: window.location.href,
          });
        } catch {
          // Ignore probe failures.
        }
      },
      args: [PASS_EXTENSION_VERSION],
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["dist/webauthn_injected.js"],
      world: "MAIN",
    });
    logPasskeyFlow("main-world-bridge-injected", {
      tabId,
      url,
    });
  } catch (error) {
    logPasskeyFlow("main-world-bridge-inject-failed", {
      tabId,
      url,
      message: error?.message || String(error || ""),
    });
  }
}

async function injectExistingTabScripts() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(
      tabs
        .filter((tab) => tab?.id && shouldInjectMainWorldBridge(tab.url || ""))
        .map((tab) => ensureMainWorldPasskeyBridge(tab.id, tab.url || ""))
    );
  } catch (error) {
    logPasskeyFlow("existing-tab-injection-failed", {
      message: error?.message || String(error || ""),
    });
  }
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
  return runManagedSync({ automatic: true });
}

async function runManagedSync({
  mode = SYNC_MODE_MERGE,
  dryRun = false,
  forceOutboxRetry = false,
  automatic = false,
} = {}) {
  if (autoSyncInFlight) {
    logSyncFlow("auto-sync-skipped-in-flight");
    if (automatic) return null;
    throw new Error("已有同步任务正在进行，请稍后重试");
  }
  autoSyncInFlight = true;
  const lockOwner = createSyncIdempotencyKey();
  try {
    if (!await acquireSyncOperationLock(lockOwner)) {
      logSyncFlow("auto-sync-skipped-in-flight");
      if (automatic) return null;
      throw new Error("已有同步任务正在进行，请稍后重试");
    }
    return await runAutoSyncInternal(lockOwner, { mode, dryRun, forceOutboxRetry, automatic });
  } finally {
    await releaseSyncOperationLock(lockOwner);
    autoSyncInFlight = false;
  }
}

async function runAutoSyncInternal(syncSessionId = createSyncIdempotencyKey(), options = {}) {
  const mode = ["remoteOverwriteLocal", "localOverwriteRemote"].includes(options.mode)
    ? options.mode
    : SYNC_MODE_MERGE;
  const dryRun = Boolean(options.dryRun);
  const forceOutboxRetry = Boolean(options.forceOutboxRetry);
  const automatic = Boolean(options.automatic);
  const reportOperationId = createSyncIdempotencyKey();
  const lockStatus = await getBackgroundLockStatus();
  if (lockStatus.locked) {
    logSyncFlow("auto-sync-skipped-locked");
    if (automatic) return null;
    throw new Error("扩展已锁定，请先解锁");
  }
  const targets = await buildRemoteSyncTargetsFromStorage();
  if (!targets || targets.length === 0) {
    if (automatic) return null;
    throw new Error("请先启用并配置同步来源");
  }
  const primaryTarget = targets.find((target) => target.isPrimary) || targets[0];
  const primaryReportSource = primaryTarget.kind === "server" ? "selfHosted" : primaryTarget.kind;
  const encryptionKey = await getOrCreateSyncEncryptionKey();
  logSyncFlow("auto-sync-start", {
    targetLabels: targets.map((item) => item.label),
    targetUrls: targets.map((item) => item.url),
    encrypted: Boolean(encryptionKey),
    online: typeof navigator !== "undefined" ? navigator.onLine : null,
  });

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
  let finalPayload = null;
  let primaryRemotePayload = null;
  const pullErrors = [];

  for (const target of targets) {
    logSyncFlow("pull-start", {
      label: target.label,
      url: target.url,
      hasAuthHeader: Boolean(target.authHeader),
    });
    let remoteResponse;
    try {
      remoteResponse = await pullRemotePayload(target);
    } catch (error) {
      logSyncFlow("auto-sync-pull-failed", {
        label: target.label,
        message: error?.message || String(error || ""),
      });
      const queued = await advancePendingOutboxAfterPullFailure(target, error, forceOutboxRetry);
      if (target.isPrimary) {
        return {
          report: buildSyncOperationReport({
            ok: false, safe: true, reasons: [error?.message || String(error || "")],
            safety: "notEvaluated",
            dryRun, mode, message: `${target.label}拉取失败：${error?.message || String(error || "")}`,
            localAccounts: visibleSyncCount(localAccounts), remoteAccounts: 0,
            mergedAccounts: visibleSyncCount(localAccounts), applied: false, pushed: false,
            remotePulled: false, pendingRetry: queued, retryable: true, stage: "pullingRemote",
            source: target.kind === "server" ? "selfHosted" : target.kind,
            syncSessionId, operationId: reportOperationId,
          }),
        };
      }
      pullErrors.push(`${target.label}: ${error?.message || String(error || "")}`);
      continue;
    }
    logSyncFlow("pull-success", {
      label: target.label,
      url: target.url,
      hasPayload: Boolean(remoteResponse.payload),
      etag: remoteResponse.etag,
    });
    updateRemoteConcurrencyState(target, remoteResponse.etag, remoteResponse.revision);
    target.remotePayload = remoteResponse.payload;
    target.remoteEncrypted = remoteResponse.encrypted;
    const remotePayload = remoteResponse.payload;
      if (
        target.kind === "webdav"
        && remotePayload
        && !String(remoteResponse.etag || "").trim()
      ) {
        throw new Error(
          "WebDAV 远端已有同步包但未返回 ETag，无法安全做条件写入。请改用支持 ETag 的 WebDAV，或改用自建服务器作为主源。"
        );
      }
    if (target.isPrimary) {
      primaryRemotePayload = remotePayload
        ? normalizeSyncPayloadShape(remotePayload)
        : null;
    }
  }

  const currentPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
  const pulledLocalPayload = {
    ...currentPayload,
    accounts: localAccounts,
    folders: localFolders,
    passkeys: localPasskeys,
  };
  if (!syncPayloadEquals(currentPayload, pulledLocalPayload)) {
    logSyncFlow("auto-sync-aborted-local-changed-during-pull");
    return {
      report: buildSyncOperationReport({
        ok: false,
        safe: true,
        safety: "notEvaluated",
        reasons: ["拉取远端数据期间本地内容已变化，请重新同步"],
        dryRun,
        mode,
        message: "拉取远端数据期间本地内容已变化，请重新同步",
        localAccounts: visibleSyncCount(currentPayload.accounts),
        remoteAccounts: visibleSyncCount(primaryRemotePayload?.accounts),
        mergedAccounts: visibleSyncCount(currentPayload.accounts),
        applied: false,
        pushed: false,
        remotePulled: true,
        pendingRetry: false,
        retryable: true,
        stage: "checkingLocalConcurrency",
        source: primaryReportSource,
        syncSessionId,
        operationId: reportOperationId,
      }),
      localPayload: currentPayload,
      payload: currentPayload,
    };
  }
  if (primaryRemotePayload && mode === SYNC_MODE_MERGE) {
    const canonicalLocalPayload = {
      ...pulledLocalPayload,
      accounts: syncAliasGroups(pulledLocalPayload.accounts),
    };
    const canonicalRemotePayload = {
      ...primaryRemotePayload,
      accounts: syncAliasGroups(primaryRemotePayload.accounts),
    };
    const mergedPayload = mergeSyncPayloadsCore(
      canonicalLocalPayload,
      canonicalRemotePayload,
      syncMergeHelpers(),
    );
    mergedPayload.accounts = syncAliasGroups(mergedPayload.accounts);
    ({ accounts: mergedAccounts, folders: mergedFolders, passkeys: mergedPasskeys } = mergedPayload);
    finalPayload = mergedPayload;
  } else if (mode === "remoteOverwriteLocal") {
    finalPayload = normalizeSyncPayloadShape(primaryRemotePayload || {
      accounts: [], folders: [], passkeys: [], allRegularAccountIds: [], folderOrderIds: [],
    });
    ({ accounts: mergedAccounts, folders: mergedFolders, passkeys: mergedPasskeys } = finalPayload);
  } else {
    finalPayload = currentPayload;
  }

  if (primaryRemotePayload || mode === "remoteOverwriteLocal") {
    const safety = validateSyncSafety(
      { accounts: syncAliasGroups(localAccounts), folders: localFolders, passkeys: localPasskeys },
      { ...(primaryRemotePayload || {}), accounts: syncAliasGroups(primaryRemotePayload?.accounts || []) },
      { accounts: mergedAccounts, folders: mergedFolders, passkeys: mergedPasskeys },
      mode
    );
    if (!safety.safe) {
      logSyncFlow("auto-sync-aborted-safety-check", {
        reasons: safety.reasons,
        local: safety.local,
        remote: safety.remote,
        merged: safety.merged,
      });
      return {
        report: buildSyncOperationReport({
          ok: false, safe: false, reasons: safety.reasons, dryRun, mode,
          message: `同步安全检查未通过：${safety.reasons.join("、")}`,
          localAccounts: visibleSyncCount(localAccounts),
          remoteAccounts: visibleSyncCount(primaryRemotePayload?.accounts),
          mergedAccounts: visibleSyncCount(mergedAccounts),
          applied: false, pushed: false, remotePulled: true, pendingRetry: false, retryable: false,
          stage: "safetyChecking", source: primaryReportSource, syncSessionId, operationId: reportOperationId,
        }),
        localPayload: currentPayload,
        payload: finalPayload,
      };
    }
  }

  if (dryRun) {
    return {
      report: buildSyncOperationReport({
        ok: true, safe: true, reasons: [], dryRun: true, mode,
        message: "预览完成（未写入）",
        localAccounts: visibleSyncCount(localAccounts),
        remoteAccounts: visibleSyncCount(primaryRemotePayload?.accounts),
        mergedAccounts: visibleSyncCount(mergedAccounts),
        applied: false, pushed: false, remotePulled: true, pendingRetry: false, retryable: false,
        stage: "completed", source: primaryReportSource, syncSessionId, operationId: reportOperationId,
      }),
      localPayload: currentPayload,
      payload: finalPayload,
    };
  }

  try {
    await saveLocalSafetySnapshot(automatic ? "自动同步前自动备份" : "同步写入本地前自动备份");
  } catch (error) {
    logSyncFlow("auto-sync-aborted-backup-failed", { message: error?.message || String(error || "") });
    throw new Error(`同步前本地安全快照失败：${error?.message || String(error || "")}`);
  }

  if (mode !== "localOverwriteRemote") {
    await writeBusinessDataToStore({
      ...finalPayload,
      accounts: mergedAccounts,
      passkeys: mergedPasskeys,
      folders: mergedFolders,
    });
  }

  const pushTargets = [...targets].sort((left, right) =>
    Number(right.isPrimary) - Number(left.isPrimary)
      || Number(right.supportsEtag) - Number(left.supportsEtag)
  );
  const pushErrors = [...pullErrors];
  let primaryPushFailed = false;
  let primaryOperationId = reportOperationId;
  const outboxByTarget = new Map((await getSyncOutbox()).map((item) => [item.targetKey, item]));
  for (const target of pushTargets) {
    if (primaryPushFailed && target.isPrimary === false) {
      pushErrors.push(`${target.label}: 主同步源上传失败，已跳过镜像写入`);
      continue;
    }
    const targetKey = syncTargetKey(target);
    const pendingOutbox = outboxByTarget.get(targetKey);
    const candidatePayload = {
      ...finalPayload,
      accounts: mergedAccounts,
      passkeys: mergedPasskeys,
      folders: mergedFolders,
    };
    const candidateHash = await syncPayloadSha256(candidatePayload);
    const persistedContext = matchingSyncOutboxItem(pendingOutbox, candidateHash);
    if (target.isPrimary && persistedContext?.operationId) {
      primaryOperationId = persistedContext.operationId;
    }
    if (persistedContext && !forceOutboxRetry && !isSyncOutboxReady(persistedContext)) {
      const paused = pendingOutbox.status === "paused";
      const waitSeconds = Math.max(1, Math.ceil((pendingOutbox.nextRetryAtMs - Date.now()) / 1000));
      pushErrors.push(paused
        ? `${target.label}: 补偿任务已暂停，等待用户手动重试`
        : `${target.label}: 补偿任务将在 ${waitSeconds} 秒后重试`);
      logSyncFlow(paused ? "push-skipped-paused" : "push-skipped-backoff", {
        label: target.label,
        nextRetryAtMs: pendingOutbox.nextRetryAtMs,
        attempts: pendingOutbox.attempts,
      });
      continue;
    }
    logSyncFlow("push-start", {
      label: target.label,
      url: target.url,
      supportsEtag: Boolean(target.supportsEtag),
      remoteEtag: target.remoteEtag,
    });
    let result;
    const operationId = persistedContext?.operationId
      || (target.isPrimary ? reportOperationId : createSyncIdempotencyKey());
    if (target.isPrimary) primaryOperationId = operationId;
    const idempotencyKey = persistedContext?.idempotencyKey || createSyncIdempotencyKey();
    try {
      result = await pushRemotePayloadWithMode(target, {
        ...candidatePayload,
      }, target.isPrimary ? mode : "localOverwriteRemote", {
        syncSessionId: persistedContext?.syncSessionId || syncSessionId,
        operationId,
        idempotencyKey,
      });
    } catch (error) {
      pushErrors.push(`${target.label}: ${error?.message || String(error || "")}`);
      if (target.isPrimary) primaryPushFailed = true;
      const nextOutbox = upsertSyncOutbox([...outboxByTarget.values()], {
        targetKey,
        payload: candidatePayload,
        error,
        payloadSha256: candidateHash,
        expectedEtag: error?.expectedEtag || target.remoteEtag || "",
        expectedRevision: error?.expectedRevision || target.remoteRevision || 0,
        idempotencyKey: error?.idempotencyKey || idempotencyKey,
        syncSessionId: error?.syncSessionId || syncSessionId,
        operationId: error?.operationId || operationId,
        sourceType: target.kind,
        scope: target.scope || "",
        forceResume: forceOutboxRetry,
      });
      outboxByTarget.clear();
      for (const item of nextOutbox) outboxByTarget.set(item.targetKey, item);
      logSyncFlow("auto-sync-push-failed", {
        label: target.label,
        message: error?.message || String(error || ""),
      });
      continue;
    }
    outboxByTarget.delete(targetKey);
    logSyncFlow("push-success", {
      label: target.label,
      url: target.url,
      itemCounts: {
        accounts: visibleSyncCount(result?.payload?.accounts),
        passkeys: visibleSyncCount(result?.payload?.passkeys),
        folders: visibleSyncCount(result?.payload?.folders),
      },
    });
    mergedAccounts = result.payload.accounts.map(normalizeAccountShape);
    mergedFolders = result.payload.folders.map(normalizeFolderShape);
    mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, result.payload.passkeys);
  }

  await setSyncOutbox([...outboxByTarget.values()]);

  await writeBusinessDataToStore({
    ...finalPayload,
    accounts: mergedAccounts,
    passkeys: mergedPasskeys,
    folders: mergedFolders,
  });
  await appendHistoryEntry({
    action: pushErrors.length > 0
      ? `${automatic ? "自动同步" : "同步"}部分完成（${pushErrors.join("；")}）`
      : `${automatic ? "自动同步" : "同步"}完成（${targets.map((item) => item.label).join(" + ")}）`,
    timestampMs: Date.now(),
  });
  logSyncFlow("auto-sync-complete", {
    targetLabels: targets.map((item) => item.label),
    pushErrors,
  });
  return {
    report: buildSyncOperationReport({
      ok: pushErrors.length === 0,
      safe: true,
      reasons: pushErrors,
      dryRun: false,
      mode,
      message: pushErrors.length > 0 ? `同步部分完成：${pushErrors.join("；")}` : "同步完成",
      localAccounts: visibleSyncCount(localAccounts),
      remoteAccounts: visibleSyncCount(primaryRemotePayload?.accounts),
      mergedAccounts: visibleSyncCount(mergedAccounts),
      applied: mode !== "localOverwriteRemote",
      pushed: pushErrors.length === 0,
      remotePulled: true,
      pendingRetry: pushErrors.length > 0,
      retryable: pushErrors.length > 0,
      stage: pushErrors.length > 0 ? "pushingRemote" : "completed",
      source: primaryReportSource,
      syncSessionId,
      operationId: primaryOperationId,
      etag: primaryTarget.remoteEtag,
    }),
  };
}

async function readBusinessDataFromStore() {
  const stored = await getAllDataFromDataStore();
  return {
    accounts: Array.isArray(stored.accounts) ? stored.accounts : [],
    passkeys: Array.isArray(stored.passkeys) ? stored.passkeys : [],
    folders: Array.isArray(stored.folders) ? stored.folders : [],
    allRegularAccountIds: Array.isArray(stored.allRegularAccountIds) ? stored.allRegularAccountIds : [],
    allRegularOrderUpdatedAtMs: Number(stored.allRegularOrderUpdatedAtMs) || 0,
    allRegularOrderUpdatedDeviceName: String(stored.allRegularOrderUpdatedDeviceName || ""),
    folderOrderIds: Array.isArray(stored.folderOrderIds) ? stored.folderOrderIds : [],
    folderOrderUpdatedAtMs: Number(stored.folderOrderUpdatedAtMs) || 0,
    folderOrderUpdatedDeviceName: String(stored.folderOrderUpdatedDeviceName || ""),
    deviceName: String(stored.deviceName || ""),
  };
}

async function saveLocalSafetySnapshot(reason) {
  const payload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
  const snapshots = await getSafetySnapshots();
  snapshots.unshift({ id: `sync-snapshot-${secureRandomUuid()}`, createdAtMs: Date.now(), reason: String(reason || "同步前备份"), payload });
  await setSafetySnapshots(snapshots);
}

async function listLocalSafetySnapshots() {
  return (await getSafetySnapshots()).map((snapshot) => ({
    id: snapshot.id,
    reason: snapshot.reason,
    createdAtMs: snapshot.createdAtMs,
    accounts: visibleSyncCount(snapshot.payload?.accounts),
    folders: visibleSyncCount(snapshot.payload?.folders),
    passkeys: visibleSyncCount(snapshot.payload?.passkeys),
  }));
}

async function restoreLocalSafetySnapshot(snapshotId) {
  const snapshots = await getSafetySnapshots();
  const snapshot = snapshots.find((item) => String(item.id) === String(snapshotId || ""));
  if (!snapshot) throw new Error("后台同步快照不存在或已被清理");
  await saveLocalSafetySnapshot("恢复本地快照前自动备份");
  await writeBusinessDataToStore(snapshot.payload);
  await appendHistoryEntry({ action: `恢复本地安全快照（${snapshot.reason}）`, timestampMs: Date.now() });
  return { message: "本地安全快照已恢复" };
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
    allRegularAccountIds: Array.isArray(payload?.allRegularAccountIds) ? payload.allRegularAccountIds.map(String).filter(Boolean) : [],
    allRegularOrderUpdatedAtMs: Number(payload?.allRegularOrderUpdatedAtMs) || 0,
    allRegularOrderUpdatedDeviceName: String(payload?.allRegularOrderUpdatedDeviceName || ""),
    folderOrderIds: Array.isArray(payload?.folderOrderIds) ? payload.folderOrderIds.map(String).filter(Boolean) : [],
    folderOrderUpdatedAtMs: Number(payload?.folderOrderUpdatedAtMs) || 0,
    folderOrderUpdatedDeviceName: String(payload?.folderOrderUpdatedDeviceName || ""),
    deviceName: String(payload?.deviceName || ""),
  };
}

function syncPayloadEquals(lhs, rhs) {
  return JSON.stringify(sortSyncPayloadCollections(normalizeSyncPayloadShape(lhs)))
    === JSON.stringify(sortSyncPayloadCollections(normalizeSyncPayloadShape(rhs)));
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
    accounts: [...(payload?.accounts || [])].sort((lhs, rhs) => compare(lhs, rhs, ["recordId", "accountId"])),
    passkeys: [...(payload?.passkeys || [])].sort((lhs, rhs) => compare(lhs, rhs, ["credentialIdB64u"])),
    folders: [...(payload?.folders || [])].sort((lhs, rhs) => compare(lhs, rhs, ["id"])),
    allRegularAccountIds: [...(payload?.allRegularAccountIds || [])],
    folderOrderIds: [...(payload?.folderOrderIds || [])],
  };
}

async function broadcastWebBridgeData(data) {
  try {
    await chrome.runtime.sendMessage({
      type: "PASS_WEB_BRIDGE_DATA_CHANGED",
      payload: normalizeSyncPayloadShape(data),
    });
  } catch {
    // The management page may not be open. The background store remains authoritative.
  }
}

async function writeBusinessDataToStore(payload) {
  const currentPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
  const nextPayload = normalizeSyncPayloadShape({ ...currentPayload, ...(payload || {}) });
  if (syncPayloadEquals(currentPayload, nextPayload)) {
    return false;
  }
  await setAllDataToDataStore(nextPayload);
  await broadcastWebBridgeData(nextPayload);
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
    STORAGE_KEY_SYNC_PRIMARY_SOURCE,
  ]);
  const secrets = await migrateLegacySyncSecrets();
  const primarySource = String(result[STORAGE_KEY_SYNC_PRIMARY_SOURCE] || "").trim() === SYNC_PRIMARY_WEBDAV
    ? SYNC_PRIMARY_WEBDAV
    : SYNC_PRIMARY_SERVER;

  const targets = [];
  if (Boolean(result[STORAGE_KEY_SYNC_ENABLE_WEBDAV])) {
    const baseUrl = String(result[STORAGE_KEY_SYNC_WEBDAV_BASE_URL] || "").trim();
    const remotePath = normalizeWebdavRemotePath(String(result[STORAGE_KEY_SYNC_WEBDAV_PATH] || "").trim() || "pass-sync-bundle-v2.json");
    if (!baseUrl) return null;
    let parsedBaseUrl;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw new Error("WebDAV 同步地址无效");
    }
    if (!isSecureSyncEndpoint(parsedBaseUrl)) {
      throw new Error("WebDAV 同步地址必须使用 HTTPS（本机回环地址可使用 HTTP）");
    }
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const base = new URL(normalizedBase);
    if (base.username || base.password || base.search || base.hash) throw new Error("WebDAV 地址不能包含账号、查询串或锚点");
    const url = new URL(remotePath, normalizedBase).toString();
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
    if (!serverBaseUrl) throw new Error("服务器同步地址必须使用 HTTPS（本机回环地址可使用 HTTP）");
    const normalizedBase = serverBaseUrl.endsWith("/") ? serverBaseUrl : `${serverBaseUrl}/`;
    const url = new URL("v2/sync/state", normalizedBase).toString();
    const token = secrets.serverToken;
    const authHeader = token ? `Bearer ${token}` : null;
    targets.push({ label: "服务器", kind: "server", url, authHeader, supportsEtag: true, remoteEtag: null, remoteEncrypted: false, isPrimary: primarySource === SYNC_PRIMARY_SERVER });
  }

  const primaryTarget = targets.find((target) => target.kind === primarySource)
    || targets.find((target) => target.kind === SYNC_PRIMARY_SERVER)
    || targets[0];
  for (const target of targets) target.isPrimary = target === primaryTarget;

  logSyncFlow("targets-built", {
    webdavEnabled: Boolean(result[STORAGE_KEY_SYNC_ENABLE_WEBDAV]),
    serverEnabled: Boolean(result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER]),
    targets: targets.map((item) => ({
      label: item.label,
      url: item.url,
      hasAuthHeader: Boolean(item.authHeader),
      kind: item.kind === "webdav" ? "webdav" : "server",
      supportsEtag: Boolean(item.supportsEtag),
    })),
  });
  return targets.length > 0 ? targets : null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!isTrustedExtensionMessageSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, error: "拒绝来自其他扩展或网页的消息" });
      return;
    }
    if (SENSITIVE_MESSAGE_TYPES.has(message?.type)) {
      const lockStatus = await getBackgroundLockStatus();
      if (lockStatus.locked) {
        sendResponse({ ok: false, locked: true, error: "扩展已锁定" });
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
      case "PASS_WEB_SYNC_CONFIGURE":
        sendResponse(await configureWebSyncFromBridge(message.payload));
        return;
      case "PASS_SYNC_RUN":
        sendResponse({
          ok: true,
          result: await runManagedSync({
            mode: message.payload?.mode,
            dryRun: Boolean(message.payload?.dryRun),
            forceOutboxRetry: Boolean(message.payload?.forceOutboxRetry),
            automatic: false,
          }),
        });
        return;
      case "PASS_SYNC_OUTBOX_STATUS":
        sendResponse({ ok: true, items: await getSyncOutboxSummaries() });
        return;
      case "PASS_SYNC_OUTBOX_CLEAR_INACTIVE":
        sendResponse({ ok: true, removed: await clearInactiveSyncOutboxItems() });
        return;
      case "PASS_SYNC_SNAPSHOTS_LIST":
        sendResponse({ ok: true, items: await listLocalSafetySnapshots() });
        return;
      case "PASS_SYNC_SNAPSHOT_RESTORE":
        sendResponse({ ok: true, result: await restoreLocalSafetySnapshot(message.payload?.snapshotId) });
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
      case "PASS_PASSKEY_DIAGNOSTIC_EVENT":
        sendResponse(await recordPasskeyPageDiagnostic(message.payload));
        return;
      case "PASS_PASSKEY_LATEST_CREATE_DIAGNOSTIC":
        sendResponse(await getLatestPasskeyCreateDiagnostic());
        return;
      case "PASS_PASSKEY_CLEAR_DIAGNOSTICS":
        sendResponse(await clearPasskeyDiagnostics());
        return;
      case "PASS_CONTENT_GET_ACCOUNTS":
        // Compatibility alias: never returns passwords.
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
    STORAGE_KEY_LOCK_MASTER_CREDENTIAL,
  ]);
  const enabled = Boolean(settings[STORAGE_KEY_LOCK_ENABLED])
    && Boolean(normalizeLockMasterCredential(settings[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]));
  if (!enabled) return { ok: true, enabled: false, locked: false };

  const session = await chrome.storage.session.get([
    STORAGE_KEY_LOCK_UNLOCKED_AT,
    STORAGE_KEY_LOCK_LAST_ACTIVITY,
  ]);
  const unlockedAtMs = Number(session[STORAGE_KEY_LOCK_UNLOCKED_AT] || 0);
  let locked = unlockedAtMs <= 0;
  if (!locked && settings[STORAGE_KEY_LOCK_POLICY] === LOCK_POLICY_IDLE_TIMEOUT) {
    const idleMinutes = Math.min(Math.max(Number(settings[STORAGE_KEY_LOCK_IDLE_MINUTES] || 5), 1), 60);
    const lastActivityAtMs = Number(session[STORAGE_KEY_LOCK_LAST_ACTIVITY] || unlockedAtMs);
    locked = Date.now() - lastActivityAtMs >= idleMinutes * 60 * 1000;
    if (locked) await lockBackground();
  }
  return { ok: true, enabled: true, locked };
}

async function unlockBackground(rawPassword) {
  const password = String(rawPassword || "");
  const stored = await chrome.storage.local.get([
    STORAGE_KEY_LOCK_ENABLED,
    STORAGE_KEY_LOCK_MASTER_CREDENTIAL,
  ]);
  const credential = normalizeLockMasterCredential(stored[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  if (!stored[STORAGE_KEY_LOCK_ENABLED] || !credential) {
    return { ok: true, enabled: false, locked: false };
  }
  if (!password || !(await verifyLockMasterPassword(credential, password))) {
    return { ok: false, enabled: true, locked: true, error: "主密码错误" };
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
    return { ok: false, enabled: true, locked: true, error: `无法解锁本地数据: ${error?.message || error}` };
  }
  const now = Date.now();
  await chrome.storage.session.set({
    [STORAGE_KEY_LOCK_UNLOCKED_AT]: now,
    [STORAGE_KEY_LOCK_LAST_ACTIVITY]: now,
  });
  await broadcastLockState(false);
  return { ok: true, enabled: true, locked: false };
}

async function lockBackground() {
  await chrome.storage.session.remove([
    STORAGE_KEY_LOCK_UNLOCKED_AT,
    STORAGE_KEY_LOCK_LAST_ACTIVITY,
  ]);
  await lockDataEncryption();
  await broadcastLockState(true);
}

async function configureDataEncryption(payload) {
  const password = String(payload?.password || "");
  const stored = await chrome.storage.local.get([STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  const credential = normalizeLockMasterCredential(stored[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  if (!password || !credential || !(await verifyLockMasterPassword(credential, password))) {
    return { ok: false, error: "主密码错误，无法保护本地数据" };
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
    return { ok: false, error: `无法保护本地数据: ${error?.message || error}` };
  }
}

async function disableBackgroundDataEncryption(payload) {
  const password = String(payload?.password || "");
  const stored = await chrome.storage.local.get([STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  const credential = normalizeLockMasterCredential(stored[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  if (!password || !credential || !(await verifyLockMasterPassword(credential, password))) {
    return { ok: false, error: "主密码错误，无法关闭本地数据保护" };
  }
  try {
    await disableDataEncryption(password, credential);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `无法关闭本地数据保护: ${error?.message || error}` };
  }
}

async function rewrapBackgroundDataEncryption(payload) {
  const currentPassword = String(payload?.currentPassword || "");
  const nextPassword = String(payload?.nextPassword || "");
  const stored = await chrome.storage.local.get([STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  const currentCredential = normalizeLockMasterCredential(stored[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  const nextCredential = normalizeLockMasterCredential(payload?.nextCredential);
  if (!currentPassword || !nextPassword || !currentCredential || !nextCredential ||
      !(await verifyLockMasterPassword(currentCredential, currentPassword))) {
    return { ok: false, error: "当前主密码错误，无法更新主密码" };
  }
  try {
    await rewrapDataEncryption(currentPassword, currentCredential, nextPassword, nextCredential);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `无法更新本地数据保护: ${error?.message || error}` };
  }
}

async function registerBackgroundLockActivity() {
  const status = await getBackgroundLockStatus();
  if (!status.enabled || status.locked) return;
  await chrome.storage.session.set({ [STORAGE_KEY_LOCK_LAST_ACTIVITY]: Date.now() });
}

async function broadcastLockState(locked) {
  try {
    await chrome.runtime.sendMessage({
      type: LOCK_STATE_CHANGED_MESSAGE,
      payload: { locked: Boolean(locked) },
    });
  } catch {
    // The background worker can be the only extension context.
  }
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs
      .filter((tab) => tab.id)
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: locked ? "PASS_LOCKED" : "PASS_UNLOCKED" })));
  } catch {
    // Tabs without the content script are expected to reject the message.
  }
}

async function handlePasskeyOperationAndSyncAccount(payload) {
  logPasskeyFlow("bridge-received", {
    operation: String(payload?.operation || ""),
    host: String(payload?.host || ""),
    origin: String(payload?.origin || ""),
  });
  const response = await handlePasskeyBridgeOperation(payload);
  await recordPasskeyDiagnostic(payload, response, "store-response");
  if (!response?.ok) {
    logPasskeyFlow("bridge-failed", {
      operation: String(payload?.operation || ""),
      error: response?.error || null,
    });
    return response;
  }

  if (payload?.operation === "create") {
    logPasskeyFlow("bridge-create-succeeded", {
      accountHint: response.result?.accountHint || null,
      createMode: String(response.result?.createMode || ""),
      createCompatMethod: String(response.result?.createCompatMethod || ""),
    });
    await upsertAccountForPasskey(response.result?.accountHint);
  }
  if (payload?.operation === "get") {
    logPasskeyFlow("bridge-get-succeeded", {
      assertionHint: response.result?.assertionHint || null,
    });
  }
  return response;
}

async function recordPasskeyDiagnostic(payload, response, phase) {
  try {
    const diagnostic = buildPasskeyBridgeDiagnostic({
      payload,
      response,
      extensionVersion: PASS_EXTENSION_VERSION,
      phase,
    });
    await appendPasskeyDiagnostic(chrome.storage?.session, diagnostic);
  } catch (error) {
    logPasskeyFlow("diagnostic-record-failed", {
      operation: String(payload?.operation || ""),
      message: error?.message || String(error || ""),
    });
  }
}

async function recordPasskeyPageDiagnostic(payload) {
  try {
    const diagnostic = buildPasskeyPageDiagnostic({
      payload,
      extensionVersion: PASS_EXTENSION_VERSION,
    });
    await appendPasskeyDiagnostic(chrome.storage?.session, diagnostic);
    logPasskeyFlow("page-diagnostic-recorded", {
      phase: String(diagnostic?.phase || ""),
      operation: String(diagnostic?.operation || ""),
      diagnosticSessionId: String(diagnostic?.diagnosticSessionId || ""),
    });
    return { ok: true };
  } catch (error) {
    logPasskeyFlow("page-diagnostic-record-failed", {
      message: error?.message || String(error || ""),
    });
    return { ok: false, error: error?.message || String(error || "诊断记录失败") };
  }
}

async function getLatestPasskeyCreateDiagnostic() {
  const storage = chrome.storage?.session;
  if (!storage?.get) return { ok: false, error: "当前浏览器不支持会话诊断" };
  const stored = await storage.get([STORAGE_KEY_PASSKEY_DIAGNOSTICS]);
  return { ok: true, diagnostic: getLatestCreateDiagnosticReport(stored?.[STORAGE_KEY_PASSKEY_DIAGNOSTICS]) };
}

async function clearPasskeyDiagnostics() {
  const storage = chrome.storage?.session;
  if (!storage?.set) return { ok: false, error: "当前浏览器不支持会话诊断" };
  await storage.set({ [STORAGE_KEY_PASSKEY_DIAGNOSTICS]: [] });
  return { ok: true };
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
  const allowedProtocol = protocol === "https:" || (protocol === "http:" && isLocalhost);
  return { tabHost, protocol, allowedProtocol };
}

async function resolveFillAccountForHost(payload, tabHost) {
  let username = String(payload?.username || "");
  let password = String(payload?.password || "");
  const accountId = String(payload?.accountId || "").trim();
  if (accountId) {
    const accounts = await getAccounts();
    const account = accounts.find((item) => !item?.isDeleted && !item?.isPermanentlyDeleted && String(item?.accountId || "") === accountId);
    if (!account) {
      return { ok: false, error: "找不到要填充的账号" };
    }
    if (!accountMatchesDomain(account, tabHost)) {
      return { ok: false, error: "当前页面域名与账号站点不匹配，已阻止跨域填充" };
    }
    return {
      ok: true,
      accountId: String(account.accountId || accountId),
      username: String(account.username || ""),
      password: String(account.password || ""),
    };
  }

  const accounts = await getAccounts();
  const matched = accounts.find((item) => {
    return !item?.isDeleted
      && !item?.isPermanentlyDeleted
      && accountMatchesDomain(item, tabHost)
      && String(item?.username || "") === username
      && String(item?.password || "") === password;
  });
  if (!matched) {
    return { ok: false, error: "当前页面域名与账号站点不匹配，已阻止跨域填充" };
  }
  return {
    ok: true,
    accountId: String(matched.accountId || ""),
    username,
    password,
  };
}

async function handleFillActiveTab(payload) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    return { ok: false, error: "找不到活动标签页" };
  }

  const { tabHost, allowedProtocol } = parseTabSecurityContext(activeTab.url || "");
  if (!tabHost) {
    return { ok: false, error: "无法识别当前标签页域名" };
  }
  if (!allowedProtocol) {
    return { ok: false, error: "仅允许向 HTTPS 页面（或本机 HTTP）填充凭据" };
  }

  const resolved = await resolveFillAccountForHost(payload, tabHost);
  if (!resolved.ok) return resolved;

  // Ensure content script is present, then reuse its fill path (single field-discovery implementation).
  try {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ["dist/content.js"],
    });
  } catch {
    // Content may already be installed via content_scripts; ignore inject failures and still try messaging.
  }

  let response;
  try {
    response = await chrome.tabs.sendMessage(activeTab.id, {
      type: "PASS_FILL_CREDENTIALS",
      payload: {
        username: resolved.username,
        password: resolved.password,
      },
    });
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "无法连接页面内容脚本，请刷新页面后重试",
    };
  }

  if (!response?.ok) {
    return { ok: false, error: response?.error || "页面填充失败" };
  }
  return {
    ok: true,
    filledUsername: Boolean(response.filledUsername),
    filledPassword: Boolean(response.filledPassword),
  };
}

function handleWebBridgeSyncData(payload) {
  const run = webBridgeSyncChain.then(async () => {
    const source = payload && typeof payload === "object" ? payload : {};
    const accounts = Array.isArray(source.accounts)
      ? source.accounts.map(normalizeAccountShape)
      : [];
    const folders = Array.isArray(source.folders)
      ? source.folders.map(normalizeFolderShape)
      : [];
    const passkeys = buildUnifiedPasskeys(
      accounts,
      Array.isArray(source.passkeys) ? source.passkeys.map(normalizePasskeyShape) : [],
    );
    await setAllDataToDataStore({
      accounts,
      folders,
      passkeys,
      allRegularAccountIds: source.allRegularAccountIds,
      allRegularOrderUpdatedAtMs: source.allRegularOrderUpdatedAtMs,
      allRegularOrderUpdatedDeviceName: source.allRegularOrderUpdatedDeviceName,
      folderOrderIds: source.folderOrderIds,
      folderOrderUpdatedAtMs: source.folderOrderUpdatedAtMs,
      folderOrderUpdatedDeviceName: source.folderOrderUpdatedDeviceName,
      deviceName: source.deviceName,
    });
    return {
      ok: true,
      accounts: visibleSyncCount(accounts),
      folders: visibleSyncCount(folders),
      passkeys: visibleSyncCount(passkeys),
    };
  });
  webBridgeSyncChain = run.catch(() => {});
  return run.catch((error) => ({
    ok: false,
    error: error?.message || String(error || "后台数据镜像失败"),
  }));
}

async function configureWebSyncFromBridge(payload) {
  const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
  const prefs = payload?.prefs && typeof payload.prefs === "object" ? payload.prefs : {};
  const serverBaseUrl = String(settings.baseUrl || "").trim();
  const webdavBaseUrl = String(prefs.webdavBaseUrl || "").trim();
  const webdavEnabled = Boolean(prefs.webdavEnabled);
  const serverEnabled = Boolean(settings.enabled);
  const primarySource = String(prefs.syncPrimarySource || "") === "webdav"
    ? SYNC_PRIMARY_WEBDAV
    : SYNC_PRIMARY_SERVER;
  await chrome.storage.local.set({
    [STORAGE_KEY_SYNC_ENABLE_WEBDAV]: webdavEnabled,
    [STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER]: serverEnabled,
    [STORAGE_KEY_SYNC_WEBDAV_BASE_URL]: webdavBaseUrl,
    [STORAGE_KEY_SYNC_WEBDAV_PATH]: String(prefs.webdavRemotePath || "").trim() || "pass-sync-bundle-v2.json",
    [STORAGE_KEY_SYNC_WEBDAV_USERNAME]: String(prefs.webdavUsername || "").trim(),
    [STORAGE_KEY_SYNC_SERVER_BASE_URL]: serverBaseUrl,
    [STORAGE_KEY_SYNC_PRIMARY_SOURCE]: primarySource,
    [STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]: normalizeAutoSyncIntervalMinutes(prefs.autoSyncIntervalMinutes),
  });
  await setSyncSecrets({
    webdavPassword: String(prefs.webdavPassword || ""),
    serverToken: String(settings.authToken || "").trim(),
    encryptionKey: normalizeSyncEncryptionKey(settings.encryptionKey),
    previousEncryptionKey: normalizeSyncEncryptionKey(prefs.previousEncryptionKey),
  });
  await scheduleAutoSyncAlarm();
  return { ok: true };
}

async function getSyncOutboxSummaries() {
  return (await getSyncOutbox()).map((item) => ({
    sourceKey: item.targetKey,
    createdAtMs: item.createdAtMs,
    attempts: item.attempts,
    nextRetryAtMs: item.nextRetryAtMs,
    lastError: item.lastError,
    status: item.status,
  }));
}

async function clearInactiveSyncOutboxItems() {
  const targets = await buildRemoteSyncTargetsFromStorage() || [];
  const activeKeys = new Set(targets.map(syncTargetKey));
  const current = await getSyncOutbox();
  const next = removeOrphanedSyncOutbox(current, activeKeys);
  if (next.length !== current.length) await setSyncOutbox(next);
  return current.length - next.length;
}

async function advancePendingOutboxAfterPullFailure(target, error, forceResume = false) {
  const targetKey = syncTargetKey(target);
  const items = await getSyncOutbox();
  const pending = items.find((item) => item.targetKey === targetKey);
  if (!pending) return false;
  const currentPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
  const currentHash = await syncPayloadSha256(currentPayload);
  if (!matchingSyncOutboxItem(pending, currentHash)) return false;
  await setSyncOutbox(upsertSyncOutbox(items, {
    targetKey,
    payload: pending.payload,
    error,
    payloadSha256: pending.payloadSha256,
    expectedEtag: pending.expectedEtag,
    expectedRevision: pending.expectedRevision,
    idempotencyKey: pending.idempotencyKey,
    syncSessionId: pending.syncSessionId,
    operationId: pending.operationId,
    sourceType: pending.sourceType || target.kind,
    scope: pending.scope || target.scope || "",
    forceResume,
  }));
  return true;
}

async function handleContentListFillAccounts(sender) {
  const tabUrl = String(sender?.tab?.url || "");
  const { tabHost, allowedProtocol } = parseTabSecurityContext(tabUrl);
  if (!tabHost) {
    return { ok: false, error: "无法识别当前标签页域名", accounts: [] };
  }
  if (!allowedProtocol) {
    return { ok: false, error: "仅允许在 HTTPS 页面（或本机 HTTP）列出可填充账号", accounts: [] };
  }

  const stored = await getAllDataFromDataStore();
  const accounts = Array.isArray(stored.accounts) ? stored.accounts.map(normalizeAccountShape) : [];
  const order = Array.isArray(stored.allRegularAccountIds) ? stored.allRegularAccountIds : [];
  const orderRank = new Map(order.map((accountId, index) => [String(accountId).toLowerCase(), index]));
  const matched = accounts
    .filter((item) => !item?.isDeleted && !item?.isPermanentlyDeleted && accountMatchesDomain(item, tabHost))
    .sort((left, right) => {
      const leftRank = orderRank.get(String(left?.recordId || left?.accountId || "").toLowerCase());
      const rightRank = orderRank.get(String(right?.recordId || right?.accountId || "").toLowerCase());
      if (leftRank != null || rightRank != null) {
        if (leftRank == null) return 1;
        if (rightRank == null) return -1;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      const leftUpdated = Number(left?.updatedAtMs || left?.createdAtMs || 0);
      const rightUpdated = Number(right?.updatedAtMs || right?.createdAtMs || 0);
      if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
      return String(left?.username || "").localeCompare(String(right?.username || ""));
    })
    .slice(0, 20)
    .map((item) => ({
      accountId: String(item.accountId || ""),
      username: String(item.username || ""),
      sites: normalizeSites(item.sites || []),
    }))
    .filter((item) => item.accountId);

  return { ok: true, domain: normalizeDomain(tabHost), accounts: matched };
}

async function handleContentFillAccount(payload, sender) {
  const tabId = sender?.tab?.id;
  const tabUrl = String(sender?.tab?.url || "");
  if (!tabId) {
    return { ok: false, error: "找不到来源标签页" };
  }

  const { tabHost, allowedProtocol } = parseTabSecurityContext(tabUrl);
  if (!tabHost) {
    return { ok: false, error: "无法识别当前标签页域名" };
  }
  if (!allowedProtocol) {
    return { ok: false, error: "仅允许向 HTTPS 页面（或本机 HTTP）填充凭据" };
  }

  const resolved = await resolveFillAccountForHost(payload, tabHost);
  if (!resolved.ok) return resolved;

  // Return credentials to the isolated content script so it can fill the same
  // form the user focused. Do not include passwords in list responses.
  return {
    ok: true,
    accountId: resolved.accountId,
    username: resolved.username,
    password: resolved.password,
  };
}

async function handleLoginDetected(payload) {
  const domain = normalizeDomain(payload?.domain || "");
  const username = (payload?.username || "").trim();
  const password = payload?.password || "";

  if (!domain || !username || !password) {
    return { shouldPrompt: false };
  }

  const accounts = await getAccounts();
  const active = accounts.filter((item) => !item.isDeleted && !item.isPermanentlyDeleted);

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
  const deviceName = normalizeDeviceName(deviceNameStored);

  const next = await getAccounts();
  const existing = next.find((account) => {
    return !account.isDeleted && !account.isPermanentlyDeleted
      && accountMatchesDomain(account, domain)
      && account.username === username;
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
  // Content scripts only need enough metadata to decide save/update prompts.
  // Passwords never leave the service worker on this path.
  const accounts = await getAccounts();
  return {
    ok: true,
    accounts: accounts
      .filter((account) => !account?.isDeleted && !account?.isPermanentlyDeleted)
      .map((account) => ({
        sites: normalizeSites(account?.sites || []),
        username: String(account?.username || ""),
        isDeleted: false,
      })),
  };
}

async function handleContentCheckLogin(payload, sender) {
  let domain = normalizeDomain(payload?.domain || "");
  try {
    const tabUrl = String(sender?.tab?.url || "");
    if (tabUrl) domain = normalizeDomain(new URL(tabUrl).hostname) || domain;
  } catch {
    // Keep payload domain as fallback for non-tab callers.
  }
  const username = String(payload?.username || "").trim();
  const password = String(payload?.password || "");
  if (!domain || !username || !password) {
    return { ok: true, shouldPrompt: false };
  }
  const accounts = await getAccounts();
  const active = accounts.filter((item) => !item.isDeleted && !item.isPermanentlyDeleted);
  const exact = active.some((account) => {
    return accountMatchesDomain(account, domain)
      && account.username === username
      && account.password === password;
  });
  if (exact) return { ok: true, shouldPrompt: false };
  const updateCandidate = active.some((account) => {
    return accountMatchesDomain(account, domain)
      && account.username === username
      && account.password !== password;
  });
  return { ok: true, shouldPrompt: true, mode: updateCandidate ? "update" : "create" };
}

async function getAccounts() {
  const raw = await getAccountsFromDataStore();
  return raw.map(normalizeAccountShape);
}

async function setAccounts(accounts) {
  const normalized = (Array.isArray(accounts) ? accounts : []).map(normalizeAccountShape);
  const current = await readBusinessDataFromStore();
  await setAllDataToDataStore({ ...current, accounts: normalized });
  await broadcastWebBridgeData({ ...current, accounts: normalized });
}

async function upsertAccountForPasskey(accountHint) {
  const domain = normalizeDomain(accountHint?.rpId || "");
  const username = normalizeUsername(accountHint?.username || "");
  const credentialIdB64u = normalizePasskeyId(accountHint?.credentialIdB64u || accountHint?.credentialId || "");
  if (!domain || !username) {
    logPasskeyFlow("upsert-skipped-missing-account-hint", {
      accountHint: accountHint || null,
    });
    return;
  }

  const now = Date.now();
  const { [STORAGE_KEY_DEVICE_NAME]: deviceNameStored } = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  const deviceName = normalizeDeviceName(deviceNameStored);

  const allAccounts = await getAccounts();
  let matchIndexes = [];
  for (let i = 0; i < allAccounts.length; i += 1) {
    const account = allAccounts[i];
    if (!account.isDeleted && !account.isPermanentlyDeleted
        && accountMatchesDomain(account, domain)
        && normalizeUsername(account.username) === username) {
      matchIndexes.push(i);
    }
  }

  // Some RPs may register passkey with an internal username that differs from the saved login username.
  // If there is only one active account under this domain/alias group, reuse it as a safe fallback.
  if (matchIndexes.length === 0) {
    const fallbackIndexes = [];
    for (let i = 0; i < allAccounts.length; i += 1) {
      const account = allAccounts[i];
      if (!account.isDeleted && !account.isPermanentlyDeleted
          && accountMatchesDomain(account, domain)) {
        fallbackIndexes.push(i);
      }
    }
    if (fallbackIndexes.length === 1) {
      matchIndexes = fallbackIndexes;
      logPasskeyFlow("upsert-using-single-domain-fallback", {
        domain,
        username,
        fallbackAccountId: String(allAccounts[fallbackIndexes[0]]?.accountId || ""),
      });
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
    logPasskeyFlow("upsert-created-new-account", {
      domain,
      username,
      accountId: created.accountId,
      credentialIdB64u,
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
    deviceName,
  });

  const removeIndexSet = new Set(matchIndexes);
  const next = allAccounts.filter((_, index) => !removeIndexSet.has(index));
  next.push(mergedAccount);
  await setAccounts(syncAliasGroups(next));
  logPasskeyFlow("upsert-merged-into-existing-account", {
    domain,
    username,
    mergedAccountId: mergedAccount.accountId,
    matchedAccountIds: matchedAccounts.map((item) => String(item?.accountId || "")),
    credentialIdB64u,
  });
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
    backupEligible: item?.backupEligible === true,
    backupState: item?.backupEligible === true && item?.backupState === true,
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
    deletedDeviceName: String(item?.deletedDeviceName || "").trim(),
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
  // Preserve explicit 0 timestamps (synthetic fixed-folder markers).
  const createdAtMs = Number(item?.createdAtMs ?? now);
  const updatedAtMs = Number(item?.updatedAtMs ?? createdAtMs);
  const safeName = safeId === FIXED_NEW_ACCOUNT_FOLDER_ID
    ? FIXED_NEW_ACCOUNT_FOLDER_NAME
    : (rawName || `未命名文件夹 ${safeId.slice(0, 8)}`);
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
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : (Number.isFinite(createdAtMs) ? createdAtMs : now),
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
        backupEligible: false,
        backupState: false,
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
    folders: Array.isArray(rawPayload.folders) ? rawPayload.folders : [],
    allRegularAccountIds: Array.isArray(rawPayload.allRegularAccountIds) ? rawPayload.allRegularAccountIds : [],
    allRegularOrderUpdatedAtMs: Number(rawPayload.allRegularOrderUpdatedAtMs) || 0,
    allRegularOrderUpdatedDeviceName: String(rawPayload.allRegularOrderUpdatedDeviceName || ""),
    folderOrderIds: Array.isArray(rawPayload.folderOrderIds) ? rawPayload.folderOrderIds : [],
    folderOrderUpdatedAtMs: Number(rawPayload.folderOrderUpdatedAtMs) || 0,
    folderOrderUpdatedDeviceName: String(rawPayload.folderOrderUpdatedDeviceName || ""),
    deviceName: String(rawPayload.deviceName || ""),
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
      formatVersion: 2,
    },
    payload: sortSyncPayloadCollections({
      accounts,
      passkeys,
      folders,
      allRegularAccountIds: payload?.allRegularAccountIds,
      allRegularOrderUpdatedAtMs: payload?.allRegularOrderUpdatedAtMs,
      allRegularOrderUpdatedDeviceName: payload?.allRegularOrderUpdatedDeviceName,
      folderOrderIds: payload?.folderOrderIds,
      folderOrderUpdatedAtMs: payload?.folderOrderUpdatedAtMs,
      folderOrderUpdatedDeviceName: payload?.folderOrderUpdatedDeviceName,
      deviceName: payload?.deviceName,
    }),
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
    response = await fetchWithSyncTimeout(target.url, { method: "GET", headers, cache: "no-store" }, `拉取${target.label}`);
  } catch (error) {
    logSyncFlow("pull-fetch-error", {
      label: target.label,
      url: target.url,
      name: error?.name || "Error",
      message: error?.message || String(error || ""),
      stack: error?.stack || "",
      online: typeof navigator !== "undefined" ? navigator.onLine : null,
    });
    throw new Error(`拉取远端失败（${target.label} ${target.url}）：${error?.message || error}`);
  }
  logSyncFlow("pull-http-response", {
    label: target.label,
    url: target.url,
    status: response.status,
    etag: response.headers.get("ETag"),
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
  if (!payload) throw new Error("远端数据格式错误，仅支持 pass.sync.bundle.v2");
  return {
    payload,
    etag: response.headers.get("ETag"),
    revision: Number(response.headers.get("X-Sync-Revision")) || 0,
    encrypted,
  };
}

function updateRemoteConcurrencyState(target, etag, revision = 0) {
  const normalizedEtag = typeof etag === "string" && etag.trim() ? etag : null;
  target.remoteEtag = normalizedEtag;
  if (Number.isFinite(Number(revision)) && Number(revision) > 0) target.remoteRevision = Number(revision);
  if (target.kind === "webdav") {
    target.supportsEtag = Boolean(normalizedEtag);
  }
}

function createSyncOperationContext(context = {}) {
  return {
    syncSessionId: String(context.syncSessionId || createSyncIdempotencyKey()),
    operationId: String(context.operationId || createSyncIdempotencyKey()),
    idempotencyKey: String(context.idempotencyKey || createSyncIdempotencyKey()),
  };
}

function annotateSyncRetryError(error, target, operation) {
  const annotated = error instanceof Error ? error : new Error(String(error || "同步失败"));
  annotated.idempotencyKey = operation.idempotencyKey;
  annotated.syncSessionId = operation.syncSessionId;
  annotated.operationId = operation.operationId;
  annotated.expectedEtag = target.remoteEtag || "";
  annotated.expectedRevision = target.remoteRevision || 0;
  return annotated;
}

async function verifySelfHostedWriteReceipt(response, idempotencyKey) {
  const scope = response.headers.get("X-Sync-Scope");
  const etag = response.headers.get("ETag");
  const payloadSha256 = response.headers.get("X-Payload-Sha256");
  const revisionHeader = Number(response.headers.get("X-Sync-Revision"));
  const idempotencyHeader = response.headers.get("X-Sync-Idempotency-Key");
  if (!scope || !etag || !payloadSha256) {
    throw new Error("服务器未返回可验证的同步提交回执");
  }
  let receipt;
  try {
    receipt = await response.json();
  } catch {
    throw new Error("服务器提交回执不是有效 JSON");
  }
  if (!receipt?.ok || !receipt?.committed
      || receipt.scope !== scope
      || receipt.etag !== etag
      || receipt.payloadSha256 !== payloadSha256
      || !Number.isInteger(receipt.revision) || receipt.revision < 1
      || receipt.revision !== revisionHeader
      || (idempotencyKey && idempotencyHeader !== idempotencyKey)
      || (idempotencyKey && receipt.idempotencyKey !== idempotencyKey)) {
    throw new Error("服务器提交回执校验失败");
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
    Accept: "application/json",
  };
  if (target.authHeader) headers.Authorization = target.authHeader;
  if (ifMatch) headers["If-Match"] = ifMatch;
  else if (target.kind === "webdav") headers["If-None-Match"] = "*";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (target.syncSessionId) headers["X-Sync-Session-Id"] = target.syncSessionId;
  if (target.operationId) headers["X-Sync-Operation-Id"] = target.operationId;
  headers["X-Sync-Client-Version"] = PASS_EXTENSION_VERSION;
  let response;
  try {
    response = await fetchWithSyncTimeout(target.url, {
      method: "PUT",
      headers,
      body: JSON.stringify(encryptedBundle, null, 2),
    });
  } catch (error) {
    logSyncFlow("push-fetch-error", {
      label: target.label,
      url: target.url,
      name: error?.name || "Error",
      message: error?.message || String(error || ""),
      stack: error?.stack || "",
      online: typeof navigator !== "undefined" ? navigator.onLine : null,
    });
    throw new Error(`上传远端失败（${target.label} ${target.url}）：${error?.message || error}`);
  }
  logSyncFlow("push-http-response", {
    label: target.label,
    url: target.url,
    status: response.status,
    etag: response.headers.get("ETag"),
    ifMatch,
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const confirmedEtag = target.kind === "server"
    ? await verifySelfHostedWriteReceipt(response, idempotencyKey)
    : response.headers.get("ETag");
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

async function pushRemotePayloadWithRetry(target, payload, context = {}) {
  let candidate = payload;
  const operation = createSyncOperationContext(context);
  target.syncSessionId = operation.syncSessionId;
  target.operationId = operation.operationId;
  const { idempotencyKey } = operation;
  for (let attempt = 0; attempt < SYNC_PUSH_CONFLICT_MAX_ATTEMPTS; attempt += 1) {
    try {
      const pushResult = await pushRemotePayload(target, candidate, target.remoteEtag, idempotencyKey);
      updateRemoteConcurrencyState(target, pushResult.etag);
      target.remotePayload = candidate;
      target.remoteEncrypted = true;
      return { payload: candidate };
    } catch (error) {
      if (error?.status !== 412 && error?.status !== 428) {
        try {
          const probe = await pullRemotePayload(target);
          if (probe.payload && syncPayloadEquals(probe.payload, candidate)) {
            updateRemoteConcurrencyState(target, probe.etag);
            target.remotePayload = candidate;
            target.remoteEncrypted = true;
            return { payload: candidate };
          }
        } catch (_) {}
        throw annotateSyncRetryError(error, target, operation);
      }
      if (attempt === SYNC_PUSH_CONFLICT_MAX_ATTEMPTS - 1) throw annotateSyncRetryError(error, target, operation);
    }
    const latestResponse = await pullRemotePayload(target);
    updateRemoteConcurrencyState(target, latestResponse.etag);
    target.remotePayload = latestResponse.payload;
    target.remoteEncrypted = latestResponse.encrypted;
    if (target.isPrimary === false) {
      continue;
    }
    const remotePayload = latestResponse.payload || { accounts: [], passkeys: [], folders: [] };
    const currentLocalPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
    if (!syncPayloadEquals(currentLocalPayload, candidate)) {
      throw new Error("本地数据在远端冲突重试期间发生变化，已停止写入，请重新同步");
    }
    const localAccounts = Array.isArray(candidate.accounts) ? candidate.accounts.map(normalizeAccountShape) : [];
    const localPasskeys = buildUnifiedPasskeys(localAccounts, Array.isArray(candidate.passkeys) ? candidate.passkeys.map(normalizePasskeyShape) : []);
    const localFolders = Array.isArray(candidate.folders) ? candidate.folders.map(normalizeFolderShape) : [];
    const remoteAccounts = syncAliasGroups(remotePayload.accounts.map(normalizeAccountShape));
    const canonicalLocalAccounts = syncAliasGroups(localAccounts);
    const remotePasskeys = buildUnifiedPasskeys(remoteAccounts, remotePayload.passkeys);
    const remoteFolders = remotePayload.folders.map(normalizeFolderShape);
    if (target.isPrimary !== false) {
      candidate = mergeSyncPayloadsCore(
        { ...candidate, accounts: canonicalLocalAccounts, passkeys: localPasskeys, folders: localFolders },
        { ...remotePayload, accounts: remoteAccounts, passkeys: remotePasskeys, folders: remoteFolders },
        syncMergeHelpers(),
      );
      candidate.accounts = syncAliasGroups(candidate.accounts);
    }
    const safety = validateSyncSafety(
      { ...candidate, accounts: canonicalLocalAccounts, folders: localFolders, passkeys: localPasskeys },
      { ...remotePayload, accounts: remoteAccounts },
      candidate,
      SYNC_MODE_MERGE
    );
    if (!safety.safe) {
      logSyncFlow("push-retry-aborted-safety-check", { reasons: safety.reasons });
      throw new Error(`并发重试合并被安全检查阻止: ${safety.reasons.join(",")}`);
    }
    if (target.isPrimary !== false) {
      await writeBusinessDataToStore(candidate);
    }
  }
  throw new Error("远端并发冲突重试次数已用尽");
}

async function pushRemotePayloadWithMode(target, payload, syncMode, context = {}) {
  if (syncMode !== SYNC_MODE_MERGE) {
    const operation = createSyncOperationContext(context);
    target.syncSessionId = operation.syncSessionId;
    target.operationId = operation.operationId;
    const pushResult = await pushRemotePayload(target, payload, target.remoteEtag, operation.idempotencyKey);
    updateRemoteConcurrencyState(target, pushResult.etag);
    target.remotePayload = payload;
    target.remoteEncrypted = true;
    return { payload };
  }
  return pushRemotePayloadWithRetry(target, payload, context);
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
    updatedAtMs: createdAtMs,
  };
}

function accountMatchesDomain(account, domain) {
  const normalized = normalizeDomain(domain);
  const sites = normalizeSites([
    ...(Array.isArray(account?.sites) ? account.sites : []),
    account?.canonicalSite || "",
  ]);
  return Boolean(normalized) && sites.some((site) => domainsMatch(site, normalized));
}
