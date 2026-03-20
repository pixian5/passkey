import {
  buildAccountId,
  compareAccountsForDisplay,
  etldPlusOne,
  formatYYMMDDHHmmss,
  normalizeDomain,
  normalizeSites,
  normalizeUsername,
  sortAccountsForDisplay,
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
  getHistory as getHistoryFromDataStore,
  setAccounts as setAccountsToDataStore,
  setAllData as setAllDataToDataStore,
  setFolders as setFoldersToDataStore,
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
const DEFAULT_SELF_HOSTED_SERVER_BASE_URL = "https://or.sbbz.tech:5443";
const DEFAULT_SELF_HOSTED_SERVER_TOKEN = "ClzgP2xsXHETVut9F6ddHVRdvvclz0QM0fDHveyOZFhGjs7l";
const SYNC_MODE_MERGE = "merge";
const SYNC_MODE_REMOTE_OVERWRITE_LOCAL = "remoteOverwriteLocal";
const SYNC_MODE_LOCAL_OVERWRITE_REMOTE = "localOverwriteRemote";
const STORAGE_KEY_LOCK_ENABLED = "pass.lock.enabled";
const STORAGE_KEY_LOCK_POLICY = "pass.lock.policy";
const STORAGE_KEY_LOCK_IDLE_MINUTES = "pass.lock.idleMinutes";
const STORAGE_KEY_LOCK_MASTER_CREDENTIAL = "pass.lock.masterCredential.v1";
const FIXED_NEW_ACCOUNT_FOLDER_ID = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";
const FIXED_NEW_ACCOUNT_FOLDER_NAME = "新账号";
const SYNC_BUNDLE_SCHEMA_V2 = "pass.sync.bundle.v2";
const LOCK_POLICY_ONCE_UNTIL_QUIT = "onceUntilQuit";
const LOCK_POLICY_IDLE_TIMEOUT = "idleTimeout";
const LOCK_POLICY_ON_BACKGROUND = "onBackground";
const LOCK_IDLE_MINUTES_MIN = 1;
const LOCK_IDLE_MINUTES_MAX = 60;
const LOCK_IDLE_MINUTES_DEFAULT = 5;

const ACCOUNT_SEARCH_FIELD_KEYS = ["username", "sites", "note", "password"];
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_REFRESH_INTERVAL_MS = 1000;
const OPTIONS_TOAST_DURATION_MS = 3000;

const dom = {
  deviceName: document.getElementById("deviceName"),
  syncEnableWebdav: document.getElementById("syncEnableWebdav"),
  syncEnableServer: document.getElementById("syncEnableServer"),
  syncMergeBtn: document.getElementById("syncMergeBtn"),
  syncRemoteOverwriteLocalBtn: document.getElementById("syncRemoteOverwriteLocalBtn"),
  syncLocalOverwriteRemoteBtn: document.getElementById("syncLocalOverwriteRemoteBtn"),
  syncWebdavFields: document.getElementById("syncWebdavFields"),
  syncServerFields: document.getElementById("syncServerFields"),
  syncWebdavBaseUrl: document.getElementById("syncWebdavBaseUrl"),
  syncWebdavPath: document.getElementById("syncWebdavPath"),
  syncWebdavUsername: document.getElementById("syncWebdavUsername"),
  syncWebdavPassword: document.getElementById("syncWebdavPassword"),
  syncServerBaseUrl: document.getElementById("syncServerBaseUrl"),
  syncServerToken: document.getElementById("syncServerToken"),
  syncAutoInterval: document.getElementById("syncAutoInterval"),
  syncAutoStatus: document.getElementById("syncAutoStatus"),
  deviceStatus: document.getElementById("deviceStatus"),
  lockEnabled: document.getElementById("lockEnabled"),
  lockAdvancedFields: document.getElementById("lockAdvancedFields"),
  lockPolicyOnceRadio: document.getElementById("lockPolicyOnce"),
  lockPolicyIdleRadio: document.getElementById("lockPolicyIdle"),
  lockPolicyBackgroundRadio: document.getElementById("lockPolicyBackground"),
  lockIdleMinutesRow: document.getElementById("lockIdleMinutesRow"),
  lockIdleMinutes: document.getElementById("lockIdleMinutes"),
  lockMasterPassword: document.getElementById("lockMasterPassword"),
  lockMasterPasswordConfirm: document.getElementById("lockMasterPasswordConfirm"),
  lockCredentialHint: document.getElementById("lockCredentialHint"),
  allAccountsCount: document.getElementById("allAccountsCount"),
  passkeyAccountsCount: document.getElementById("passkeyAccountsCount"),
  totpAccountsCount: document.getElementById("totpAccountsCount"),
  allAccountsList: document.getElementById("allAccountsList"),
  recycleAccountsCount: document.getElementById("recycleAccountsCount"),
  accountsTabAll: document.getElementById("accountsTabAll"),
  accountsTabPasskey: document.getElementById("accountsTabPasskey"),
  accountsTabTotp: document.getElementById("accountsTabTotp"),
  accountsTabRecycle: document.getElementById("accountsTabRecycle"),
  accountsFolderList: document.getElementById("accountsFolderList"),
  createFolderBtn: document.getElementById("createFolderBtn"),
  allAccountsSearchWrap: document.getElementById("allAccountsSearchWrap"),
  allAccountsSearchFieldsBtn: document.getElementById("allAccountsSearchFieldsBtn"),
  allAccountsSearchFieldsPanel: document.getElementById("allAccountsSearchFieldsPanel"),
  allAccountsSearchFieldAll: document.getElementById("allAccountsSearchFieldAll"),
  allAccountsSearchFieldUsername: document.getElementById("allAccountsSearchFieldUsername"),
  allAccountsSearchFieldSites: document.getElementById("allAccountsSearchFieldSites"),
  allAccountsSearchFieldNote: document.getElementById("allAccountsSearchFieldNote"),
  allAccountsSearchFieldPassword: document.getElementById("allAccountsSearchFieldPassword"),
  allAccountsSearch: document.getElementById("allAccountsSearch"),
  openSortModalBtn: document.getElementById("openSortModal"),
  openHistoryModalBtn: document.getElementById("openHistoryModal"),
  clearActiveAccountsBtn: document.getElementById("clearActiveAccounts"),
  clearRecycleBinBtn: document.getElementById("clearRecycleBin"),
  sortModal: document.getElementById("sortModal"),
  sortModalList: document.getElementById("sortModalList"),
  closeSortModalBtn: document.getElementById("closeSortModal"),
  historyModal: document.getElementById("historyModal"),
  historyModalList: document.getElementById("historyModalList"),
  closeHistoryModalBtn: document.getElementById("closeHistoryModal"),
  addSitesToFolderModal: document.getElementById("addSitesToFolderModal"),
  addSitesToFolderInput: document.getElementById("addSitesToFolderInput"),
  addSitesToFolderAutoAdd: document.getElementById("addSitesToFolderAutoAdd"),
  cancelAddSitesToFolderBtn: document.getElementById("cancelAddSitesToFolder"),
  confirmAddSitesToFolderBtn: document.getElementById("confirmAddSitesToFolder"),
  payload: document.getElementById("payload"),
  refreshBtn: document.getElementById("refreshBtn"),
  exportSyncBundleBtn: document.getElementById("exportSyncBundleBtn"),
  exportChromeCsvBtn: document.getElementById("exportChromeCsvBtn"),
  exportFirefoxCsvBtn: document.getElementById("exportFirefoxCsvBtn"),
  exportSafariCsvBtn: document.getElementById("exportSafariCsvBtn"),
  importSyncBundleBtn: document.getElementById("importSyncBundleBtn"),
  importBrowserCsvBtn: document.getElementById("importBrowserCsvBtn"),
  importGoogleAuthQrBtn: document.getElementById("importGoogleAuthQrBtn"),
  importGoogleAuthQrFilesBtn: document.getElementById("importGoogleAuthQrFilesBtn"),
  importGoogleAuthFolderSelect: document.getElementById("importGoogleAuthFolderSelect"),
  importGoogleAuthNewFolderName: document.getElementById("importGoogleAuthNewFolderName"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  clearBtn: document.getElementById("clearBtn"),
  status: document.getElementById("status"),
};

let accountsRaw = [];
let passkeysRaw = [];
let foldersRaw = [];
let editingAccountId = null;
let totpRefreshTimer = null;
let accountSearchUseAll = true;
let accountSearchFields = new Set();
let activeAccountView = "all";
let contextMenuElement = null;
let contextMenuOutsideHandler = null;
let contextMenuEscapeHandler = null;
let lockCredentialExists = false;
let sortModalOrderIds = [];
let sortModalDraggingAccountId = "";
let historyEntries = [];
let optionsToastTimer = null;
let addSitesTargetFolderId = null;
let deviceNameSaveTimer = null;
let syncSettingsSaveTimer = null;
let lockSettingsSaveTimer = null;

const AUTO_SYNC_INTERVAL_OPTIONS = new Set(["0", "1", "3", "5", "10", "15", "30", "60"]);

init().catch((error) => {
  setStatus(`初始化失败: ${error.message}`);
});

async function init() {
  await loadDeviceName();
  await loadSyncSettings();
  await loadLockSettings();
  await ensureDataStorageReady();
  await refresh();
  startTotpRefreshTicker();

  dom.syncMergeBtn.addEventListener("click", () => syncNowWithRemote(SYNC_MODE_MERGE));
  dom.syncRemoteOverwriteLocalBtn.addEventListener("click", async () => {
    const shouldContinue = await confirmRemoteOverwriteLocalIfNeeded();
    if (!shouldContinue) return;
    await syncNowWithRemote(SYNC_MODE_REMOTE_OVERWRITE_LOCAL);
  });
  dom.syncLocalOverwriteRemoteBtn.addEventListener("click", async () => {
    const shouldContinue = await confirmLocalOverwriteRemoteIfNeeded();
    if (!shouldContinue) return;
    await syncNowWithRemote(SYNC_MODE_LOCAL_OVERWRITE_REMOTE);
  });
  dom.deviceName.addEventListener("input", () => {
    scheduleDeviceNameSave();
  });
  dom.deviceName.addEventListener("change", () => {
    void saveDeviceName({ showStatus: false });
  });
  dom.syncEnableWebdav.addEventListener("change", () => {
    renderSyncBackendFields();
    void persistSyncSettings({ showStatus: false });
  });
  dom.syncEnableServer.addEventListener("change", () => {
    renderSyncBackendFields();
    void persistSyncSettings({ showStatus: false });
  });
  dom.syncAutoInterval.addEventListener("change", () => {
    renderAutoSyncStatus();
    void persistSyncSettings({ showStatus: false });
  });
  dom.syncWebdavBaseUrl.addEventListener("input", scheduleSyncSettingsSave);
  dom.syncWebdavPath.addEventListener("input", scheduleSyncSettingsSave);
  dom.syncWebdavUsername.addEventListener("input", scheduleSyncSettingsSave);
  dom.syncWebdavPassword.addEventListener("input", scheduleSyncSettingsSave);
  dom.syncServerBaseUrl.addEventListener("input", scheduleSyncSettingsSave);
  dom.syncServerToken.addEventListener("input", scheduleSyncSettingsSave);
  dom.syncWebdavBaseUrl.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
  dom.syncWebdavPath.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
  dom.syncWebdavUsername.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
  dom.syncWebdavPassword.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
  dom.syncServerBaseUrl.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
  dom.syncServerToken.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
  dom.lockEnabled.addEventListener("change", () => {
    renderLockSettingsFields();
    void saveLockSettings({ showStatus: false });
  });
  dom.lockPolicyOnceRadio.addEventListener("change", () => {
    renderLockSettingsFields();
    void saveLockSettings({ showStatus: false });
  });
  dom.lockPolicyIdleRadio.addEventListener("change", () => {
    renderLockSettingsFields();
    void saveLockSettings({ showStatus: false });
  });
  dom.lockPolicyBackgroundRadio.addEventListener("change", () => {
    renderLockSettingsFields();
    void saveLockSettings({ showStatus: false });
  });
  dom.lockIdleMinutes.addEventListener("input", scheduleLockSettingsSave);
  dom.lockIdleMinutes.addEventListener("change", () => void saveLockSettings({ showStatus: false }));
  dom.lockMasterPassword.addEventListener("input", scheduleLockSettingsSave);
  dom.lockMasterPasswordConfirm.addEventListener("input", scheduleLockSettingsSave);
  dom.lockMasterPassword.addEventListener("change", () => void saveLockSettings({ showStatus: false }));
  dom.lockMasterPasswordConfirm.addEventListener("change", () => void saveLockSettings({ showStatus: false }));
  dom.createFolderBtn.addEventListener("click", createFolderFromPrompt);
  dom.accountsFolderList.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".account-view-tab")) return;
    event.preventDefault();
    closeContextMenu();
  });
  dom.allAccountsList.addEventListener("contextmenu", (event) => {
    if (event.target.closest(".account")) return;
    event.preventDefault();
    closeContextMenu();
  });
  dom.accountsTabAll.addEventListener("click", () => setAccountView("all"));
  dom.accountsTabPasskey.addEventListener("click", () => setAccountView("passkeys"));
  dom.accountsTabTotp.addEventListener("click", () => setAccountView("totp"));
  dom.accountsTabRecycle.addEventListener("click", () => setAccountView("recycle"));
  dom.allAccountsSearch.addEventListener("input", () => renderCurrentView(accountsRaw));
  dom.openSortModalBtn.addEventListener("click", openSortModal);
  dom.openHistoryModalBtn.addEventListener("click", openHistoryModal);
  dom.closeSortModalBtn.addEventListener("click", closeSortModal);
  dom.closeHistoryModalBtn.addEventListener("click", closeHistoryModal);
  dom.cancelAddSitesToFolderBtn.addEventListener("click", closeAddSitesToFolderModal);
  dom.confirmAddSitesToFolderBtn.addEventListener("click", addAccountsMatchingSitesToFolderFromModal);
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
  dom.addSitesToFolderModal.addEventListener("click", (event) => {
    if (event.target === dom.addSitesToFolderModal) {
      closeAddSitesToFolderModal();
    }
  });
  dom.allAccountsSearchFieldsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    dom.allAccountsSearchFieldsPanel.classList.toggle("hidden");
    syncAllAccountSearchFieldCheckboxes();
  });
  dom.allAccountsSearchFieldAll.addEventListener("change", onAllAccountSearchFieldAllChanged);
  dom.allAccountsSearchFieldUsername.addEventListener("change", onAllAccountSearchFieldChanged);
  dom.allAccountsSearchFieldSites.addEventListener("change", onAllAccountSearchFieldChanged);
  dom.allAccountsSearchFieldNote.addEventListener("change", onAllAccountSearchFieldChanged);
  dom.allAccountsSearchFieldPassword.addEventListener("change", onAllAccountSearchFieldChanged);
  dom.allAccountsSearchFieldsPanel.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  document.addEventListener("click", (event) => {
    closeContextMenuIfNeeded(event);
    if (dom.allAccountsSearchFieldsPanel.classList.contains("hidden")) return;
    const wrap = dom.allAccountsSearchFieldsPanel.closest(".search-filter-wrap");
    if (wrap && wrap.contains(event.target)) return;
    closeAllAccountsSearchFieldsPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeContextMenu();
    }
    if (event.key === "Escape" && !dom.sortModal.classList.contains("hidden")) {
      closeSortModal();
      return;
    }
    if (event.key === "Escape" && !dom.historyModal.classList.contains("hidden")) {
      closeHistoryModal();
      return;
    }
    if (event.key === "Escape" && !dom.addSitesToFolderModal.classList.contains("hidden")) {
      closeAddSitesToFolderModal();
      return;
    }
    if (event.key === "Escape" && !dom.allAccountsSearchFieldsPanel.classList.contains("hidden")) {
      closeAllAccountsSearchFieldsPanel();
    }
    if (
      event.key === "Enter"
      && !event.shiftKey
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && !event.isComposing
    ) {
      if (isMultilineInputTarget(event.target)) return;
      const actionButton = findDefaultActionButtonForOptions(event.target);
      if (actionButton && !actionButton.disabled) {
        event.preventDefault();
        actionButton.click();
      }
    }
  });
  document.addEventListener("scroll", () => {
    closeContextMenu();
  }, true);
  dom.clearActiveAccountsBtn.addEventListener("click", clearActiveAccounts);
  dom.clearRecycleBinBtn.addEventListener("click", clearRecycleBin);
  dom.refreshBtn.addEventListener("click", () => refresh());
  dom.exportSyncBundleBtn.addEventListener("click", exportSyncBundle);
  dom.exportChromeCsvBtn.addEventListener("click", () => exportBrowserPasswordCsv("chrome"));
  dom.exportFirefoxCsvBtn.addEventListener("click", () => exportBrowserPasswordCsv("firefox"));
  dom.exportSafariCsvBtn.addEventListener("click", () => exportBrowserPasswordCsv("safari"));
  dom.importSyncBundleBtn.addEventListener("click", importSyncBundleAndMerge);
  dom.importBrowserCsvBtn.addEventListener("click", importBrowserPasswordCsv);
  dom.importGoogleAuthQrBtn.addEventListener("click", importGoogleAuthenticatorExportQrFromClipboard);
  dom.importGoogleAuthQrFilesBtn.addEventListener("click", importGoogleAuthenticatorExportQrFromFiles);
  dom.exportBtn.addEventListener("click", exportJson);
  dom.importBtn.addEventListener("click", importJson);
  dom.clearBtn.addEventListener("click", clearAll);
}

async function loadDeviceName() {
  const result = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  dom.deviceName.value = String(result[STORAGE_KEY_DEVICE_NAME] || "ChromeMac");
}

function scheduleDeviceNameSave() {
  window.clearTimeout(deviceNameSaveTimer);
  deviceNameSaveTimer = window.setTimeout(() => {
    void saveDeviceName({ showStatus: false });
  }, 250);
}

function scheduleSyncSettingsSave() {
  window.clearTimeout(syncSettingsSaveTimer);
  syncSettingsSaveTimer = window.setTimeout(() => {
    void persistSyncSettings({ showStatus: false });
  }, 250);
}

function scheduleLockSettingsSave() {
  window.clearTimeout(lockSettingsSaveTimer);
  lockSettingsSaveTimer = window.setTimeout(() => {
    void saveLockSettings({ showStatus: false });
  }, 350);
}

async function saveDeviceName({ showStatus = true } = {}) {
  const next = String(dom.deviceName.value || "").trim();
  if (!next) {
    if (showStatus) {
      setDeviceStatus("设备名称不能为空");
    }
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: next });
  if (showStatus) {
    setDeviceStatus(`设备名称已保存为 ${next}`);
  }
}

async function readBusinessDataFromStore() {
  const stored = await getAllDataFromDataStore();
  return {
    accounts: Array.isArray(stored?.accounts) ? stored.accounts : [],
    passkeys: Array.isArray(stored?.passkeys) ? stored.passkeys : [],
    folders: Array.isArray(stored?.folders) ? stored.folders : [],
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

async function loadHistory() {
  const raw = await getHistoryFromDataStore();
  historyEntries = (Array.isArray(raw) ? raw : [])
    .map((item) => ({
      id: String(item?.id || ""),
      timestampMs: Number(item?.timestampMs || 0),
      action: String(item?.action || "").trim(),
    }))
    .filter((item) => item.timestampMs > 0 && item.action.length > 0)
    .sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    });
}

