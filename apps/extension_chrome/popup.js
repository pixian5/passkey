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
  appendHistoryEntry,
  STORAGE_KEY_DATA_BUMP,
  ensureDataStorageReady,
  getAccounts as getAccountsFromDataStore,
  getHistory as getHistoryFromDataStore,
  getPasskeys as getPasskeysFromDataStore,
  setAccounts as setAccountsToDataStore,
  setPasskeys as setPasskeysToDataStore,
} from "./data_store.js";

const STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
const FIXED_NEW_ACCOUNT_FOLDER_ID = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";
const STORAGE_KEY_LOCK_ENABLED = "pass.lock.enabled";
const STORAGE_KEY_LOCK_POLICY = "pass.lock.policy";
const STORAGE_KEY_LOCK_IDLE_MINUTES = "pass.lock.idleMinutes";
const STORAGE_KEY_LOCK_MASTER_CREDENTIAL = "pass.lock.masterCredential.v1";
const LOCK_POLICY_ONCE_UNTIL_QUIT = "onceUntilQuit";
const LOCK_POLICY_IDLE_TIMEOUT = "idleTimeout";
const LOCK_POLICY_ON_BACKGROUND = "onBackground";
const LOCK_IDLE_MINUTES_DEFAULT = 5;
const LOCK_IDLE_MINUTES_MIN = 1;
const LOCK_IDLE_MINUTES_MAX = 60;
const LOCK_STORAGE_KEYS = new Set([
  STORAGE_KEY_LOCK_ENABLED,
  STORAGE_KEY_LOCK_POLICY,
  STORAGE_KEY_LOCK_IDLE_MINUTES,
  STORAGE_KEY_LOCK_MASTER_CREDENTIAL,
]);

const ACCOUNT_SEARCH_FIELD_KEYS = ["username", "sites", "note", "password"];
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_REFRESH_INTERVAL_MS = 1000;
const POPUP_TOAST_DURATION_MS = 3000;

const dom = {
  openCreateModalBtn: document.getElementById("openCreateModal"),
  openSortModalBtn: document.getElementById("openSortModal"),
  openHistoryModalBtn: document.getElementById("openHistoryModal"),
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
  status: document.getElementById("popupStatus"),
};

let currentDomain = "";
let accounts = [];
let passkeys = [];
let editingAccountId = null;
let viewMode = "accounts";
let totpRefreshTimer = null;
let accountSearchUseAll = true;
let accountSearchFields = new Set();
let popupToastTimer = null;
let sortModalOrderIds = [];
let sortModalDraggingAccountId = "";
let historyEntries = [];
let lockSettings = {
  enabled: false,
  policy: LOCK_POLICY_ONCE_UNTIL_QUIT,
  idleMinutes: LOCK_IDLE_MINUTES_DEFAULT,
  credential: null,
};
let isPopupLocked = false;
let popupLockMessage = "";
let lockIdleTimer = null;
let lockLastActivityAtMs = Date.now();
let lockOperationInFlight = false;

init().catch((error) => {
  setStatus(`初始化失败: ${error.message}`);
});

async function init() {
  await resolveCurrentDomain();
  await Promise.all([
    ensureDataStorageReady(),
    loadAccounts(),
    loadHistory(),
    loadPasskeys(),
    loadLockSettingsFromStorage(),
  ]);
  renderAccounts();
  bindEvents();
  renderLockOverlay();
  scheduleIdleAutoLockCheck();
  startTotpRefreshTicker();
  chrome.storage.onChanged.addListener(handleStorageChanged);
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
      relockMessage: "解锁设置已更新，请重新输入主密码",
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
  await Promise.all([loadAccounts(), loadPasskeys(), loadHistory()]);
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
  dom.openHistoryModalBtn.addEventListener("click", openHistoryModal);
  dom.createAccountBtn.addEventListener("click", createAccountFromInputs);
  dom.createTotpPasteRawBtn.addEventListener("click", () => {
    void pasteRawTotpSecretFromClipboard({
      totpInput: dom.createTotpInput,
    });
  });
  dom.createTotpPasteUriBtn.addEventListener("click", () => {
    void pasteOtpAuthUriFromClipboard({
      totpInput: dom.createTotpInput,
      sitesInput: dom.createSiteInput,
      usernameInput: dom.createUsernameInput,
    });
  });
  dom.createTotpPasteQrBtn.addEventListener("click", () => {
    void pasteOtpAuthQrFromClipboard({
      totpInput: dom.createTotpInput,
      sitesInput: dom.createSiteInput,
      usernameInput: dom.createUsernameInput,
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
    lockForBackgroundIfNeeded("扩展切到后台，已锁定");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      lockForBackgroundIfNeeded("扩展切到后台，已锁定");
      return;
    }
    registerPopupActivity();
  });
}

function registerPopupActivity() {
  if (!isLockFeatureEnabled()) return;
  if (isPopupLocked) return;
  lockLastActivityAtMs = Date.now();
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

  const timeoutMs = lockSettings.idleMinutes * 60 * 1000;
  lockIdleTimer = window.setTimeout(() => {
    lockIdleTimer = null;
    if (!isLockFeatureEnabled() || isPopupLocked) return;
    const idleForMs = Date.now() - lockLastActivityAtMs;
    if (idleForMs >= timeoutMs) {
      setPopupLockedState(true, `超过 ${lockSettings.idleMinutes} 分钟无操作，已锁定`);
      setStatus(`超过 ${lockSettings.idleMinutes} 分钟无操作，已锁定`);
      return;
    }
    scheduleIdleAutoLockCheck();
  }, timeoutMs + 120);
}

function lockForBackgroundIfNeeded(reason) {
  if (!isLockFeatureEnabled()) return;
  if (isPopupLocked) return;
  if (lockSettings.policy !== LOCK_POLICY_ON_BACKGROUND) return;
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
  dom.lockMessage.textContent = popupLockMessage || "请输入主密码解锁。";
  if (showOverlay) {
    dom.unlockPasswordInput.focus();
  }
}

function setPopupLockedState(nextLocked, message = "") {
  const lockEnabled = isLockFeatureEnabled();
  const locked = lockEnabled && Boolean(nextLocked);
  isPopupLocked = locked;
  popupLockMessage = locked ? (message || "请输入主密码解锁。") : "";
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
    STORAGE_KEY_LOCK_MASTER_CREDENTIAL,
  ]);
  lockSettings = {
    enabled: Boolean(result[STORAGE_KEY_LOCK_ENABLED]),
    policy: normalizeLockPolicy(result[STORAGE_KEY_LOCK_POLICY]),
    idleMinutes: clampLockIdleMinutes(result[STORAGE_KEY_LOCK_IDLE_MINUTES]),
    credential: normalizeLockMasterCredential(result[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]),
  };

  if (!isLockFeatureEnabled()) {
    setPopupLockedState(false);
    return;
  }

  if (relockIfEnabled || !isPopupLocked) {
    setPopupLockedState(true, relockMessage || "请输入主密码解锁。");
    return;
  }

  scheduleIdleAutoLockCheck();
  renderLockOverlay();
}