async function appendHistory(action, timestampMs = Date.now()) {
  const normalizedAction = String(action || "").trim();
  if (!normalizedAction) return;
  await appendHistoryEntry({ action: normalizedAction, timestampMs });
  if (!dom.historyModal.classList.contains("hidden")) {
    await loadHistory();
    renderHistoryModalList();
  }
}

function historyValueSnippet(input, maxLength = 80) {
  const normalized = String(input || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!normalized) return "(空)";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

async function loadSyncSettings() {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_SYNC_ENABLE_WEBDAV,
    STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER,
    STORAGE_KEY_SYNC_WEBDAV_BASE_URL,
    STORAGE_KEY_SYNC_WEBDAV_PATH,
    STORAGE_KEY_SYNC_WEBDAV_USERNAME,
    STORAGE_KEY_SYNC_WEBDAV_PASSWORD,
    STORAGE_KEY_SYNC_SERVER_BASE_URL,
    STORAGE_KEY_SYNC_SERVER_TOKEN,
    STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES,
  ]);
  const hasEnableWebdav = typeof result[STORAGE_KEY_SYNC_ENABLE_WEBDAV] === "boolean";
  const hasEnableServer = typeof result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER] === "boolean";
  const enableWebdav = hasEnableWebdav
    ? Boolean(result[STORAGE_KEY_SYNC_ENABLE_WEBDAV])
    : false;
  const enableServer = hasEnableServer
    ? Boolean(result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER])
    : false;

  dom.syncEnableWebdav.checked = enableWebdav;
  dom.syncEnableServer.checked = enableServer;
  dom.syncWebdavBaseUrl.value = String(result[STORAGE_KEY_SYNC_WEBDAV_BASE_URL] || "");
  dom.syncWebdavPath.value = String(result[STORAGE_KEY_SYNC_WEBDAV_PATH] || "pass-sync-bundle-v2.json");
  dom.syncWebdavUsername.value = String(result[STORAGE_KEY_SYNC_WEBDAV_USERNAME] || "");
  dom.syncWebdavPassword.value = String(result[STORAGE_KEY_SYNC_WEBDAV_PASSWORD] || "");
  dom.syncServerBaseUrl.value = String(
    result[STORAGE_KEY_SYNC_SERVER_BASE_URL] || DEFAULT_SELF_HOSTED_SERVER_BASE_URL
  );
  dom.syncServerToken.value = String(result[STORAGE_KEY_SYNC_SERVER_TOKEN] || DEFAULT_SELF_HOSTED_SERVER_TOKEN);
  dom.syncAutoInterval.value = normalizeAutoSyncIntervalMinutes(result[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]);
  renderSyncBackendFields();
}

function renderSyncBackendFields() {
  dom.syncWebdavFields.classList.toggle("hidden", !dom.syncEnableWebdav.checked);
  dom.syncServerFields.classList.toggle("hidden", !dom.syncEnableServer.checked);
  renderAutoSyncStatus();
}

function normalizeAutoSyncIntervalMinutes(value) {
  const normalized = String(value ?? "0").trim();
  return AUTO_SYNC_INTERVAL_OPTIONS.has(normalized) ? normalized : "0";
}

function renderAutoSyncStatus() {
  const interval = normalizeAutoSyncIntervalMinutes(dom.syncAutoInterval.value);
  const enabledLabels = [];
  if (dom.syncEnableWebdav.checked) enabledLabels.push("WebDAV");
  if (dom.syncEnableServer.checked) enabledLabels.push("服务器");
  if (interval === "0") {
    dom.syncAutoStatus.textContent = "自动同步已关闭";
    return;
  }
  if (enabledLabels.length === 0) {
    dom.syncAutoStatus.textContent = "自动同步已开启，但当前没有可用远端同步源";
    return;
  }
  dom.syncAutoStatus.textContent = `自动按“合并”模式执行，每 ${interval} 分钟同步一次（${enabledLabels.join(" + ")}）`;
}

async function loadLockSettings() {
  const result = await chrome.storage.local.get([
    STORAGE_KEY_LOCK_ENABLED,
    STORAGE_KEY_LOCK_POLICY,
    STORAGE_KEY_LOCK_IDLE_MINUTES,
    STORAGE_KEY_LOCK_MASTER_CREDENTIAL,
  ]);
  const credential = normalizeLockMasterCredential(result[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  lockCredentialExists = Boolean(credential);
  const enabled = Boolean(result[STORAGE_KEY_LOCK_ENABLED]) && lockCredentialExists;
  const policy = normalizeLockPolicy(result[STORAGE_KEY_LOCK_POLICY]);
  const idleMinutes = clampLockIdleMinutes(result[STORAGE_KEY_LOCK_IDLE_MINUTES]);

  dom.lockEnabled.checked = enabled;
  setLockPolicySelection(policy);
  dom.lockIdleMinutes.value = String(idleMinutes);
  dom.lockMasterPassword.value = "";
  dom.lockMasterPasswordConfirm.value = "";
  dom.lockCredentialHint.textContent = lockCredentialExists ? "已设置主密码" : "";
  renderLockSettingsFields();

  if (Boolean(result[STORAGE_KEY_LOCK_ENABLED]) && !lockCredentialExists) {
    await chrome.storage.local.set({ [STORAGE_KEY_LOCK_ENABLED]: false });
  }
}

function renderLockSettingsFields() {
  const lockEnabled = Boolean(dom.lockEnabled.checked);
  dom.lockAdvancedFields.classList.toggle("hidden", !lockEnabled);
  const idleTimeout = getSelectedLockPolicy() === LOCK_POLICY_IDLE_TIMEOUT;
  dom.lockIdleMinutesRow.classList.toggle("hidden", !lockEnabled || !idleTimeout);
}

function getSelectedLockPolicy() {
  if (dom.lockPolicyIdleRadio.checked) return LOCK_POLICY_IDLE_TIMEOUT;
  if (dom.lockPolicyBackgroundRadio.checked) return LOCK_POLICY_ON_BACKGROUND;
  return LOCK_POLICY_ONCE_UNTIL_QUIT;
}

function setLockPolicySelection(policy) {
  const normalized = normalizeLockPolicy(policy);
  dom.lockPolicyOnceRadio.checked = normalized === LOCK_POLICY_ONCE_UNTIL_QUIT;
  dom.lockPolicyIdleRadio.checked = normalized === LOCK_POLICY_IDLE_TIMEOUT;
  dom.lockPolicyBackgroundRadio.checked = normalized === LOCK_POLICY_ON_BACKGROUND;
}

async function saveLockSettings({ showStatus = true } = {}) {
  const lockEnabled = Boolean(dom.lockEnabled.checked);
  const policy = getSelectedLockPolicy();
  const idleMinutes = clampLockIdleMinutes(dom.lockIdleMinutes.value);
  const password = String(dom.lockMasterPassword.value || "").trim();
  const confirm = String(dom.lockMasterPasswordConfirm.value || "").trim();

  const result = await chrome.storage.local.get([STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  const existingCredential = normalizeLockMasterCredential(result[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
  let nextCredential = existingCredential;

  if (lockEnabled) {
    const shouldSetOrUpdatePassword = !existingCredential || password || confirm;
    if (shouldSetOrUpdatePassword) {
      if (!password) {
        if (showStatus) {
          setDeviceStatus("主密码不能为空");
        }
        return;
      }
      if (password !== confirm) {
        if (showStatus) {
          setDeviceStatus("两次输入的主密码不一致");
        }
        return;
      }
      nextCredential = await createLockMasterCredential(password);
    }
    if (!nextCredential) {
      if (showStatus) {
        setDeviceStatus("缺少主密码，无法启用解锁");
      }
      return;
    }
  } else if (existingCredential) {
    let disablePassword = password;
    if (!disablePassword) {
      const promptResult = window.prompt("请输入当前主密码以关闭主密码锁", "");
      disablePassword = String(promptResult || "").trim();
    }
    if (!disablePassword) {
      dom.lockEnabled.checked = true;
      renderLockSettingsFields();
      if (showStatus) {
        setDeviceStatus("未输入当前主密码，已取消关闭");
      }
      return;
    }
    const verified = await verifyLockMasterPassword(existingCredential, disablePassword);
    if (!verified) {
      dom.lockEnabled.checked = true;
      renderLockSettingsFields();
      if (showStatus) {
        setDeviceStatus("当前主密码错误，无法关闭解锁");
      }
      return;
    }
  }

  const updates = {
    [STORAGE_KEY_LOCK_ENABLED]: lockEnabled && Boolean(nextCredential),
    [STORAGE_KEY_LOCK_POLICY]: policy,
    [STORAGE_KEY_LOCK_IDLE_MINUTES]: idleMinutes,
    [STORAGE_KEY_LOCK_MASTER_CREDENTIAL]: nextCredential,
  };
  await chrome.storage.local.set(updates);
  lockCredentialExists = Boolean(nextCredential);
  dom.lockMasterPassword.value = "";
  dom.lockMasterPasswordConfirm.value = "";
  dom.lockCredentialHint.textContent = lockCredentialExists ? "已设置主密码" : "";
  renderLockSettingsFields();

  if (!showStatus) {
    return;
  }
  if (!lockEnabled) {
    setDeviceStatus("主密码锁已关闭");
    return;
  }
  if (!existingCredential) {
    setDeviceStatus("主密码锁已启用");
    return;
  }
  if (password || confirm) {
    setDeviceStatus("主密码已更新，解锁策略已保存");
    return;
  }
  setDeviceStatus("解锁策略已保存");
}

async function persistSyncSettings({ showStatus = true } = {}) {
  const enableWebdav = Boolean(dom.syncEnableWebdav.checked);
  const enableServer = Boolean(dom.syncEnableServer.checked);
  const autoSyncIntervalMinutes = normalizeAutoSyncIntervalMinutes(dom.syncAutoInterval.value);
  const nextSettings = {
    [STORAGE_KEY_SYNC_ENABLE_WEBDAV]: enableWebdav,
    [STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER]: enableServer,
    [STORAGE_KEY_SYNC_WEBDAV_BASE_URL]: String(dom.syncWebdavBaseUrl.value || "").trim(),
    [STORAGE_KEY_SYNC_WEBDAV_PATH]: String(dom.syncWebdavPath.value || "").trim() || "pass-sync-bundle-v2.json",
    [STORAGE_KEY_SYNC_WEBDAV_USERNAME]: String(dom.syncWebdavUsername.value || "").trim(),
    [STORAGE_KEY_SYNC_WEBDAV_PASSWORD]: String(dom.syncWebdavPassword.value || ""),
    [STORAGE_KEY_SYNC_SERVER_BASE_URL]: String(dom.syncServerBaseUrl.value || "").trim(),
    [STORAGE_KEY_SYNC_SERVER_TOKEN]: String(dom.syncServerToken.value || "").trim(),
    [STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]: Number(autoSyncIntervalMinutes),
  };
  await chrome.storage.local.set(nextSettings);

  const persisted = await chrome.storage.local.get([
    STORAGE_KEY_SYNC_SERVER_BASE_URL,
    STORAGE_KEY_SYNC_SERVER_TOKEN,
    STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES,
  ]);
  dom.syncServerBaseUrl.value = String(
    persisted[STORAGE_KEY_SYNC_SERVER_BASE_URL] || nextSettings[STORAGE_KEY_SYNC_SERVER_BASE_URL] || DEFAULT_SELF_HOSTED_SERVER_BASE_URL
  );
  dom.syncServerToken.value = String(
    persisted[STORAGE_KEY_SYNC_SERVER_TOKEN] || nextSettings[STORAGE_KEY_SYNC_SERVER_TOKEN] || DEFAULT_SELF_HOSTED_SERVER_TOKEN
  );
  dom.syncAutoInterval.value = normalizeAutoSyncIntervalMinutes(
    persisted[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES] ?? nextSettings[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]
  );

  renderSyncBackendFields();
  if (!showStatus) return;

  const enabledLabels = [];
  if (enableWebdav) enabledLabels.push("WebDAV");
  if (enableServer) enabledLabels.push("服务器");
  const autoSyncLabel = autoSyncIntervalMinutes === "0" ? "自动同步关闭" : `自动同步每 ${autoSyncIntervalMinutes} 分钟`;
  setDeviceStatus(
    enabledLabels.length > 0
      ? `同步源配置已保存（已启用：${enabledLabels.join(" + ")}；${autoSyncLabel}）`
      : `同步源配置已保存（当前未启用任何远端源；${autoSyncLabel}）`
  );
}

async function saveSyncSettings() {
  await persistSyncSettings({ showStatus: true });
}

async function refresh({ silent = false } = {}) {
  const { accounts, passkeys, folders } = await readBusinessDataFromStore();
  await loadHistory();

  accountsRaw = cloneAccounts(accounts);
  passkeysRaw = passkeys.map(normalizePasskeyShape);
  foldersRaw = sortFoldersForDisplay(withFixedFolder(folders.map(normalizeFolderShape)));
  closeContextMenu();

  dom.payload.value = JSON.stringify(
    { accounts: accountsRaw, passkeys: passkeysRaw, folders: foldersRaw },
    null,
    2
  );
  renderGoogleAuthenticatorImportFolderOptions();
  renderSidebar(accountsRaw);
  renderCurrentView(accountsRaw);
  setAccountView(activeAccountView);
  if (!dom.historyModal.classList.contains("hidden")) {
    renderHistoryModalList();
  }

  if (!silent) {
    setStatus(`已加载 ${accountsRaw.length} 条账号，${passkeysRaw.length} 条通行密钥，${foldersRaw.length} 个文件夹`);
  }
}

async function exportJson() {
  const text = dom.payload.value;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pass-extension-data.json";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("已导出 JSON");
}

async function importJson() {
  let parsed;
  try {
    parsed = JSON.parse(dom.payload.value);
  } catch (error) {
    setStatus(`JSON 格式错误: ${error.message}`);
    return;
  }

  const payload = parseSyncBundlePayload(parsed);
  if (!payload) {
    setStatus("JSON 格式错误：缺少 accounts/folders/payload");
    return;
  }
  const accounts = payload.accounts.map(normalizeAccountShape);
  const passkeys = buildUnifiedPasskeys(accounts, payload.passkeys);
  const folders = payload.folders.map(normalizeFolderShape);
  await writeBusinessDataToStore({ accounts, passkeys, folders });
  await appendHistory(`导入 JSON：账号 ${accounts.length} 条，通行密钥 ${passkeys.length} 条，文件夹 ${folders.length} 个`);

  editingAccountId = null;
  await refresh({ silent: true });
  setStatus(`导入完成，共 ${accounts.length} 条账号，${passkeys.length} 条通行密钥，${folders.length} 个文件夹`);
}

async function clearAll() {
  await writeBusinessDataToStore({ accounts: [], passkeys: [], folders: [] });
  await appendHistory("清空全部数据：账号、通行密钥、文件夹");
  editingAccountId = null;
  await refresh({ silent: true });
  setStatus("账号、通行密钥与文件夹已清空");
}

async function exportSyncBundle() {
  const bundle = await buildSyncBundle();
  const fileName = `pass-sync-bundle-${formatFileTimestamp(bundle.exportedAtMs)}.json`;
  const text = JSON.stringify(bundle, null, 2);
  downloadTextFile(fileName, text, "application/json");
  setStatus(
    `同步包已导出：${bundle.payload.accounts.length} 条账号，` +
      `${bundle.payload.passkeys.length} 条通行密钥，${bundle.payload.folders.length} 个文件夹`
  );
}

async function exportBrowserPasswordCsv(format) {
  const browser = normalizeBrowserExportFormat(format);
  const localStored = await readBusinessDataFromStore();
  const localAccounts = Array.isArray(localStored.accounts)
    ? localStored.accounts.map(normalizeAccountShape)
    : [];
  const activeAccounts = localAccounts.filter((account) => !account.isDeleted);
  const csv = buildBrowserPasswordCsv(activeAccounts, browser);
  const fileName = `pass-${browser}-passwords-${formatFileTimestamp(Date.now())}.csv`;
  downloadTextFile(fileName, csv, "text/csv;charset=utf-8");
  setStatus(`已导出 ${browserExportLabel(browser)} 密码 CSV，共 ${countBrowserPasswordRows(activeAccounts)} 行`);
}

async function importSyncBundleAndMerge() {
  const file = await pickJsonFile();
  if (!file) {
    setStatus("已取消导入同步包");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    setStatus(`同步包 JSON 解析失败: ${error.message}`);
    return;
  }

  const incomingPayload = parseSyncBundlePayload(parsed, { requireBundleSchema: true });
  if (!incomingPayload) {
    setStatus("同步包格式错误，仅支持 pass.sync.bundle.v2");
    return;
  }

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

  const remoteAccounts = incomingPayload.accounts.map(normalizeAccountShape);
  const remotePasskeys = buildUnifiedPasskeys(remoteAccounts, incomingPayload.passkeys);
  const remoteFolders = incomingPayload.folders.map(normalizeFolderShape);

  const mergedFolders = mergeFolderCollections(localFolders, remoteFolders);
  let mergedAccounts = mergeAccountCollections(localAccounts, remoteAccounts);
  mergedAccounts = syncAliasGroups(mergedAccounts);
  mergedAccounts = reconcileAccountFolders(mergedAccounts, mergedFolders);
  let mergedPasskeys = mergePasskeyCollections(localPasskeys, remotePasskeys);
  mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, mergedPasskeys);

  await writeBusinessDataToStore({
    accounts: mergedAccounts,
    passkeys: mergedPasskeys,
    folders: mergedFolders,
  });
  await appendHistory(
    `导入同步包并合并：账号 ${localAccounts.length}->${mergedAccounts.length}，通行密钥 ${localPasskeys.length}->${mergedPasskeys.length}`
  );

  editingAccountId = null;
  await refresh({ silent: true });
  setStatus(
    `同步包合并完成：账号 ${localAccounts.length}+${remoteAccounts.length}->${mergedAccounts.length}，` +
      `通行密钥 ${localPasskeys.length}+${remotePasskeys.length}->${mergedPasskeys.length}，` +
      `文件夹 ${localFolders.length}+${remoteFolders.length}->${mergedFolders.length}`
  );
}

async function importBrowserPasswordCsv() {
  const file = await pickCsvFile();
  if (!file) {
    setStatus("已取消浏览器密码 CSV 导入");
    return;
  }

  let parsed;
  try {
    parsed = parseBrowserPasswordCsv(await file.text());
  } catch (error) {
    setStatus(`浏览器密码 CSV 导入失败: ${error.message}`);
    return;
  }

  const localStored = await readBusinessDataFromStore();
  let mergedAccounts = Array.isArray(localStored.accounts)
    ? localStored.accounts.map(normalizeAccountShape)
    : [];
  const localStoredPasskeys = Array.isArray(localStored.passkeys)
    ? localStored.passkeys.map(normalizePasskeyShape)
    : [];
  const localPasskeys = buildUnifiedPasskeys(mergedAccounts, localStoredPasskeys);
  const localFolders = Array.isArray(localStored.folders)
    ? localStored.folders.map(normalizeFolderShape)
    : [];

  const startedAtMs = Date.now();
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  parsed.entries.forEach((entry, index) => {
    const nowMs = startedAtMs + index;
    const matchIndex = findImportedBrowserAccountIndex(mergedAccounts, entry);
    if (matchIndex >= 0) {
      const updated = applyImportedBrowserEntryToAccount(mergedAccounts[matchIndex], entry, nowMs);
      if (JSON.stringify(updated) === JSON.stringify(mergedAccounts[matchIndex])) {
        unchangedCount += 1;
      } else {
        mergedAccounts[matchIndex] = updated;
        updatedCount += 1;
      }
      return;
    }

    const createdAtMs = startedAtMs + index * 1000;
    const canonicalSite = etldPlusOne(entry.sites[0] || "");
    mergedAccounts.push(normalizeAccountShape({
      accountId: buildAccountId(canonicalSite, entry.username, createdAtMs),
      canonicalSite,
      usernameAtCreate: entry.username,
      sites: entry.sites,
      username: entry.username,
      password: entry.password,
      note: entry.note,
      createdAtMs,
      updatedAtMs: createdAtMs,
      usernameUpdatedAtMs: createdAtMs,
      usernameUpdatedDeviceName: currentImportDeviceName(),
      passwordUpdatedAtMs: createdAtMs,
      passwordUpdatedDeviceName: currentImportDeviceName(),
      noteUpdatedAtMs: entry.note ? createdAtMs : 0,
      noteUpdatedDeviceName: currentImportDeviceName(),
      deletedDeviceName: "",
      lastOperatedDeviceName: currentImportDeviceName(),
      createdDeviceName: currentImportDeviceName(),
      isDeleted: false,
      deletedAtMs: null,
      folderIds: [],
      passkeyCredentialIds: [],
    }));
    createdCount += 1;
  });

  if (createdCount === 0 && updatedCount === 0) {
    setStatus(
      `浏览器密码 CSV 导入完成（${parsed.formatLabel}），没有新增或更新账号` +
        (parsed.skippedRowCount > 0 ? `，跳过 ${parsed.skippedRowCount} 行` : "") +
        (unchangedCount > 0 ? `，未变化 ${unchangedCount} 行` : "")
    );
    return;
  }

  mergedAccounts = syncAliasGroups(mergedAccounts);
  mergedAccounts = reconcileAccountFolders(mergedAccounts, localFolders);
  const mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, localPasskeys);

  await writeBusinessDataToStore({
    accounts: mergedAccounts,
    passkeys: mergedPasskeys,
    folders: localFolders,
  });
  await appendHistory(
    `导入 ${parsed.formatLabel} 密码 CSV：新增 ${createdCount} 条，更新 ${updatedCount} 条` +
      (parsed.skippedRowCount > 0 ? `，跳过 ${parsed.skippedRowCount} 行` : "") +
      (unchangedCount > 0 ? `，未变化 ${unchangedCount} 行` : "")
  );

  editingAccountId = null;
  await refresh({ silent: true });
  setStatus(
    `浏览器密码 CSV 导入完成（${parsed.formatLabel}）：新增 ${createdCount} 条，更新 ${updatedCount} 条` +
      (parsed.skippedRowCount > 0 ? `，跳过 ${parsed.skippedRowCount} 行` : "") +
      (unchangedCount > 0 ? `，未变化 ${unchangedCount} 行` : "")
  );
}

async function importGoogleAuthenticatorExportQrFromClipboard() {
  let migration;
  try {
    migration = await readGoogleAuthenticatorMigrationFromClipboard();
  } catch (error) {
    setStatus(`谷歌验证器导入失败: ${error.message}`);
    return;
  }

  if (!migration) {
    setStatus("剪贴板里没有可识别的谷歌验证器导出二维码");
    return;
  }

  await importGoogleAuthenticatorMigration(migration, buildGoogleAuthenticatorImportFolderPlan());
}

async function importGoogleAuthenticatorExportQrFromFiles() {
  const files = await pickImageFiles();
  if (!files || files.length === 0) {
    setStatus("已取消谷歌验证器二维码导入");
    return;
  }

  let migration;
  try {
    migration = await readGoogleAuthenticatorMigrationFromFiles(files);
  } catch (error) {
    setStatus(`谷歌验证器导入失败: ${error.message}`);
    return;
  }

  if (!migration) {
    setStatus("未从所选图片中识别到谷歌验证器导出二维码");
    return;
  }

  await importGoogleAuthenticatorMigration(migration, buildGoogleAuthenticatorImportFolderPlan());
}

async function importGoogleAuthenticatorMigration(migration, folderPlan = null) {
  const localStored = await readBusinessDataFromStore();
  let mergedAccounts = Array.isArray(localStored.accounts)
    ? localStored.accounts.map(normalizeAccountShape)
    : [];
  const localStoredPasskeys = Array.isArray(localStored.passkeys)
    ? localStored.passkeys.map(normalizePasskeyShape)
    : [];
  const localPasskeys = buildUnifiedPasskeys(mergedAccounts, localStoredPasskeys);
  let localFolders = Array.isArray(localStored.folders)
    ? localStored.folders.map(normalizeFolderShape)
    : [];

  const resolvedImportFolder = resolveGoogleAuthenticatorImportFolder(folderPlan, localFolders);
  if (
    (String(folderPlan?.newFolderName || "").trim() || String(folderPlan?.selectedFolderId || "").trim()) &&
    !resolvedImportFolder.folderId
  ) {
    return;
  }
  localFolders = resolvedImportFolder.folders;

  const startedAtMs = Date.now();
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let skippedCount = Number(migration.skippedCount || 0);

  migration.entries.forEach((entry, index) => {
    if (!entry?.siteAlias || !entry?.secret) {
      skippedCount += 1;
      return;
    }

    const nowMs = startedAtMs + index;
    const matchIndex = findImportedTotpAccountIndex(mergedAccounts, entry);
    if (matchIndex >= 0) {
      const updated = applyImportedTotpEntryToAccount(
        mergedAccounts[matchIndex],
        entry,
        nowMs,
        resolvedImportFolder.folderId
      );
      if (JSON.stringify(updated) === JSON.stringify(mergedAccounts[matchIndex])) {
        unchangedCount += 1;
      } else {
        mergedAccounts[matchIndex] = updated;
        updatedCount += 1;
      }
      return;
    }

    const createdAtMs = startedAtMs + index * 1000;
    const canonicalSite = etldPlusOne(entry.siteAlias || "");
    mergedAccounts.push(normalizeAccountShape({
      accountId: buildAccountId(canonicalSite, entry.username || "", createdAtMs),
      canonicalSite,
      usernameAtCreate: entry.username || "",
      sites: [entry.siteAlias],
      username: entry.username || "",
      password: "",
      totpSecret: entry.secret,
      createdAtMs,
      updatedAtMs: createdAtMs,
      usernameUpdatedAtMs: createdAtMs,
      usernameUpdatedDeviceName: currentImportDeviceName(),
      passwordUpdatedAtMs: createdAtMs,
      passwordUpdatedDeviceName: currentImportDeviceName(),
      totpUpdatedAtMs: createdAtMs,
      totpUpdatedDeviceName: currentImportDeviceName(),
      deletedDeviceName: "",
      lastOperatedDeviceName: currentImportDeviceName(),
      createdDeviceName: currentImportDeviceName(),
      isDeleted: false,
      deletedAtMs: null,
      folderIds: resolvedImportFolder.folderId ? [resolvedImportFolder.folderId] : [],
      folderId: resolvedImportFolder.folderId,
      passkeyCredentialIds: [],
    }));
    createdCount += 1;
  });

  if (createdCount === 0 && updatedCount === 0) {
    setStatus(
      `谷歌验证器导入完成，没有新增或更新账号` +
        buildGoogleAuthenticatorImportSuffix({
          importedCount: migration.entries.length,
          skippedCount,
          unchangedCount,
          batchSize: migration.batchSize,
          batchIndex: migration.batchIndex,
        })
    );
    return;
  }

  mergedAccounts = syncAliasGroups(mergedAccounts);
  mergedAccounts = reconcileAccountFolders(mergedAccounts, localFolders);
  const mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, localPasskeys);

  await writeBusinessDataToStore({
    accounts: mergedAccounts,
    passkeys: mergedPasskeys,
    folders: localFolders,
  });
  await appendHistory(
    (resolvedImportFolder.createdFolderName
      ? `创建文件夹：${resolvedImportFolder.createdFolderName}；`
      : "") +
    `导入谷歌验证器导出二维码：新增 ${createdCount} 条，更新 ${updatedCount} 条` +
      buildGoogleAuthenticatorImportSuffix({
        importedCount: migration.entries.length,
        skippedCount,
        unchangedCount,
        batchSize: migration.batchSize,
        batchIndex: migration.batchIndex,
      })
  );

  editingAccountId = null;
  await refresh({ silent: true });
  setStatus(
    `谷歌验证器导入完成：新增 ${createdCount} 条，更新 ${updatedCount} 条` +
      (resolvedImportFolder.folderName ? `，导入到文件夹 ${resolvedImportFolder.folderName}` : "") +
      buildGoogleAuthenticatorImportSuffix({
        importedCount: migration.entries.length,
        skippedCount,
        unchangedCount,
        batchSize: migration.batchSize,
        batchIndex: migration.batchIndex,
      })
  );
}

async function syncNowWithRemote(syncMode = SYNC_MODE_MERGE) {
  await saveSyncSettings();
  const targets = buildRemoteSyncTargetsFromDom();
  if (!targets || targets.length === 0) return;
  const normalizedSyncMode = normalizeSyncMode(syncMode);

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

  if (normalizedSyncMode !== SYNC_MODE_LOCAL_OVERWRITE_REMOTE) {
    let remoteAggregate = null;
    for (const target of targets) {
      let remotePayload = null;
      try {
        const remoteResponse = await pullRemotePayload(target);
        target.remoteEtag = remoteResponse.etag;
        remotePayload = remoteResponse.payload;
      } catch (error) {
        setStatus(`${target.label} 拉取失败: ${error.message}`);
        return;
      }

      const remoteAccounts = remotePayload ? remotePayload.accounts.map(normalizeAccountShape) : [];
      const remotePasskeys = remotePayload
        ? buildUnifiedPasskeys(remoteAccounts, remotePayload.passkeys)
        : [];
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

    if (normalizedSyncMode === SYNC_MODE_MERGE) {
      if (remoteAggregate) {
        mergedFolders = mergeFolderCollections(localFolders, remoteAggregate.folders);
        mergedAccounts = mergeAccountCollections(localAccounts, remoteAggregate.accounts);
        mergedAccounts = syncAliasGroups(mergedAccounts);
        mergedAccounts = reconcileAccountFolders(mergedAccounts, mergedFolders);
        mergedPasskeys = mergePasskeyCollections(localPasskeys, remoteAggregate.passkeys);
        mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, mergedPasskeys);
      }
    } else if (normalizedSyncMode === SYNC_MODE_REMOTE_OVERWRITE_LOCAL) {
      if (remoteAggregate) {
        mergedAccounts = remoteAggregate.accounts;
        mergedPasskeys = buildUnifiedPasskeys(remoteAggregate.accounts, remoteAggregate.passkeys);
        mergedFolders = remoteAggregate.folders;
      } else {
        mergedAccounts = [];
        mergedPasskeys = [];
        mergedFolders = [];
      }
    }
  }

  await writeBusinessDataToStore({
    accounts: mergedAccounts,
    passkeys: mergedPasskeys,
    folders: mergedFolders,
  });
  await appendHistory(
    `${getSyncModeHistoryLabel(normalizedSyncMode)}：账号 ${localAccounts.length}->${mergedAccounts.length}，通行密钥 ${localPasskeys.length}->${mergedPasskeys.length}`
  );

  const pushErrors = [];
  const pushTargets = [...targets].sort((left, right) => Number(right.supportsEtag) - Number(left.supportsEtag));
  for (const target of pushTargets) {
    try {
      const result = await pushRemotePayloadWithMode(target, {
        accounts: mergedAccounts,
        passkeys: mergedPasskeys,
        folders: mergedFolders,
      }, normalizedSyncMode);
      mergedAccounts = result.payload.accounts.map(normalizeAccountShape);
      mergedFolders = result.payload.folders.map(normalizeFolderShape);
      mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, result.payload.passkeys);
    } catch (error) {
      pushErrors.push(`${target.label}: ${error.message}`);
    }
  }

  editingAccountId = null;
  await refresh({ silent: true });
  const sourceSummary = targets.map((item) => item.label).join(" + ");
  if (pushErrors.length > 0) {
    setStatus(
      `${getSyncModeStatusLabel(normalizedSyncMode)}，但部分源上传失败（${sourceSummary}）：${pushErrors.join("；")}（账号 ${localAccounts.length}->${mergedAccounts.length}，` +
        `通行密钥 ${localPasskeys.length}->${mergedPasskeys.length}，文件夹 ${localFolders.length}->${mergedFolders.length}）`
    );
    return;
  }
  setStatus(
    `${getSyncModeStatusLabel(normalizedSyncMode)}（${sourceSummary}）：账号 ${localAccounts.length}->${mergedAccounts.length}，` +
      `通行密钥 ${localPasskeys.length}->${mergedPasskeys.length}，文件夹 ${localFolders.length}->${mergedFolders.length}`
  );
}

async function confirmRemoteOverwriteLocalIfNeeded() {
  const targets = buildRemoteSyncTargetsFromDom();
  if (!targets || targets.length === 0) return false;

  const unreachableTargets = [];
  const emptyTargets = [];
  for (const target of targets) {
    try {
      const remoteResponse = await pullRemotePayload(target);
      if (!remoteResponse.payload) {
        emptyTargets.push(target.label);
      }
    } catch (error) {
      unreachableTargets.push(`${target.label}（${error.message}）`);
    }
  }

  if (unreachableTargets.length === 0 && emptyTargets.length === 0) {
    return true;
  }

  const messages = [];
  if (unreachableTargets.length > 0) {
    messages.push(`以下远端当前不可达：${unreachableTargets.join("；")}。继续执行后，本次操作很可能直接失败。`);
  }
  if (emptyTargets.length > 0) {
    messages.push(`以下远端当前为空：${emptyTargets.join("、")}。如果所有可用远端都为空，继续执行可能把本地数据覆盖成空。`);
  }
  messages.push("确定仍要继续执行“云端覆盖本地”吗？");
  return window.confirm(messages.join("\n\n"));
}

async function confirmLocalOverwriteRemoteIfNeeded() {
  const localStored = await readBusinessDataFromStore();
  const localAccounts = Array.isArray(localStored.accounts) ? localStored.accounts : [];
  const localPasskeys = Array.isArray(localStored.passkeys) ? localStored.passkeys : [];
  const localFolders = Array.isArray(localStored.folders) ? localStored.folders : [];
  const isEmpty = localAccounts.length === 0 && localPasskeys.length === 0 && localFolders.length === 0;
  if (!isEmpty) {
    return true;
  }
  return window.confirm("本地数据当前为空。\n\n继续执行“本地覆盖云端”会把所有已启用远端同步源覆盖成空数据。\n\n确定继续吗？");
}

function buildRemoteSyncTargetsFromDom() {
  const targets = [];
  if (dom.syncEnableWebdav.checked) {
    const baseUrl = String(dom.syncWebdavBaseUrl.value || "").trim();
    const remotePath = String(dom.syncWebdavPath.value || "").trim() || "pass-sync-bundle-v2.json";
    if (!baseUrl || !remotePath) {
      setStatus("WebDAV 配置不完整：请填写地址和远端路径");
      return null;
    }
    let url;
    try {
      const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
      url = new URL(remotePath.replace(/^\/+/g, ""), normalizedBase).toString();
    } catch {
      setStatus("WebDAV 地址格式不正确");
      return null;
    }
    const username = String(dom.syncWebdavUsername.value || "");
    const password = String(dom.syncWebdavPassword.value || "");
    let authHeader = null;
    if (username || password) {
      authHeader = `Basic ${base64EncodeUtf8(`${username}:${password}`)}`;
    }
    targets.push({ label: "WebDAV", url, authHeader, supportsEtag: false, remoteEtag: null });
  }

  if (dom.syncEnableServer.checked) {
    const serverBaseUrl = String(dom.syncServerBaseUrl.value || "").trim();
    if (!serverBaseUrl) {
      setStatus("服务器配置不完整：请填写服务地址");
      return null;
    }
    let url;
    try {
      const normalizedBase = serverBaseUrl.endsWith("/") ? serverBaseUrl : `${serverBaseUrl}/`;
      url = new URL("v1/sync/payload", normalizedBase).toString();
    } catch {
      setStatus("服务器地址格式不正确");
      return null;
    }
    const token = String(dom.syncServerToken.value || "").trim();
    const authHeader = token ? `Bearer ${token}` : null;
    targets.push({ label: "服务器", url, authHeader, supportsEtag: true, remoteEtag: null });
  }

  if (targets.length === 0) {
    setStatus("请至少启用一个远端同步源（WebDAV 或 自建服务器）");
    return null;
  }
  return targets;
}

async function pullRemotePayload(target) {
  const headers = {
    Accept: "application/json",
  };
  if (target.authHeader) {
    headers.Authorization = target.authHeader;
  }
  const response = await fetch(target.url, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  if (response.status === 404) {
    return { payload: null, etag: null };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const text = await response.text();
  if (!String(text || "").trim()) {
    return {
      payload: null,
      etag: response.headers.get("ETag"),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`远端 JSON 解析失败: ${error.message}`);
  }
  const payload = parseSyncBundlePayload(parsed, { requireBundleSchema: true });
  if (!payload) {
    throw new Error("远端数据格式错误，仅支持 pass.sync.bundle.v2");
  }
  return {
    payload,
    etag: response.headers.get("ETag"),
  };
}

async function pushRemotePayload(target, payload, ifMatch = null) {
  const bundle = await buildSyncBundleFromPayload(payload);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (target.authHeader) {
    headers.Authorization = target.authHeader;
  }
  if (ifMatch) {
    headers["If-Match"] = ifMatch;
  }
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
  return {
    etag: response.headers.get("ETag"),
  };
}

async function pushRemotePayloadWithRetry(target, payload) {
  try {
    const pushResult = await pushRemotePayload(target, payload, target.remoteEtag);
    target.remoteEtag = pushResult.etag;
    return { payload };
  } catch (error) {
    if (!target.supportsEtag || error?.status !== 412) {
      throw error;
    }
  }

  const latestResponse = await pullRemotePayload(target);
  target.remoteEtag = latestResponse.etag;
  const remotePayload = latestResponse.payload || {
    accounts: [],
    passkeys: [],
    folders: [],
  };

  const localAccounts = Array.isArray(payload.accounts)
    ? payload.accounts.map(normalizeAccountShape)
    : [];
  const localPasskeys = buildUnifiedPasskeys(
    localAccounts,
    Array.isArray(payload.passkeys) ? payload.passkeys.map(normalizePasskeyShape) : []
  );
  const localFolders = Array.isArray(payload.folders)
    ? payload.folders.map(normalizeFolderShape)
    : [];
  const remoteAccounts = remotePayload.accounts.map(normalizeAccountShape);
  const remotePasskeys = buildUnifiedPasskeys(remoteAccounts, remotePayload.passkeys);
  const remoteFolders = remotePayload.folders.map(normalizeFolderShape);

  let mergedFolders = mergeFolderCollections(localFolders, remoteFolders);
  let mergedAccounts = mergeAccountCollections(localAccounts, remoteAccounts);
  mergedAccounts = syncAliasGroups(mergedAccounts);
  mergedAccounts = reconcileAccountFolders(mergedAccounts, mergedFolders);
  let mergedPasskeys = mergePasskeyCollections(localPasskeys, remotePasskeys);
  mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, mergedPasskeys);

  const reconciledPayload = {
    accounts: mergedAccounts,
    passkeys: mergedPasskeys,
    folders: mergedFolders,
  };

  await writeBusinessDataToStore(reconciledPayload);
  const retryResult = await pushRemotePayload(target, reconciledPayload, target.remoteEtag);
  target.remoteEtag = retryResult.etag;
  return { payload: reconciledPayload };
}

async function pushRemotePayloadRemotePreferred(target, payload) {
  try {
    const pushResult = await pushRemotePayload(target, payload, target.remoteEtag);
    target.remoteEtag = pushResult.etag;
    return { payload };
  } catch (error) {
    if (!target.supportsEtag || error?.status !== 412) {
      throw error;
    }
  }

  const latestResponse = await pullRemotePayload(target);
  target.remoteEtag = latestResponse.etag;
  const latestPayload = latestResponse.payload || {
    accounts: [],
    passkeys: [],
    folders: [],
  };
  await writeBusinessDataToStore(latestPayload);
  const retryResult = await pushRemotePayload(target, latestPayload, target.remoteEtag);
  target.remoteEtag = retryResult.etag;
  return { payload: latestPayload };
}

async function pushRemotePayloadWithMode(target, payload, syncMode) {
  switch (syncMode) {
    case SYNC_MODE_LOCAL_OVERWRITE_REMOTE: {
      await pushRemotePayload(target, payload, null);
      return { payload };
    }
    case SYNC_MODE_REMOTE_OVERWRITE_LOCAL:
      return pushRemotePayloadRemotePreferred(target, payload);
    case SYNC_MODE_MERGE:
    default:
      return pushRemotePayloadWithRetry(target, payload);
  }
}

function normalizeSyncMode(value) {
  switch (String(value || "").trim()) {
    case SYNC_MODE_REMOTE_OVERWRITE_LOCAL:
      return SYNC_MODE_REMOTE_OVERWRITE_LOCAL;
    case SYNC_MODE_LOCAL_OVERWRITE_REMOTE:
      return SYNC_MODE_LOCAL_OVERWRITE_REMOTE;
    case SYNC_MODE_MERGE:
    default:
      return SYNC_MODE_MERGE;
  }
}

function getSyncModeHistoryLabel(syncMode) {
  switch (syncMode) {
    case SYNC_MODE_REMOTE_OVERWRITE_LOCAL:
      return "云端覆盖本地";
    case SYNC_MODE_LOCAL_OVERWRITE_REMOTE:
      return "本地覆盖云端";
    case SYNC_MODE_MERGE:
    default:
      return "远端同步合并";
  }
}

function getSyncModeStatusLabel(syncMode) {
  switch (syncMode) {
    case SYNC_MODE_REMOTE_OVERWRITE_LOCAL:
      return "云端覆盖本地完成";
    case SYNC_MODE_LOCAL_OVERWRITE_REMOTE:
      return "本地覆盖云端完成";
    case SYNC_MODE_MERGE:
    default:
      return "远端同步完成";
  }
}

async function buildSyncBundleFromPayload(payload) {
  const [deviceName, deviceId] = await Promise.all([getDeviceName(), getOrCreateSyncDeviceId()]);
  const accounts = Array.isArray(payload?.accounts)
    ? payload.accounts.map(normalizeAccountShape)
    : [];
  const rawPasskeys = Array.isArray(payload?.passkeys)
    ? payload.passkeys.map(normalizePasskeyShape)
    : [];
  const passkeys = buildUnifiedPasskeys(accounts, rawPasskeys);
  const folders = Array.isArray(payload?.folders)
    ? payload.folders.map(normalizeFolderShape)
    : [];
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

async function buildSyncBundle() {
  const [deviceName, deviceId, stored] = await Promise.all([
    getDeviceName(),
    getOrCreateSyncDeviceId(),
    readBusinessDataFromStore(),
  ]);

  const accounts = Array.isArray(stored.accounts)
    ? stored.accounts.map(normalizeAccountShape)
    : [];
  const storedPasskeys = Array.isArray(stored.passkeys)
    ? stored.passkeys.map(normalizePasskeyShape)
    : [];
  const passkeys = buildUnifiedPasskeys(accounts, storedPasskeys);
  const folders = Array.isArray(stored.folders)
    ? stored.folders.map(normalizeFolderShape)
    : [];

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

function downloadTextFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pickJsonFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener(
      "change",
      () => {
        resolve(input.files?.[0] || null);
      },
      { once: true }
    );
    input.click();
  });
}

function pickCsvFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv,text/plain";
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

function pickImageFiles() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff";
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

function normalizeBrowserExportFormat(format) {
  const value = String(format || "").trim().toLowerCase();
  if (value === "firefox") return "firefox";
  if (value === "safari") return "safari";
  return "chrome";
}

function browserExportLabel(format) {
  const browser = normalizeBrowserExportFormat(format);
  if (browser === "firefox") return "Firefox";
  if (browser === "safari") return "Safari";
  return "Chrome";
}

function countBrowserPasswordRows(accounts) {
  return (Array.isArray(accounts) ? accounts : [])
    .filter((account) => !account?.isDeleted)
    .reduce((count, account) => count + normalizeSites(account?.sites || []).length, 0);
}

function buildBrowserPasswordCsv(accounts, format) {
  const browser = normalizeBrowserExportFormat(format);
  const headers = browser === "firefox"
    ? ["url", "username", "password"]
    : ["name", "url", "username", "password", "note"];
  const rows = [headers.map(csvEscape).join(",")];

  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (account?.isDeleted) continue;
    const sites = normalizeSites(account?.sites || []);
    for (const site of sites) {
      const url = `https://${site}`;
      const username = String(account?.username || "");
      const password = String(account?.password || "");
      const note = String(account?.note || "");
      const name = String(account?.canonicalSite || "").trim() || site;
      const columns = browser === "firefox"
        ? [url, username, password]
        : [name, url, username, password, note];
      rows.push(columns.map(csvEscape).join(","));
    }
  }

  return rows.join("\n");
}

function csvEscape(value) {
  return `"${String(value || "").replaceAll("\"", "\"\"")}"`;
}

function parseBrowserPasswordCsv(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!normalized) {
    throw new Error("文件内容为空");
  }

  const rows = parseCsvRows(normalized);
  if (!rows.length || !rows[0].length) {
    throw new Error("CSV 缺少表头");
  }

  const headers = rows[0].map((value) => normalizeBrowserCsvHeader(value));
  const format = detectBrowserCsvFormat(headers);
  if (!format) {
    throw new Error("无法识别为 Chrome 或 Firefox 导出的密码 CSV");
  }

  const entries = [];
  let skippedRowCount = 0;
  for (const row of rows.slice(1)) {
    const entry = parseBrowserCsvEntry(headers, row);
    if (entry) {
      entries.push(entry);
    } else if (row.join("").trim()) {
      skippedRowCount += 1;
    }
  }

  return {
    formatLabel: format,
    entries,
    skippedRowCount,
  };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeBrowserCsvHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "_");
}