async function unlockPopupWithPassword() {
  if (!isLockFeatureEnabled()) {
    setPopupLockedState(false);
    return;
  }
  if (lockOperationInFlight) return;
  const password = String(dom.unlockPasswordInput.value || "").trim();
  if (!password) {
    setStatus("请输入主密码");
    return;
  }

  lockOperationInFlight = true;
  try {
    const verified = await verifyLockMasterPassword(lockSettings.credential, password);
    if (!verified) {
      popupLockMessage = "主密码错误";
      renderLockOverlay();
      setStatus("主密码错误");
      return;
    }
    setPopupLockedState(false);
    setStatus("扩展已解锁");
  } finally {
    lockOperationInFlight = false;
  }
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

async function verifyLockMasterPassword(credential, password) {
  const normalized = normalizeLockMasterCredential(credential);
  if (!normalized) return false;
  const saltBytes = base64ToBytes(normalized.saltBase64);
  if (saltBytes.length === 0) return false;
  const digest = await computePasswordDigest(password, saltBytes);
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
    setStatus("扩展已锁定，请先解锁");
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
    setStatus("扩展已锁定，请先解锁");
    return;
  }
  if (viewMode !== "accounts" && viewMode !== "all") return;
  const visibleAccounts = getVisibleAccountsForCurrentMode();
  if (visibleAccounts.length === 0) {
    setStatus("当前列表没有可排序账号");
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
  return value || "ChromeMac";
}

async function loadAccounts() {
  const raw = await getAccountsFromDataStore();
  accounts = raw.map(normalizeAccountShape);
}

async function loadPasskeys() {
  const raw = await getPasskeysFromDataStore();
  passkeys = raw.map(normalizePasskeyShape);
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
  if (!dom.historyModal.classList.contains("modal-hidden")) {
    await loadHistory();
    renderHistoryModalList();
  }
}

async function persistAccounts(nextAccounts) {
  accounts = nextAccounts.map(normalizeAccountShape);
  await setAccountsToDataStore(accounts);
}

async function persistPasskeys(nextPasskeys) {
  passkeys = nextPasskeys.map(normalizePasskeyShape);
  await setPasskeysToDataStore(passkeys);
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
    folderIds: Array.isArray(account.folderIds)
      ? account.folderIds.map((id) => String(id))
      : (account.folderId == null ? [] : [String(account.folderId)]),
    sites,
    username,
    password: account.password || "",
    totpSecret: account.totpSecret || "",
    recoveryCodes: account.recoveryCodes || "",
    note: account.note || "",
    passkeyCredentialIds,
    usernameUpdatedAtMs: Number(account.usernameUpdatedAtMs || createdAtMs),
    passwordUpdatedAtMs: Number(account.passwordUpdatedAtMs || createdAtMs),
    totpUpdatedAtMs: Number(account.totpUpdatedAtMs || createdAtMs),
    recoveryCodesUpdatedAtMs: Number(account.recoveryCodesUpdatedAtMs || createdAtMs),
    noteUpdatedAtMs: Number(account.noteUpdatedAtMs || createdAtMs),
    passkeyUpdatedAtMs: Number(account.passkeyUpdatedAtMs || createdAtMs),
    isDeleted: Boolean(account.isDeleted),
    deletedAtMs: account.deletedAtMs == null ? null : Number(account.deletedAtMs),
    lastOperatedDeviceName: account.lastOperatedDeviceName || "ChromeMac",
    createdAtMs,
    updatedAtMs: Number(account.updatedAtMs || createdAtMs),
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
    createCompatMethod: normalizePasskeyCreateCompatMethod(item?.createCompatMethod, item?.alg),
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
  dom.openHistoryModalBtn.classList.toggle("hidden", locked);
  dom.accountSearchSection.classList.toggle("hidden", locked || showPasskeyMode);
  dom.passkeySection.classList.toggle("passkey-hidden", locked || !showPasskeyMode);
  dom.accountList.style.display = showPasskeyMode ? "none" : "grid";

  if (locked) {
    closeSortModal();
    closeHistoryModal();
    dom.accountList.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "扩展已锁定，请先输入主密码解锁。";
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
      empty.textContent = "暂无账号。";
    } else if (!currentDomain) {
      empty.textContent = "当前页面无站点信息，无法匹配账号。";
    } else if (showRecycleBinMode) {
      empty.textContent = "当前站点在回收站中没有匹配账号。";
    } else {
      empty.textContent = "当前站点没有匹配账号。";
    }
    dom.accountList.appendChild(empty);
    return;
  }

  for (const account of visibleAccounts) {
    const card = document.createElement("article");
    card.className = "account";
    if (!showRecycleBinMode && isPinnedAccount(account)) {
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
    meta.innerHTML =
      `用户名: ${escapeHtml(account.username || "-")}<br/>` +
      `站点别名:<div class="meta-multiline">${sitesMultilineHtml}</div>`;
    card.appendChild(meta);

    const totpCopyBtn = hasTotpSecret(account.totpSecret)
      ? createTotpCopyButton({
        accountId: account.accountId,
        username: account.username,
        totpSecret: account.totpSecret,
      })
      : null;

    const actions = document.createElement("div");
    actions.className = "actions";

    if (!showRecycleBinMode) {
      const aliasBtn = document.createElement("button");
      aliasBtn.textContent = "加入当前域名";
      aliasBtn.addEventListener("click", () => addCurrentDomainToAccount(account.accountId));
      actions.appendChild(aliasBtn);

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "复制密码";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(account.password || "");
          setStatus(`已复制 ${account.username} 的密码`);
        } catch (error) {
          setStatus(`复制失败: ${error.message}`);
        }
      });
      actions.appendChild(copyBtn);

      const fillBtn = document.createElement("button");
      fillBtn.textContent = "填充当前页";
      fillBtn.disabled = !(account.username && account.password);
      fillBtn.addEventListener("click", () => fillCurrentPage(account));
      actions.appendChild(fillBtn);

      const editBtn = document.createElement("button");
      editBtn.textContent = editingAccountId === account.accountId ? "收起编辑" : "编辑";
      editBtn.addEventListener("click", () => {
        editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
        renderAccounts();
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "删除账号";
      deleteBtn.addEventListener("click", () => moveToRecycleBin(account.accountId));
      actions.appendChild(deleteBtn);

      if (totpCopyBtn) {
        actions.appendChild(totpCopyBtn);
      }
    } else {
      const restoreBtn = document.createElement("button");
      restoreBtn.textContent = "恢复账号";
      restoreBtn.addEventListener("click", () => restoreFromRecycleBin(account.accountId));
      actions.appendChild(restoreBtn);

      const permanentDeleteBtn = document.createElement("button");
      permanentDeleteBtn.textContent = "永久删除";
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
  let visibleAccounts = showRecycleBinMode
    ? accounts.filter((account) => account.isDeleted)
    : accounts.filter((account) => !account.isDeleted);

  if (!showAllAccountsMode) {
    visibleAccounts = visibleAccounts.filter((account) =>
      isAccountMatchCurrentDomain(account, currentDomain)
    );
  }

  if (includeSearch) {
    const accountQuery = String(dom.accountSearch.value || "").trim().toLowerCase();
    if (accountQuery) {
      visibleAccounts = visibleAccounts.filter((account) =>
        isAccountMatchSearch(account, accountQuery)
      );
    }
  }

  return sortAccountsForDisplay(visibleAccounts);
}

function renderSortModalList() {
  dom.sortModalList.innerHTML = "";
  const accountById = new Map(accounts.map((account) => [String(account.accountId || ""), account]));
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
  return isPinnedAccount(source) === isPinnedAccount(target);
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

  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const now = Date.now();
  const deviceName = await getDeviceName();
  let changed = false;

  const pinnedSubset = [];
  const regularSubset = [];
  for (const accountId of normalizedOrderedIds) {
    const target = next.find((item) => String(item.accountId || "") === accountId);
    if (!target || target.isDeleted) continue;
    if (isPinnedAccount(target)) {
      pinnedSubset.push(accountId);
    } else {
      regularSubset.push(accountId);
    }
  }

  const allPinnedIds = sortAccountsForDisplay(
    next.filter((item) => !item.isDeleted && isPinnedAccount(item))
  ).map((item) => String(item.accountId || ""));
  const allRegularIds = sortAccountsForDisplay(
    next.filter((item) => !item.isDeleted && !isPinnedAccount(item))
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
    empty.textContent = allPasskeys.length === 0
      ? "暂无通行密钥（访问支持 passkey 的站点并注册后会出现在这里）"
      : "没有匹配的通行密钥";
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
    meta.innerHTML =
      `credentialId: ${escapeHtml(shortenMiddle(item.credentialIdB64u, 20))}<br/>` +
      `签名计数: ${item.signCount} | 算法: ${item.alg} | 模式: ${escapeHtml(item.mode)}<br/>` +
      `创建: ${formatTime(item.createdAtMs)} | 最近使用: ${formatTime(item.lastUsedAtMs)}<br/>` +
      `关联账号数: ${linkedCount}<br/>`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const editUserBtn = document.createElement("button");
    editUserBtn.textContent = "编辑用户名";
    editUserBtn.addEventListener("click", async () => {
      await editPasskeyUsername(item.credentialIdB64u, item.userName || item.displayName || "");
    });
    actions.appendChild(editUserBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "button-danger";
    deleteBtn.textContent = "删除通行密钥";
    deleteBtn.addEventListener("click", async () => {
      await deletePasskey(item.credentialIdB64u);
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    dom.passkeyList.appendChild(card);
  }
}

function collectUnifiedPasskeys() {
  const byId = new Map();
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
      lastUsedAtMs: item?.lastUsedAtMs == null ? null : Number(item.lastUsedAtMs),
    });
  }

  for (const account of accounts) {
    const ids = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
    if (ids.length === 0) continue;
    const accountSite = normalizeDomain(
      (account?.sites && account.sites[0]) || account?.canonicalSite || ""
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
          linkedAccountCount: 0,
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
  details.className = "meta editor-meta";
  details.innerHTML =
    `通行密钥: ${(account.passkeyCredentialIds || []).length} 个 | 通行密钥更新时间：${formatTime(account.passkeyUpdatedAtMs)}<br/>` +
    `创建: ${formatTime(account.createdAtMs)} | 更新: ${formatTime(account.updatedAtMs)}<br/>` +
    `删除: ${formatTime(account.deletedAtMs)}<br/>` +
    `用户名更新时间：${formatTime(account.usernameUpdatedAtMs)} | 密码更新时间：${formatTime(account.passwordUpdatedAtMs)}<br/>` +
    `TOTP更新时间：${formatTime(account.totpUpdatedAtMs)} | 恢复码更新时间：${formatTime(account.recoveryCodesUpdatedAtMs)} | 备注更新时间：${formatTime(account.noteUpdatedAtMs)}<br/>`;
  editor.appendChild(details);

  const buttons = document.createElement("div");
  buttons.className = "actions";

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
  buttons.appendChild(saveBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
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
    setStatus("扩展已锁定，请先解锁");
    return;
  }
  const sites = parseSites(dom.createSiteInput.value);
  const username = dom.createUsernameInput.value.trim();
  const password = dom.createPasswordInput.value;
  const totpSecret = normalizeTotpSecret(dom.createTotpInput.value);

  if (sites.length === 0) {
    setStatus("站点别名不能为空");
    return;
  }
  if (!username) {
    setStatus("用户名不能为空");
    return;
  }
  if (!password) {
    setStatus("密码不能为空");
    return;
  }
  if (totpSecret && !isValidTotpSecret(totpSecret)) {
    setStatus("TOTP 密钥无效，请检查后再创建");
    return;
  }

  const createdAtMs = Date.now();
  const deviceName = await getDeviceName();
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const created = createAccount({
    site: sites[0],
    sites,
    username,
    password,
    totpSecret,
    createdAtMs,
    deviceName,
  });
  next.push(created);

  const synced = syncAliasGroups(next);
  await persistAccounts(synced);
  await appendHistory(
    `${created.accountId}：创建账号（用户名改为${historyValueSnippet(username)}，密码改为${historyValueSnippet(password)}）`,
    createdAtMs
  );
  dom.createSiteInput.value = "";
  dom.createUsernameInput.value = "";
  dom.createPasswordInput.value = "";
  dom.createTotpInput.value = "";
  closeCreateModal();
  setStatus("账号已创建");
  renderAccounts();
}

async function addCurrentDomainToAccount(accountId) {
  const domain = normalizeDomain(currentDomain);
  if (!domain) {
    setStatus("当前页面没有可用域名");
    return;
  }

  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }

  if (!target.sites.includes(domain)) {
    target.sites.push(domain);
    target.sites = normalizeSites(target.sites);
    target.updatedAtMs = Date.now();
  }

  const synced = syncAliasGroups(next);
  await persistAccounts(synced);
  await appendHistory(`${target.accountId}：站点别名改为${historyValueSnippet(target.sites.join(", "))}`);
  setStatus(`已将 ${domain} 加入账号别名组并自动同步`);
  renderAccounts();
}

async function saveAccountEdit(accountId, draft) {
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到编辑账号");
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
    historyMessages.push(`站点别名改为${historyValueSnippet(nextSites.join(", "))}`);
  }

  const nextUsername = draft.username.trim();
  if (nextUsername && nextUsername !== target.username) {
    target.username = nextUsername;
    target.usernameUpdatedAtMs = now;
    changed = true;
    historyMessages.push(`用户名改为${historyValueSnippet(nextUsername)}`);
  }

  if (draft.password !== target.password) {
    target.password = draft.password;
    target.passwordUpdatedAtMs = now;
    changed = true;
    historyMessages.push(`密码改为${historyValueSnippet(draft.password)}`);
  }

  const nextTotpSecret = normalizeTotpSecret(draft.totpSecret);
  if (nextTotpSecret && !isValidTotpSecret(nextTotpSecret)) {
    setStatus("TOTP 密钥无效，请检查后再保存");
    return;
  }

  if (nextTotpSecret !== normalizeTotpSecret(target.totpSecret)) {
    target.totpSecret = nextTotpSecret;
    target.totpUpdatedAtMs = now;
    changed = true;
    historyMessages.push(`TOTP 改为${historyValueSnippet(nextTotpSecret)}`);
  }

  if (draft.recoveryCodes !== target.recoveryCodes) {
    target.recoveryCodes = draft.recoveryCodes;
    target.recoveryCodesUpdatedAtMs = now;
    changed = true;
    historyMessages.push(`恢复码改为${historyValueSnippet(draft.recoveryCodes)}`);
  }

  if (draft.note !== target.note) {
    target.note = draft.note;
    target.noteUpdatedAtMs = now;
    changed = true;
    historyMessages.push(`备注改为${historyValueSnippet(draft.note)}`);
  }

  if (!changed) {
    setStatus("没有可保存的变更");
    return;
  }

  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  const synced = syncAliasGroups(next);
  await persistAccounts(synced);
  for (const message of historyMessages) {
    await appendHistory(`${target.accountId}：${message}`, now);
  }
  editingAccountId = null;
  setStatus("账号编辑已保存");
  renderAccounts();
}

async function moveToRecycleBin(accountId) {
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }

  if (target.isDeleted) {
    setStatus("账号已在回收站");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  target.isDeleted = true;
  target.deletedAtMs = now;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  await persistAccounts(next);
  await appendHistory(`${target.accountId}：移入回收站`, now);
  setStatus("账号已移入回收站");
  renderAccounts();
}

async function restoreFromRecycleBin(accountId) {
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }

  if (!target.isDeleted) {
    setStatus("该账号不在回收站");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  target.isDeleted = false;
  target.deletedAtMs = null;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  await persistAccounts(next);
  await appendHistory(`${target.accountId}：从回收站恢复`, now);
  setStatus("账号已从回收站恢复");
  renderAccounts();
}

async function permanentlyDelete(accountId) {
  const target = accounts.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }
  if (!target.isDeleted) {
    setStatus("仅支持在回收站中永久删除");
    return;
  }

  const next = accounts.filter((item) => item.accountId !== accountId);
  if (editingAccountId === accountId) {
    editingAccountId = null;
  }
  await persistAccounts(next);
  await appendHistory(`${accountId}：永久删除`);
  setStatus(`账号已永久删除: ${accountId}`);
  renderAccounts();
}

async function deletePasskey(credentialIdB64u) {
  const targetId = normalizePasskeyId(credentialIdB64u);
  if (!targetId) {
    setStatus("通行密钥 ID 非法");
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
      updatedAtMs: now,
    };
  });

  if (next.length === passkeys.length && !accountsChanged) {
    setStatus("未找到目标通行密钥");
    return;
  }

  if (next.length !== passkeys.length) {
    await persistPasskeys(next);
  }
  if (accountsChanged) {
    await persistAccounts(nextAccounts);
  }
  await appendHistory(`通行密钥删除：${targetId}`, now);
  setStatus(`通行密钥已移除: ${shortenMiddle(targetId, 16)}`);
  renderAccounts();
}