function detectBrowserCsvFormat(headers) {
  const values = new Set(headers);
  if (values.has("url") && values.has("username") && values.has("password")) {
    if (values.has("name") || values.has("note") || values.has("notes")) return "Chrome";
    if (values.has("httprealm") || values.has("formactionorigin") || values.has("guid")) return "Firefox";
    return "浏览器 CSV";
  }
  if (values.has("origin") && values.has("username") && values.has("password")) return "Chrome";
  if (values.has("signon_realm") && values.has("username") && values.has("password")) return "Chrome";
  return "";
}

function parseBrowserCsvEntry(headers, row) {
  const values = {};
  headers.forEach((header, index) => {
    values[header] = String(row[index] || "").trim();
  });

  const sites = extractBrowserCsvSites(values);
  const username = normalizeUsername(values.username || "");
  const password = String(values.password || "");
  if (!sites.length || (!username && !password)) {
    return null;
  }

  const note = mergeImportedBrowserNotes([
    values.name ? `来源名称：${values.name}` : "",
    values.note ? `备注：${values.note}` : "",
    values.notes ? `备注：${values.notes}` : "",
    values.httprealm ? `HTTP Realm：${values.httprealm}` : "",
  ]);

  return { sites, username, password, note };
}

function extractBrowserCsvSites(values) {
  const rawCandidates = [
    values.url,
    values.origin,
    values.website,
    values.hostname,
    values.signon_realm,
    values.formactionorigin,
    values.action,
  ];
  return [...new Set(rawCandidates.map(normalizeBrowserCsvSite).filter(Boolean))].sort();
}

function normalizeBrowserCsvSite(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("://")) {
    try {
      return normalizeDomain(new URL(raw).hostname);
    } catch {
      return "";
    }
  }
  return normalizeDomain(raw);
}

function findImportedBrowserAccountIndex(accounts, entry) {
  const targetSites = new Set(normalizeSites(entry.sites || []));
  const targetCanonicalSites = new Set([...targetSites].map((site) => etldPlusOne(site)));
  const normalizedUsername = normalizeUsername(entry.username || "");
  let bestIndex = -1;
  let bestScore = -1;

  accounts.forEach((account, index) => {
    const accountSites = new Set(normalizeSites(account?.sites || []));
    const accountCanonicalSites = new Set([...accountSites].map((site) => etldPlusOne(site)));
    accountCanonicalSites.add(String(account?.canonicalSite || ""));
    const usernameMatches = normalizedUsername
      ? normalizeUsername(account?.username || "") === normalizedUsername ||
        normalizeUsername(account?.usernameAtCreate || "") === normalizedUsername
      : !normalizeUsername(account?.username || "");
    const siteOverlaps = [...targetSites].some((site) => accountSites.has(site));
    const canonicalMatches = [...targetCanonicalSites].some((site) => accountCanonicalSites.has(site));

    let score = -1;
    if (usernameMatches && siteOverlaps) score = account?.isDeleted ? 35 : 40;
    else if (usernameMatches && canonicalMatches) score = account?.isDeleted ? 25 : 30;
    else if (!normalizedUsername && siteOverlaps) score = account?.isDeleted ? 15 : 20;
    else if (!normalizedUsername && canonicalMatches) score = account?.isDeleted ? 5 : 10;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function applyImportedBrowserEntryToAccount(account, entry, nowMs) {
  const next = normalizeAccountShape(account);
  let changed = false;
  const mergedSites = normalizeSites([...(next.sites || []), ...(entry.sites || [])]);
  if (JSON.stringify(mergedSites) !== JSON.stringify(next.sites || [])) {
    next.sites = mergedSites;
    changed = true;
  }
  if (entry.username && entry.username !== next.username) {
    next.username = entry.username;
    next.usernameUpdatedAtMs = nowMs;
    changed = true;
  }
  if (entry.password && entry.password !== next.password) {
    next.password = entry.password;
    next.passwordUpdatedAtMs = nowMs;
    changed = true;
  }
  const mergedNote = mergeImportedBrowserNotes([next.note || "", entry.note || ""]);
  if (mergedNote !== String(next.note || "")) {
    next.note = mergedNote;
    next.noteUpdatedAtMs = nowMs;
    changed = true;
  }
  if (next.isDeleted) {
    next.isDeleted = false;
    next.deletedAtMs = null;
    changed = true;
  }
  if (changed) {
    next.updatedAtMs = nowMs;
    next.lastOperatedDeviceName = currentImportDeviceName();
  }
  return next;
}

function mergeImportedBrowserNotes(parts) {
  const result = [];
  const seen = new Set();
  for (const rawPart of Array.isArray(parts) ? parts : []) {
    const part = String(rawPart || "").trim();
    if (!part || seen.has(part)) continue;
    seen.add(part);
    result.push(part);
  }
  return result.join("\n");
}

function currentImportDeviceName() {
  return String(dom.deviceName?.value || "").trim() || "ChromeMac";
}

function formatFileTimestamp(ms) {
  const date = new Date(Number(ms) || Date.now());
  const yyyy = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${month}${day}-${hour}${minute}${second}`;
}

async function clearActiveAccounts() {
  if (activeAccountView === "recycle") {
    setStatus("当前是回收站视图，请使用“清空回收站”");
    return;
  }

  const visibleAccounts = currentVisibleAccounts(accountsRaw).filter((item) => !item.isDeleted);
  const targetAccountIds = new Set(visibleAccounts.map((item) => String(item.accountId || "")));
  const activeCount = targetAccountIds.size;
  if (activeCount === 0) {
    setStatus("当前页面没有可移入回收站的账号");
    return;
  }

  const confirmed = window.confirm(
    `将把当前页面中的 ${activeCount} 条记录移入回收站，是否继续？`
  );
  if (!confirmed) {
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  const next = cloneAccounts(accountsRaw).map((account) => {
    const accountId = String(account?.accountId || "");
    if (account.isDeleted || !targetAccountIds.has(accountId)) return account;
    return {
      ...account,
      isDeleted: true,
      deletedAtMs: now,
      updatedAtMs: now,
      lastOperatedDeviceName: deviceName,
    };
  });

  editingAccountId = null;
  await setAccountsToDataStore(next);
  await appendHistory(`批量移入回收站：${activeCount} 条账号`, now);
  await refresh({ silent: true });
  setStatus(`已将当前页面 ${activeCount} 条账号移入回收站`);
}

async function clearRecycleBin() {
  const deletedCount = accountsRaw.filter((item) => item.isDeleted).length;
  if (deletedCount === 0) {
    setStatus("回收站为空，无需清空");
    return;
  }

  const confirmed = window.confirm(
    `将永久删除回收站中的 ${deletedCount} 条记录，此操作不可恢复。是否继续？`
  );
  if (!confirmed) {
    return;
  }

  const next = cloneAccounts(accountsRaw).filter((account) => !account.isDeleted);
  editingAccountId = null;
  await setAccountsToDataStore(next);
  await appendHistory(`清空回收站：永久删除 ${deletedCount} 条账号`);
  await refresh({ silent: true });
  setStatus(`已清空回收站，永久删除 ${deletedCount} 条记录`);
}

async function createFolderFromPrompt() {
  const raw = window.prompt("新建文件夹\n请输入文件夹名称：", "");
  if (raw == null) {
    setStatus("已取消新建文件夹");
    return;
  }
  const name = String(raw || "").trim();
  if (!name) {
    setStatus("文件夹名称不能为空");
    return;
  }

  const existed = foldersRaw.some(
    (item) => String(item?.name || "").trim().toLowerCase() === name.toLowerCase()
  );
  if (existed) {
    setStatus(`文件夹已存在: ${name}`);
    return;
  }

  const now = Date.now();
  const nextFolderId = (globalThis.crypto?.randomUUID?.() || stableUuidFromText(`folder|${name}|${now}`)).toLowerCase();
  const nextFolders = sortFoldersForDisplay([
    ...foldersRaw.map(normalizeFolderShape),
    normalizeFolderShape({
      id: nextFolderId,
      name,
      createdAtMs: now,
      updatedAtMs: now,
    }),
  ]);
  await setFoldersToDataStore(nextFolders);
  await appendHistory(`创建文件夹：${name}`, now);
  await refresh({ silent: true });
  setStatus(`已创建文件夹: ${name}`);
}

function renderGoogleAuthenticatorImportFolderOptions() {
  const select = dom.importGoogleAuthFolderSelect;
  if (!select) return;
  const previousValue = String(select.value || "");
  select.innerHTML = "";

  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "不放入文件夹";
  select.appendChild(empty);

  for (const folder of foldersRaw) {
    const option = document.createElement("option");
    option.value = normalizeFolderId(folder?.id);
    option.textContent = String(folder?.name || "未命名文件夹");
    select.appendChild(option);
  }

  const hasPrevious = Array.from(select.options).some((option) => option.value === previousValue);
  select.value = hasPrevious ? previousValue : "";
}

function buildGoogleAuthenticatorImportFolderPlan() {
  return {
    selectedFolderId: normalizeFolderId(dom.importGoogleAuthFolderSelect?.value || ""),
    newFolderName: String(dom.importGoogleAuthNewFolderName?.value || "").trim(),
  };
}

function resolveGoogleAuthenticatorImportFolder(folderPlan, foldersInput) {
  const folders = Array.isArray(foldersInput) ? foldersInput.map(normalizeFolderShape) : [];
  const newFolderName = String(folderPlan?.newFolderName || "").trim();
  if (newFolderName) {
    const existing = folders.find((folder) => String(folder?.name || "").trim().toLowerCase() === newFolderName.toLowerCase());
    if (existing) {
      return {
        folderId: normalizeFolderId(existing.id),
        folderName: String(existing.name || ""),
        createdFolderName: "",
        folders,
      };
    }

    const now = Date.now();
    const created = normalizeFolderShape({
      id: (globalThis.crypto?.randomUUID?.() || stableUuidFromText(`folder|${newFolderName}|${now}`)).toLowerCase(),
      name: newFolderName,
      createdAtMs: now,
      updatedAtMs: now,
    });
    return {
      folderId: normalizeFolderId(created.id),
      folderName: String(created.name || ""),
      createdFolderName: String(created.name || ""),
      folders: sortFoldersForDisplay([...folders, created]),
    };
  }

  const selectedFolderId = normalizeFolderId(folderPlan?.selectedFolderId || "");
  if (!selectedFolderId) {
    return { folderId: "", folderName: "", createdFolderName: "", folders };
  }
  const existing = folders.find((folder) => normalizeFolderId(folder?.id) === selectedFolderId);
  if (!existing) {
    setStatus("目标文件夹不存在");
    return { folderId: "", folderName: "", createdFolderName: "", folders };
  }
  return {
    folderId: selectedFolderId,
    folderName: String(existing.name || ""),
    createdFolderName: "",
    folders,
  };
}

async function deleteFolder(folderId) {
  const normalizedFolderId = normalizeFolderId(folderId);
  if (!normalizedFolderId) {
    setStatus("目标文件夹不存在");
    return;
  }
  if (normalizedFolderId === FIXED_NEW_ACCOUNT_FOLDER_ID) {
    setStatus("固定文件夹不可删除");
    return;
  }

  const folder = foldersRaw.find((item) => normalizeFolderId(item?.id) === normalizedFolderId);
  if (!folder) {
    setStatus("目标文件夹不存在");
    return;
  }

  const confirmed = window.confirm(`将删除文件夹：${folder.name}\n并从相关账号中移除该文件夹。是否继续？`);
  if (!confirmed) return;

  const now = Date.now();
  const deviceName = await getDeviceName();
  let removedFromAccountCount = 0;

  const nextAccounts = cloneAccounts(accountsRaw).map((account) => {
    const currentFolderIds = normalizeFolderIdList(extractAccountFolderIds(account));
    if (!currentFolderIds.includes(normalizedFolderId)) {
      return account;
    }

    const nextFolderIds = currentFolderIds.filter((id) => id !== normalizedFolderId);
    const nextAccount = {
      ...account,
      folderId: nextFolderIds[0] || null,
      folderIds: nextFolderIds,
      updatedAtMs: now,
      lastOperatedDeviceName: deviceName,
    };
    removedFromAccountCount += 1;
    return nextAccount;
  });
  const nextFolders = sortFoldersForDisplay(
    foldersRaw
      .map(normalizeFolderShape)
      .filter((item) => normalizeFolderId(item?.id) !== normalizedFolderId)
  );

  await writeBusinessDataToStore({
    accounts: nextAccounts,
    passkeys: passkeysRaw,
    folders: nextFolders,
  });
  await appendHistory(
    removedFromAccountCount > 0
      ? `删除文件夹：${folder.name}，并从 ${removedFromAccountCount} 个账号中移除`
      : `删除文件夹：${folder.name}`
  );

  if (activeAccountView === `folder:${normalizedFolderId}`) {
    activeAccountView = "all";
  }
  await refresh({ silent: true });
  if (removedFromAccountCount > 0) {
    setStatus(`已删除文件夹: ${folder.name}，并从 ${removedFromAccountCount} 个账号中移除`);
  } else {
    setStatus(`已删除文件夹: ${folder.name}`);
  }
}

async function toggleAccountFolderMembership(accountId, folderId) {
  const normalizedFolderId = normalizeFolderId(folderId);
  if (!normalizedFolderId) return;
  if (!foldersRaw.some((item) => normalizeFolderId(item?.id) === normalizedFolderId)) {
    setStatus("目标文件夹不存在");
    return;
  }

  const next = cloneAccounts(accountsRaw);
  const target = next.find((item) => String(item?.accountId || "") === String(accountId));
  if (!target) {
    setStatus("目标账号不存在");
    return;
  }
  if (target.isDeleted) {
    setStatus("回收站账号不支持放入文件夹");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  const current = normalizeFolderIdList(extractAccountFolderIds(target));
  const exists = current.includes(normalizedFolderId);
  const nextFolderIds = exists
    ? current.filter((id) => id !== normalizedFolderId)
    : normalizeFolderIdList([...current, normalizedFolderId]);

  target.folderId = nextFolderIds[0] || null;
  target.folderIds = nextFolderIds;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;

  await setAccountsToDataStore(next);
  const folderName = folderDisplayNameById(normalizedFolderId);
  await appendHistory(
    exists
      ? `${target.accountId}：从文件夹移除 ${folderName}`
      : `${target.accountId}：放入文件夹 ${folderName}`,
    now
  );
  await refresh({ silent: true });
  setStatus(exists ? `已从文件夹移除: ${folderName}` : `已放入文件夹: ${folderName}`);
}

function renderAllAccounts(inputAccounts) {
  let accounts = sortAccountsForDisplay(
    (Array.isArray(inputAccounts) ? inputAccounts : [])
      .map(normalizeAccountShape)
      .filter((account) => !account.isDeleted)
  );
  const query = String(dom.allAccountsSearch.value || "").trim().toLowerCase();
  if (query) {
    accounts = accounts.filter((account) => isAccountMatchSearch(account, query));
  }

  dom.allAccountsCount.textContent = `(${accounts.length})`;
  dom.allAccountsList.innerHTML = "";

  if (accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无账号";
    dom.allAccountsList.appendChild(empty);
    return;
  }

  for (const account of accounts) {
    const card = document.createElement("article");
    card.className = "account";
    if (isPinnedAccount(account)) {
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
    meta.innerHTML = buildSettingsAccountMetaHtml(account);
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "account-actions";
    const totpCopyBtn = hasTotpSecret(account.totpSecret)
      ? createTotpCopyButton({
        accountId: account.accountId,
        username: account.username,
        totpSecret: account.totpSecret,
      })
      : null;

    const editBtn = document.createElement("button");
    editBtn.textContent = editingAccountId === account.accountId ? "收起编辑" : "编辑";
    editBtn.addEventListener("click", () => {
      editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
      renderAllAccounts(accountsRaw);
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "button-danger";
    deleteBtn.textContent = account.isDeleted ? "永久删除" : "删除";
    deleteBtn.addEventListener("click", async () => {
      await deleteAccountFromAll(account.accountId);
    });
    actions.appendChild(deleteBtn);

    if (totpCopyBtn) {
      actions.appendChild(totpCopyBtn);
    }

    card.appendChild(actions);

    if (editingAccountId === account.accountId) {
      card.appendChild(buildAccountEditor(account));
    }

    dom.allAccountsList.appendChild(card);
  }

  void refreshVisibleTotpButtons();
}

function renderRecycleAccounts(inputAccounts) {
  const accounts = (Array.isArray(inputAccounts) ? inputAccounts : [])
    .map(normalizeAccountShape)
    .filter((account) => account.isDeleted)
    .sort(
      (a, b) =>
        Number(b.deletedAtMs || b.updatedAtMs || 0) - Number(a.deletedAtMs || a.updatedAtMs || 0)
    );

  dom.recycleAccountsCount.textContent = `(${accounts.length})`;
  dom.recycleAccountsList.innerHTML = "";

  if (accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "回收站为空";
    dom.recycleAccountsList.appendChild(empty);
    void refreshVisibleTotpButtons();
    return;
  }

  for (const account of accounts) {
    const card = document.createElement("article");
    card.className = "account";

    const title = document.createElement("strong");
    title.textContent = account.accountId;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = buildSettingsAccountMetaHtml(account);
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "account-actions";

    const restoreBtn = document.createElement("button");
    restoreBtn.textContent = "恢复";
    restoreBtn.addEventListener("click", async () => {
      await restoreDeletedAccount(account.accountId);
    });
    actions.appendChild(restoreBtn);

    const permanentDeleteBtn = document.createElement("button");
    permanentDeleteBtn.className = "button-danger";
    permanentDeleteBtn.textContent = "永久删除";
    permanentDeleteBtn.addEventListener("click", async () => {
      await permanentlyDeleteAccount(account.accountId);
    });
    actions.appendChild(permanentDeleteBtn);

    card.appendChild(actions);

    if (hasTotpSecret(account.totpSecret)) {
      card.appendChild(
        createTotpCopyButton({
          accountId: account.accountId,
          username: account.username,
          totpSecret: account.totpSecret,
        })
      );
    }

    dom.recycleAccountsList.appendChild(card);
  }

  void refreshVisibleTotpButtons();
}

function renderSidebar(inputAccounts) {
  const accounts = (Array.isArray(inputAccounts) ? inputAccounts : []).map(normalizeAccountShape);
  const active = accounts.filter((item) => !item.isDeleted);
  const recycle = accounts.filter((item) => item.isDeleted);
  const passkeys = active.filter((item) => (item.passkeyCredentialIds || []).length > 0);
  const totp = active.filter((item) => hasTotpSecret(item.totpSecret));

  dom.allAccountsCount.textContent = `(${active.length})`;
  dom.passkeyAccountsCount.textContent = `(${passkeys.length})`;
  dom.totpAccountsCount.textContent = `(${totp.length})`;
  dom.recycleAccountsCount.textContent = `(${recycle.length})`;

  const folderCountMap = new Map();
  for (const account of active) {
    for (const id of extractAccountFolderIds(account)) {
      const key = normalizeFolderId(id);
      if (!key) continue;
      const prev = folderCountMap.get(key) || 0;
      folderCountMap.set(key, prev + 1);
    }
  }

  const folderById = new Map(foldersRaw.map((folder) => [normalizeFolderId(folder.id), folder]));
  if (!folderById.has(FIXED_NEW_ACCOUNT_FOLDER_ID)) {
    folderById.set(FIXED_NEW_ACCOUNT_FOLDER_ID, normalizeFolderShape({
      id: FIXED_NEW_ACCOUNT_FOLDER_ID,
      name: FIXED_NEW_ACCOUNT_FOLDER_NAME,
      createdAtMs: 0,
    }));
  }

  const knownFolders = sortFoldersForDisplay(Array.from(folderById.values()));
  const unknownFolderEntries = Array.from(folderCountMap.entries())
    .filter(([id]) => !folderById.has(id))
    .map(([id, count]) => ({
      id,
      name: `未命名文件夹 ${id.slice(0, 8)}`,
      createdAtMs: 0,
      count,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const folderEntries = [
    ...knownFolders.map((folder) => ({
      id: normalizeFolderId(folder.id),
      name: String(folder.name || FIXED_NEW_ACCOUNT_FOLDER_NAME),
      createdAtMs: Number(folder.createdAtMs || 0),
      count: folderCountMap.get(normalizeFolderId(folder.id)) || 0,
    })),
    ...unknownFolderEntries,
  ];

  dom.accountsFolderList.innerHTML = "";
  for (const folder of folderEntries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-view-tab";
    button.dataset.view = `folder:${folder.id}`;
    button.dataset.folderId = folder.id;
    button.textContent = `${folder.name} (${folder.count})`;
    button.addEventListener("click", () => setAccountView(`folder:${folder.id}`));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openFolderContextMenu({
        folderId: folder.id,
        x: event.clientX,
        y: event.clientY,
      });
    });
    dom.accountsFolderList.appendChild(button);
  }
}

function buildSettingsAccountMetaHtml(account) {
  const sitesMultilineHtml = toMultilineHtml((account?.sites || []).join("\n") || "-");
  const passkeyCount = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []).length;
  return (
    `用户名: ${escapeHtml(account?.username || "-")}<br/>` +
    `站点别名:<div class="meta-multiline">${sitesMultilineHtml}</div>` +
    `通行密钥: ${passkeyCount} 个<br/>`
  );
}

function currentViewAccounts(inputAccounts) {
  const accounts = (Array.isArray(inputAccounts) ? inputAccounts : []).map(normalizeAccountShape);
  const active = accounts.filter((item) => !item.isDeleted);
  const recycle = accounts.filter((item) => item.isDeleted);

  if (activeAccountView === "recycle") {
    return recycle;
  }
  if (activeAccountView === "passkeys") {
    return active.filter((item) => (item.passkeyCredentialIds || []).length > 0);
  }
  if (activeAccountView === "totp") {
    return active.filter((item) => hasTotpSecret(item.totpSecret));
  }
  if (String(activeAccountView).startsWith("folder:")) {
    const folderId = normalizeFolderId(String(activeAccountView).slice("folder:".length));
    return active.filter((item) => {
      const ids = extractAccountFolderIds(item).map(normalizeFolderId);
      return ids.includes(folderId);
    });
  }
  return active;
}

function currentVisibleAccounts(inputAccounts) {
  let accounts = currentViewAccounts(inputAccounts);
  const query = String(dom.allAccountsSearch.value || "").trim().toLowerCase();
  if (query) {
    accounts = accounts.filter((account) => isAccountMatchSearch(account, query));
  }
  return accounts;
}

function isSortModalSupportedView() {
  return activeAccountView !== "recycle";
}

function getSortableAccountsForCurrentView() {
  if (!isSortModalSupportedView()) return [];
  const visible = currentVisibleAccounts(accountsRaw).filter((account) => !account.isDeleted);
  return sortAccountsForScope(visible);
}

function openSortModal() {
  if (!isSortModalSupportedView()) {
    setStatus("回收站不支持排序");
    return;
  }
  const visibleAccounts = getSortableAccountsForCurrentView();
  if (visibleAccounts.length === 0) {
    setStatus("当前列表没有可排序账号");
    return;
  }
  sortModalOrderIds = visibleAccounts.map((account) => String(account.accountId || ""));
  sortModalDraggingAccountId = "";
  renderSortModalList();
  dom.sortModal.classList.remove("hidden");
  dom.sortModal.setAttribute("aria-hidden", "false");
}

function closeSortModal() {
  sortModalDraggingAccountId = "";
  sortModalOrderIds = [];
  dom.sortModal.classList.add("hidden");
  dom.sortModal.setAttribute("aria-hidden", "true");
  dom.sortModalList.innerHTML = "";
}

async function openHistoryModal() {
  await loadHistory();
  renderHistoryModalList();
  dom.historyModal.classList.remove("hidden");
  dom.historyModal.setAttribute("aria-hidden", "false");
}

function closeHistoryModal() {
  dom.historyModal.classList.add("hidden");
  dom.historyModal.setAttribute("aria-hidden", "true");
  dom.historyModalList.innerHTML = "";
}

function renderHistoryModalList() {
  dom.historyModalList.innerHTML = "";
  if (historyEntries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无历史记录";
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

function renderSortModalList() {
  dom.sortModalList.innerHTML = "";
  const accountById = new Map(
    accountsRaw
      .map(normalizeAccountShape)
      .filter((account) => !account.isDeleted)
      .map((account) => [String(account.accountId || ""), account])
  );
  const normalizedOrder = sortModalOrderIds
    .map((accountId) => String(accountId || ""))
    .filter((accountId) => accountById.has(accountId));
  sortModalOrderIds = normalizedOrder;

  if (normalizedOrder.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "当前列表没有可排序账号";
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
    const pinned = isPinnedAccount(account);
    pinBtn.textContent = pinned ? "取消置顶" : "置顶";
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
        setStatus("仅支持置顶项之间、非置顶项之间排序");
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
  return isPinnedInCurrentScope(source) === isPinnedInCurrentScope(target);
}

function formatSortableAccountLabel(account) {
  const site = etldPlusOne(account?.canonicalSite || account?.sites?.[0] || "") || "-";
  const createdText = formatYYMMDDHHmmss(Number(account?.createdAtMs || 0));
  const username = String(account?.username || "");
  return `${site}-${createdText}-${username}`;
}

async function persistSortOrderFromModal(orderedIds) {
  const normalizedOrderedIds = [...new Set((Array.isArray(orderedIds) ? orderedIds : [])
    .map((value) => String(value || ""))
    .filter(Boolean))];
  if (normalizedOrderedIds.length === 0) return;

  const next = cloneAccounts(accountsRaw).map(normalizeAccountShape);
  const scopeKey = getActivePinScopeKey();
  const now = Date.now();
  const deviceName = await getDeviceName();
  let changed = false;

  const pinnedSubset = [];
  const regularSubset = [];
  for (const accountId of normalizedOrderedIds) {
    const target = next.find((item) => String(item.accountId || "") === accountId);
    if (!target || target.isDeleted) continue;
    if (getPinnedViewState(target, scopeKey).pinned) {
      pinnedSubset.push(accountId);
    } else {
      regularSubset.push(accountId);
    }
  }

  const visibleIds = new Set(
    currentVisibleAccounts(next)
      .filter((item) => !item.isDeleted)
      .map((item) => String(item.accountId || ""))
  );
  const allPinnedIds = sortAccountsForScope(
    next.filter((item) => !item.isDeleted && visibleIds.has(String(item.accountId || "")) && getPinnedViewState(item, scopeKey).pinned),
    scopeKey
  ).map((item) => String(item.accountId || ""));
  const allRegularIds = sortAccountsForScope(
    next.filter((item) => !item.isDeleted && visibleIds.has(String(item.accountId || "")) && !getPinnedViewState(item, scopeKey).pinned),
    scopeKey
  ).map((item) => String(item.accountId || ""));

  const mergedPinnedIds = buildMergedOrderIds(allPinnedIds, pinnedSubset);
  const mergedRegularIds = buildMergedOrderIds(allRegularIds, regularSubset);

  for (let i = 0; i < mergedPinnedIds.length; i += 1) {
    const id = mergedPinnedIds[i];
    const item = next.find((entry) => String(entry.accountId || "") === id);
    if (!item) continue;
    item.pinnedViews = normalizePinnedViewsMap(item.pinnedViews, item);
    const currentState = getPinnedViewState(item, scopeKey);
    const currentOrder = currentState.pinnedSortOrder == null ? null : Number(currentState.pinnedSortOrder);
    if (currentOrder === i) continue;
    item.pinnedViews[scopeKey] = {
      ...currentState,
      pinned: true,
      pinnedSortOrder: i,
    };
    item.updatedAtMs = now;
    item.lastOperatedDeviceName = deviceName;
    changed = true;
  }

  for (let i = 0; i < mergedRegularIds.length; i += 1) {
    const id = mergedRegularIds[i];
    const item = next.find((entry) => String(entry.accountId || "") === id);
    if (!item) continue;
    item.pinnedViews = normalizePinnedViewsMap(item.pinnedViews, item);
    const currentState = getPinnedViewState(item, scopeKey);
    const currentOrder = currentState.regularSortOrder == null ? null : Number(currentState.regularSortOrder);
    if (currentOrder === i) continue;
    item.pinnedViews[scopeKey] = {
      ...currentState,
      regularSortOrder: i,
    };
    item.updatedAtMs = now;
    item.lastOperatedDeviceName = deviceName;
    changed = true;
  }

  if (!changed) return;
  accountsRaw = cloneAccounts(next);
  await setAccountsToDataStore(next);
  dom.payload.value = JSON.stringify(
    { accounts: accountsRaw, passkeys: passkeysRaw, folders: foldersRaw },
    null,
    2
  );
  renderSidebar(accountsRaw);
  renderCurrentView(accountsRaw);
}

function buildMergedOrderIds(allIds, subsetIds) {
  const fullOrder = (Array.isArray(allIds) ? allIds : [])
    .map((value) => String(value || ""))
    .filter(Boolean);
  const fullSet = new Set(fullOrder);
  const requestedSubset = (Array.isArray(subsetIds) ? subsetIds : [])
    .map((value) => String(value || ""))
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
    .filter((value) => fullSet.has(value));
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

function renderCurrentView(inputAccounts) {
  let accounts = sortAccountsForScope(currentVisibleAccounts(inputAccounts));

  dom.allAccountsList.innerHTML = "";
  if (accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无账号";
    dom.allAccountsList.appendChild(empty);
    return;
  }

  const isRecycle = activeAccountView === "recycle";
  for (const account of accounts) {
    const card = document.createElement("article");
    card.className = "account";
    if (!isRecycle && isPinnedInCurrentScope(account)) {
      card.classList.add("account-pinned");
    }
    card.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openAccountContextMenu({
        account,
        x: event.clientX,
        y: event.clientY,
      });
    });

    const titleRow = document.createElement("div");
    titleRow.className = "account-title-row";
    const title = document.createElement("strong");
    title.textContent = account.accountId;
    titleRow.appendChild(title);
    card.appendChild(titleRow);

    const meta = document.createElement("div");
    meta.className = "meta";
    const sitesMultilineHtml = toMultilineHtml(account.sites.join("\n"));
    meta.innerHTML =
      `用户名: ${escapeHtml(account.username || "-")}<br/>` +
      `站点别名:<div class="meta-multiline">${sitesMultilineHtml}</div>` +
      `通行密钥: ${account.passkeyCredentialIds.length} 个<br/>`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "account-actions";
    const totpCopyBtn = hasTotpSecret(account.totpSecret)
      ? createTotpCopyButton({
        accountId: account.accountId,
        username: account.username,
        totpSecret: account.totpSecret,
      })
      : null;

    if (!isRecycle) {
      const editBtn = document.createElement("button");
      editBtn.textContent = editingAccountId === account.accountId ? "收起编辑" : "编辑";
      editBtn.addEventListener("click", () => {
        editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
        renderCurrentView(accountsRaw);
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "button-danger";
      deleteBtn.textContent = "删除";
      deleteBtn.addEventListener("click", async () => {
        await deleteAccountFromAll(account.accountId);
      });
      actions.appendChild(deleteBtn);
      if (totpCopyBtn) actions.appendChild(totpCopyBtn);
      card.appendChild(actions);

      if (editingAccountId === account.accountId) {
        card.appendChild(buildAccountEditor(account));
      }
    } else {
      const restoreBtn = document.createElement("button");
      restoreBtn.textContent = "恢复";
      restoreBtn.addEventListener("click", async () => {
        await restoreDeletedAccount(account.accountId);
      });
      actions.appendChild(restoreBtn);

      const permanentDeleteBtn = document.createElement("button");
      permanentDeleteBtn.className = "button-danger";
      permanentDeleteBtn.textContent = "永久删除";
      permanentDeleteBtn.addEventListener("click", async () => {
        await permanentlyDeleteAccount(account.accountId);
      });
      actions.appendChild(permanentDeleteBtn);
      if (totpCopyBtn) actions.appendChild(totpCopyBtn);
      card.appendChild(actions);
    }

    dom.allAccountsList.appendChild(card);
  }

  void refreshVisibleTotpButtons();
}

function setAccountView(nextView) {
  closeContextMenu();
  activeAccountView = String(nextView || "all");
  const isRecycle = activeAccountView === "recycle";

  dom.accountsTabAll.classList.toggle("is-active", activeAccountView === "all");
  dom.accountsTabPasskey.classList.toggle("is-active", activeAccountView === "passkeys");
  dom.accountsTabTotp.classList.toggle("is-active", activeAccountView === "totp");
  dom.accountsTabRecycle.classList.toggle("is-active", isRecycle);
  const folderButtons = dom.accountsFolderList.querySelectorAll(".account-view-tab[data-view]");
  folderButtons.forEach((button) => {
    const matched = button.getAttribute("data-view") === activeAccountView;
    button.classList.toggle("is-active", matched);
  });

  dom.clearActiveAccountsBtn.classList.toggle("hidden", isRecycle);
  dom.clearRecycleBinBtn.classList.toggle("hidden", !isRecycle);
  dom.openSortModalBtn.classList.toggle("hidden", isRecycle);

  if (isRecycle) {
    closeAllAccountsSearchFieldsPanel();
    closeSortModal();
  }

  renderCurrentView(accountsRaw);
}

function closeContextMenuIfNeeded(event) {
  if (!contextMenuElement) return;
  if (contextMenuElement.contains(event.target)) return;
  closeContextMenu();
}

function closeContextMenu() {
  if (contextMenuElement) {
    contextMenuElement.remove();
    contextMenuElement = null;
  }
  if (contextMenuOutsideHandler) {
    window.removeEventListener("mousedown", contextMenuOutsideHandler, true);
    contextMenuOutsideHandler = null;
  }
  if (contextMenuEscapeHandler) {
    window.removeEventListener("keydown", contextMenuEscapeHandler, true);
    contextMenuEscapeHandler = null;
  }
}

function openContextMenu({ x, y, items }) {
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";

  for (const item of items) {
    if (item.type === "separator") {
      const separator = document.createElement("div");
      separator.className = "context-menu-separator";
      menu.appendChild(separator);
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-menu-item";
    if (item.danger) {
      button.classList.add("context-danger");
    }
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (button.disabled) return;
      closeContextMenu();
      await item.onSelect?.();
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  contextMenuElement = menu;

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const rect = menu.getBoundingClientRect();
  const maxLeft = Math.max(8, viewportWidth - rect.width - 8);
  const maxTop = Math.max(8, viewportHeight - rect.height - 8);
  menu.style.left = `${Math.min(Math.max(8, x), maxLeft)}px`;
  menu.style.top = `${Math.min(Math.max(8, y), maxTop)}px`;

  contextMenuOutsideHandler = (event) => {
    if (!menu.contains(event.target)) {
      closeContextMenu();
    }
  };
  contextMenuEscapeHandler = (event) => {
    if (event.key === "Escape") {
      closeContextMenu();
    }
  };
  window.addEventListener("mousedown", contextMenuOutsideHandler, true);
  window.addEventListener("keydown", contextMenuEscapeHandler, true);
}

function openAccountContextMenu({ account, x, y }) {
  if (!account) return;

  if (account.isDeleted) {
    openContextMenu({
      x,
      y,
      items: [
        {
          label: "恢复账号",
          onSelect: async () => restoreDeletedAccount(account.accountId),
        },
        {
          label: "永久删除",
          danger: true,
          onSelect: async () => permanentlyDeleteAccount(account.accountId),
        },
      ],
    });
    return;
  }

  openContextMenu({
    x,
    y,
    items: [
      {
        label: isPinnedInCurrentScope(account) ? "取消置顶" : "置顶",
        onSelect: async () => togglePin(account.accountId),
      },
      { type: "separator" },
      {
        label: "编辑",
        onSelect: async () => {
          editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
          renderCurrentView(accountsRaw);
        },
      },
      { type: "separator" },
      {
        label: "放入文件夹",
        disabled: foldersRaw.length === 0,
        onSelect: async () => openAccountFolderContextMenu(account, { x: x + 16, y: y + 12 }),
      },
      { type: "separator" },
      {
        label: "删除",
        danger: true,
        onSelect: async () => deleteAccountFromAll(account.accountId),
      },
    ],
  });
}

function openFolderContextMenu({ folderId, x, y }) {
  const normalizedFolderId = normalizeFolderId(folderId);
  const folder = foldersRaw.find((item) => normalizeFolderId(item?.id) === normalizedFolderId);
  if (!folder) return;

  if (normalizedFolderId === FIXED_NEW_ACCOUNT_FOLDER_ID) {
    openContextMenu({
      x,
      y,
      items: [
        {
          label: "指定网站全部账号",
          onSelect: async () => openAddSitesToFolderModal(normalizedFolderId),
        },
        { type: "separator" },
        {
          label: "固定文件夹不可删除",
          disabled: true,
          onSelect: async () => {},
        },
      ],
    });
    return;
  }

  openContextMenu({
    x,
    y,
    items: [
      {
        label: "指定网站全部账号",
        onSelect: async () => openAddSitesToFolderModal(normalizedFolderId),
      },
      { type: "separator" },
      {
        label: "删除文件夹",
        danger: true,
        onSelect: async () => deleteFolder(normalizedFolderId),
      },
    ],
  });
}

function openAddSitesToFolderModal(folderId) {
  addSitesTargetFolderId = normalizeFolderId(folderId);
  const folder = foldersRaw.find((item) => normalizeFolderId(item?.id) === addSitesTargetFolderId);
  dom.addSitesToFolderInput.value = Array.isArray(folder?.matchedSites) ? folder.matchedSites.join("\n") : "";
  dom.addSitesToFolderAutoAdd.checked = Boolean(folder?.autoAddMatchingSites);
  dom.addSitesToFolderModal.classList.remove("hidden");
  dom.addSitesToFolderModal.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    dom.addSitesToFolderInput.focus();
  }, 0);
}

function closeAddSitesToFolderModal() {
  addSitesTargetFolderId = null;
  dom.addSitesToFolderInput.value = "";
  dom.addSitesToFolderAutoAdd.checked = true;
  dom.addSitesToFolderModal.classList.add("hidden");
  dom.addSitesToFolderModal.setAttribute("aria-hidden", "true");
}

async function addAccountsMatchingSitesToFolderFromModal() {
  const folderId = normalizeFolderId(addSitesTargetFolderId);
  if (!folderId) {
    closeAddSitesToFolderModal();
    setStatus("目标文件夹不存在");
    return;
  }
  const sites = parseSites(dom.addSitesToFolderInput.value || "");
  const autoAddMatchingSites = Boolean(dom.addSitesToFolderAutoAdd.checked);

  const targetIds = accountsRaw
    .map(normalizeAccountShape)
    .filter((account) => !account.isDeleted)
    .filter((account) => {
      const aliases = new Set(account.sites.map(normalizeDomain).filter(Boolean));
      const canonical = normalizeDomain(account.canonicalSite || "");
      return sites.some((site) => aliases.has(site) || canonical === site);
    })
    .map((account) => account.accountId);

  const next = cloneAccounts(accountsRaw).map(normalizeAccountShape);
  const nextFolders = foldersRaw.map((item) => {
    const folder = normalizeFolderShape(item);
    if (normalizeFolderId(folder.id) !== folderId) return folder;
    return {
      ...folder,
      matchedSites: sites,
      autoAddMatchingSites,
      updatedAtMs: Date.now(),
    };
  });
  const now = Date.now();
  const deviceName = await getDeviceName();
  let changedCount = 0;

  for (const accountId of targetIds) {
    const target = next.find((item) => String(item.accountId || "") === String(accountId));
    if (!target || target.isDeleted) continue;
    const currentFolderIds = normalizeFolderIdList(extractAccountFolderIds(target));
    if (currentFolderIds.includes(folderId)) continue;
    const nextFolderIds = normalizeFolderIdList([...currentFolderIds, folderId]);
    target.folderId = nextFolderIds[0] || null;
    target.folderIds = nextFolderIds;
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    changedCount += 1;
  }

  closeAddSitesToFolderModal();
  accountsRaw = cloneAccounts(next);
  foldersRaw = sortFoldersForDisplay(withFixedFolder(nextFolders));
  await writeBusinessDataToStore({ accounts: next, passkeys: passkeysRaw, folders: nextFolders });
  await appendHistory(
    `更新文件夹站点规则：${folderDisplayNameById(folderId)}（${sites.length} 个站点，自动加入${autoAddMatchingSites ? "开" : "关"}）`,
    now
  );
  if (changedCount > 0) {
    await appendHistory(`按站点批量加入文件夹：${folderDisplayNameById(folderId)}（${changedCount} 个账号）`, now);
  }
  await refresh({ silent: true });
  setStatus(
    changedCount > 0
      ? `已保存规则，并将 ${changedCount} 个账号加入文件夹: ${folderDisplayNameById(folderId)}`
      : `已保存文件夹站点规则: ${folderDisplayNameById(folderId)}`
  );
}


function openAccountFolderContextMenu(account, position) {
  const normalizedAccount = normalizeAccountShape(account);
  const checked = new Set(
    normalizeFolderIdList(extractAccountFolderIds(normalizedAccount))
  );
  const folders = sortFoldersForDisplay(foldersRaw.map(normalizeFolderShape));
  if (folders.length === 0) {
    setStatus("请先创建文件夹");
    return;
  }

  openContextMenu({
    x: position?.x ?? 100,
    y: position?.y ?? 100,
    items: folders.map((folder) => {
      const id = normalizeFolderId(folder.id);
      const isChecked = checked.has(id);
      return {
        label: `${isChecked ? "☑" : "☐"} ${folder.name}`,
        onSelect: async () => {
          await toggleAccountFolderMembership(normalizedAccount.accountId, id);
        },
      };
    }),
  });
}

function applyAutoFolderRulesToAccount(account, folders = foldersRaw) {
  if (!account || account.isDeleted) return account;
  const accountSites = new Set(
    normalizeSites([...(account.sites || []), account.canonicalSite || ""]).filter(Boolean)
  );
  if (accountSites.size === 0) return account;
  const matchedFolderIds = (Array.isArray(folders) ? folders : [])
    .map(normalizeFolderShape)
    .filter((folder) => folder.autoAddMatchingSites)
    .filter((folder) => folder.matchedSites.some((site) => accountSites.has(site)))
    .map((folder) => normalizeFolderId(folder.id))
    .filter(Boolean);
  if (matchedFolderIds.length === 0) return account;
  const nextFolderIds = normalizeFolderIdList([
    ...extractAccountFolderIds(account),
    ...matchedFolderIds,
  ]);
  return {
    ...account,
    folderId: nextFolderIds[0] || null,
    folderIds: nextFolderIds,
  };
}

function getActivePinScopeKey() {
  return String(activeAccountView || "all");
}

function getPinScopeLabel(scopeKey = getActivePinScopeKey()) {
  if (scopeKey === "all") return "全部";
  if (scopeKey === "passkeys") return "通行密钥";
  if (scopeKey === "totp") return "验证码";
  if (scopeKey === "recycle") return "回收站";
  if (String(scopeKey).startsWith("folder:")) {
    const folderId = normalizeFolderId(String(scopeKey).slice("folder:".length));
    return folderDisplayNameById(folderId);
  }
  return String(scopeKey);
}

function normalizePinnedViewsMap(input, legacyAccount = null) {
  const result = {};
  const source = input && typeof input === "object" ? input : {};
  for (const [scopeKey, rawValue] of Object.entries(source)) {
    const normalizedScopeKey = String(scopeKey || "").trim();
    if (!normalizedScopeKey || !rawValue || typeof rawValue !== "object") continue;
    const pinned = Boolean(rawValue.pinned);
    const pinnedSortOrder = rawValue.pinnedSortOrder == null ? null : Number(rawValue.pinnedSortOrder);
    const regularSortOrder = rawValue.regularSortOrder == null ? null : Number(rawValue.regularSortOrder);
    result[normalizedScopeKey] = {
      pinned,
      pinnedSortOrder: Number.isFinite(pinnedSortOrder) ? pinnedSortOrder : null,
      regularSortOrder: Number.isFinite(regularSortOrder) ? regularSortOrder : null,
    };
  }

  if (legacyAccount && !result.all) {
    result.all = {
      pinned: Boolean(legacyAccount?.isPinned),
      pinnedSortOrder: legacyAccount?.pinnedSortOrder == null ? null : Number(legacyAccount.pinnedSortOrder),
      regularSortOrder: legacyAccount?.regularSortOrder == null ? null : Number(legacyAccount.regularSortOrder),
    };
  }

  return result;
}

function getPinnedViewState(account, scopeKey = getActivePinScopeKey()) {
  const pinnedViews = normalizePinnedViewsMap(account?.pinnedViews, account);
  return pinnedViews[scopeKey] || {
    pinned: false,
    pinnedSortOrder: null,
    regularSortOrder: null,
  };
}

function isPinnedInCurrentScope(account) {
  return Boolean(getPinnedViewState(account).pinned);
}

function isPinnedAccount(account) {
  return isPinnedInCurrentScope(account);
}

function compareAccountsForScope(lhs, rhs, scopeKey = getActivePinScopeKey()) {
  const lhsState = getPinnedViewState(lhs, scopeKey);
  const rhsState = getPinnedViewState(rhs, scopeKey);
  if (lhsState.pinned !== rhsState.pinned) {
    return lhsState.pinned ? -1 : 1;
  }

  const lhsUpdatedAt = Number(lhs?.updatedAtMs || 0);
  const rhsUpdatedAt = Number(rhs?.updatedAtMs || 0);
  if (lhsUpdatedAt !== rhsUpdatedAt) return rhsUpdatedAt - lhsUpdatedAt;

  if (lhsState.pinned && rhsState.pinned) {
    if (lhsState.pinnedSortOrder != null && rhsState.pinnedSortOrder != null && lhsState.pinnedSortOrder !== rhsState.pinnedSortOrder) {
      return lhsState.pinnedSortOrder - rhsState.pinnedSortOrder;
    }
    if (lhsState.pinnedSortOrder != null && rhsState.pinnedSortOrder == null) return -1;
    if (lhsState.pinnedSortOrder == null && rhsState.pinnedSortOrder != null) return 1;
  } else {
    if (lhsState.regularSortOrder != null && rhsState.regularSortOrder != null && lhsState.regularSortOrder !== rhsState.regularSortOrder) {
      return lhsState.regularSortOrder - rhsState.regularSortOrder;
    }
    if (lhsState.regularSortOrder != null && rhsState.regularSortOrder == null) return -1;
    if (lhsState.regularSortOrder == null && rhsState.regularSortOrder != null) return 1;
  }

  const lhsCreatedAt = Number(lhs?.createdAtMs || 0);
  const rhsCreatedAt = Number(rhs?.createdAtMs || 0);
  if (lhsCreatedAt !== rhsCreatedAt) return rhsCreatedAt - lhsCreatedAt;
  return String(lhs?.accountId || "").localeCompare(String(rhs?.accountId || ""));
}

function sortAccountsForScope(inputAccounts, scopeKey = getActivePinScopeKey()) {
  return [...(Array.isArray(inputAccounts) ? inputAccounts : [])].sort((lhs, rhs) =>
    compareAccountsForScope(lhs, rhs, scopeKey)
  );
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
    haystacks.push(account.sites.join(" "), account.canonicalSite);
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

function closeAllAccountsSearchFieldsPanel() {
  dom.allAccountsSearchFieldsPanel.classList.add("hidden");
}

function isMultilineInputTarget(target) {
  return target instanceof HTMLTextAreaElement || target?.isContentEditable;
}

function findDefaultActionButtonForOptions(target) {
  if (!dom.addSitesToFolderModal.classList.contains("hidden")) {
    return dom.confirmAddSitesToFolderBtn;
  }
  return null;
}

function onAllAccountSearchFieldAllChanged() {
  if (dom.allAccountsSearchFieldAll.checked) {
    accountSearchUseAll = true;
    accountSearchFields = new Set();
  } else {
    accountSearchUseAll = false;
  }
  syncAllAccountSearchFieldCheckboxes();
  renderCurrentView(accountsRaw);
}

function onAllAccountSearchFieldChanged() {
  const next = new Set();
  if (dom.allAccountsSearchFieldUsername.checked) next.add("username");
  if (dom.allAccountsSearchFieldSites.checked) next.add("sites");
  if (dom.allAccountsSearchFieldNote.checked) next.add("note");
  if (dom.allAccountsSearchFieldPassword.checked) next.add("password");
  accountSearchUseAll = false;
  accountSearchFields = next;
  syncAllAccountSearchFieldCheckboxes();
  renderCurrentView(accountsRaw);
}

function syncAllAccountSearchFieldCheckboxes() {
  dom.allAccountsSearchFieldUsername.checked = accountSearchFields.has("username");
  dom.allAccountsSearchFieldSites.checked = accountSearchFields.has("sites");
  dom.allAccountsSearchFieldNote.checked = accountSearchFields.has("note");
  dom.allAccountsSearchFieldPassword.checked = accountSearchFields.has("password");
  dom.allAccountsSearchFieldAll.checked = accountSearchUseAll;
}

function buildAccountEditor(account) {
  const editor = document.createElement("div");
  editor.className = "editor";

  const sitesInput = createEditorTextarea(editor, "站点别名（每行一个）", account.sites.join("\n"), {
    className: "editor-textarea editor-textarea-sites",
  });
  const usernameInput = createEditorField(editor, "用户名", account.username);
  const passwordInput = createEditorField(editor, "密码", account.password);
  const totpInput = createEditorField(editor, "TOTP", account.totpSecret || "");
  appendTotpImportActions(editor, {
    totpInput,
    sitesInput,
    usernameInput,
  });
  const recoveryInput = createEditorTextarea(editor, "恢复码（每行一个）", account.recoveryCodes || "", {
    className: "editor-textarea editor-textarea-recovery",
  });
  const noteInput = createEditorTextarea(editor, "备注", account.note || "", {
    className: "editor-textarea",
  });

  const details = document.createElement("div");
  details.className = "meta";
  details.innerHTML =
    `创建: ${formatTime(account.createdAtMs)} | 更新: ${formatTime(account.updatedAtMs)}<br/>` +
    `最后操作设备: ${String(account.lastOperatedDeviceName || "").trim() || "-"}<br/>` +
    `删除: ${formatTime(account.deletedAtMs)}<br/>` +
    `用户名：${formatTime(account.usernameUpdatedAtMs)} | ${String(account.usernameUpdatedDeviceName || "").trim() || "-"}<br/>` +
    `密码：${formatTime(account.passwordUpdatedAtMs)} | ${String(account.passwordUpdatedDeviceName || "").trim() || "-"}<br/>` +
    `TOTP：${formatTime(account.totpUpdatedAtMs)} | ${String(account.totpUpdatedDeviceName || "").trim() || "-"}<br/>` +
    `恢复码：${formatTime(account.recoveryCodesUpdatedAtMs)} | ${String(account.recoveryCodesUpdatedDeviceName || "").trim() || "-"}<br/>` +
    `备注：${formatTime(account.noteUpdatedAtMs)} | ${String(account.noteUpdatedDeviceName || "").trim() || "-"}<br/>` +
    `通行密钥：${formatTime(account.passkeyUpdatedAtMs)} | ${String(account.passkeyUpdatedDeviceName || "").trim() || "-"}<br/>`;
  editor.appendChild(details);

  const actions = document.createElement("div");
  actions.className = "account-actions";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "保存编辑";
  saveBtn.addEventListener("click", async () => {
    await saveAccountEdit(account.accountId, {
      sitesText: sitesInput.value,
      username: usernameInput.value,
      password: passwordInput.value,
      totpSecret: totpInput.value,
      recoveryCodes: recoveryInput.value,
      note: noteInput.value,
    });
  });
  actions.appendChild(saveBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", () => {
    editingAccountId = null;
    renderCurrentView(accountsRaw);
  });
  actions.appendChild(cancelBtn);

  editor.appendChild(actions);
  return editor;
}

async function saveAccountEdit(accountId, draft) {
  const next = cloneAccounts(accountsRaw);
  const target = next.find((item) => String(item.accountId || "") === String(accountId));
  if (!target) {
    setStatus("未找到编辑账号");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  let changed = false;
  const historyMessages = [];

  const nextSites = parseSites(draft.sitesText);
  const prevSites = normalizeSites(target.sites || []);
  if (nextSites.length > 0 && JSON.stringify(nextSites) !== JSON.stringify(prevSites)) {
    target.sites = nextSites;
    changed = true;
    historyMessages.push(`站点别名改为${historyValueSnippet(nextSites.join(", "))}`);
  }

  const nextUsername = normalizeUsername(draft.username);
  if (nextUsername && nextUsername !== String(target.username || "")) {
    target.username = nextUsername;
    target.usernameUpdatedAtMs = now;
    target.usernameUpdatedDeviceName = deviceName;
    changed = true;
    historyMessages.push(`用户名改为${historyValueSnippet(nextUsername)}`);
  }

  if (String(draft.password || "") !== String(target.password || "")) {
    target.password = String(draft.password || "");
    target.passwordUpdatedAtMs = now;
    target.passwordUpdatedDeviceName = deviceName;
    changed = true;
    historyMessages.push(`密码改为${historyValueSnippet(draft.password)}`);
  }

  const nextTotpSecret = normalizeTotpSecret(String(draft.totpSecret || ""));
  if (nextTotpSecret && !isValidTotpSecret(nextTotpSecret)) {
    setStatus("TOTP 密钥无效，请检查后再保存");
    return;
  }

  if (nextTotpSecret !== normalizeTotpSecret(String(target.totpSecret || ""))) {
    target.totpSecret = nextTotpSecret;
    target.totpUpdatedAtMs = now;
    target.totpUpdatedDeviceName = deviceName;
    changed = true;
    historyMessages.push(`TOTP 改为${historyValueSnippet(nextTotpSecret)}`);
  }

  if (String(draft.recoveryCodes || "") !== String(target.recoveryCodes || "")) {
    target.recoveryCodes = String(draft.recoveryCodes || "");
    target.recoveryCodesUpdatedAtMs = now;
    target.recoveryCodesUpdatedDeviceName = deviceName;
    changed = true;
    historyMessages.push(`恢复码改为${historyValueSnippet(draft.recoveryCodes)}`);
  }

  if (String(draft.note || "") !== String(target.note || "")) {
    target.note = String(draft.note || "");
    target.noteUpdatedAtMs = now;
    target.noteUpdatedDeviceName = deviceName;
    changed = true;
    historyMessages.push(`备注改为${historyValueSnippet(draft.note)}`);
  }

  if (!changed) {
    setStatus("没有可保存的变更");
    return;
  }

  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  const withAutoFolders = next.map((item) =>
    item === target ? applyAutoFolderRulesToAccount(item) : item
  );

  const synced = syncAliasGroups(withAutoFolders);
  await setAccountsToDataStore(synced);
  for (const message of historyMessages) {
    await appendHistory(`${target.accountId}：${message}`, now);
  }
  editingAccountId = null;
  await refresh({ silent: true });
  setStatus("账号编辑已保存");
}

async function deleteAccountFromAll(accountId) {
  const next = cloneAccounts(accountsRaw);
  const index = next.findIndex((item) => String(item.accountId || "") === String(accountId));
  if (index < 0) {
    setStatus("未找到目标账号");
    return;
  }

  const target = next[index];
  if (target.isDeleted) {
    next.splice(index, 1);
    if (editingAccountId === target.accountId) {
      editingAccountId = null;
    }
    await setAccountsToDataStore(next);
    await appendHistory(`${target.accountId}：永久删除`);
    await refresh({ silent: true });
    setStatus(`已永久删除账号: ${target.accountId}`);
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  target.isDeleted = true;
  target.deletedAtMs = now;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  if (editingAccountId === target.accountId) {
    editingAccountId = null;
  }
  await setAccountsToDataStore(next);
  await appendHistory(`${target.accountId}：移入回收站`, now);
  await refresh({ silent: true });
  setStatus(`已移入回收站: ${target.accountId}`);
}

async function restoreDeletedAccount(accountId) {
  const next = cloneAccounts(accountsRaw);
  const target = next.find((item) => String(item.accountId || "") === String(accountId));
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }
  if (!target.isDeleted) {
    setStatus("该账号不在回收站");
    return;
  }

  const confirmed = window.confirm(`将恢复账号：${target.accountId}\n是否继续？`);
  if (!confirmed) return;

  const now = Date.now();
  const deviceName = await getDeviceName();
  target.isDeleted = false;
  target.deletedAtMs = null;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  if (editingAccountId === target.accountId) {
    editingAccountId = null;
  }

  await setAccountsToDataStore(next);
  await appendHistory(`${target.accountId}：从回收站恢复`, now);
  await refresh({ silent: true });
  setStatus(`已恢复账号: ${target.accountId}`);
}

async function permanentlyDeleteAccount(accountId) {
  const next = cloneAccounts(accountsRaw);
  const index = next.findIndex((item) => String(item.accountId || "") === String(accountId));
  if (index < 0) {
    setStatus("未找到目标账号");
    return;
  }

  const target = next[index];
  if (!target.isDeleted) {
    setStatus("仅支持在回收站中永久删除");
    return;
  }

  next.splice(index, 1);
  if (editingAccountId === target.accountId) {
    editingAccountId = null;
  }

  await setAccountsToDataStore(next);
  await appendHistory(`${target.accountId}：永久删除`);
  await refresh({ silent: true });
  setStatus(`已永久删除账号: ${target.accountId}`);
}

async function togglePin(accountId, { fromSortModal = false } = {}) {
  const next = cloneAccounts(accountsRaw);
  const target = next.find((item) => String(item.accountId || "") === String(accountId));
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }
  if (target.isDeleted) {
    setStatus("回收站账号不支持置顶");
    return;
  }

  const scopeKey = getActivePinScopeKey();
  const scopeLabel = getPinScopeLabel(scopeKey);
  const now = Date.now();
  const deviceName = await getDeviceName();
  target.pinnedViews = normalizePinnedViewsMap(target.pinnedViews, target);
  const currentState = getPinnedViewState(target, scopeKey);
  const nextPinned = !currentState.pinned;
  if (nextPinned) {
    const maxOrder = next
      .filter((item) => !item.isDeleted && getPinnedViewState(item, scopeKey).pinned)
      .reduce((maxValue, item) => Math.max(maxValue, Number(getPinnedViewState(item, scopeKey).pinnedSortOrder ?? -1)), -1);
    target.pinnedViews[scopeKey] = {
      ...currentState,
      pinned: true,
      pinnedSortOrder: maxOrder + 1,
    };
  } else {
    target.pinnedViews[scopeKey] = {
      ...currentState,
      pinned: false,
      pinnedSortOrder: null,
      regularSortOrder: null,
    };
  }
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;

  await setAccountsToDataStore(next);
  await appendHistory(
    nextPinned ? `${target.accountId}：在${scopeLabel}置顶` : `${target.accountId}：取消${scopeLabel}置顶`,
    now
  );
  await refresh({ silent: true });
  setStatus(
    nextPinned
      ? `账号已在${scopeLabel}置顶: ${target.accountId}`
      : `已取消${scopeLabel}置顶: ${target.accountId}`
  );
  if (fromSortModal && !dom.sortModal.classList.contains("hidden")) {
    sortModalOrderIds = getSortableAccountsForCurrentView().map((account) => String(account.accountId || ""));
    renderSortModalList();
  }
}

function appendTotpImportActions(parent, { totpInput, sitesInput, usernameInput }) {
  const wrap = document.createElement("div");
  wrap.className = "editor-row editor-row-multiline totp-import-row";

  const label = document.createElement("span");
  label.textContent = "TOTP导入";
  wrap.appendChild(label);

  const actions = document.createElement("div");
  actions.className = "totp-import-actions";
  wrap.appendChild(actions);

  const rawBtn = document.createElement("button");
  rawBtn.type = "button";
  rawBtn.textContent = "粘贴原始密钥";
  rawBtn.addEventListener("click", () => {
    void pasteRawTotpSecretFromClipboard({
      totpInput,
    });
  });
  actions.appendChild(rawBtn);

  const uriBtn = document.createElement("button");
  uriBtn.type = "button";
  uriBtn.textContent = "粘贴 otpauth URI";
  uriBtn.addEventListener("click", () => {
    void pasteOtpAuthUriFromClipboard({
      totpInput,
      sitesInput,
      usernameInput,
    });
  });
  actions.appendChild(uriBtn);

  const qrBtn = document.createElement("button");
  qrBtn.type = "button";
  qrBtn.textContent = "识别剪贴板二维码";
  qrBtn.addEventListener("click", () => {
    void pasteOtpAuthQrFromClipboard({
      totpInput,
      sitesInput,
      usernameInput,
    });
  });
  actions.appendChild(qrBtn);

  parent.appendChild(wrap);
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

function cloneAccounts(inputAccounts) {
  const values = Array.isArray(inputAccounts) ? inputAccounts : [];
  return values.map((account) => ({
    ...account,
    folderIds: Array.isArray(account?.folderIds) ? [...account.folderIds] : [],
    sites: Array.isArray(account?.sites) ? [...account.sites] : [],
    passkeyCredentialIds: Array.isArray(account?.passkeyCredentialIds)
      ? [...account.passkeyCredentialIds]
      : [],
    pinnedViews: normalizePinnedViewsMap(account?.pinnedViews, account),
  }));
}

async function getDeviceName() {
  const result = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  const value = String(result[STORAGE_KEY_DEVICE_NAME] || "").trim();
  return value || "ChromeMac";
}

async function getOrCreateSyncDeviceId() {
  const result = await chrome.storage.local.get([STORAGE_KEY_SYNC_DEVICE_ID]);
  const existing = String(result[STORAGE_KEY_SYNC_DEVICE_ID] || "").trim().toLowerCase();
  if (existing) return existing;

  const generated = String(
    globalThis.crypto?.randomUUID?.() || stableUuidFromText(`sync-device|${Date.now()}|${Math.random()}`)
  ).toLowerCase();
  await chrome.storage.local.set({ [STORAGE_KEY_SYNC_DEVICE_ID]: generated });
  return generated;
}

function normalizeAccountShape(account) {
  const now = Date.now();
  const sites = normalizeSites(account?.sites || []);
  const canonical = account?.canonicalSite || etldPlusOne(sites[0] || "");
  const createdAtMs = Number(account?.createdAtMs || account?.updatedAtMs || now);
  const username = String(account?.username || "");
  const accountId = String(account?.accountId || buildAccountId(canonical, username, createdAtMs));
  const recordId = normalizeRecordId(account, accountId, createdAtMs);
  const passkeyCredentialIds = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);

  return {
    recordId,
    accountId,
    canonicalSite: canonical,
    usernameAtCreate: String(account?.usernameAtCreate || username),
    isPinned: Boolean(account?.isPinned),
    pinnedSortOrder: account?.pinnedSortOrder == null ? null : Number(account.pinnedSortOrder),
    regularSortOrder: account?.regularSortOrder == null ? null : Number(account.regularSortOrder),
    pinnedViews: normalizePinnedViewsMap(account?.pinnedViews, account),
    folderId: account?.folderId == null ? null : String(account.folderId),
    folderIds: Array.isArray(account?.folderIds)
      ? account.folderIds.map((id) => String(id))
      : (account?.folderId == null ? [] : [String(account.folderId)]),
    sites,
    username,
    password: String(account?.password || ""),
    totpSecret: String(account?.totpSecret || ""),
    recoveryCodes: String(account?.recoveryCodes || ""),
    note: String(account?.note || ""),
    passkeyCredentialIds,
    usernameUpdatedAtMs: Number(account?.usernameUpdatedAtMs || createdAtMs),
    usernameUpdatedDeviceName: String(account?.usernameUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || "ChromeMac",
    passwordUpdatedAtMs: Number(account?.passwordUpdatedAtMs || createdAtMs),
    passwordUpdatedDeviceName: String(account?.passwordUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || "ChromeMac",
    totpUpdatedAtMs: Number(account?.totpUpdatedAtMs || createdAtMs),
    totpUpdatedDeviceName: String(account?.totpUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || "ChromeMac",
    recoveryCodesUpdatedAtMs: Number(account?.recoveryCodesUpdatedAtMs || createdAtMs),
    recoveryCodesUpdatedDeviceName: String(account?.recoveryCodesUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || "ChromeMac",
    noteUpdatedAtMs: Number(account?.noteUpdatedAtMs || createdAtMs),
    noteUpdatedDeviceName: String(account?.noteUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || "ChromeMac",
    passkeyUpdatedAtMs: Number(account?.passkeyUpdatedAtMs || createdAtMs),
    passkeyUpdatedDeviceName: String(account?.passkeyUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || "ChromeMac",
    isDeleted: Boolean(account?.isDeleted),
    deletedAtMs: account?.deletedAtMs == null ? null : Number(account.deletedAtMs),
    deletedDeviceName: String(account?.deletedDeviceName || "").trim(),
    lastOperatedDeviceName: String(account?.lastOperatedDeviceName || "").trim() || "ChromeMac",
    createdDeviceName: String(account?.createdDeviceName || account?.lastOperatedDeviceName || "").trim() || "ChromeMac",
    createdAtMs,
    updatedAtMs: Number(account?.updatedAtMs || createdAtMs),
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

function normalizeFolderShape(item) {
  const now = Date.now();
  const id = normalizeFolderId(item?.id || "");
  const fixedId = FIXED_NEW_ACCOUNT_FOLDER_ID;
  const rawName = String(item?.name || "").trim();
  const safeId = id || (globalThis.crypto?.randomUUID?.() || stableUuidFromText(`folder|${rawName}|${now}`)).toLowerCase();
  const createdAtMs = Number(item?.createdAtMs || now);
  const safeName = safeId === fixedId
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

function parseSites(raw) {
  return normalizeSites(
    String(raw || "")
      .split(/[\s,;\n\t]+/g)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function normalizePasskeyCredentialIds(input) {
  const values = Array.isArray(input) ? input : [];
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].sort();
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
        if (!existing.rpId && rpId) {
          existing.rpId = rpId;
        }
        if (!existing.userName && userName) {
          existing.userName = userName;
        }
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

function normalizeFolderId(value) {
  return String(value || "").trim().toLowerCase();
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
  const direct = normalizeFolderId(account?.recordId || account?.id || "");
  if (isUuidLower(direct)) return direct;
  const usernameSeed = String(account?.usernameAtCreate || account?.username || "").trim();
  const stableSeed = `${String(accountId || "").trim()}|${Number(createdAtMs || 0)}|${usernameSeed}`;
  return stableUuidFromText(stableSeed);
}

function normalizeFolderIdList(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map(normalizeFolderId).filter(Boolean))].sort();
}

function withFixedFolder(inputFolders) {
  const folders = Array.isArray(inputFolders) ? [...inputFolders] : [];
  const exists = folders.some((item) => normalizeFolderId(item?.id) === FIXED_NEW_ACCOUNT_FOLDER_ID);
  if (!exists) {
    folders.push(
      normalizeFolderShape({
        id: FIXED_NEW_ACCOUNT_FOLDER_ID,
        name: FIXED_NEW_ACCOUNT_FOLDER_NAME,
        createdAtMs: 0,
      })
    );
  }
  return folders.map((folder) => {
    if (normalizeFolderId(folder?.id) !== FIXED_NEW_ACCOUNT_FOLDER_ID) return folder;
    return {
      ...folder,
      id: FIXED_NEW_ACCOUNT_FOLDER_ID,
      name: FIXED_NEW_ACCOUNT_FOLDER_NAME,
    };
  });
}

function folderDisplayNameById(folderId) {
  const normalizedFolderId = normalizeFolderId(folderId);
  const matched = foldersRaw.find((item) => normalizeFolderId(item?.id) === normalizedFolderId);
  if (!matched) {
    return `未命名文件夹 ${normalizedFolderId.slice(0, 8)}`;
  }
  return String(matched?.name || `未命名文件夹 ${normalizedFolderId.slice(0, 8)}`);
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

function normalizeLockPolicy(value) {
  const policy = String(value || "");
  if (policy === LOCK_POLICY_IDLE_TIMEOUT) return LOCK_POLICY_IDLE_TIMEOUT;
  if (policy === LOCK_POLICY_ON_BACKGROUND) return LOCK_POLICY_ON_BACKGROUND;
  return LOCK_POLICY_ONCE_UNTIL_QUIT;
}

function clampLockIdleMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return LOCK_IDLE_MINUTES_DEFAULT;
  const rounded = Math.round(parsed);
  return Math.min(Math.max(rounded, LOCK_IDLE_MINUTES_MIN), LOCK_IDLE_MINUTES_MAX);
}

function normalizeLockMasterCredential(value) {
  if (!value || typeof value !== "object") return null;
  const version = Number(value.version || 1);
  const saltBase64 = String(value.saltBase64 || "");
  const digestBase64 = String(value.digestBase64 || "");
  if (version !== 1 || !saltBase64 || !digestBase64) return null;
  const saltBytes = base64ToBytes(saltBase64);
  if (saltBytes.length === 0) return null;
  return { version, saltBase64, digestBase64 };
}

async function createLockMasterCredential(password) {
  const normalizedPassword = String(password || "").trim();
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const digestBase64 = await computePasswordDigest(normalizedPassword, saltBytes);
  return {
    version: 1,
    saltBase64: bytesToBase64(saltBytes),
    digestBase64,
  };
}

async function verifyLockMasterPassword(credential, password) {
  const normalized = normalizeLockMasterCredential(credential);
  if (!normalized) return false;
  const saltBytes = base64ToBytes(normalized.saltBase64);
  if (saltBytes.length === 0) return false;
  const digest = await computePasswordDigest(String(password || "").trim(), saltBytes);
  return digest === normalized.digestBase64;
}

async function computePasswordDigest(password, saltBytes) {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(String(password || ""));
  const merged = new Uint8Array(saltBytes.length + passwordBytes.length);
  merged.set(saltBytes, 0);
  merged.set(passwordBytes, saltBytes.length);
  const hashBuffer = await crypto.subtle.digest("SHA-256", merged);
  return bytesToBase64(new Uint8Array(hashBuffer));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  try {
    const binary = atob(String(base64 || ""));
    const output = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      output[i] = binary.charCodeAt(i);
    }
    return output;
  } catch {
    return new Uint8Array();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toMultilineHtml(value) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) return "-";
  return escapeHtml(text).replaceAll("\n", "<br/>");
}

function setStatus(message) {
  const text = String(message || "").trim();
  if (!text) return;
  dom.status.textContent = text;
  showOptionsToast(text);
}

function setDeviceStatus(message) {
  dom.deviceStatus.textContent = message;
}

function showOptionsToast(message) {
  let toast = document.getElementById("optionsToast");
  if (!(toast instanceof HTMLDivElement)) {
    toast = document.createElement("div");
    toast.id = "optionsToast";
    toast.className = "options-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = String(message || "");
  toast.classList.add("options-toast-show");
  if (optionsToastTimer != null) {
    clearTimeout(optionsToastTimer);
  }
  optionsToastTimer = window.setTimeout(() => {
    const current = document.getElementById("optionsToast");
    if (!(current instanceof HTMLDivElement)) return;
    current.classList.remove("options-toast-show");
  }, OPTIONS_TOAST_DURATION_MS);
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
      setStatus("剪贴板文本为空");
      return;
    }
    if (!isValidTotpSecret(secret)) {
      setStatus("粘贴失败：原始密钥不是有效 TOTP");
      return;
    }
    totpInput.value = secret;
    setStatus("已填充 TOTP 原始密钥");
  } catch (error) {
    setStatus(`读取剪贴板失败: ${error.message}`);
  }
}

async function pasteOtpAuthUriFromClipboard({ totpInput, sitesInput, usernameInput }) {
  try {
    const raw = String(await navigator.clipboard.readText() || "");
    const payload = parseOtpAuthUriPayload(raw);
    if (!payload) {
      setStatus("粘贴失败：不是有效的 otpauth://totp URI");
      return;
    }
    applyOtpAuthPayloadToInputs(payload, {
      totpInput,
      sitesInput,
      usernameInput,
      includeSiteAndUsername: true,
    });
    setStatus("已解析 otpauth URI，并填充 TOTP/站点别名/用户名");
  } catch (error) {
    setStatus(`读取剪贴板失败: ${error.message}`);
  }
}

async function pasteOtpAuthQrFromClipboard({ totpInput, sitesInput, usernameInput }) {
  try {
    const payloadText = await parseQrPayloadFromClipboard();
    if (!payloadText) {
      setStatus("粘贴失败：剪贴板没有可识别的二维码图片");
      return;
    }
    const payload = parseOtpAuthUriPayload(payloadText);
    if (!payload) {
      setStatus("粘贴失败：二维码内容不是有效的 otpauth://totp URI");
      return;
    }
    applyOtpAuthPayloadToInputs(payload, {
      totpInput,
      sitesInput,
      usernameInput,
      includeSiteAndUsername: true,
    });
    setStatus("已解析二维码，并填充 TOTP/站点别名/用户名");
  } catch (error) {
    setStatus(`识别二维码失败: ${error.message}`);
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
    // keep original path if decoding fails
  }
  const label = decodedPath
    .replace(/^\/+/g, "")
    .trim();

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
    siteAlias: resolveImportedSiteAlias({ issuer, username: labelUsername }),
    username: labelUsername || "",
  };
}

function siteAliasFromIssuer(issuer) {
  const compactIssuer = String(issuer || "")
    .trim()
    .replaceAll(" ", "");
  if (!compactIssuer) return "";
  const normalized = normalizeDomain(compactIssuer);
  if (!normalized) return "";
  if (normalized.includes(".")) {
    return normalized;
  }
  return `${normalized}.com`;
}

function resolveImportedSiteAlias({ issuer, username }) {
  const byIssuer = siteAliasFromIssuer(issuer);
  if (byIssuer) return byIssuer;
  const byUsername = siteAliasFromUsername(username);
  if (byUsername) return byUsername;
  return "";
}

function siteAliasFromUsername(username) {
  const raw = String(username || "").trim();
  if (!raw) return "";
  const atIndex = raw.lastIndexOf("@");
  if (atIndex >= 0 && atIndex < raw.length - 1) {
    return normalizeDomain(raw.slice(atIndex + 1));
  }
  return normalizeDomain(raw);
}

async function readGoogleAuthenticatorMigrationFromClipboard() {
  let rawText = "";
  if (typeof navigator?.clipboard?.readText === "function") {
    try {
      rawText = String(await navigator.clipboard.readText() || "").trim();
    } catch {
      rawText = "";
    }
  }

  let parsed = parseGoogleAuthenticatorMigrationUriPayload(rawText);
  if (parsed) return parsed;

  const qrPayload = await parseQrPayloadFromClipboard();
  if (!qrPayload) {
    return null;
  }

  parsed = parseGoogleAuthenticatorMigrationUriPayload(qrPayload);
  if (parsed) return parsed;
  throw new Error("二维码内容不是有效的谷歌验证器导出数据");
}

async function readGoogleAuthenticatorMigrationFromFiles(files) {
  if (typeof BarcodeDetector === "undefined") {
    throw new Error("当前浏览器不支持二维码识别");
  }

  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const migrations = [];
  for (const file of Array.isArray(files) ? files : []) {
    const payloadText = await parseQrPayloadFromBlob(file, detector);
    if (!payloadText) continue;
    const parsed = parseGoogleAuthenticatorMigrationUriPayload(payloadText);
    if (parsed) {
      migrations.push(parsed);
    }
  }

  if (migrations.length === 0) return null;
  return mergeGoogleAuthenticatorMigrations(migrations);
}

function parseGoogleAuthenticatorMigrationUriPayload(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (String(parsed.protocol || "").toLowerCase() !== "otpauth-migration:") return null;
  if (String(parsed.hostname || "").toLowerCase() !== "offline") return null;

  const payloadB64 = String(parsed.searchParams.get("data") || "").trim();
  if (!payloadB64) return null;

  const bytes = decodeBase64ToBytes(payloadB64);
  if (!bytes || bytes.length === 0) return null;
  return decodeGoogleAuthenticatorMigrationPayload(bytes);
}

function decodeGoogleAuthenticatorMigrationPayload(bytes) {
  const payload = {
    entries: [],
    skippedCount: 0,
    batchSize: 0,
    batchIndex: 0,
  };

  let offset = 0;
  while (offset < bytes.length) {
    const tag = readProtoVarint(bytes, offset);
    if (!tag) break;
    offset = tag.nextOffset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x07;

    if (fieldNumber === 1 && wireType === 2) {
      const chunk = readProtoLengthDelimited(bytes, offset);
      if (!chunk) break;
      offset = chunk.nextOffset;
      const entry = decodeGoogleAuthenticatorOtpParameters(chunk.value);
      if (entry) {
        payload.entries.push(entry);
      } else {
        payload.skippedCount += 1;
      }
      continue;
    }

    if (fieldNumber === 3 && wireType === 0) {
      const value = readProtoVarint(bytes, offset);
      if (!value) break;
      payload.batchSize = value.value;
      offset = value.nextOffset;
      continue;
    }

    if (fieldNumber === 4 && wireType === 0) {
      const value = readProtoVarint(bytes, offset);
      if (!value) break;
      payload.batchIndex = value.value;
      offset = value.nextOffset;
      continue;
    }

    offset = skipProtoField(bytes, offset, wireType);
    if (offset < 0) break;
  }

  return payload;
}

function decodeGoogleAuthenticatorOtpParameters(bytes) {
  let secretBytes = null;
  let name = "";
  let issuer = "";
  let algorithm = 1;
  let digits = 1;
  let type = 2;
  let offset = 0;

  while (offset < bytes.length) {
    const tag = readProtoVarint(bytes, offset);
    if (!tag) break;
    offset = tag.nextOffset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x07;

    if (fieldNumber === 1 && wireType === 2) {
      const chunk = readProtoLengthDelimited(bytes, offset);
      if (!chunk) return null;
      secretBytes = chunk.value;
      offset = chunk.nextOffset;
      continue;
    }
    if (fieldNumber === 2 && wireType === 2) {
      const chunk = readProtoLengthDelimited(bytes, offset);
      if (!chunk) return null;
      name = decodeProtoUtf8(chunk.value);
      offset = chunk.nextOffset;
      continue;
    }
    if (fieldNumber === 3 && wireType === 2) {
      const chunk = readProtoLengthDelimited(bytes, offset);
      if (!chunk) return null;
      issuer = decodeProtoUtf8(chunk.value);
      offset = chunk.nextOffset;
      continue;
    }
    if ((fieldNumber === 4 || fieldNumber === 5 || fieldNumber === 6) && wireType === 0) {
      const value = readProtoVarint(bytes, offset);
      if (!value) return null;
      if (fieldNumber === 4) algorithm = value.value;
      if (fieldNumber === 5) digits = value.value;
      if (fieldNumber === 6) type = value.value;
      offset = value.nextOffset;
      continue;
    }

    offset = skipProtoField(bytes, offset, wireType);
    if (offset < 0) return null;
  }

  if (!secretBytes || secretBytes.length === 0) return null;
  if (type !== 2 || algorithm !== 1 || digits !== 1) return null;

  const labelParts = parseImportedOtpLabel(name);
  const effectiveIssuer = String(issuer || "").trim() || labelParts.issuer;
  const username = labelParts.username || String(name || "").trim();
  const siteAlias = resolveImportedSiteAlias({ issuer: effectiveIssuer, username });
  const secret = bytesToBase32(secretBytes);
  if (!secret || !siteAlias || !isValidTotpSecret(secret)) return null;

  return {
    secret,
    siteAlias,
    username,
  };
}

function parseImportedOtpLabel(label) {
  const text = String(label || "").trim();
  if (!text) {
    return { issuer: "", username: "" };
  }
  const colonIndex = text.indexOf(":");
  if (colonIndex < 0) {
    return { issuer: "", username: text };
  }
  return {
    issuer: text.slice(0, colonIndex).trim(),
    username: text.slice(colonIndex + 1).trim(),
  };
}

function readProtoVarint(bytes, startOffset) {
  let result = 0;
  let shift = 0;
  let offset = startOffset;
  while (offset < bytes.length && shift <= 35) {
    const byte = bytes[offset];
    result |= (byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, nextOffset: offset };
    }
    shift += 7;
  }
  return null;
}

function readProtoLengthDelimited(bytes, startOffset) {
  const lengthValue = readProtoVarint(bytes, startOffset);
  if (!lengthValue) return null;
  const start = lengthValue.nextOffset;
  const end = start + lengthValue.value;
  if (end > bytes.length) return null;
  return {
    value: bytes.slice(start, end),
    nextOffset: end,
  };
}

function skipProtoField(bytes, startOffset, wireType) {
  if (wireType === 0) {
    const value = readProtoVarint(bytes, startOffset);
    return value ? value.nextOffset : -1;
  }
  if (wireType === 1) {
    return startOffset + 8 <= bytes.length ? startOffset + 8 : -1;
  }
  if (wireType === 2) {
    const chunk = readProtoLengthDelimited(bytes, startOffset);
    return chunk ? chunk.nextOffset : -1;
  }
  if (wireType === 5) {
    return startOffset + 4 <= bytes.length ? startOffset + 4 : -1;
  }
  return -1;
}

function decodeBase64ToBytes(input) {
  const normalized = String(input || "")
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (!normalized) return new Uint8Array();
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let index = 0; index < bin.length; index += 1) {
    out[index] = bin.charCodeAt(index);
  }
  return out;
}

function decodeProtoUtf8(bytes) {
  return new TextDecoder().decode(bytes).trim();
}

function bytesToBase32(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let output = "";
  let buffer = 0;
  let bitsInBuffer = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5) {
      output += alphabet[(buffer >> (bitsInBuffer - 5)) & 0x1f];
      bitsInBuffer -= 5;
    }
  }
  if (bitsInBuffer > 0) {
    output += alphabet[(buffer << (5 - bitsInBuffer)) & 0x1f];
  }
  return output;
}

function findImportedTotpAccountIndex(accounts, entry) {
  return findImportedBrowserAccountIndex(accounts, {
    sites: [entry.siteAlias],
    username: entry.username || "",
  });
}

function applyImportedTotpEntryToAccount(account, entry, nowMs, targetFolderId = "") {
  const next = normalizeAccountShape(account);
  let changed = false;
  const mergedSites = normalizeSites([...(next.sites || []), entry.siteAlias || ""]);
  if (JSON.stringify(mergedSites) !== JSON.stringify(next.sites || [])) {
    next.sites = mergedSites;
    changed = true;
  }
  if (entry.username && entry.username !== next.username) {
    next.username = entry.username;
    next.usernameUpdatedAtMs = nowMs;
    changed = true;
  }
  if (entry.secret && entry.secret !== next.totpSecret) {
    next.totpSecret = entry.secret;
    next.totpUpdatedAtMs = nowMs;
    changed = true;
  }
  if (targetFolderId) {
    const mergedFolderIds = normalizeFolderIdList([...(next.folderIds || []), targetFolderId]);
    if (JSON.stringify(mergedFolderIds) !== JSON.stringify(normalizeFolderIdList(next.folderIds || []))) {
      next.folderIds = mergedFolderIds;
      next.folderId = mergedFolderIds[0] || null;
      changed = true;
    }
  }
  if (next.isDeleted) {
    next.isDeleted = false;
    next.deletedAtMs = null;
    changed = true;
  }
  if (changed) {
    next.updatedAtMs = nowMs;
    next.lastOperatedDeviceName = currentImportDeviceName();
  }
  return next;
}

function buildGoogleAuthenticatorImportSuffix({ importedCount, skippedCount, unchangedCount, batchSize, batchIndex }) {
  let suffix = `，解析 ${Number(importedCount || 0)} 条`;
  if (Number(skippedCount || 0) > 0) {
    suffix += `，跳过 ${Number(skippedCount)} 条`;
  }
  if (Number(unchangedCount || 0) > 0) {
    suffix += `，未变化 ${Number(unchangedCount)} 条`;
  }
  if (Number(batchSize || 0) > 1) {
    suffix += `，当前批次 ${Number(batchIndex || 0) + 1}/${Number(batchSize)}`;
  }
  return suffix;
}

function mergeGoogleAuthenticatorMigrations(migrations) {
  const merged = {
    entries: [],
    skippedCount: 0,
    batchSize: 0,
    batchIndex: 0,
  };
  const seen = new Set();

  for (const migration of Array.isArray(migrations) ? migrations : []) {
    merged.skippedCount += Number(migration?.skippedCount || 0);
    merged.batchSize += Math.max(Number(migration?.batchSize || 0), migration?.entries?.length ? 1 : 0);
    for (const entry of Array.isArray(migration?.entries) ? migration.entries : []) {
      const key = [
        String(entry?.siteAlias || ""),
        String(entry?.username || ""),
        String(entry?.secret || ""),
      ].join("|");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.entries.push(entry);
    }
  }

  merged.batchSize = Math.max(merged.batchSize, Array.isArray(migrations) ? migrations.length : 0);
  return merged;
}

async function parseQrPayloadFromClipboard() {
  if (typeof navigator?.clipboard?.read !== "function") {
    throw new Error("当前浏览器不支持读取剪贴板图片");
  }
  if (typeof BarcodeDetector === "undefined") {
    throw new Error("当前浏览器不支持二维码识别");
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
  button.textContent = "验证码: 计算中...";
  button.addEventListener("click", async () => {
    const code = String(button.dataset.passTotpCode || "");
    if (!code) {
      setStatus("验证码暂不可用");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      const label = String(username || accountId || "");
      setStatus(`验证码已复制: ${label}`);
    } catch (error) {
      setStatus(`复制验证码失败: ${error.message}`);
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
  const buttons = Array.from(document.querySelectorAll(".totp-copy-button[data-pass-totp-secret]"));
  if (buttons.length === 0) return;

  const bySecret = new Map();
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
    const result = secret === "__invalid__"
      ? null
      : await generateTotpCode(secret, Date.now());
    for (const button of group) {
      applyTotpResultToButton(button, result);
    }
  }
}

function applyTotpResultToButton(button, result) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (!button.isConnected) return;

  if (!result) {
    button.textContent = "验证码: TOTP 密钥无效";
    button.dataset.passTotpCode = "";
    button.disabled = true;
    button.classList.add("totp-invalid");
    return;
  }

  button.textContent = `验证码: ${result.code} (${result.remainingSeconds}s)`;
  button.dataset.passTotpCode = result.code;
  button.disabled = false;
  button.classList.remove("totp-invalid");
}

function normalizeTotpSecret(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replaceAll(" ", "")
    .replaceAll("-", "")
    .replace(/=+$/g, "");
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
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
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

  const counter = BigInt(Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS));
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

  const offset = signature[signature.length - 1] & 0x0f;
  if (offset + 3 >= signature.length) return null;

  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  const code = String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
  const remainingSeconds = TOTP_PERIOD_SECONDS - (Math.floor(nowMs / 1000) % TOTP_PERIOD_SECONDS);
  return { code, remainingSeconds };
}