async function editPasskeyUsername(credentialIdB64u, currentUserName = "") {
  const targetId = normalizePasskeyId(credentialIdB64u);
  if (!targetId) {
    setStatus("通行密钥 ID 非法");
    return;
  }

  const input = window.prompt("编辑通行密钥用户名", String(currentUserName || ""));
  if (input == null) {
    return;
  }
  const nextUserName = String(input || "").trim();
  if (!nextUserName) {
    setStatus("用户名不能为空");
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
      updatedAtMs: now,
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
      updatedAtMs: now,
      lastOperatedDeviceName: deviceName,
    };
  });

  if (!passkeysChanged && !accountsChanged) {
    setStatus("未找到目标通行密钥");
    return;
  }

  if (passkeysChanged) {
    await persistPasskeys(nextPasskeys);
  }
  if (accountsChanged) {
    await persistAccounts(nextAccounts);
  }
  await appendHistory(`通行密钥用户名改为${historyValueSnippet(nextUserName)}：${targetId}`, now);
  setStatus(`通行密钥用户名已更新: ${nextUserName}`);
  renderAccounts();
}

async function fillCurrentPage(account) {
  const response = await chrome.runtime.sendMessage({
    type: "PASS_FILL_ACTIVE_TAB",
    payload: { username: account.username, password: account.password },
  });

  if (response?.ok) {
    setStatus("已向当前网页注入填充动作");
  } else {
    setStatus(`填充失败: ${response?.error || "未知错误"}`);
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

function isPinnedAccount(account) {
  return Boolean(account?.isPinned);
}

async function togglePin(accountId, { fromSortModal = false } = {}) {
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }
  if (target.isDeleted) {
    setStatus("回收站账号不支持置顶");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  const nextPinned = !isPinnedAccount(target);
  target.isPinned = nextPinned;
  if (nextPinned) {
    const maxOrder = next
      .filter((item) => !item.isDeleted && isPinnedAccount(item))
      .reduce((maxValue, item) => Math.max(maxValue, Number(item.pinnedSortOrder ?? -1)), -1);
    target.pinnedSortOrder = maxOrder + 1;
  } else {
    target.pinnedSortOrder = null;
    target.regularSortOrder = null;
  }
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  await persistAccounts(next);
  await appendHistory(
    nextPinned ? `${target.accountId}：账号置顶` : `${target.accountId}：取消账号置顶`,
    now
  );
  setStatus(nextPinned ? "账号已置顶" : "已取消置顶");
  renderAccounts();
  if (fromSortModal && !dom.sortModal.classList.contains("modal-hidden")) {
    sortModalOrderIds = getVisibleAccountsForCurrentMode().map((account) => String(account.accountId || ""));
    renderSortModalList();
  }
}

function parseSites(raw) {
  return normalizeSites(
    raw
      .split(/[\s,;\n\t]+/g)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function historyValueSnippet(input, maxLength = 80) {
  const normalized = String(input || "")
    .replace(/\r\n/g, " ")
    .replace(/[\r\n]/g, " ")
    .trim();
  if (!normalized) return "(空)";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function normalizePasskeyId(value) {
  return String(value || "").trim();
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

function formatPasskeyCompatLabel(item) {
  const mode = String(item?.mode || "");
  const method = normalizePasskeyCreateCompatMethod(item?.createCompatMethod, item?.alg);
  if (mode === "linked-account") {
    return "命中：未知(仅账号关联)";
  }
  if (method === "user_name_fallback+rs256") {
    return "命中：兼容2+3";
  }
  if (method === "user_name_fallback") {
    return "命中：兼容2(user.name兜底)";
  }
  if (method === "rs256") {
    return "命中：兼容3(RS256)";
  }
  return "命中：标准托管";
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

function normalizePasskeyCredentialIds(input) {
  const values = Array.isArray(input) ? input : [];
  return [...new Set(values.map(normalizePasskeyId).filter(Boolean))].sort();
}

function isAccountMatchCurrentDomain(account, domain) {
  if (!domain) return false;
  const normalizedCurrent = normalizeDomain(domain);
  const currentEtld1 = etldPlusOne(normalizedCurrent);
  const sites = normalizeSites(account.sites || []);
  return sites.some((site) => site === normalizedCurrent || etldPlusOne(site) === currentEtld1);
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
    accountSearchFields = new Set();
  } else {
    accountSearchUseAll = false;
  }
  syncAccountSearchFieldCheckboxes();
  renderAccounts();
}

function onAccountSearchFieldChanged() {
  const next = new Set();
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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function toMultilineHtml(value) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim();
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

  toast.textContent = text;
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
    siteAlias: siteAliasFromIssuer(issuer),
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
  if (viewMode === "passkeys") return;
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
