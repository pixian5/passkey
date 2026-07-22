// This page is copied directly into the Tauri webview without a bundler, so a
// bare npm import such as "@tauri-apps/api/core" cannot be resolved here.
const invoke = (command, args) => {
  const runtime = window.__TAURI__?.core ?? window.__TAURI_INTERNALS__;
  if (typeof runtime?.invoke !== "function") {
    throw new Error("Tauri 运行时不可用，请从 Tauri 应用内启动");
  }
  return runtime.invoke(command, args);
};

const $ = (s) => document.querySelector(s);

const els = {
  output: $("#output"),
  deviceName: $("#deviceName"),
  deviceLabel: $("#deviceLabel"),
  accountRows: $("#accountRows"),
  listEmpty: $("#listEmpty"),
  folderList: $("#folderList"),
  folderEmpty: $("#folderEmpty"),
  folderHead: $("#folderHead"),
  searchInput: $("#searchInput"),
  searchField: $("#searchField"),
  sortMode: $("#sortMode"),
  labelAll: $("#label-all"),
  labelPasskeys: $("#label-passkeys"),
  labelTotp: $("#label-totp"),
  labelRecycle: $("#label-recycle"),
  labelFolders: $("#label-folders"),
  accountForm: $("#accountForm"),
  accountId: $("#accountId"),
  sites: $("#sites"),
  username: $("#username"),
  password: $("#password"),
  totpSecret: $("#totpSecret"),
  recoveryCodes: $("#recoveryCodes"),
  note: $("#note"),
  editFolders: $("#editFolders"),
  editModal: $("#editModal"),
  editTitle: $("#editTitle"),
  btnCreateStay: $("#btn-create-stay"),
  btnSaveAccount: $("#btn-save-account"),
  btnPasteTotpRaw: $("#btn-paste-totp-raw"),
  btnPasteTotpUri: $("#btn-paste-totp-uri"),
  btnPasteTotpQr: $("#btn-paste-totp-qr"),
  folderModal: $("#folderModal"),
  newFolderName: $("#newFolderName"),
  folderSitesModal: $("#folderSitesModal"),
  folderSitesForm: $("#folderSitesForm"),
  folderSitesTitle: $("#folderSitesTitle"),
  folderSitesInput: $("#folderSitesInput"),
  folderAutoAdd: $("#folderAutoAdd"),
  folderDedupModal: $("#folderDedupModal"),
  folderDedupTitle: $("#folderDedupTitle"),
  folderDedupSummary: $("#folderDedupSummary"),
  folderDedupGroups: $("#folderDedupGroups"),
  btnKeepLatest: $("#btn-keep-latest"),
  btnKeepEarliest: $("#btn-keep-earliest"),
  folderDeleteModal: $("#folderDeleteModal"),
  folderDeleteMessage: $("#folderDeleteMessage"),
  btnConfirmFolderDelete: $("#btn-confirm-folder-delete"),
  contextMenu: $("#contextMenu"),
  btnCreateFolder: $("#btn-create-folder"),
  btnNew: $("#btn-new"),
  btnUndo: $("#btn-undo"),
  btnRedo: $("#btn-redo"),
  btnHistory: $("#btn-history"),
  historyModal: $("#historyModal"),
  historyList: $("#historyList"),
  historyUndoLatest: $("#historyUndoLatest"),
  historyRedoLatest: $("#historyRedoLatest"),
  btnRestoreAll: $("#btn-restore-all"),
  btnPurgeRecycle: $("#btn-purge-recycle"),
  btnDelete: $("#btn-delete"),
  btnRestore: $("#btn-restore"),
  btnHealth: $("#btn-health"),
  btnDemo: $("#btn-demo"),
  btnExport: $("#btn-export"),
  btnExportChrome: $("#btn-export-chrome"),
  btnExportFirefox: $("#btn-export-firefox"),
  btnExportSafari: $("#btn-export-safari"),
  btnImportBrowser: $("#btn-import-browser"),
  btnImportGoogleAuthenticator: $("#btn-import-google-authenticator"),
  btnExportBundle: $("#btn-export-bundle"),
  btnImportBundle: $("#btn-import-bundle"),
  fileBrowserCsv: $("#fileBrowserCsv"),
  fileGoogleAuthenticator: $("#fileGoogleAuthenticator"),
  fileSyncBundle: $("#fileSyncBundle"),
  exportDirectory: $("#exportDirectory"),
  btnSaveDevice: $("#btn-save-device"),
  btnSaveUi: $("#btn-save-ui"),
  uiFontFamily: $("#uiFontFamily"),
  uiTextSize: $("#uiTextSize"),
  uiTextSizeVal: $("#uiTextSizeVal"),
  uiButtonSize: $("#uiButtonSize"),
  uiButtonSizeVal: $("#uiButtonSizeVal"),
  uiToastDuration: $("#uiToastDuration"),
  uiToastDurationVal: $("#uiToastDurationVal"),
  showPasswordsGlobally: $("#showPasswordsGlobally"),
  localPayload: $("#localPayload"),
  remotePayload: $("#remotePayload"),
  btnLoadLocal: $("#btn-load-local"),
  btnClearRemote: $("#btn-clear-remote"),
  btnFillEmptyRemote: $("#btn-fill-empty-remote"),
  btnMergePreview: $("#btn-merge-preview"),
  mergePanel: $("#mergePanel"),
  mergeResult: $("#mergeResult"),
  mergeSummary: $("#mergeSummary"),
  mergePayloadOut: $("#mergePayloadOut"),
  syncEnabled: $("#syncEnabled"),
  syncPrimarySource: $("#syncPrimarySource"),
  syncBaseUrl: $("#syncBaseUrl"),
  syncToken: $("#syncToken"),
  syncEncKey: $("#syncEncKey"),
  prevSyncEncKey: $("#prevSyncEncKey"),
  syncMode: $("#syncMode"),
  autoSyncInterval: $("#autoSyncInterval"),
  autoSyncStatus: $("#autoSyncStatus"),
  syncKeyIdHint: $("#syncKeyIdHint"),
  prevSyncKeyIdHint: $("#prevSyncKeyIdHint"),
  webdavEnabled: $("#webdavEnabled"),
  webdavBaseUrl: $("#webdavBaseUrl"),
  webdavRemotePath: $("#webdavRemotePath"),
  webdavUsername: $("#webdavUsername"),
  webdavPassword: $("#webdavPassword"),
  btnSaveSync: $("#btn-save-sync"),
  btnGenSyncKey: $("#btn-gen-sync-key"),
  btnCopySyncKey: $("#btn-copy-sync-key"),
  btnSyncPreview: $("#btn-sync-preview"),
  btnSyncMerge: $("#btn-sync-merge"),
  btnSyncRemoteOverwrite: $("#btn-sync-remote-overwrite"),
  btnSyncLocalOverwrite: $("#btn-sync-local-overwrite"),
  btnSyncNow: $("#btn-sync-now"),
  btnSyncNowSettings: $("#btn-sync-now-settings"),
  btnLoadVersions: $("#btn-load-versions"),
  syncVersionsStatus: $("#syncVersionsStatus"),
  syncVersionsList: $("#syncVersionsList"),
  btnLoadLocalSnapshots: $("#btn-load-local-snapshots"),
  localSnapshotsStatus: $("#localSnapshotsStatus"),
  localSnapshotsList: $("#localSnapshotsList"),
  syncDecisionSummary: $("#syncDecisionSummary"),
  syncPreviewOut: $("#syncPreviewOut"),
  lockOverlay: $("#lockOverlay"),
  unlockPassword: $("#unlockPassword"),
  lockError: $("#lockError"),
  btnUnlock: $("#btn-unlock"),
  btnUnlockBiometric: $("#btn-unlock-biometric"),
  lockStatus: $("#lockStatus"),
  lockPassword: $("#lockPassword"),
  lockPassword2: $("#lockPassword2"),
  lockChangePassword: $("#lockChangePassword"),
  lockCurrentPassword: $("#lockCurrentPassword"),
  lockNewPassword: $("#lockNewPassword"),
  lockNewPassword2: $("#lockNewPassword2"),
  lockPolicy: $("#lockPolicy"),
  idleMinutes: $("#idleMinutes"),
  backgroundLockDelay: $("#backgroundLockDelay"),
  preferBiometrics: $("#preferBiometrics"),
  btnLockEnable: $("#btn-lock-enable"),
  btnLockChangePassword: $("#btn-lock-change-password"),
  btnLockDisable: $("#btn-lock-disable"),
  btnLockIdle: $("#btn-lock-idle"),
  btnLockNow: $("#btn-lock-now"),
  btnLockNowSettings: $("#btn-lock-now-settings"),
  appMain: $("#appMain"),
  sidebar: $("#sidebar"),
  settingsModal: $("#settingsModal"),
  btnOpenSettings: $("#btn-open-settings"),
  btnOpenMerge: $("#btn-open-merge"),
  btnOpenProvision: $("#btn-open-provision"),
  provisionModal: $("#provisionModal"),
  provisionConfirmModal: $("#provisionConfirmModal"),
  provisionConfirmSummary: $("#provisionConfirmSummary"),
  provisionConfirmFindings: $("#provisionConfirmFindings"),
  btnProvisionConfirmReplace: $("#btn-provision-confirm-replace"),
  btnProvisionConfirmCancel: $("#btn-provision-confirm-cancel"),
  provisionProgress: $("#provisionProgress"),
  provisionProgressText: $("#provisionProgressText"),
  provisionProgressElapsed: $("#provisionProgressElapsed"),
  provisionServerUrl: $("#provisionServerUrl"),
  provisionSshUser: $("#provisionSshUser"),
  provisionSshPort: $("#provisionSshPort"),
  provisionAuthMode: $("#provisionAuthMode"),
  provisionPasswordRow: $("#provisionPasswordRow"),
  provisionKeyRow: $("#provisionKeyRow"),
  provisionSecretPassword: $("#provisionSecretPassword"),
  provisionSecretKey: $("#provisionSecretKey"),
  provisionKeyPassphrase: $("#provisionKeyPassphrase"),
  provisionTlsCertificate: $("#provisionTlsCertificate"),
  provisionTlsPrivateKey: $("#provisionTlsPrivateKey"),
  provisionToken: $("#provisionToken"),
  provisionEncKey: $("#provisionEncKey"),
  provisionStatus: $("#provisionStatus"),
  btnLoadSshCred: $("#btn-load-ssh-cred"),
  btnGenProvisionToken: $("#btn-gen-provision-token"),
  btnRunProvision: $("#btn-run-provision"),
  debugOut: $("#debugOut"),
};

let biometricAvailable = null;
let biometricAutoTried = false;

let state = {
  activeAccounts: [],
  deletedAccounts: [],
  folders: [],
  passkeys: [],
  deviceName: "",
};

let lockState = {
  enabled: false,
  locked: false,
  idleLockMinutes: 5,
  hasPassword: false,
  lockPolicy: "onceUntilQuit",
  preferBiometrics: true,
  biometricReady: false,
};
let activityTimer = null;
let totpTimer = null;
let autoSyncTimer = null;
let filter = { type: "all" };
let selectedId = "";
let selectedAccountIds = new Set();
let selectionAnchorId = "";
let folderSitesTargetId = "";
let folderDedupTarget = null;
let folderDeleteTarget = null;
let uiPrefs = {
  fontFamily: "系统默认",
  textFontSize: 14,
  buttonFontSize: 13,
  toastDurationSeconds: 2.5,
  showPasswordsGlobally: false,
  exportDirectory: "",
  autoSyncIntervalMinutes: 0,
  previousEncryptionKey: "",
  webdavEnabled: false,
  webdavBaseUrl: "",
  webdavRemotePath: "pass-sync-bundle-v2.json",
  webdavUsername: "",
  webdavPassword: "",
  syncPrimarySource: "selfHosted",
};

/**
 * Toast levels (see docs + apps/codex-tauri/README.md):
 * - success → green
 * - error   → red
 * - warn    → yellow
 * Prefer toastSuccess / toastError / toastWarn; plain message() auto-detects.
 */
const TOAST_LEVELS = ["success", "error", "warn"];

const inferToastLevel = (text) => {
  const s = String(text ?? "");
  // Explicit failure cues first
  if (
    /失败|错误|无法|拒绝|异常|超时|未通过|无效|不能|禁止|未配置|不可达|412|401|403|500|HTTP\s*\d{3}/i.test(
      s
    )
  ) {
    return "error";
  }
  // Warnings / cancellations / empty / risk
  if (
    /取消|警告|风险|注意|未写入|未启用|为空|跳过|请先|请填写|可能|暂无|无已保存|停止|安全检查/i.test(
      s
    )
  ) {
    return "warn";
  }
  return "success";
};

const showToast = (text, level) => {
  const el = els.output || document.querySelector("#output");
  const body = String(text ?? "");
  const kind = TOAST_LEVELS.includes(level) ? level : inferToastLevel(body);
  if (!el) {
    console.log(`[pass:${kind}]`, body);
    return;
  }
  el.hidden = false;
  el.textContent = body;
  el.classList.remove("toast-success", "toast-error", "toast-warn");
  el.classList.add(`toast-${kind}`);
  el.dataset.level = kind;
  clearTimeout(showToast._t);
  const ms = Math.round((uiPrefs.toastDurationSeconds || 2.5) * 1000);
  showToast._t = setTimeout(() => {
    el.hidden = true;
  }, Math.max(1000, ms));
};

const message = (text, level) => showToast(text, level);
const toastSuccess = (text) => showToast(text, "success");
const toastError = (text) => showToast(text, "error");
const toastWarn = (text) => showToast(text, "warn");

const applyUiPrefs = () => {
  const root = document.documentElement;
  const textSize = Number(uiPrefs.textFontSize || 14);
  const buttonSize = Number(uiPrefs.buttonFontSize || 13);
  const font =
    !uiPrefs.fontFamily || uiPrefs.fontFamily === "系统默认"
      ? '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif'
      : `"${uiPrefs.fontFamily}", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`;

  root.style.setProperty("--ui-font", font);
  root.style.setProperty("--ui-text-size", `${textSize}px`);
  root.style.setProperty("--ui-button-size", `${buttonSize}px`);
  root.style.setProperty("--ui-scale", String(textSize / 14));
  root.style.setProperty("--ui-btn-scale", String(buttonSize / 13));
  root.style.fontSize = `${textSize}px`;
  root.style.fontFamily = font;
  document.body.style.fontSize = `${textSize}px`;
  document.body.style.fontFamily = font;

  // Global password visibility for form secrets (respect per-field forceVisible).
  const secretIds = [
    "password",
    "totpSecret",
    "syncToken",
    "syncEncKey",
    "prevSyncEncKey",
    "webdavPassword",
    "lockPassword",
    "lockPassword2",
    "provisionSecretPassword",
    "provisionKeyPassphrase",
    "provisionToken",
    "provisionEncKey",
  ];
  for (const id of secretIds) {
    const input = document.getElementById(id);
    if (!(input instanceof HTMLInputElement)) continue;
    if (input.dataset.forceVisible === "1") continue;
    input.type = uiPrefs.showPasswordsGlobally ? "text" : "password";
  }
  document.querySelectorAll("[data-toggle-secret]").forEach((button) => {
    const input = document.querySelector(`#${button.dataset.toggleSecret}`);
    if (!(input instanceof HTMLInputElement)) return;
    const visible = input.type !== "password";
    button.textContent = visible ? "◉" : "◎";
    button.title = visible ? "隐藏" : "显示";
  });
};

let uiPrefsSaveTimer = null;
const scheduleSaveUiPrefs = () => {
  clearTimeout(uiPrefsSaveTimer);
  uiPrefsSaveTimer = setTimeout(async () => {
    try {
      await invoke("set_ui_prefs", { prefs: collectUiPrefs() });
    } catch (err) {
      console.warn("auto-save ui prefs", err);
    }
  }, 250);
};

const applyUiPrefsFromFormLive = () => {
  // Pull live values from form controls without waiting for Save button.
  if (els.uiFontFamily) uiPrefs.fontFamily = els.uiFontFamily.value || "系统默认";
  if (els.uiTextSize) uiPrefs.textFontSize = Number(els.uiTextSize.value || 14);
  if (els.uiButtonSize) uiPrefs.buttonFontSize = Number(els.uiButtonSize.value || 13);
  if (els.uiToastDuration) {
    uiPrefs.toastDurationSeconds = Number(els.uiToastDuration.value || 2.5);
  }
  if (els.showPasswordsGlobally) {
    uiPrefs.showPasswordsGlobally = Boolean(els.showPasswordsGlobally.checked);
  }
  if (els.exportDirectory) uiPrefs.exportDirectory = (els.exportDirectory.value || "").trim();
  if (els.autoSyncInterval) {
    uiPrefs.autoSyncIntervalMinutes = Number(els.autoSyncInterval.value || 0);
  }
  if (els.prevSyncEncKey) {
    uiPrefs.previousEncryptionKey = (els.prevSyncEncKey.value || "").trim();
  }
  applyUiPrefs();
  updateAutoSyncStatus();
};

const collectUiPrefs = () => ({
  fontFamily: els.uiFontFamily?.value || "系统默认",
  textFontSize: Number(els.uiTextSize?.value || 14),
  buttonFontSize: Number(els.uiButtonSize?.value || 13),
  toastDurationSeconds: Number(els.uiToastDuration?.value || 2.5),
  showPasswordsGlobally: Boolean(els.showPasswordsGlobally?.checked),
  exportDirectory: (els.exportDirectory?.value || "").trim(),
  autoSyncIntervalMinutes: Number(els.autoSyncInterval?.value || 0),
  previousEncryptionKey: (els.prevSyncEncKey?.value || "").trim(),
  webdavEnabled: Boolean(els.webdavEnabled?.checked),
  webdavBaseUrl: (els.webdavBaseUrl?.value || "").trim(),
  webdavRemotePath: (els.webdavRemotePath?.value || "pass-sync-bundle-v2.json").trim(),
  webdavUsername: (els.webdavUsername?.value || "").trim(),
  webdavPassword: els.webdavPassword?.value || "",
  syncPrimarySource: els.syncPrimarySource?.value || "selfHosted",
});

const fillUiPrefsForm = () => {
  if (els.uiFontFamily) els.uiFontFamily.value = uiPrefs.fontFamily || "系统默认";
  if (els.uiTextSize) {
    els.uiTextSize.value = String(uiPrefs.textFontSize || 14);
    if (els.uiTextSizeVal) els.uiTextSizeVal.textContent = String(uiPrefs.textFontSize || 14);
  }
  if (els.uiButtonSize) {
    els.uiButtonSize.value = String(uiPrefs.buttonFontSize || 13);
    if (els.uiButtonSizeVal) els.uiButtonSizeVal.textContent = String(uiPrefs.buttonFontSize || 13);
  }
  if (els.uiToastDuration) {
    els.uiToastDuration.value = String(uiPrefs.toastDurationSeconds || 2.5);
    if (els.uiToastDurationVal) {
      els.uiToastDurationVal.textContent = `${uiPrefs.toastDurationSeconds || 2.5}s`;
    }
  }
  if (els.showPasswordsGlobally) {
    els.showPasswordsGlobally.checked = Boolean(uiPrefs.showPasswordsGlobally);
  }
  if (els.exportDirectory) els.exportDirectory.value = uiPrefs.exportDirectory || "";
  if (els.autoSyncInterval) {
    els.autoSyncInterval.value = String(uiPrefs.autoSyncIntervalMinutes || 0);
  }
  if (els.prevSyncEncKey) els.prevSyncEncKey.value = uiPrefs.previousEncryptionKey || "";
  if (els.webdavEnabled) els.webdavEnabled.checked = Boolean(uiPrefs.webdavEnabled);
  if (els.webdavBaseUrl) els.webdavBaseUrl.value = uiPrefs.webdavBaseUrl || "";
  if (els.webdavRemotePath) {
    els.webdavRemotePath.value = uiPrefs.webdavRemotePath || "pass-sync-bundle-v2.json";
  }
  if (els.webdavUsername) els.webdavUsername.value = uiPrefs.webdavUsername || "";
  if (els.webdavPassword) els.webdavPassword.value = uiPrefs.webdavPassword || "";
  if (els.syncPrimarySource) {
    els.syncPrimarySource.value = uiPrefs.syncPrimarySource || "selfHosted";
  }
  updateAutoSyncStatus();
};

const loadUiPrefs = async () => {
  try {
    const p = await invoke("get_ui_prefs");
    uiPrefs = { ...uiPrefs, ...p };
    // Coerce numbers (serde may return floats)
    uiPrefs.textFontSize = Number(uiPrefs.textFontSize || 14);
    uiPrefs.buttonFontSize = Number(uiPrefs.buttonFontSize || 13);
    uiPrefs.toastDurationSeconds = Number(uiPrefs.toastDurationSeconds || 2.5);
    uiPrefs.autoSyncIntervalMinutes = Number(uiPrefs.autoSyncIntervalMinutes || 0);
    fillUiPrefsForm();
    applyUiPrefs();
    scheduleAutoSync();
  } catch (err) {
    console.warn("load ui prefs", err);
    applyUiPrefs();
  }
};

const saveUiPrefs = async () => {
  uiPrefs = collectUiPrefs();
  await invoke("set_ui_prefs", { prefs: uiPrefs });
  applyUiPrefs();
  scheduleAutoSync();
  await refreshSyncKeyHints();
};

const updateAutoSyncStatus = () => {
  const m = Number(uiPrefs.autoSyncIntervalMinutes || 0);
  if (els.autoSyncStatus) {
    els.autoSyncStatus.textContent =
      m > 0 ? `自动同步：每 ${m} 分钟（仅在同步已启用时）` : "自动同步：关闭";
  }
};

const scheduleAutoSync = () => {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  const m = Number(uiPrefs.autoSyncIntervalMinutes || 0);
  updateAutoSyncStatus();
  if (m <= 0) return;
  autoSyncTimer = setInterval(async () => {
    try {
      if (lockState.enabled && lockState.locked) return;
      if (!els.syncEnabled?.checked && !els.webdavEnabled?.checked) return;
      await runSyncNow({ quiet: true });
    } catch (_) {}
  }, m * 60 * 1000);
};

const refreshSyncKeyHints = async () => {
  try {
    const key = (els.syncEncKey?.value || "").trim();
    const prev = (els.prevSyncEncKey?.value || "").trim();
    if (els.syncKeyIdHint) {
      if (!key) {
        els.syncKeyIdHint.textContent = "当前未配置同步密钥，将使用明文同步包。";
      } else {
        const id = await invoke("sync_key_id", { key });
        els.syncKeyIdHint.textContent = id
          ? `当前同步密钥 ID：${id}。配对或排查密钥不匹配时请核对此标识。`
          : "同步密钥格式无效（需要 256 位 base64url 或留空）。";
      }
    }
    if (els.prevSyncKeyIdHint) {
      if (!prev) {
        els.prevSyncKeyIdHint.textContent = "轮换前密钥未配置。";
      } else {
        const id = await invoke("sync_key_id", { key: prev });
        els.prevSyncKeyIdHint.textContent = id
          ? `轮换前密钥 ID：${id}。确认所有设备已更新后再清空。`
          : "轮换前密钥格式无效。";
      }
    }
  } catch (_) {}
};

const formatTimeMs = (ms) => {
  const n = Number(ms || 0);
  if (!n) return "-";
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return String(ms);
  const yy = String(d.getFullYear()).slice(2);
  return `${yy}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
};

const readFileAsText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsText(file);
  });

// Surface unexpected errors so "no reaction" is visible.
window.addEventListener("error", (e) => {
  toastError(`脚本错误: ${e.message || e}`);
});
window.addEventListener("unhandledrejection", (e) => {
  toastError(`请求失败: ${e.reason || e}`);
});

const escapeHtml = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const accountKey = (a) => a.recordId || a.id || a.accountId || "";

const hasTotp = (a) => Boolean((a.totpSecret || "").trim());
const hasPasskey = (a) => (a.passkeyCredentialIds || []).length > 0;

const folderIdsOf = (a) => {
  const ids = [...(a.folderIds || [])];
  if (a.folderId) ids.push(a.folderId);
  return [...new Set(ids.map(String))];
};

const passkeysForAccount = (a) => {
  const ids = new Set((a.passkeyCredentialIds || []).map(String));
  const sites = new Set((a.sites || []).map((s) => String(s).toLowerCase()));
  return (state.passkeys || []).filter((p) => {
    if (p.isDeleted || p.isPermanentlyDeleted) return false;
    if (ids.has(p.credentialIdB64u)) return true;
    const rp = (p.rpId || "").toLowerCase();
    return rp && sites.has(rp);
  });
};

// --- TOTP (RFC 6238, SHA1, 6 digits, 30s) ---
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(input || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of cleaned) {
    const val = alphabet.indexOf(c);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function hotp(keyBytes, counter) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // big-endian counter
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(bin % 10 ** 6).padStart(6, "0");
}

async function totpCode(secret) {
  const key = base32Decode(secret);
  if (!key.length) return null;
  const step = 30;
  const counter = Math.floor(Date.now() / 1000 / step);
  const code = await hotp(key, counter);
  const remain = step - (Math.floor(Date.now() / 1000) % step);
  return { code, remain };
}

function formatOtpDisplay(code) {
  if (!code || code.length !== 6) return code || "------";
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

const query = () => (els.searchInput?.value || "").trim().toLowerCase();
const searchField = () => els.searchField?.value || "all";
const matchesQuery = (a) => {
  const q = query();
  if (!q) return true;
  const field = searchField();
  const parts =
    field === "site"
      ? a.sites || []
      : field === "username"
        ? [a.username, a.accountId]
        : field === "password"
          ? [a.password]
          : field === "note"
            ? [a.note]
            : [a.username, a.accountId, a.password, a.note, ...(a.sites || [])];
  const hay = parts.filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
};

const isPinnedAccount = (a) => Boolean(a?.isPinned);
const accountRecordId = (a) =>
  String(a?.recordId || a?.id || a?.accountId || "").trim();

const compareOptionalOrder = (lo, ro) => {
  if (lo != null && ro != null && lo !== ro) return lo - ro;
  if (lo != null && ro == null) return -1;
  if (lo == null && ro != null) return 1;
  return 0;
};

const sortAccounts = (list) => {
  const mode = els.sortMode?.value || "default";
  const arr = [...list];
  const cmp = (x, y) => String(x || "").localeCompare(String(y || ""), "en");
  arr.sort((a, b) => {
    if (mode === "usernameAZ") return cmp(a.username, b.username);
    if (mode === "siteAZ") return cmp((a.sites || [])[0], (b.sites || [])[0]);
    // default: pinned first, then manual order within each section
    const ap = isPinnedAccount(a);
    const bp = isPinnedAccount(b);
    if (ap !== bp) return ap ? -1 : 1;
    if (ap && bp) {
      const byPin = compareOptionalOrder(a.pinnedSortOrder, b.pinnedSortOrder);
      if (byPin) return byPin;
    } else {
      const byReg = compareOptionalOrder(a.regularSortOrder, b.regularSortOrder);
      if (byReg) return byReg;
    }
    const byUpdated = (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
    if (byUpdated) return byUpdated;
    return cmp(a.accountId, b.accountId);
  });
  return arr;
};

const filteredAccounts = () => {
  let base;
  if (filter.type === "recycle") base = state.deletedAccounts || [];
  else {
    base = state.activeAccounts || [];
    if (filter.type === "passkeys") base = base.filter(hasPasskey);
    if (filter.type === "totp") base = base.filter(hasTotp);
    if (filter.type === "folder") {
      const fid = filter.id.toLowerCase();
      base = base.filter((a) => folderIdsOf(a).some((id) => id.toLowerCase() === fid));
    }
  }
  return sortAccounts(base.filter(matchesQuery));
};

const isApplePlatform = () =>
  /Mac|iPhone|iPad|iPod/i.test(
    `${navigator.platform || ""} ${navigator.userAgent || ""}`
  );

/** ⌘ on macOS, Ctrl elsewhere — never Ctrl on Apple (reserved for context menu). */
const isMultiSelectModifier = (e) =>
  isApplePlatform() ? Boolean(e.metaKey && !e.ctrlKey) : Boolean(e.metaKey || e.ctrlKey);

const selectOnlyAccount = (key) => {
  selectedId = key;
  selectedAccountIds = key ? new Set([key]) : new Set();
  selectionAnchorId = key;
};

const toggleAccountSelection = (key) => {
  if (selectedAccountIds.has(key)) selectedAccountIds.delete(key);
  else selectedAccountIds.add(key);
  selectedId = key;
  // Keep selectionAnchorId unchanged so Shift+click can still expand from original anchor.
  if (!selectionAnchorId) selectionAnchorId = key;
};

const selectAccountRange = (key, orderedKeys) => {
  const keys = (orderedKeys || []).map(String);
  const target = String(key || "");
  // If no anchor yet, fall back to first selected or the target itself.
  let anchor = selectionAnchorId || selectedId || target;
  if (!keys.includes(String(anchor))) {
    // Anchor not in current list (filter changed) — use first selected still visible, else target.
    const visibleSelected = [...selectedAccountIds].find((id) => keys.includes(String(id)));
    anchor = visibleSelected || target;
    selectionAnchorId = anchor;
  }
  const anchorIndex = keys.indexOf(String(anchor));
  const targetIndex = keys.indexOf(target);
  if (anchorIndex === -1 || targetIndex === -1) {
    selectOnlyAccount(key);
    return;
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  selectedAccountIds = new Set(keys.slice(start, end + 1));
  selectedId = target;
  // Do not move anchor — subsequent Shift+clicks expand from the same origin.
};

/** Update row selected styles without rebuilding the list (avoids flash). */
const applyAccountSelectionStyles = () => {
  if (!els.accountRows) return;
  els.accountRows.querySelectorAll(".account-row").forEach((row) => {
    const id = row.dataset.id || "";
    row.classList.toggle("selected", selectedAccountIds.has(id));
  });
};

const clearAccountSelection = () => {
  selectedId = "";
  selectedAccountIds.clear();
  selectionAnchorId = "";
};

const updateSidebarLabels = () => {
  const active = state.activeAccounts || [];
  if (els.labelAll) els.labelAll.textContent = `全部 (${active.length})`;
  if (els.labelPasskeys) els.labelPasskeys.textContent = `通行密钥 (${active.filter(hasPasskey).length})`;
  if (els.labelTotp) els.labelTotp.textContent = `验证码 (${active.filter(hasTotp).length})`;
  if (els.labelRecycle) {
    els.labelRecycle.textContent = `回收站 (${(state.deletedAccounts || []).length})`;
  }
  const folders = (state.folders || []).filter((f) => !f.isDeleted && !f.isPermanentlyDeleted);
  if (els.labelFolders) els.labelFolders.textContent = `文件夹 (${folders.length})`;
};

const applySidebarActive = () => {
  document.querySelectorAll(".sidebar .side-item[data-filter]").forEach((btn) => {
    const f = btn.dataset.filter || "";
    let on = false;
    if (f === "all" && filter.type === "all") on = true;
    else if (f === "passkeys" && filter.type === "passkeys") on = true;
    else if (f === "totp" && filter.type === "totp") on = true;
    else if (f === "recycle" && filter.type === "recycle") on = true;
    else if (
      f.startsWith("folder:") &&
      filter.type === "folder" &&
      f.slice(7).toLowerCase() === String(filter.id || "").toLowerCase()
    ) {
      on = true;
    }
    btn.classList.toggle("active", on);
  });
};

const setFilter = (next) => {
  filter = next || { type: "all" };
  clearAccountSelection();
  if (els.searchInput) {
    const field = searchField();
    const fieldLabel =
      field === "site"
        ? "站点名"
        : field === "username"
          ? "用户名"
          : field === "password"
            ? "密码"
            : field === "note"
              ? "备注"
              : "";
    const scope =
      filter.type === "passkeys"
        ? "通行密钥账号"
        : filter.type === "totp"
          ? "验证码账号"
          : filter.type === "recycle"
            ? "回收站账号"
            : filter.type === "folder"
              ? "当前文件夹账号"
              : "全部账号";
    els.searchInput.placeholder = fieldLabel
      ? `按${fieldLabel}搜索${scope}（输入即搜）`
      : `搜索${scope}（输入即搜）`;
  }
  // Re-render list + folders first, then mark the active sidebar item
  // (folders are recreated in render).
  render();
  applySidebarActive();
};

const copyText = async (text, okMsg) => {
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess(okMsg);
  } catch {
    toastError("复制失败");
  }
};

const hideContextMenu = () => {
  if (els.contextMenu) els.contextMenu.hidden = true;
};

const showContextMenu = (event, items) => {
  if (!els.contextMenu) return;
  event.preventDefault();
  event.stopPropagation();
  els.contextMenu.innerHTML = "";
  items.forEach(({ label, action, danger = false }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    if (danger) item.classList.add("danger");
    item.addEventListener("click", async (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      hideContextMenu();
      try {
        await action();
      } catch (err) {
        toastError(`操作失败：${err}`);
      }
    });
    els.contextMenu.appendChild(item);
  });
  els.contextMenu.hidden = false;
  const menuRect = els.contextMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - menuRect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - menuRect.height - 8);
  els.contextMenu.style.left = `${Math.max(8, left)}px`;
  els.contextMenu.style.top = `${Math.max(8, top)}px`;
};

const openFolderSites = (folder) => {
  folderSitesTargetId = String(folder.id);
  if (els.folderSitesTitle) els.folderSitesTitle.textContent = `加入「${folder.name || "未命名文件夹"}」中的指定网站账号`;
  if (els.folderSitesInput) els.folderSitesInput.value = (folder.matchedSites || []).join("\n");
  if (els.folderAutoAdd) els.folderAutoAdd.checked = Boolean(folder.autoAddMatchingSites);
  if (els.folderSitesModal) els.folderSitesModal.hidden = false;
  setTimeout(() => els.folderSitesInput?.focus(), 50);
};

const closeFolderSites = () => {
  if (els.folderSitesModal) els.folderSitesModal.hidden = true;
  folderSitesTargetId = "";
};

const formatTime = (ms) => {
  if (!ms) return "-";
  try {
    return new Date(Number(ms)).toLocaleString();
  } catch {
    return "-";
  }
};

const renderFolderDedupGroups = () => {
  const groups = folderDedupTarget?.groups || [];
  if (els.folderDedupSummary) {
    els.folderDedupSummary.textContent = groups.length
      ? `重复组 ${groups.length} 组，按站点别名和用户名分组`
      : "当前文件夹暂无重复账号";
  }
  if (els.btnKeepLatest) els.btnKeepLatest.disabled = groups.length === 0;
  if (els.btnKeepEarliest) els.btnKeepEarliest.disabled = groups.length === 0;
  if (!els.folderDedupGroups) return;
  els.folderDedupGroups.innerHTML = "";
  if (!groups.length) {
    els.folderDedupGroups.innerHTML = '<div class="dedup-empty">当前文件夹暂无重复账号</div>';
    return;
  }
  groups.forEach((group) => {
    const card = document.createElement("section");
    card.className = "dedup-group";
    const head = document.createElement("div");
    head.className = "dedup-group-head";
    head.innerHTML = `<div><div class="dedup-group-title">${escapeHtml((group.siteAliases || []).join(", ") || "未命名站点")}</div><div class="dedup-account-meta">用户名：${escapeHtml(group.username || "(空用户名)")} · ${group.accounts.length} 个账号</div></div>`;
    card.appendChild(head);
    group.accounts.forEach((account, index) => {
      const row = document.createElement("div");
      row.className = "dedup-account";
      const label = index === 0 ? "最新" : index === group.accounts.length - 1 ? "最早" : "";
      row.innerHTML = `
        <div class="dedup-account-main">
          <div class="dedup-account-id">${label ? `<span class="dedup-keep-label">${label}</span>` : ""}${escapeHtml(account.accountId || accountKey(account) || "账号")}</div>
          <div class="dedup-account-sites">站点：${escapeHtml((account.sites || []).join(", ") || account.canonicalSite || "-")}</div>
          <div class="dedup-account-meta">更新时间：${escapeHtml(formatTime(account.updatedAtMs))} · 创建时间：${escapeHtml(formatTime(account.createdAtMs))}</div>
        </div>`;
      const keep = document.createElement("button");
      keep.type = "button";
      keep.className = "primary";
      keep.textContent = "仅保留此账号";
      keep.addEventListener("click", () => deduplicateFolder("account", accountKey(account)));
      row.appendChild(keep);
      card.appendChild(row);
    });
    els.folderDedupGroups.appendChild(card);
  });
};

const refreshFolderDedup = async () => {
  if (!folderDedupTarget?.folderId) return;
  const groups = await invoke("get_folder_duplicate_groups", {
    folderId: folderDedupTarget.folderId,
  });
  folderDedupTarget.groups = groups || [];
  renderFolderDedupGroups();
};

const openFolderDedup = async (folder) => {
  folderDedupTarget = { folderId: String(folder.id), folderName: folder.name || "未命名文件夹", groups: [] };
  if (els.folderDedupTitle) els.folderDedupTitle.textContent = `${folderDedupTarget.folderName} 内去重`;
  if (els.folderDedupModal) els.folderDedupModal.hidden = false;
  renderFolderDedupGroups();
  try {
    await refreshFolderDedup();
  } catch (err) {
    toastError(`读取重复账号失败：${err}`);
  }
};

const closeFolderDedup = () => {
  if (els.folderDedupModal) els.folderDedupModal.hidden = true;
  folderDedupTarget = null;
};

const openFolderDelete = (folder) => {
  folderDeleteTarget = { id: String(folder.id), name: folder.name || "未命名文件夹" };
  if (els.folderDeleteMessage) {
    els.folderDeleteMessage.textContent = `删除「${folderDeleteTarget.name}」后，文件夹内账号会保留，但不再归属此文件夹。`;
  }
  if (els.folderDeleteModal) els.folderDeleteModal.hidden = false;
};

const closeFolderDelete = () => {
  if (els.folderDeleteModal) els.folderDeleteModal.hidden = true;
  folderDeleteTarget = null;
};

const confirmFolderDelete = async () => {
  const target = folderDeleteTarget;
  if (!target) return;
  if (els.btnConfirmFolderDelete) els.btnConfirmFolderDelete.disabled = true;
  try {
    await invoke("delete_folder", { id: target.id });
    if (filter.type === "folder" && String(filter.id).toLowerCase() === target.id.toLowerCase()) {
      filter = { type: "all" };
    }
    closeFolderDelete();
    await refreshState();
    toastSuccess(`文件夹「${target.name}」已删除`);
  } catch (err) {
    toastError(`删除文件夹失败：${err}`);
  } finally {
    if (els.btnConfirmFolderDelete) els.btnConfirmFolderDelete.disabled = false;
  }
};

const deduplicateFolder = async (mode, accountId = null) => {
  if (!folderDedupTarget?.folderId) return;
  try {
    const result = await invoke("deduplicate_folder", {
      folderId: folderDedupTarget.folderId,
      mode,
      accountId,
    });
    await refreshState();
    await refreshFolderDedup();
    toastSuccess(result.message || `去重完成，已移入回收站 ${result.deletedCount || 0} 个账号`);
  } catch (err) {
    toastError(`去重失败：${err}`);
  }
};

// Account / folder reorder via mouse gesture (HTML5 DnD is unreliable in WKWebView).
const dnd = {
  kind: "", // "folder" | "account"
  sourceId: "",
  sourcePinned: null,
  overId: "",
  before: true,
  active: false,
  moved: false,
  suppressClick: false,
  startX: 0,
  startY: 0,
  sourceEl: null,
  floatEl: null,
  lineEl: null,
  committing: false,
};

const sameId = (a, b) =>
  String(a || "").toLowerCase() === String(b || "").toLowerCase();

const ensureLineEl = () => {
  if (dnd.lineEl && document.body.contains(dnd.lineEl)) return dnd.lineEl;
  const line = document.createElement("div");
  line.className = "drop-line";
  line.hidden = true;
  document.body.appendChild(line);
  dnd.lineEl = line;
  return line;
};

const hideLineEl = () => {
  if (dnd.lineEl) dnd.lineEl.hidden = true;
};

const showLineAt = (targetEl, before) => {
  if (!targetEl) {
    hideLineEl();
    return;
  }
  const line = ensureLineEl();
  const rect = targetEl.getBoundingClientRect();
  const y = before ? rect.top : rect.bottom;
  line.hidden = false;
  line.style.left = `${Math.max(8, rect.left + 4)}px`;
  line.style.width = `${Math.max(40, rect.width - 8)}px`;
  line.style.top = `${Math.max(0, y - 1.5)}px`;
};

const clearSourceMarks = () => {
  document.querySelectorAll(".drag-source").forEach((n) => n.classList.remove("drag-source"));
};

const removeFloatEl = () => {
  if (dnd.floatEl) {
    dnd.floatEl.remove();
    dnd.floatEl = null;
  }
};

const armClickSuppression = () => {
  dnd.suppressClick = true;
  const block = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
  };
  window.addEventListener("click", block, true);
  setTimeout(() => {
    window.removeEventListener("click", block, true);
    dnd.suppressClick = false;
  }, 450);
};

const shouldIgnoreClick = (e) => {
  if (!dnd.suppressClick && !dnd.moved && !dnd.active) return false;
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  return true;
};

const moveIdInList = (ids, sourceId, targetId, before) => {
  const list = ids.map(String);
  const from = list.findIndex((id) => sameId(id, sourceId));
  const to = list.findIndex((id) => sameId(id, targetId));
  if (from < 0 || to < 0) return null;
  let dest = before ? to : to + 1;
  if (from < dest) dest -= 1;
  if (dest === from) return null;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, dest)), 0, moved);
  return next;
};

const findAccountByAnyId = (id) =>
  (state.activeAccounts || []).find(
    (a) =>
      sameId(accountKey(a), id) ||
      sameId(accountRecordId(a), id) ||
      sameId(a.accountId, id)
  );

const pinScopeAccounts = (pinned) =>
  sortAccounts((state.activeAccounts || []).filter((a) => isPinnedAccount(a) === pinned));

const reorderFolderRelative = async (sourceId, targetId, before) => {
  const folders = (state.folders || []).filter((f) => !f.isDeleted && !f.isPermanentlyDeleted);
  const ids = folders.map((f) => String(f.id));
  const next = moveIdInList(ids, sourceId, targetId, before);
  if (!next) {
    toastWarn("位置未变化");
    return false;
  }
  try {
    await invoke("reorder_folders", { orderedIds: next });
    const byId = new Map(folders.map((f) => [String(f.id).toLowerCase(), f]));
    const deleted = (state.folders || []).filter((f) => f.isDeleted || f.isPermanentlyDeleted);
    state.folders = next
      .map((id) => byId.get(String(id).toLowerCase()))
      .filter(Boolean)
      .concat(deleted);
    renderFolders();
    applySidebarActive();
    toastSuccess("文件夹顺序已更新");
    return true;
  } catch (err) {
    toastError(`文件夹排序失败：${err}`);
    return false;
  }
};

const reorderAccountRelative = async (sourceId, targetId, before) => {
  const source = findAccountByAnyId(sourceId);
  if (!source) {
    toastError("未找到拖动的账号");
    return false;
  }
  const pinned = isPinnedAccount(source);
  const visible = filteredAccounts().filter((a) => isPinnedAccount(a) === pinned && !a.isDeleted);
  const group = visible.length ? visible : pinScopeAccounts(pinned);
  const ids = group.map((a) => accountRecordId(a) || accountKey(a));
  const sourceRec = accountRecordId(source) || accountKey(source);
  const target = findAccountByAnyId(targetId);
  if (!target) {
    toastError("未找到放置目标");
    return false;
  }
  let targetRec = accountRecordId(target) || accountKey(target);
  let placeBefore = before;
  if (isPinnedAccount(target) !== pinned) {
    if (!ids.length) return false;
    targetRec = pinned ? ids[ids.length - 1] : ids[0];
    placeBefore = !pinned;
  }
  const next = moveIdInList(ids, sourceRec, targetRec, placeBefore);
  if (!next) {
    toastWarn("位置未变化");
    return false;
  }
  try {
    await invoke("reorder_accounts", { orderedIds: next, pinned });
    const orderRank = new Map(next.map((id, i) => [String(id).toLowerCase(), i]));
    for (const acc of state.activeAccounts || []) {
      if (isPinnedAccount(acc) !== pinned) continue;
      const rid = String(accountRecordId(acc) || accountKey(acc)).toLowerCase();
      if (!orderRank.has(rid)) continue;
      if (pinned) acc.pinnedSortOrder = orderRank.get(rid);
      else acc.regularSortOrder = orderRank.get(rid);
    }
    render();
    toastSuccess(pinned ? "置顶顺序已更新" : "账号顺序已更新");
    refreshState().catch(() => {});
    return true;
  } catch (err) {
    toastError(`账号排序失败：${err}`);
    return false;
  }
};

const findDropTargetAtPoint = (clientX, clientY) => {
  // Temporarily hide float so hit-testing sees list rows.
  const prev = dnd.floatEl?.style.pointerEvents;
  if (dnd.floatEl) dnd.floatEl.style.pointerEvents = "none";
  if (dnd.lineEl) dnd.lineEl.style.pointerEvents = "none";
  let target = null;
  const stack = document.elementsFromPoint(clientX, clientY) || [];
  if (dnd.kind === "account") {
    for (const el of stack) {
      const row = el?.closest?.(".account-row");
      if (!row) continue;
      if (sameId(row.dataset.recordId || row.dataset.id, dnd.sourceId)) continue;
      target = row;
      break;
    }
  } else if (dnd.kind === "folder") {
    for (const el of stack) {
      const item = el?.closest?.(".side-item[data-folder-id]");
      if (!item) continue;
      if (sameId(item.dataset.folderId, dnd.sourceId)) continue;
      target = item;
      break;
    }
  }
  if (dnd.floatEl) dnd.floatEl.style.pointerEvents = prev || "none";
  return target;
};

const ensureFloatEl = (clientX, clientY) => {
  if (dnd.floatEl) return dnd.floatEl;
  const source = dnd.sourceEl;
  if (!source) return null;
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true);
  ghost.classList.add("drag-float");
  ghost.classList.remove("selected", "drag-source");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.dataset.offsetX = String(clientX - rect.left);
  ghost.dataset.offsetY = String(clientY - rect.top);
  document.body.appendChild(ghost);
  dnd.floatEl = ghost;
  source.classList.add("drag-source");
  return ghost;
};

const moveFloatEl = (clientX, clientY) => {
  const ghost = ensureFloatEl(clientX, clientY);
  if (!ghost) return;
  const ox = Number(ghost.dataset.offsetX || 0);
  const oy = Number(ghost.dataset.offsetY || 0);
  ghost.style.left = `${clientX - ox}px`;
  ghost.style.top = `${clientY - oy}px`;
};

const updateHoverTarget = (clientX, clientY) => {
  const target = findDropTargetAtPoint(clientX, clientY);
  if (!target) {
    dnd.overId = "";
    hideLineEl();
    return;
  }
  const rect = target.getBoundingClientRect();
  let before = clientY < rect.top + rect.height / 2;
  if (dnd.kind === "account") {
    const targetPinned = target.dataset.pinned === "1";
    if (Boolean(dnd.sourcePinned) !== targetPinned) {
      before = Boolean(dnd.sourcePinned) ? false : true;
    }
  }
  dnd.overId = target.dataset.recordId || target.dataset.id || target.dataset.folderId || "";
  dnd.before = before;
  showLineAt(target, before);
};

const detachMouseDnd = () => {
  document.removeEventListener("mousemove", onMouseDndMove, true);
  document.removeEventListener("mouseup", onMouseDndUp, true);
};

const resetMouseDnd = () => {
  detachMouseDnd();
  removeFloatEl();
  hideLineEl();
  clearSourceMarks();
  document.body.classList.remove("is-reordering");
  dnd.kind = "";
  dnd.sourceId = "";
  dnd.sourcePinned = null;
  dnd.overId = "";
  dnd.before = true;
  dnd.active = false;
  dnd.moved = false;
  dnd.startX = 0;
  dnd.startY = 0;
  dnd.sourceEl = null;
};

const onMouseDndMove = (e) => {
  if (!dnd.active) return;
  const x = e.clientX;
  const y = e.clientY;
  const dx = x - dnd.startX;
  const dy = y - dnd.startY;
  if (!dnd.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
    dnd.moved = true;
    document.body.classList.add("is-reordering");
    ensureFloatEl(x, y);
  }
  if (!dnd.moved) return;
  if (e.cancelable) e.preventDefault();
  moveFloatEl(x, y);
  updateHoverTarget(x, y);
};

const onMouseDndUp = async (e) => {
  if (!dnd.active) return;
  const moved = dnd.moved;
  const kind = dnd.kind;
  const sourceId = dnd.sourceId;
  const overId = dnd.overId;
  const before = dnd.before;
  detachMouseDnd();
  removeFloatEl();
  hideLineEl();
  clearSourceMarks();
  document.body.classList.remove("is-reordering");
  dnd.active = false;
  dnd.moved = false;
  dnd.kind = "";
  dnd.sourceId = "";
  dnd.sourcePinned = null;
  dnd.overId = "";
  dnd.sourceEl = null;
  if (!moved) return;
  if (e?.cancelable) e.preventDefault();
  e?.stopPropagation?.();
  if (typeof e?.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  armClickSuppression();
  if (!sourceId || !overId || sameId(sourceId, overId)) {
    toastWarn("请拖到其他账号行上松手");
    return;
  }
  if (dnd.committing) return;
  dnd.committing = true;
  try {
    if (kind === "folder") await reorderFolderRelative(sourceId, overId, before);
    else if (kind === "account") await reorderAccountRelative(sourceId, overId, before);
  } finally {
    dnd.committing = false;
  }
};

const beginMouseReorder = (e, { kind, sourceId, sourcePinned = null, sourceEl = null }) => {
  if (e.button != null && e.button !== 0) return;
  // Only block real form controls / links.
  if (e.target?.closest?.("input, textarea, select, a")) return;
  // Modifier clicks are for multi-select / range-select — do not start drag.
  if (e.shiftKey || isMultiSelectModifier(e)) return;
  // Cancel any previous gesture.
  if (dnd.active) resetMouseDnd();
  dnd.kind = kind;
  dnd.sourceId = sourceId;
  dnd.sourcePinned = sourcePinned;
  dnd.overId = "";
  dnd.before = true;
  dnd.active = true;
  dnd.moved = false;
  dnd.startX = e.clientX;
  dnd.startY = e.clientY;
  dnd.sourceEl = sourceEl || e.currentTarget || null;
  document.addEventListener("mousemove", onMouseDndMove, true);
  document.addEventListener("mouseup", onMouseDndUp, true);
};

// Compatibility no-ops for older call sites if any remain.
const bindAccountListDnd = () => {};
const bindFolderListDnd = () => {};

const renderFolders = () => {
  if (!els.folderList) return;
  const folders = (state.folders || []).filter((f) => !f.isDeleted && !f.isPermanentlyDeleted);
  if (els.folderEmpty) els.folderEmpty.hidden = folders.length > 0;
  els.folderList.innerHTML = "";
  folders.forEach((folder) => {
    const count = (state.activeAccounts || []).filter((a) =>
      folderIdsOf(a).some((id) => id.toLowerCase() === String(folder.id).toLowerCase())
    ).length;
    const folderId = String(folder.id);
    const item = document.createElement("div");
    item.className = "side-item reorderable";
    item.dataset.filter = `folder:${folder.id}`;
    item.dataset.folderId = folderId;
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.textContent = `${folder.name || "未命名"} (${count})`;
    item.addEventListener("click", (e) => {
      if (shouldIgnoreClick(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setFilter({ type: "folder", id: folderId });
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setFilter({ type: "folder", id: folderId });
      }
    });
    item.addEventListener("mousedown", (e) => {
      beginMouseReorder(e, { kind: "folder", sourceId: folderId, sourceEl: item });
    });
    els.folderList.appendChild(item);
  });
};

const togglePinAccount = async (account) => {
  if (!account || account.isDeleted) {
    toastWarn("回收站账号不支持置顶");
    return;
  }
  try {
    const id = accountRecordId(account) || accountKey(account);
    const wasPinned = isPinnedAccount(account);
    await invoke("toggle_account_pin", { id });
    await refreshState();
    toastSuccess(wasPinned ? "已取消置顶" : "已置顶");
  } catch (err) {
    toastError(`置顶失败：${err}`);
  }
};

const render = () => {
  if (els.deviceName) els.deviceName.value = state.deviceName || "";
  if (els.deviceLabel) els.deviceLabel.textContent = state.deviceName ? `· ${state.deviceName}` : "";
  const recycleActive = filter.type === "recycle";
  const hasDeleted = (state.deletedAccounts || []).length > 0;
  if (els.btnRestoreAll) els.btnRestoreAll.hidden = !recycleActive;
  if (els.btnPurgeRecycle) els.btnPurgeRecycle.hidden = !recycleActive;
  if (els.btnRestoreAll) els.btnRestoreAll.disabled = !hasDeleted;
  if (els.btnPurgeRecycle) els.btnPurgeRecycle.disabled = !hasDeleted;
  updateSidebarLabels();
  renderFolders();
  applySidebarActive();
  bindAccountListDnd();

  const accounts = filteredAccounts();
  if (els.listEmpty) els.listEmpty.hidden = accounts.length > 0;
  if (!els.accountRows) return;
  els.accountRows.innerHTML = "";

  accounts.forEach((a) => {
    const key = accountKey(a);
    const recId = accountRecordId(a) || key;
    const pinned = isPinnedAccount(a);
    const row = document.createElement("div");
    row.className =
      "account-row" +
      (selectedAccountIds.has(key) ? " selected" : "") +
      (pinned ? " pinned" : "");
    row.dataset.id = key;
    row.dataset.recordId = recId;
    row.dataset.pinned = pinned ? "1" : "0";
    // Drag-to-reorder only in manual sort mode and outside recycle bin.
    const canDrag =
      filter.type !== "recycle" &&
      (els.sortMode?.value || "default") === "default" &&
      !a.isDeleted;
    if (canDrag) {
      row.classList.add("reorderable");
    }

    const title = a.accountId || a.username || (a.sites || [])[0] || "账号";
    const sites = (a.sites || []).join("  ");
    const pks = passkeysForAccount(a);
    const pkLine = pks
      .slice(0, 2)
      .map((p) => `通行密钥 RP ID: ${p.rpId || "—"} 用户名: ${p.userName || p.displayName || "—"}`)
      .join(" · ");

    const deleted = a.isDeleted
      ? `<span class="deleted-tag">已删除</span>`
      : "";
    const pinBadge = pinned && !a.isDeleted
      ? `<span class="pinned-tag" title="置顶">置顶</span>`
      : "";

    row.innerHTML = `
      <div class="row-title">${escapeHtml(title)}${pinBadge}${deleted}</div>
      <div class="row-line row-username">用户名: ${escapeHtml(a.username || "—")}</div>
      <div class="row-sub row-sites">站点别名: ${escapeHtml(sites || "—")}</div>
      ${pkLine ? `<div class="row-sub">${escapeHtml(pkLine)}</div>` : ""}
      <div class="row-otp" data-totp="${escapeHtml((a.totpSecret || "").trim())}" hidden></div>
    `;

    const copyOtpFromRow = (e) => {
      if (shouldIgnoreClick(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      const otp = e.currentTarget instanceof Element ? e.currentTarget : e.target?.closest?.(".row-otp");
      const code = otp?.getAttribute?.("data-code") || "";
      if (code) copyText(code, "验证码已复制");
      else toastWarn("验证码尚未生成");
    };

    // Bind on the OTP row itself so any text (label / digits / remain) copies.
    row.querySelector(".row-otp")?.addEventListener("click", copyOtpFromRow);

    // click title area opens edit; username/sites/otp copy on click
    row.addEventListener("click", (e) => {
      if (shouldIgnoreClick(e)) return;
      const t = e.target;
      // OTP handled by its own listener (must not open edit).
      if (t.closest(".row-otp")) return;
      // Selection modifiers take priority over copy/edit.
      const orderedKeys = accounts.map(accountKey);
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        selectAccountRange(key, orderedKeys);
        applyAccountSelectionStyles();
        return;
      }
      if (isMultiSelectModifier(e)) {
        e.preventDefault();
        e.stopPropagation();
        toggleAccountSelection(key);
        applyAccountSelectionStyles();
        return;
      }
      if (t.closest(".row-username")) {
        e.stopPropagation();
        copyText(a.username || "", "用户名已复制");
        return;
      }
      if (t.closest(".row-sites")) {
        e.stopPropagation();
        copyText((a.sites || []).join("\n"), "站点别名已复制");
        return;
      }
      selectOnlyAccount(key);
      openEdit(a);
      render();
    });

    if (canDrag) {
      // Whole account card is draggable (title / username / OTP / sites).
      // Short click without movement still copies or opens edit via click handlers.
      // ⌘ / Shift clicks skip drag (handled in beginMouseReorder).
      row.addEventListener("mousedown", (e) => {
        beginMouseReorder(e, {
          kind: "account",
          sourceId: recId,
          sourcePinned: pinned,
          sourceEl: row,
        });
      });
    }

    els.accountRows.appendChild(row);
  });

  refreshTotpRows();
};

async function refreshTotpRows() {
  const nodes = document.querySelectorAll(".row-otp[data-totp]");
  for (const node of nodes) {
    const secret = node.getAttribute("data-totp") || "";
    if (!secret) {
      node.removeAttribute("data-code");
      node.hidden = true;
      continue;
    }
    try {
      const res = await totpCode(secret);
      if (!res) {
        node.removeAttribute("data-code");
        node.hidden = true;
        continue;
      }
      node.hidden = false;
      node.setAttribute("data-code", res.code);
      const shown = formatOtpDisplay(res.code);
      node.innerHTML = `验证码: <span class="otp-digits">${shown}</span> <span class="otp-remain">(剩余 ${res.remain}s)</span>`;
      node.title = "点击复制验证码";
      node.setAttribute("role", "button");
      node.tabIndex = 0;
    } catch {
      node.removeAttribute("data-code");
      node.hidden = true;
    }
  }
}

const populateFolderSelect = (selected = []) => {
  if (!els.editFolders) return;
  const sel = new Set(selected.map(String));
  const folders = (state.folders || []).filter((f) => !f.isDeleted);
  els.editFolders.innerHTML = "";
  folders.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name || f.id;
    opt.selected = sel.has(String(f.id));
    els.editFolders.appendChild(opt);
  });
};

const openEdit = (account = null) => {
  if (!els.editModal) return;
  const card = els.editModal.querySelector(".account-editor-card");
  const isNew = !account;
  card?.classList.toggle("account-create-card", isNew);
  els.editModal.querySelector(".account-folders-field")?.toggleAttribute("hidden", isNew);
  if (account) {
    selectOnlyAccount(accountKey(account));
    els.accountId.value = selectedId;
    els.sites.value = (account.sites || []).join("\n");
    els.username.value = account.username || "";
    els.password.value = account.password || "";
    els.totpSecret.value = account.totpSecret || "";
    els.recoveryCodes.value = account.recoveryCodes || "";
    els.note.value = account.note || "";
    if (els.editTitle) els.editTitle.textContent = "编辑账号";
    if (els.btnSaveAccount) els.btnSaveAccount.textContent = "保存";
    if (els.btnCreateStay) els.btnCreateStay.hidden = true;
    populateFolderSelect(folderIdsOf(account));
    if (els.btnDelete) {
      els.btnDelete.hidden = false;
      els.btnDelete.textContent = filter.type === "recycle" ? "永久删除" : "移入回收站";
    }
    if (els.btnRestore) els.btnRestore.hidden = filter.type !== "recycle";
  } else {
    clearAccountSelection();
    els.accountId.value = "";
    els.accountForm?.reset();
    if (els.editTitle) els.editTitle.textContent = "新建账号";
    if (els.btnSaveAccount) els.btnSaveAccount.textContent = "创建并关闭";
    if (els.btnCreateStay) els.btnCreateStay.hidden = false;
    populateFolderSelect(
      filter.type === "folder" && filter.id ? [filter.id] : []
    );
    if (els.btnDelete) els.btnDelete.hidden = true;
    if (els.btnRestore) els.btnRestore.hidden = true;
  }
  [els.password, els.totpSecret].forEach((input) => {
    if (!input) return;
    delete input.dataset.forceVisible;
    input.type = uiPrefs.showPasswordsGlobally ? "text" : "password";
  });
  document.querySelectorAll("[data-toggle-secret]").forEach((button) => {
    const input = document.querySelector(`#${button.dataset.toggleSecret}`);
    const visible = input instanceof HTMLInputElement && input.type !== "password";
    button.textContent = visible ? "◉" : "◎";
    button.title = visible ? "隐藏" : "显示";
    button.setAttribute("aria-label", button.title);
  });
  els.editModal.hidden = false;
  setTimeout(() => els.sites?.focus(), 50);
};

const closeEdit = () => {
  if (els.editModal) els.editModal.hidden = true;
};

const normalizedTotpSecret = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/=+$/g, "");

const isValidTotpSecret = (value) => {
  const secret = normalizedTotpSecret(value);
  return secret.length >= 8 && /^[A-Z2-7]+$/.test(secret) && base32Decode(secret).length > 0;
};

const normalizeImportedSite = (value) => {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return "";
  const withoutScheme = raw.replace(/^https?:\/\//, "").split(/[/?#]/)[0].split(":")[0];
  if (!withoutScheme) return "";
  return withoutScheme.includes(".") ? withoutScheme : `${withoutScheme}.com`;
};

const parseOtpAuthUri = (value) => {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return null;
  }
  if (url.protocol.toLowerCase() !== "otpauth:" || url.hostname.toLowerCase() !== "totp") return null;
  const secret = normalizedTotpSecret(url.searchParams.get("secret"));
  if (!isValidTotpSecret(secret)) return null;
  const label = decodeURIComponent(url.pathname || "")
    .replace(/^\/+/, "")
    .trim();
  const colon = label.indexOf(":");
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : "";
  const username = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const issuer = (url.searchParams.get("issuer") || labelIssuer).trim();
  const site = normalizeImportedSite(issuer) || normalizeImportedSite(username.split("@").pop());
  return { secret, username, site };
};

const base32Encode = (bytes) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0, bits = 0, out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits ? out + alphabet[(buffer << (5 - bits)) & 31] : out;
};

const readProtoVarint = (bytes, start) => {
  let value = 0, shift = 0, index = start;
  while (index < bytes.length && shift < 35) {
    const byte = bytes[index++];
    value |= (byte & 127) << shift;
    if (!(byte & 128)) return [value, index];
    shift += 7;
  }
  throw new Error("二维码数据损坏");
};

const googleMigrationEntries = (raw) => {
  const url = new URL(raw);
  if (url.protocol !== "otpauth-migration:") return [];
  const source = Uint8Array.from(atob(url.searchParams.get("data") || ""), (c) => c.charCodeAt(0));
  const decoder = new TextDecoder();
  const readFields = (bytes) => {
    const fields = []; let index = 0;
    while (index < bytes.length) {
      const [tag, afterTag] = readProtoVarint(bytes, index); index = afterTag;
      const wire = tag & 7, field = tag >>> 3;
      if (wire === 2) { const [length, afterLength] = readProtoVarint(bytes, index); fields.push([field, bytes.slice(afterLength, afterLength + length)]); index = afterLength + length; }
      else if (wire === 0) { const [value, afterValue] = readProtoVarint(bytes, index); fields.push([field, value]); index = afterValue; }
      else throw new Error("不支持的二维码字段");
    }
    return fields;
  };
  return readFields(source).filter(([field]) => field === 1).flatMap(([, value]) => {
    const fields = readFields(value); const find = (id) => fields.find(([field]) => field === id)?.[1];
    const secretBytes = find(1), name = find(2), issuer = find(3), type = find(6);
    if (!(secretBytes instanceof Uint8Array) || (type != null && type !== 2)) return [];
    const username = name instanceof Uint8Array ? decoder.decode(name) : "";
    const issuerText = issuer instanceof Uint8Array ? decoder.decode(issuer) : "";
    const site = normalizeImportedSite(issuerText) || normalizeImportedSite(username.split("@").pop());
    return site ? [{ site, username, secret: base32Encode(secretBytes) }] : [];
  });
};

const decodeQrFile = async (file) => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0); bitmap.close?.();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = window.jsQR?.(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
  return result?.data || "";
};

const readClipboardText = async () => {
  if (!navigator.clipboard?.readText) throw new Error("当前系统不允许读取剪贴板文本");
  const text = (await navigator.clipboard.readText()).trim();
  if (!text) throw new Error("剪贴板没有文本内容");
  return text;
};

const applyOtpAuthPayload = (payload, includeSiteAndUsername) => {
  if (els.totpSecret) els.totpSecret.value = payload.secret;
  if (includeSiteAndUsername) {
    if (payload.site && els.sites) els.sites.value = payload.site;
    if (payload.username && els.username) els.username.value = payload.username;
  }
  toastSuccess(includeSiteAndUsername ? "已填充 TOTP、站点别名和用户名" : "已填充 TOTP 原始密钥");
};

const pasteTotpRaw = async () => {
  try {
    const secret = normalizedTotpSecret(await readClipboardText());
    if (!isValidTotpSecret(secret)) throw new Error("原始密钥不是有效 TOTP");
    applyOtpAuthPayload({ secret }, false);
  } catch (err) {
    toastError(`粘贴失败：${err}`);
  }
};

const pasteTotpUri = async (rawValue = null) => {
  try {
    const payload = parseOtpAuthUri(rawValue ?? await readClipboardText());
    if (!payload) throw new Error("不是有效的 otpauth://totp URI");
    applyOtpAuthPayload(payload, true);
  } catch (err) {
    toastError(`粘贴失败：${err}`);
  }
};

const pasteTotpQr = async () => {
  try {
    const text = await navigator.clipboard?.readText?.();
    if (parseOtpAuthUri(text)) {
      await pasteTotpUri(text);
      return;
    }
    if (!navigator.clipboard?.read || !("BarcodeDetector" in window)) {
      throw new Error("剪贴板没有可识别的二维码文本或图片");
    }
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const bitmap = await createImageBitmap(await item.getType(imageType));
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      if (codes[0]?.rawValue && parseOtpAuthUri(codes[0].rawValue)) {
        await pasteTotpUri(codes[0].rawValue);
        return;
      }
    }
    throw new Error("二维码内容不是有效的 otpauth://totp URI");
  } catch (err) {
    toastError(`粘贴失败：${err}`);
  }
};

const openSettings = async (tab = "general") => {
  if (!els.settingsModal) return;
  els.settingsModal.hidden = false;
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.settingsTab === tab);
  });
  document.querySelectorAll(".settings-pane").forEach((p) => {
    p.classList.toggle("active", p.dataset.pane === tab);
  });
  try {
    await loadUiPrefs();
    await loadSyncSettings();
    if (els.deviceName) els.deviceName.value = state.deviceName || els.deviceName.value || "";
    await refreshSyncKeyHints();
    await refreshLock();
  } catch (err) {
    toastError(`打开设置失败：${err}`);
  }
};
const closeSettings = () => {
  if (els.settingsModal) els.settingsModal.hidden = true;
};

const refreshState = async () => {
  const next = await invoke("get_app_state");
  state = {
    activeAccounts: next.activeAccounts || [],
    deletedAccounts: next.deletedAccounts || [],
    folders: next.folders || [],
    passkeys: next.passkeys || [],
    deviceName: next.deviceName || "",
  };
  const validIds = new Set([...state.activeAccounts, ...state.deletedAccounts].map(accountKey));
  selectedAccountIds = new Set([...selectedAccountIds].filter((id) => validIds.has(id)));
  if (selectedId && !validIds.has(selectedId)) selectedId = "";
  if (selectionAnchorId && !validIds.has(selectionAnchorId)) {
    selectionAnchorId = selectedAccountIds.values().next().value || "";
  }
  render();
  await refreshUndoStatus();
  await refreshRedoStatus();
};

const refreshUndoStatus = async () => {
  try {
    const status = await invoke("get_undo_status");
    if (els.btnUndo) {
      els.btnUndo.disabled = !status;
      els.btnUndo.title = status ? `撤销：${status.title}` : "没有可撤销的本地操作";
      els.btnUndo.textContent = status ? `撤销：${status.title}` : "撤销";
    }
    if (els.historyUndoLatest) els.historyUndoLatest.disabled = !status;
  } catch (_) {
    if (els.btnUndo) els.btnUndo.disabled = true;
    if (els.historyUndoLatest) els.historyUndoLatest.disabled = true;
  }
};

const refreshRedoStatus = async () => {
  try {
    const status = await invoke("get_redo_status");
    if (els.btnRedo) {
      els.btnRedo.disabled = !status;
      els.btnRedo.title = status ? `重做：${status.title}` : "没有可重做的操作";
      els.btnRedo.textContent = status ? `重做：${status.title}` : "重做";
    }
    if (els.historyRedoLatest) els.historyRedoLatest.disabled = !status;
  } catch (_) {
    if (els.btnRedo) els.btnRedo.disabled = true;
    if (els.historyRedoLatest) els.historyRedoLatest.disabled = true;
  }
};

const renderOperationHistory = (entries = []) => {
  if (!els.historyList) return;
  els.historyList.innerHTML = "";
  if (!entries.length) {
    els.historyList.innerHTML = '<div class="history-empty">暂无本地操作记录</div>';
    return;
  }
  [...entries].reverse().forEach((entry) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const stateLabel = entry.stack === "redo" ? "可重做" : "可撤销";
    row.innerHTML = `<div class="history-row-head"><span class="history-row-title">${escapeHtml(entry.title || "本地操作")}</span><span class="history-row-meta">${stateLabel}</span></div><div class="history-row-meta">${escapeHtml(formatTime(entry.createdAtMs))}</div>`;
    els.historyList.appendChild(row);
  });
};

const refreshOperationHistory = async () => {
  try {
    const entries = await invoke("get_operation_history");
    renderOperationHistory(entries || []);
  } catch (err) {
    if (els.historyList) els.historyList.innerHTML = `<div class="history-empty">读取历史失败：${escapeHtml(err)}</div>`;
  }
};

const openHistory = async () => {
  if (!els.historyModal) return;
  els.historyModal.hidden = false;
  await refreshOperationHistory();
  await refreshUndoStatus();
  await refreshRedoStatus();
};

const closeHistory = () => {
  if (els.historyModal) els.historyModal.hidden = true;
};

const applyLockUi = () => {
  const locked = Boolean(lockState.enabled && lockState.locked);
  const canBiometric = Boolean(
    biometricAvailable && lockState.biometricReady && lockState.preferBiometrics
  );
  if (els.lockOverlay) els.lockOverlay.hidden = !locked;
  if (els.appMain) els.appMain.style.visibility = locked ? "hidden" : "visible";
  if (els.btnUnlockBiometric) {
    els.btnUnlockBiometric.hidden = !canBiometric;
    // Prefer fingerprint as primary action when available.
    els.btnUnlockBiometric.classList.toggle("primary", canBiometric);
  }
  if (els.btnUnlock) {
    els.btnUnlock.classList.toggle("primary", !canBiometric);
  }
  if (els.lockStatus) {
    const policyTitle = {
      onceUntilQuit: "退出前不锁定",
      idleTimeout: `空闲 ${lockState.idleLockMinutes || 5} 分钟锁定`,
      onBackground: "切到后台锁定",
    }[lockState.lockPolicy] || "退出前不锁定";
    const bioHint = canBiometric
      ? "；可用指纹"
      : biometricAvailable && lockState.preferBiometrics
        ? "；指纹待主密码初始化"
        : "";
    els.lockStatus.textContent = lockState.enabled
      ? `状态：已启用；${lockState.locked ? "已锁定" : "已解锁"}；${policyTitle}${bioHint}`
      : "状态：未启用";
  }
  if (els.lockPolicy) {
    els.lockPolicy.value = lockState.lockPolicy || "onceUntilQuit";
  }
  if (els.idleMinutes && lockState.idleLockMinutes) {
    els.idleMinutes.value = String(lockState.idleLockMinutes);
  }
  if (els.preferBiometrics) {
    els.preferBiometrics.checked = Boolean(lockState.preferBiometrics);
  }
  if (els.lockChangePassword) {
    els.lockChangePassword.hidden = !lockState.enabled;
  }
  if (els.backgroundLockDelay && lockState.backgroundLockDelaySeconds != null) {
    els.backgroundLockDelay.value = String(lockState.backgroundLockDelaySeconds);
  }
  if (locked && canBiometric && !biometricAutoTried) {
    biometricAutoTried = true;
    // Prefer Touch ID / fingerprint when the OS supports it and session is ready.
    queueMicrotask(() => {
      if (lockState.enabled && lockState.locked && biometricAvailable && lockState.biometricReady) {
        els.btnUnlockBiometric?.click();
      }
    });
  }
  if (!locked) {
    biometricAutoTried = false;
  }
};

const refreshBiometricAvailability = async () => {
  try {
    biometricAvailable = Boolean(await invoke("lock_biometric_available"));
  } catch (_) {
    biometricAvailable = false;
  }
  return biometricAvailable;
};

const refreshLock = async ({ probeBiometric = false } = {}) => {
  lockState = await invoke("get_lock_state");
  if (probeBiometric || biometricAvailable === null) {
    await refreshBiometricAvailability();
  }
  applyLockUi();
  return lockState;
};

const noteActivity = async () => {
  try {
    await invoke("lock_touch");
  } catch (_) {}
};

const loadSyncSettings = async () => {
  try {
    const s = await invoke("get_sync_settings");
    if (els.syncEnabled) els.syncEnabled.checked = Boolean(s.enabled);
    if (els.syncBaseUrl) els.syncBaseUrl.value = s.baseUrl || "";
    if (els.syncToken) els.syncToken.value = s.authToken || "";
    if (els.syncEncKey) els.syncEncKey.value = s.encryptionKey || "";
    if (els.syncMode) els.syncMode.value = s.mode || "merge";
  } catch (err) {
    toastError(`读取同步设置失败：${err}`);
  }
};

const collectSyncSettings = () => ({
  enabled: Boolean(els.syncEnabled?.checked),
  baseUrl: (els.syncBaseUrl?.value || "").trim(),
  authToken: (els.syncToken?.value || "").trim(),
  encryptionKey: (els.syncEncKey?.value || "").trim(),
  mode: els.syncMode?.value || "merge",
});

const saveAllSyncRelated = async () => {
  await invoke("set_sync_settings", { settings: collectSyncSettings() });
  uiPrefs = collectUiPrefs();
  await invoke("set_ui_prefs", { prefs: uiPrefs });
  scheduleAutoSync();
  await refreshSyncKeyHints();
};

const buildLocalSyncPayload = () => ({
  accounts: [...(state.activeAccounts || []), ...(state.deletedAccounts || [])],
  folders: state.folders || [],
  passkeys: state.passkeys || [],
});

const extractPayload = (text, label) => {
  const raw = (text || "").trim();
  if (!raw) throw new Error(`${label} 为空`);
  const obj = JSON.parse(raw);
  return obj?.payload ?? obj;
};

const runSyncNow = async ({ quiet = false } = {}) => {
  return runSyncMode(els.syncMode?.value || "merge", { quiet });
};

const renderSyncDecisionSummary = (reports) => {
  if (!els.syncDecisionSummary) return;
  const list = Array.isArray(reports) ? reports : [reports];
  const valid = list.filter(Boolean);
  if (!valid.length) {
    els.syncDecisionSummary.hidden = true;
    return;
  }
  const modeNames = {
    merge: "按字段合并",
    remoteOverwriteLocal: "云端覆盖本地",
    localOverwriteRemote: "本地覆盖云端",
  };
  const lines = [
    "裁决摘要：账号优先按 recordId/accountId 匹配；字段按字段更新时间较新者胜，时间相同非空胜空，再按账号更新时间、设备名和字典序稳定裁决。",
    "删除规则：删除时间不早于最新内容更新时间时删除胜出；永久删除标记不会被普通内容恢复。",
    ...valid.map((report) => {
      const source = report.source ? `${report.source}：` : "";
      const mode = modeNames[report.mode] || report.mode || "未知模式";
      const safety = report.safe === false ? `安全检查未通过${report.reasons?.length ? `（${report.reasons.join("、")}）` : ""}` : "安全检查通过";
      return `${source}${mode} · 本地 ${report.localAccounts ?? "-"} → 合并 ${report.mergedAccounts ?? "-"} · ${safety}`;
    }),
  ];
  els.syncDecisionSummary.hidden = false;
  els.syncDecisionSummary.textContent = lines.join("\n");
};

const runSyncMode = async (mode, { quiet = false } = {}) => {
  await saveAllSyncRelated();
  const reports = [];
  const failures = [];
  const sources = [];
  if (els.syncEnabled?.checked) sources.push("selfHosted");
  if (els.webdavEnabled?.checked) sources.push("webdav");
  if (!sources.length) {
    throw new Error("请先启用自建服务器或 WebDAV 同步");
  }
  const configuredPrimary = els.syncPrimarySource?.value || "selfHosted";
  const preferred = sources.includes(configuredPrimary) ? configuredPrimary : sources[0];
  const ordered = [...sources].sort((left, right) => (right === preferred) - (left === preferred));
  for (const source of ordered) {
    // The primary source makes merge / overwrite decisions. Other enabled
    // targets are mirrors and only receive the post-primary local payload.
    const sourceMode = source === preferred ? mode : "localOverwriteRemote";
    try {
      const raw = await invoke(
        source === "selfHosted" ? "sync_now_mode" : "sync_webdav_now_mode",
        { mode: sourceMode }
      );
      const result = typeof raw === "string" ? JSON.parse(raw) : raw;
      reports.push({ source: source === "selfHosted" ? "自建服务器" : "WebDAV", ...(result.report || {}) });
    } catch (err) {
      failures.push(`${source === "selfHosted" ? "自建服务器" : "WebDAV"}：${err}`);
    }
  }
  await refreshState();
  if (failures.length) {
    throw new Error(`${failures.join("；")}。已完成 ${reports.length} 个来源`);
  }
  const report = reports[reports.length - 1] || {};
  if (!quiet) toastSuccess(reports.map((item) => `${item.source}：${item.message || "完成"}`).join("；"));
  if (els.syncPreviewOut) {
    els.syncPreviewOut.hidden = false;
    els.syncPreviewOut.textContent = JSON.stringify(reports, null, 2);
  }
  renderSyncDecisionSummary(reports);
  return report;
};

document.addEventListener("contextmenu", (e) => {
  const folderButton = e.target instanceof Element
    ? e.target.closest("#folderList .side-item[data-filter^='folder:']")
    : null;
  if (folderButton) {
    const folderId = String(folderButton.dataset.filter || "").slice(7);
    const folder = (state.folders || []).find((item) => String(item.id) === folderId);
    if (!folder) return;
    showContextMenu(e, [
      { label: "加入指定网站全部账号", action: () => openFolderSites(folder) },
      { label: "文件夹内去重", action: () => openFolderDedup(folder) },
      {
        label: "删除文件夹",
        danger: true,
        action: () => openFolderDelete(folder),
      },
    ]);
    return;
  }

  const accountRow = e.target instanceof Element
    ? e.target.closest(".account-row")
    : null;
  if (accountRow) {
    const key = accountRow.dataset.id || "";
    const account =
      (state.activeAccounts || []).find((item) => accountKey(item) === key) ||
      (state.deletedAccounts || []).find((item) => accountKey(item) === key);
    if (!account) return;
    const items = [];
    if (!account.isDeleted) {
      items.push({
        label: isPinnedAccount(account) ? "取消置顶" : "置顶",
        action: () => togglePinAccount(account),
      });
    }
    items.push({
      label: "编辑账号",
      action: () => {
        selectOnlyAccount(key);
        openEdit(account);
        render();
      },
    });
    showContextMenu(e, items);
    return;
  }

  const sideButton = e.target instanceof Element
    ? e.target.closest("#sidebar .side-item[data-filter]")
    : null;
  if (sideButton) {
    showContextMenu(e, [{ label: "新建账号", action: () => openEdit(null) }]);
    return;
  }

  const folderHead = e.target instanceof Element ? e.target.closest("#folderHead") : null;
  if (folderHead) {
    showContextMenu(e, [{ label: "新建文件夹", action: () => openNewFolderDialog() }]);
  }
});

const openNewFolderDialog = () => {
  try {
    if (els.newFolderName) els.newFolderName.value = "";
    if (els.folderModal) {
      els.folderModal.hidden = false;
      els.folderModal.removeAttribute("hidden");
    }
    toastWarn("请输入文件夹名称");
    setTimeout(() => els.newFolderName?.focus(), 50);
  } catch (err) {
    toastError(`打开新建文件夹失败: ${err}`);
  }
};

// Robust sidebar + folder actions via document-level delegation.
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;

  // Create folder confirm
  if (t.closest("#btn-create-folder")) {
    e.preventDefault();
    e.stopPropagation();
    const restoreButton = setButtonBusy(els.btnCreateFolder, "正在创建…");
    toastWarn("正在创建文件夹，请稍候…");
    (async () => {
      try {
        const name = (els.newFolderName?.value || "").trim();
        if (!name) {
          toastWarn("文件夹名不能为空");
          return;
        }
        await invoke("create_folder", { name });
        if (els.folderModal) {
          els.folderModal.hidden = true;
          els.folderModal.setAttribute("hidden", "");
        }
        await refreshState();
        toastSuccess(`文件夹「${name}」已创建`);
      } catch (err) {
        toastError(`创建文件夹失败: ${err}`);
      } finally {
        restoreButton();
      }
    })();
    return;
  }

  // Sidebar filter items (static + dynamic folders)
  const sideBtn = t.closest(".side-item[data-filter]");
  if (sideBtn && (sideBtn.closest("#sidebar") || sideBtn.closest(".sidebar"))) {
    e.preventDefault();
    e.stopPropagation();
    const f = sideBtn.getAttribute("data-filter") || sideBtn.dataset.filter || "";
    console.log("[pass] filter click", f);
    if (f === "all") setFilter({ type: "all" });
    else if (f === "passkeys") setFilter({ type: "passkeys" });
    else if (f === "totp") setFilter({ type: "totp" });
    else if (f === "recycle") setFilter({ type: "recycle" });
    else if (f.startsWith("folder:")) setFilter({ type: "folder", id: f.slice(7) });
    else toastWarn(`未知筛选: ${f}`);
    return;
  }
});

els.searchInput?.addEventListener("input", () => render());
els.searchField?.addEventListener("change", () => render());
els.sortMode?.addEventListener("change", () => render());
els.btnNew?.addEventListener("click", () => openEdit(null));
els.btnOpenSettings?.addEventListener("click", () => openSettings("general"));
window.addEventListener("pass-open-settings", () => openSettings("general"));
document.querySelectorAll("[data-close-settings]").forEach((el) => el.addEventListener("click", closeSettings));

const setProvisionStatus = (text, isError = false) => {
  if (!els.provisionStatus) return;
  const value = String(text || "").trim();
  els.provisionStatus.hidden = !value;
  els.provisionStatus.textContent = value;
  els.provisionStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
  // Empty status must not reserve layout height (avoids crushed footer on short windows).
  if (!value) {
    els.provisionStatus.removeAttribute("style");
    els.provisionStatus.hidden = true;
  }
};

let provisionProgressTimer = null;
let provisionProgressStart = 0;
const showProvisionProgress = (text) => {
  if (els.provisionProgress) els.provisionProgress.hidden = false;
  if (els.provisionProgressText) els.provisionProgressText.textContent = text || "正在处理…";
  provisionProgressStart = Date.now();
  const updateElapsed = () => {
    if (!els.provisionProgressElapsed) return;
    const sec = Math.floor((Date.now() - provisionProgressStart) / 1000);
    els.provisionProgressElapsed.textContent = sec > 0 ? `已耗时 ${sec}s` : "";
  };
  updateElapsed();
  if (provisionProgressTimer) clearInterval(provisionProgressTimer);
  provisionProgressTimer = setInterval(updateElapsed, 1000);
};
const hideProvisionProgress = () => {
  if (provisionProgressTimer) {
    clearInterval(provisionProgressTimer);
    provisionProgressTimer = null;
  }
  if (els.provisionProgress) els.provisionProgress.hidden = true;
  if (els.provisionProgressElapsed) els.provisionProgressElapsed.textContent = "";
};

const updateProvisionAuthUi = () => {
  const mode = els.provisionAuthMode?.value || "privateKey";
  if (els.provisionPasswordRow) els.provisionPasswordRow.hidden = mode !== "password";
  if (els.provisionKeyRow) els.provisionKeyRow.hidden = mode !== "privateKey";
};

const collectProvisionDraft = () => ({
  serverUrl: (els.provisionServerUrl?.value || "").trim(),
  tlsCertificate: (els.provisionTlsCertificate?.value || "").trim(),
  tlsPrivateKey: (els.provisionTlsPrivateKey?.value || "").trim(),
  accessToken: (els.provisionToken?.value || "").trim(),
  syncEncryptionKey: (els.provisionEncKey?.value || "").trim(),
});

const persistProvisionDraft = async () => {
  try {
    await invoke("save_provision_draft", { draft: collectProvisionDraft() });
  } catch (err) {
    console.warn("save provision draft", err);
  }
};

const openProvisionModal = async () => {
  if (!els.provisionModal) return;
  let draft = {};
  try {
    draft = (await invoke("get_provision_draft")) || {};
  } catch (_) {}
  if (els.provisionServerUrl) {
    els.provisionServerUrl.value =
      (els.syncBaseUrl?.value || "").trim() || draft.serverUrl || "https://";
  }
  if (els.provisionTlsCertificate) els.provisionTlsCertificate.value = draft.tlsCertificate || "";
  if (els.provisionTlsPrivateKey) els.provisionTlsPrivateKey.value = draft.tlsPrivateKey || "";
  if (els.provisionToken) els.provisionToken.value = els.syncToken?.value || draft.accessToken || "";
  if (els.provisionEncKey) els.provisionEncKey.value = els.syncEncKey?.value || draft.syncEncryptionKey || "";
  // Clear per-field forceVisible so global show-passwords can apply.
  for (const id of [
    "provisionSecretPassword",
    "provisionKeyPassphrase",
    "provisionToken",
    "provisionEncKey",
  ]) {
    const input = document.getElementById(id);
    if (input) delete input.dataset.forceVisible;
  }
  setProvisionStatus("");
  hideProvisionProgress();
  updateProvisionAuthUi();
  els.provisionModal.hidden = false;
  applyUiPrefs();
  try {
    await loadSavedSshCredential();
    // Re-apply after credentials load (values changed, still respect global).
    applyUiPrefs();
  } catch (_) {}
};

const closeProvisionModal = () => {
  persistProvisionDraft();
  if (els.provisionModal) els.provisionModal.hidden = true;
};

let provisionConfirmResolve = null;
const closeProvisionConfirm = (confirmed = false) => {
  if (els.provisionConfirmModal) els.provisionConfirmModal.hidden = true;
  const resolve = provisionConfirmResolve;
  provisionConfirmResolve = null;
  resolve?.(confirmed);
};

const requestProvisionReplacement = (report) => new Promise((resolve) => {
  provisionConfirmResolve = resolve;
  if (els.provisionConfirmSummary) {
    els.provisionConfirmSummary.textContent = report?.summary || "服务器上已存在 Pass 同步服务。";
  }
  if (els.provisionConfirmFindings) {
    const findings = (report?.findings || []).map((item) => `• ${item}`).join("\n");
    els.provisionConfirmFindings.textContent = findings;
    els.provisionConfirmFindings.hidden = !findings;
  }
  if (els.provisionConfirmModal) els.provisionConfirmModal.hidden = false;
  els.btnProvisionConfirmReplace?.focus();
});

document.querySelectorAll("[data-close-provision-confirm]").forEach((el) => {
  el.addEventListener("click", () => closeProvisionConfirm(false));
});
els.btnProvisionConfirmReplace?.addEventListener("click", () => {
  const restore = setButtonBusy(els.btnProvisionConfirmReplace, "正在删除…");
  // 给用户一瞬视觉反馈再关闭弹窗，避免感觉点击无响应。
  setTimeout(() => {
    restore();
    closeProvisionConfirm(true);
  }, 200);
});
els.btnProvisionConfirmCancel?.addEventListener("click", () => closeProvisionConfirm(false));

const collectProvisionCredential = () => {
  const mode = els.provisionAuthMode?.value || "privateKey";
  const secret =
    mode === "password"
      ? els.provisionSecretPassword?.value || ""
      : els.provisionSecretKey?.value || "";
  return {
    username: (els.provisionSshUser?.value || "root").trim() || "root",
    port: Number(els.provisionSshPort?.value || 22),
    authMode: mode,
    secret,
    privateKeyPassphrase: els.provisionKeyPassphrase?.value || "",
  };
};

const setButtonBusy = (button, busyText) => {
  if (!button) return () => {};
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  return () => {
    button.disabled = false;
    button.textContent = originalText;
  };
};

const loadSavedSshCredential = async () => {
  const serverUrl = (els.provisionServerUrl?.value || els.syncBaseUrl?.value || "").trim();
  if (!serverUrl) return;
  const cred = await invoke("get_ssh_credential", { serverUrl });
  if (els.provisionSshUser) els.provisionSshUser.value = cred.username || "root";
  if (els.provisionSshPort) els.provisionSshPort.value = String(cred.port || 22);
  if (els.provisionAuthMode) els.provisionAuthMode.value = cred.authMode || "privateKey";
  updateProvisionAuthUi();
  if ((cred.authMode || "privateKey") === "password") {
    if (els.provisionSecretPassword) els.provisionSecretPassword.value = cred.secret || "";
  } else if (els.provisionSecretKey) {
    els.provisionSecretKey.value = cred.secret || "";
  }
  if (els.provisionKeyPassphrase) {
    els.provisionKeyPassphrase.value = cred.privateKeyPassphrase || "";
  }
  setProvisionStatus(cred.secret ? "已载入该主机保存的 SSH 凭据" : "无已保存凭据");
  applyUiPrefs();
};

els.btnOpenProvision?.addEventListener("click", () => openProvisionModal());
document.querySelectorAll("[data-close-provision]").forEach((el) => {
  el.addEventListener("click", closeProvisionModal);
});
els.provisionAuthMode?.addEventListener("change", updateProvisionAuthUi);
els.btnLoadSshCred?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnLoadSshCred, "正在读取…");
  try {
    await loadSavedSshCredential();
  } catch (err) {
    setProvisionStatus(String(err), true);
  } finally {
    restore();
  }
});
els.btnGenProvisionToken?.addEventListener("click", () => {
  const restore = setButtonBusy(els.btnGenProvisionToken, "正在生成…");
  try {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = btoa(String.fromCharCode(...bytes))
      .replace(/=+$/g, "")
      .replace(/\+/g, "")
      .replace(/\//g, "");
    if (els.provisionToken) {
      els.provisionToken.value = token;
      delete els.provisionToken.dataset.forceVisible;
    }
    applyUiPrefs();
    toastSuccess("已生成访问令牌");
  } finally {
    restore();
  }
});
els.btnRunProvision?.addEventListener("click", async () => {
  const serverUrl = (els.provisionServerUrl?.value || "").trim();
  const accessToken = (els.provisionToken?.value || "").trim();
  const syncEncryptionKey = (els.provisionEncKey?.value || "").trim();
  const tlsCertificate = (els.provisionTlsCertificate?.value || "").trim();
  const tlsPrivateKey = (els.provisionTlsPrivateKey?.value || "").trim();
  await persistProvisionDraft();
  const credential = collectProvisionCredential();
  if (!serverUrl.startsWith("https://")) {
    setProvisionStatus("服务器地址必须是 HTTPS URL", true);
    toastWarn("服务器地址必须是 HTTPS URL");
    return;
  }
  // accessToken / syncEncryptionKey may be empty (open server / plaintext sync).
  if (!credential.secret.trim()) {
    setProvisionStatus("请填写 SSH 密码或私钥", true);
    toastWarn("请填写 SSH 密码或私钥");
    return;
  }
  const restoreProvisionButton = setButtonBusy(els.btnRunProvision, "创建服务");
  // 禁用 provision modal 的关闭按钮，防止操作中途关闭。
  const closeBtns = document.querySelectorAll("[data-close-provision]");
  closeBtns.forEach((b) => { b.style.pointerEvents = "none"; b.style.opacity = "0.4"; });

  const runCreate = async (removeExisting) => {
    // Keep the SSH form usable after a failed deployment as well as after a
    // successful one; the credential is encrypted and keyed by host.
    try {
      await invoke("save_ssh_credential_cmd", { serverUrl, credential });
    } catch (_) {}
    showProvisionProgress(
      removeExisting ? "正在删除旧服务并创建新服务…" : "正在通过 SSH 在服务器上创建服务…"
    );
    setProvisionStatus(
      removeExisting
        ? "正在删除旧服务并创建新服务，请稍候…"
        : "正在通过 SSH 在服务器上创建服务，请稍候…"
    );
    const result = await invoke("provision_self_hosted_server", {
      serverUrl,
      credential,
      accessToken,
      syncEncryptionKey,
      tlsCertificate,
      tlsPrivateKey,
      removeExisting: Boolean(removeExisting),
    });
    showProvisionProgress("正在验证服务连通性…");
    if (els.syncEnabled) els.syncEnabled.checked = true;
    if (els.syncBaseUrl) els.syncBaseUrl.value = result.endpoint || serverUrl;
    if (els.syncToken) els.syncToken.value = accessToken;
    if (els.syncEncKey) els.syncEncKey.value = syncEncryptionKey;
    try {
      await saveAllSyncRelated();
    } catch (_) {}
    setProvisionStatus(result.message || "服务创建完成");
    toastSuccess(result.message || "已在服务器创建同步服务");
    const healthy = await invoke("verify_sync_endpoint", {
      endpoint: result.endpoint || serverUrl,
    });
    hideProvisionProgress();
    if (healthy) {
      setTimeout(() => closeProvisionModal(), 800);
      openSettings("sync");
    }
  };

  try {
    showProvisionProgress("正在检测服务器是否已有旧服务…");
    setProvisionStatus("正在检测服务器是否已有旧服务…");
    const report = await invoke("detect_existing_sync_service", {
      serverUrl,
      credential,
    });
    let removeExisting = false;
    if (report?.exists) {
      hideProvisionProgress();
      const ok = await requestProvisionReplacement(report);
      if (!ok) {
        setProvisionStatus("已取消：未删除旧服务，也未创建新服务");
        toastWarn("已取消创建服务");
        return;
      }
      removeExisting = true;
    } else {
      setProvisionStatus(report?.summary || "未发现旧服务，开始创建…");
    }
    await runCreate(removeExisting);
  } catch (err) {
    const raw = String(err ?? "");
    if (raw.includes("EXISTING_SERVICE:")) {
      const payload = raw.split("EXISTING_SERVICE:")[1] || "";
      const parts = payload.split("|");
      const host = parts[0] || "";
      const findings = (parts[1] || "")
        .split("；")
        .filter(Boolean)
        .map((x) => `• ${x}`)
        .join("\n");
      hideProvisionProgress();
      const ok = await requestProvisionReplacement({
        summary: `检测到服务器 ${host} 上已有 Pass 同步服务。`,
        findings: findings ? findings.split("\n").map((item) => item.replace(/^•\s*/, "")) : [],
      });
      if (!ok) {
        setProvisionStatus("已取消：未删除旧服务，也未创建新服务");
        toastWarn("已取消创建服务");
        return;
      }
      try {
        await runCreate(true);
        return;
      } catch (err2) {
        hideProvisionProgress();
        setProvisionStatus(String(err2), true);
        toastError(`创建服务失败：${err2}`);
        return;
      }
    }
    hideProvisionProgress();
    setProvisionStatus(raw, true);
    toastError(`创建服务失败：${raw}`);
  } finally {
    hideProvisionProgress();
    restoreProvisionButton();
    closeBtns.forEach((b) => { b.style.pointerEvents = ""; b.style.opacity = ""; });
  }
});
document.querySelectorAll("[data-close-edit]").forEach((el) => el.addEventListener("click", closeEdit));
document.querySelectorAll("[data-close-folder]").forEach((el) =>
  el.addEventListener("click", () => {
    if (els.folderModal) els.folderModal.hidden = true;
  })
);
document.querySelectorAll("[data-close-folder-sites]").forEach((el) =>
  el.addEventListener("click", closeFolderSites)
);
document.querySelectorAll("[data-close-folder-dedup]").forEach((el) =>
  el.addEventListener("click", closeFolderDedup)
);
document.querySelectorAll("[data-close-folder-delete]").forEach((el) =>
  el.addEventListener("click", closeFolderDelete)
);
document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element) || !e.target.closest("#contextMenu")) hideContextMenu();
});
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => openSettings(btn.dataset.settingsTab || "general"));
});
window.addEventListener("keydown", (e) => {
  // On macOS, Ctrl is reserved for context-menu style interactions;
  // app shortcuts use ⌘ (meta). Elsewhere Ctrl/Meta both work.
  const meta = isMultiSelectModifier(e);
  const target = e.target instanceof Element ? e.target : null;
  const isTextInput = target?.closest("input, textarea, select, [contenteditable]");
  const hasOpenModal = Boolean(document.querySelector(".modal:not([hidden])"));
  // In the account list, Cmd/Ctrl+A mirrors PassMac: select all accounts
  // currently visible under the active filter. Keep native text selection in forms.
  if (meta && (e.key === "a" || e.key === "A") && !isTextInput && !hasOpenModal) {
    e.preventDefault();
    const visibleIds = filteredAccounts().map(accountKey).filter(Boolean);
    selectedAccountIds = new Set(visibleIds);
    selectedId = visibleIds[0] || "";
    // Keep first item as range anchor for subsequent Shift+click.
    selectionAnchorId = visibleIds[0] || "";
    applyAccountSelectionStyles();
    if (visibleIds.length) toastSuccess(`已选择 ${visibleIds.length} 个账号`);
    return;
  }
  // Cmd/Ctrl + , → settings (macOS PassMac parity)
  if (meta && (e.key === "," || e.code === "Comma")) {
    e.preventDefault();
    openSettings("general");
    return;
  }
  // Cmd/Ctrl + N → new account
  if (meta && (e.key === "n" || e.key === "N") && !e.shiftKey) {
    const tag = (e.target && e.target.tagName) || "";
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
      e.preventDefault();
      openEdit(null);
    }
    return;
  }
  if (e.key === "Escape") {
    closeSettings();
    closeEdit();
    closeProvisionModal();
    closeProvisionConfirm(false);
    if (els.folderModal) els.folderModal.hidden = true;
    closeFolderSites();
    closeFolderDedup();
    closeFolderDelete();
    hideContextMenu();
  }
});

// Live UI controls: apply immediately + debounced persist
const bindRange = (input, label, suffix = "") => {
  input?.addEventListener("input", () => {
    if (label) label.textContent = `${input.value}${suffix}`;
    applyUiPrefsFromFormLive();
    scheduleSaveUiPrefs();
  });
  input?.addEventListener("change", () => {
    applyUiPrefsFromFormLive();
    scheduleSaveUiPrefs();
  });
};
bindRange(els.uiTextSize, els.uiTextSizeVal);
bindRange(els.uiButtonSize, els.uiButtonSizeVal);
bindRange(els.uiToastDuration, els.uiToastDurationVal, "s");

els.uiFontFamily?.addEventListener("change", () => {
  applyUiPrefsFromFormLive();
  scheduleSaveUiPrefs();
});

els.btnSaveUi?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnSaveUi, "正在保存…");
  try {
    await saveUiPrefs();
    toastSuccess("界面设置已保存");
  } catch (err) {
    toastError(`保存界面设置失败：${err}`);
  } finally {
    restore();
  }
});
els.showPasswordsGlobally?.addEventListener("change", async () => {
  applyUiPrefsFromFormLive();
  try {
    await saveUiPrefs();
    toastSuccess(uiPrefs.showPasswordsGlobally ? "已全局显示密码" : "已全局隐藏密码");
  } catch (err) {
    toastError(`保存失败：${err}`);
  }
});
els.exportDirectory?.addEventListener("change", () => {
  applyUiPrefsFromFormLive();
  scheduleSaveUiPrefs();
});
els.syncEncKey?.addEventListener("change", () => refreshSyncKeyHints());
els.prevSyncEncKey?.addEventListener("change", () => {
  applyUiPrefsFromFormLive();
  scheduleSaveUiPrefs();
  refreshSyncKeyHints();
});
els.autoSyncInterval?.addEventListener("change", async () => {
  applyUiPrefsFromFormLive();
  try {
    await saveUiPrefs();
    scheduleAutoSync();
    toastSuccess(uiPrefs.autoSyncIntervalMinutes > 0
      ? `自动同步已设为每 ${uiPrefs.autoSyncIntervalMinutes} 分钟`
      : "自动同步已关闭");
  } catch (err) {
    toastError(`保存失败：${err}`);
  }
});
els.webdavEnabled?.addEventListener("change", () => {
  applyUiPrefsFromFormLive();
  scheduleSaveUiPrefs();
});
["webdavBaseUrl", "webdavRemotePath", "webdavUsername", "webdavPassword"].forEach((id) => {
  const el = document.getElementById(id);
  el?.addEventListener("change", () => {
    applyUiPrefsFromFormLive();
    scheduleSaveUiPrefs();
  });
});

const accountPayload = () => ({
  sites: (els.sites.value || "")
    .split(/[,，\n]/)
    .map((site) => site.trim())
    .filter(Boolean),
  username: (els.username.value || "").trim(),
  password: els.password.value || "",
  totpSecret: normalizedTotpSecret(els.totpSecret.value),
  recoveryCodes: els.recoveryCodes.value || "",
  note: els.note.value || "",
});

const selectedFolderIds = () => [...(els.editFolders?.selectedOptions || [])].map((option) => option.value);

const saveAccount = async (closeAfter) => {
  if (!els.accountForm?.reportValidity()) return;
  const payload = accountPayload();
  const folderIds = selectedFolderIds();
  const id = els.accountId.value;
  const restoreButton = setButtonBusy(
    id ? els.btnSaveAccount : closeAfter ? els.btnSaveAccount : els.btnCreateStay,
    id ? "正在保存…" : "正在创建…"
  );
  if (!id) toastWarn("正在创建账号，请稍候…");
  try {
    if (id) {
      await invoke("update_account", { id, input: payload });
      await invoke("set_account_folders", { id, folderIds });
      toastSuccess("已保存");
    } else {
      const created = await invoke("create_account", { input: payload });
      if (folderIds.length && created) {
        await invoke("set_account_folders", { id: accountKey(created), folderIds });
      }
      toastSuccess("账号已创建");
    }
    await refreshState();
    if (id || closeAfter) {
      closeEdit();
    } else {
      els.accountForm.reset();
      els.accountId.value = "";
      populateFolderSelect(folderIds);
      els.sites.focus();
    }
  } catch (err) {
    toastError(`保存失败：${err}`);
  } finally {
    restoreButton();
  }
};

els.accountForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveAccount(true);
});

els.btnCreateStay?.addEventListener("click", () => saveAccount(false));
els.btnConfirmFolderDelete?.addEventListener("click", confirmFolderDelete);
els.btnPasteTotpRaw?.addEventListener("click", pasteTotpRaw);
els.btnPasteTotpUri?.addEventListener("click", () => pasteTotpUri());
els.btnPasteTotpQr?.addEventListener("click", pasteTotpQr);
// Event delegation so provision modal secrets also work.
document.addEventListener("click", (e) => {
  const button = e.target instanceof Element ? e.target.closest("[data-toggle-secret]") : null;
  if (!button) return;
  const input = document.querySelector(`#${button.dataset.toggleSecret}`);
  if (!(input instanceof HTMLInputElement)) return;
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  if (visible) input.dataset.forceVisible = "1";
  else delete input.dataset.forceVisible;
  button.textContent = visible ? "◉" : "◎";
  button.title = visible ? "隐藏" : "显示";
  button.setAttribute("aria-label", button.title);
});

els.folderSitesForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!folderSitesTargetId) return;
  const siteInputs = (els.folderSitesInput?.value || "")
    .split(/[,，\n]/)
    .map((site) => site.trim())
    .filter(Boolean);
  try {
    const result = await invoke("configure_folder_site_rules", {
      folderId: folderSitesTargetId,
      siteInputs,
      autoAdd: Boolean(els.folderAutoAdd?.checked),
    });
    closeFolderSites();
    await refreshState();
    toastSuccess(result.message || `已加入 ${result.addedCount || 0} 个账号`);
  } catch (err) {
    toastError(`保存文件夹规则失败：${err}`);
  }
});

els.btnKeepLatest?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnKeepLatest, "正在去重…");
  try {
    await deduplicateFolder("latest");
  } finally {
    restore();
  }
});
els.btnKeepEarliest?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnKeepEarliest, "正在去重…");
  try {
    await deduplicateFolder("earliest");
  } finally {
    restore();
  }
});

els.btnDelete?.addEventListener("click", async () => {
  const id = els.accountId.value;
  if (!id) return;
  const restore = setButtonBusy(els.btnDelete, "正在删除…");
  try {
    if (filter.type === "recycle") {
      await invoke("hard_delete_account", { id });
      toastSuccess("已永久删除");
    } else {
      await invoke("soft_delete_account", { id });
      toastSuccess("已移入回收站");
    }
    closeEdit();
    await refreshState();
  } catch (err) {
    toastError(`删除失败：${err}`);
  } finally {
    restore();
  }
});

els.btnRestore?.addEventListener("click", async () => {
  const id = els.accountId.value;
  if (!id) return;
  const restore = setButtonBusy(els.btnRestore, "正在恢复…");
  try {
    await invoke("restore_account", { id });
    closeEdit();
    await refreshState();
    toastSuccess("已恢复");
  } catch (err) {
    toastError(`恢复失败：${err}`);
  } finally {
    restore();
  }
});

els.btnRestoreAll?.addEventListener("click", async () => {
  if (!(state.deletedAccounts || []).length) return;
  const restore = setButtonBusy(els.btnRestoreAll, "正在恢复…");
  try {
    const count = await invoke("restore_all_deleted_accounts");
    await refreshState();
    toastSuccess(`已恢复 ${count} 个账号`);
  } catch (err) {
    toastError(`批量恢复失败：${err}`);
  } finally {
    restore();
  }
});

els.btnPurgeRecycle?.addEventListener("click", async () => {
  const count = (state.deletedAccounts || []).length;
  if (!count) return;
  if (!window.confirm(`将永久删除回收站中的 ${count} 个账号，且无法直接撤销。已自动创建本地安全快照。是否继续？`)) {
    return;
  }
  const restore = setButtonBusy(els.btnPurgeRecycle, "正在清空…");
  try {
    const removed = await invoke("hard_delete_all_deleted_accounts");
    await refreshState();
    toastSuccess(`已永久删除 ${removed} 个账号`);
  } catch (err) {
    toastError(`清空回收站失败：${err}`);
  } finally {
    restore();
  }
});

els.btnUndo?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnUndo, "正在撤销…");
  try {
    const message = await invoke("undo_last_operation");
    await refreshState();
    toastSuccess(message || "已撤销最近一次操作");
  } catch (err) {
    toastError(`撤销失败：${err}`);
    await refreshUndoStatus();
  } finally {
    restore();
    await refreshUndoStatus();
    await refreshRedoStatus();
    if (!els.historyModal?.hidden) await refreshOperationHistory();
  }
});

els.btnRedo?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnRedo, "正在重做…");
  try {
    const message = await invoke("redo_last_operation");
    await refreshState();
    toastSuccess(message || "已重做最近一次操作");
  } catch (err) {
    toastError(`重做失败：${err}`);
  } finally {
    restore();
    await refreshUndoStatus();
    await refreshRedoStatus();
    if (!els.historyModal?.hidden) await refreshOperationHistory();
  }
});

els.btnHistory?.addEventListener("click", () => openHistory().catch((err) => toastError(`打开历史失败：${err}`)));
els.historyUndoLatest?.addEventListener("click", () => els.btnUndo?.click());
els.historyRedoLatest?.addEventListener("click", () => els.btnRedo?.click());
document.querySelectorAll("[data-close-history]").forEach((el) => el.addEventListener("click", closeHistory));

els.btnSaveDevice?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnSaveDevice, "正在保存…");
  try {
    await invoke("set_device_name", { deviceName: els.deviceName.value });
    await refreshState();
    toastSuccess("设备名已保存");
  } catch (err) {
    toastError(`保存失败：${err}`);
  } finally {
    restore();
  }
});
els.btnExport?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnExport, "正在导出…");
  try {
    await saveUiPrefs().catch(() => {});
    const r = await invoke("export_csv_to_path", {
      path: null,
    });
    toastSuccess(r.message || `CSV：${r.path}`);
  } catch (err) {
    try {
      const r = await invoke("export_csv");
      toastSuccess(`CSV：${r.csvPath}`);
    } catch (e2) {
      toastError(`导出失败：${err}`);
    }
  } finally {
    restore();
  }
});

const exportBrowser = async (format, btn) => {
  const restore = setButtonBusy(btn, "正在导出…");
  try {
    const r = await invoke("export_browser_csv_cmd", { format, path: null });
    toastSuccess(r.message || r.path);
  } catch (err) {
    toastError(`导出失败：${err}`);
  } finally {
    restore();
  }
};
els.btnExportChrome?.addEventListener("click", (e) => exportBrowser("chrome", e.currentTarget));
els.btnExportFirefox?.addEventListener("click", (e) => exportBrowser("firefox", e.currentTarget));
els.btnExportSafari?.addEventListener("click", (e) => exportBrowser("safari", e.currentTarget));

els.btnImportBrowser?.addEventListener("click", () => els.fileBrowserCsv?.click());
els.fileBrowserCsv?.addEventListener("change", async () => {
  const file = els.fileBrowserCsv.files?.[0];
  if (!file) return;
  toastWarn("正在导入，请稍候…");
  try {
    const text = await readFileAsText(file);
    const r = await invoke("import_browser_csv_text", { content: text });
    await refreshState();
    toastSuccess(r.message || `已导入 ${r.imported} 条`);
  } catch (err) {
    toastError(`导入失败：${err}`);
  } finally {
    els.fileBrowserCsv.value = "";
  }
});

els.btnImportGoogleAuthenticator?.addEventListener("click", () => els.fileGoogleAuthenticator?.click());
els.fileGoogleAuthenticator?.addEventListener("change", async () => {
  const files = [...(els.fileGoogleAuthenticator?.files || [])];
  if (!files.length) return;
  try {
    const entries = [];
    for (const file of files) {
      const data = await decodeQrFile(file);
      entries.push(...googleMigrationEntries(data));
    }
    if (!entries.length) throw new Error("没有识别到有效的 Google Authenticator 导出二维码");
    const result = await invoke("import_google_authenticator_totp", { entries });
    await refreshState();
    toastSuccess(`验证器导入完成：新增 ${result.created}，更新 ${result.updated}，跳过 ${result.skipped}`);
  } catch (err) {
    toastError(`验证器导入失败：${err}`);
  } finally {
    if (els.fileGoogleAuthenticator) els.fileGoogleAuthenticator.value = "";
  }
});

els.btnExportBundle?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnExportBundle, "正在导出…");
  try {
    await saveAllSyncRelated().catch(() => {});
    const r = await invoke("export_sync_bundle", { path: null });
    toastSuccess(r.message || r.path);
  } catch (err) {
    toastError(`导出同步包失败：${err}`);
  } finally {
    restore();
  }
});
els.btnImportBundle?.addEventListener("click", () => els.fileSyncBundle?.click());
els.fileSyncBundle?.addEventListener("change", async () => {
  const file = els.fileSyncBundle.files?.[0];
  if (!file) return;
  toastWarn("正在导入，请稍候…");
  try {
    const text = await readFileAsText(file);
    const raw = await invoke("import_sync_bundle_text", { content: text, apply: false });
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!result.safe) {
      toastWarn(result.message || "安全检查未通过，未写入");
      if (els.syncPreviewOut) {
        els.syncPreviewOut.hidden = false;
        els.syncPreviewOut.textContent = JSON.stringify(result, null, 2);
      }
      openSettings("sync");
      return;
    }
    const ok = window.confirm(
      `${result.message || "可以合并"}\n\n确定写入本地 vault 吗？`
    );
    if (!ok) {
      toastWarn("已取消导入");
      return;
    }
    const raw2 = await invoke("import_sync_bundle_text", { content: text, apply: true });
    const result2 = typeof raw2 === "string" ? JSON.parse(raw2) : raw2;
    await refreshState();
    toastSuccess(result2.message || "同步包已合并写入");
  } catch (err) {
    toastError(`导入同步包失败：${err}`);
  } finally {
    els.fileSyncBundle.value = "";
  }
});

els.btnDemo?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnDemo, "正在生成…");
  toastWarn("正在生成演示数据，请稍候…");
  try {
    await invoke("generate_demo_accounts");
    await refreshState();
    toastSuccess("已生成演示数据");
  } catch (err) {
    toastError(`生成失败：${err}`);
  } finally {
    restore();
  }
});
els.btnHealth?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnHealth, "正在检查…");
  try {
    const h = await invoke("health_check");
    if (els.debugOut) els.debugOut.textContent = JSON.stringify(h, null, 2);
    openSettings("debug");
  } catch (err) {
    toastError(`检查失败：${err}`);
  } finally {
    restore();
  }
});

els.btnSaveSync?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnSaveSync, "正在保存…");
  try {
    await saveAllSyncRelated();
    toastSuccess("同步设置已保存");
  } catch (err) {
    toastError(`保存失败：${err}`);
  } finally {
    restore();
  }
});
els.btnGenSyncKey?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnGenSyncKey, "正在生成…");
  try {
    const key = await invoke("generate_sync_encryption_key");
    if (els.syncEncKey) els.syncEncKey.value = key;
    await refreshSyncKeyHints();
    toastSuccess("已生成同步密钥");
  } finally {
    restore();
  }
});
els.btnCopySyncKey?.addEventListener("click", async () => {
  const key = els.syncEncKey?.value || "";
  if (!key) {
    toastWarn("当前无同步密钥");
    return;
  }
  try {
    await navigator.clipboard.writeText(key);
    toastSuccess("同步密钥已复制");
  } catch {
    toastError("复制失败");
  }
});
els.btnSyncPreview?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnSyncPreview, "正在预览…");
  try {
    await saveAllSyncRelated();
    const raw = await invoke("sync_preview");
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (els.syncPreviewOut) {
      els.syncPreviewOut.hidden = false;
      els.syncPreviewOut.textContent = JSON.stringify(result.report || result, null, 2);
    }
    renderSyncDecisionSummary(result.report || result);
    toastSuccess(result.report?.message || "预览完成");
  } catch (err) {
    toastError(`预览失败：${err}`);
  } finally {
    restore();
  }
});
els.btnSyncMerge?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnSyncMerge, "正在同步…");
  try {
    if (els.syncMode) els.syncMode.value = "merge";
    await runSyncMode("merge");
  } catch (err) {
    toastError(`同步失败：${err}`);
  } finally {
    restore();
  }
});
els.btnSyncRemoteOverwrite?.addEventListener("click", async () => {
  if (
    !window.confirm(
      "云端覆盖本地会用远端数据替换本机 vault。\n若远端为空或不可达可能导致数据丢失。\n确定继续吗？"
    )
  ) {
    return;
  }
  const restore = setButtonBusy(els.btnSyncRemoteOverwrite, "正在同步…");
  try {
    if (els.syncMode) els.syncMode.value = "remoteOverwriteLocal";
    await runSyncMode("remoteOverwriteLocal");
  } catch (err) {
    toastError(`同步失败：${err}`);
  } finally {
    restore();
  }
});
els.btnSyncLocalOverwrite?.addEventListener("click", async () => {
  if (
    !window.confirm(
      "本地覆盖云端会把本机数据推到服务器并覆盖远端。\n确定继续吗？"
    )
  ) {
    return;
  }
  const restore = setButtonBusy(els.btnSyncLocalOverwrite, "正在同步…");
  try {
    if (els.syncMode) els.syncMode.value = "localOverwriteRemote";
    await runSyncMode("localOverwriteRemote");
  } catch (err) {
    toastError(`同步失败：${err}`);
  } finally {
    restore();
  }
});
els.btnSyncNow?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnSyncNow, "正在同步…");
  try {
    await runSyncNow();
  } catch (err) {
    toastError(`同步失败：${err}`);
    openSettings("sync");
  } finally {
    restore();
  }
});
els.btnSyncNowSettings?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnSyncNowSettings, "正在同步…");
  try {
    await runSyncNow();
  } catch (err) {
    toastError(`同步失败：${err}`);
  } finally {
    restore();
  }
});

els.btnLoadVersions?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnLoadVersions, "正在读取…");
  try {
    await saveAllSyncRelated().catch(() => {});
    const list = await invoke("list_server_versions");
    if (els.syncVersionsStatus) {
      els.syncVersionsStatus.textContent = list.length
        ? `共 ${list.length} 个快照`
        : "暂无快照";
    }
    if (els.syncVersionsList) {
      els.syncVersionsList.innerHTML = "";
      for (const v of list) {
        const row = document.createElement("div");
        row.className = "version-row";
        const span = document.createElement("span");
        span.textContent = `版本 ${v.id} · 导出 ${formatTimeMs(v.exportedAtMs)} · 保存 ${formatTimeMs(v.savedAtMs)} · ${(v.payloadSha256 || "").slice(0, 12)}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "恢复";
        btn.addEventListener("click", async () => {
          if (!window.confirm(`恢复服务器快照 ${v.id}？本机数据将被替换。`)) return;
          const restoreBtn = setButtonBusy(btn, "正在恢复…");
          try {
            const msg = await invoke("restore_server_version", { versionId: v.id });
            await refreshState();
            toastSuccess(msg);
          } catch (err) {
            toastError(`恢复失败：${err}`);
          } finally {
            restoreBtn();
          }
        });
        row.append(span, btn);
        els.syncVersionsList.appendChild(row);
      }
    }
  } catch (err) {
    if (els.syncVersionsStatus) els.syncVersionsStatus.textContent = String(err);
    toastError(`读取快照失败：${err}`);
  } finally {
    restore();
  }
});

els.btnLoadLocalSnapshots?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnLoadLocalSnapshots, "正在读取…");
  try {
    const list = await invoke("list_local_snapshots");
    if (els.localSnapshotsStatus) {
      els.localSnapshotsStatus.textContent = list.length
        ? `共 ${list.length} 个本地安全快照`
        : "暂无本地安全快照";
    }
    if (els.localSnapshotsList) {
      els.localSnapshotsList.innerHTML = "";
      for (const snapshot of list) {
        const row = document.createElement("div");
        row.className = "version-row";
        const span = document.createElement("span");
        span.textContent = `${snapshot.reason} · ${formatTimeMs(snapshot.createdAtMs)} · 账号 ${snapshot.accounts} · 文件夹 ${snapshot.folders} · 通行密钥 ${snapshot.passkeys}`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "恢复";
        btn.addEventListener("click", async () => {
          if (!window.confirm("恢复本地安全快照会替换当前 vault；当前数据也会先自动备份。确定继续吗？")) return;
          const restoreBtn = setButtonBusy(btn, "正在恢复…");
          try {
            const msg = await invoke("restore_local_snapshot", { snapshotId: snapshot.id });
            await refreshState();
            toastSuccess(msg);
          } catch (err) {
            toastError(`恢复本地安全快照失败：${err}`);
          } finally {
            restoreBtn();
          }
        });
        row.append(span, btn);
        els.localSnapshotsList.appendChild(row);
      }
    }
  } catch (err) {
    if (els.localSnapshotsStatus) els.localSnapshotsStatus.textContent = String(err);
    toastError(`读取本地安全快照失败：${err}`);
  } finally {
    restore();
  }
});

els.btnLoadLocal?.addEventListener("click", async () => {
  await refreshState();
  if (els.localPayload) els.localPayload.value = JSON.stringify(buildLocalSyncPayload(), null, 2);
});
els.btnClearRemote?.addEventListener("click", () => {
  if (els.remotePayload) els.remotePayload.value = "";
});
els.btnFillEmptyRemote?.addEventListener("click", () => {
  if (els.remotePayload) {
    els.remotePayload.value = JSON.stringify({ accounts: [], folders: [], passkeys: [] }, null, 2);
  }
});
els.btnOpenMerge?.addEventListener("click", () => {
  if (els.mergePanel) els.mergePanel.hidden = false;
  openSettings("debug");
});
els.btnMergePreview?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnMergePreview, "正在合并…");
  try {
    const localObj = (els.localPayload?.value || "").trim()
      ? extractPayload(els.localPayload.value, "本地")
      : buildLocalSyncPayload();
    const remoteObj = extractPayload(els.remotePayload?.value, "远端");
    const raw = await invoke("merge_sync_payloads", {
      localJson: JSON.stringify(localObj),
      remoteJson: JSON.stringify(remoteObj),
    });
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (els.mergeResult) els.mergeResult.hidden = false;
    if (els.mergeSummary) {
      els.mergeSummary.textContent = `safe=${result.safe}\n${(result.reasons || []).join(", ")}`;
    }
    if (els.mergePayloadOut) els.mergePayloadOut.textContent = JSON.stringify(result.payload, null, 2);
    toastSuccess("JSON 合并预览完成");
  } catch (err) {
    toastError(`预览失败：${err}`);
  } finally {
    restore();
  }
});

els.btnUnlock?.addEventListener("click", async () => {
  if (els.btnUnlock) els.btnUnlock.disabled = true;
  try {
    lockState = await invoke("lock_unlock", { password: els.unlockPassword?.value || "" });
    if (els.unlockPassword) els.unlockPassword.value = "";
    if (els.lockError) els.lockError.textContent = "";
    applyLockUi();
    await refreshState();
    await loadSyncSettings();
    await loadUiPrefs();
    toastSuccess("已解锁");
  } catch (err) {
    if (els.lockError) els.lockError.textContent = String(err);
  } finally {
    if (els.btnUnlock) els.btnUnlock.disabled = false;
  }
});
els.btnUnlockBiometric?.addEventListener("click", async () => {
  if (els.btnUnlockBiometric) els.btnUnlockBiometric.disabled = true;
  try {
    lockState = await invoke("lock_unlock_biometric");
    if (els.lockError) els.lockError.textContent = "";
    applyLockUi();
    await refreshState();
    await loadSyncSettings();
    await loadUiPrefs();
    toastSuccess("已通过指纹解锁");
  } catch (err) {
    if (els.lockError) els.lockError.textContent = String(err);
    // Fall back to password field after biometric cancel/fail.
    els.unlockPassword?.focus();
  } finally {
    if (els.btnUnlockBiometric) els.btnUnlockBiometric.disabled = false;
  }
});
els.btnLockEnable?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnLockEnable, "正在启用…");
  try {
    const password = (els.lockPassword?.value || "").trim();
    const confirm = (els.lockPassword2?.value || "").trim();
    if (!password) {
      toastError("请输入主密码");
      return;
    }
    if (password !== confirm) {
      toastError("两次输入的主密码不一致");
      return;
    }
    lockState = await invoke("lock_enable", {
      password,
      confirm,
      idleLockMinutes: Number(els.idleMinutes?.value || 5),
      lockPolicy: els.lockPolicy?.value || "onceUntilQuit",
      preferBiometrics: Boolean(els.preferBiometrics?.checked),
      backgroundLockDelaySeconds: Number(els.backgroundLockDelay?.value || 60),
    });
    try {
      await saveAllSyncRelated();
    } catch (_) {}
    if (els.lockPassword) els.lockPassword.value = "";
    if (els.lockPassword2) els.lockPassword2.value = "";
    await refreshBiometricAvailability();
    applyLockUi();
    toastSuccess(
      biometricAvailable && lockState.biometricReady
        ? "应用锁已启用，可用指纹解锁"
        : biometricAvailable
          ? "应用锁已启用；锁定后可用指纹（已写入指纹会话）"
          : "应用锁已启用"
    );
  } catch (err) {
    toastError(`启用失败：${err}`);
  } finally {
    restore();
  }
});
els.btnLockChangePassword?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnLockChangePassword, "正在更换…");
  try {
    const oldPassword = els.lockCurrentPassword?.value || "";
    const newPassword = els.lockNewPassword?.value || "";
    const confirm = els.lockNewPassword2?.value || "";
    if (!oldPassword || !newPassword) {
      throw new Error("请输入当前主密码和新主密码");
    }
    if (newPassword !== confirm) {
      throw new Error("两次输入的新主密码不一致");
    }
    lockState = await invoke("lock_change_password", { oldPassword, newPassword, confirm });
    for (const input of [els.lockCurrentPassword, els.lockNewPassword, els.lockNewPassword2]) {
      if (input) input.value = "";
    }
    applyLockUi();
    toastSuccess("主密码已更换");
  } catch (err) {
    toastError(`更换主密码失败：${err}`);
  } finally {
    restore();
  }
});
els.btnLockDisable?.addEventListener("click", async () => {
  if (els.btnLockDisable) els.btnLockDisable.disabled = true;
  try {
    lockState = await invoke("lock_disable", { password: els.lockPassword?.value || "" });
    if (els.lockPassword) els.lockPassword.value = "";
    if (els.lockPassword2) els.lockPassword2.value = "";
    await refreshBiometricAvailability();
    applyLockUi();
    toastSuccess("应用锁已关闭");
  } catch (err) {
    toastError(`关闭失败：${err}`);
  } finally {
    if (els.btnLockDisable) els.btnLockDisable.disabled = false;
  }
});
els.btnLockIdle?.addEventListener("click", async () => {
  const restore = setButtonBusy(els.btnLockIdle, "正在保存…");
  try {
    lockState = await invoke("lock_save_preferences", {
      lockPolicy: els.lockPolicy?.value || "onceUntilQuit",
      idleLockMinutes: Number(els.idleMinutes?.value || 5),
      preferBiometrics: Boolean(els.preferBiometrics?.checked),
      backgroundLockDelaySeconds: Number(els.backgroundLockDelay?.value || 60),
    });
    applyLockUi();
    toastSuccess("锁定策略已保存");
  } catch (err) {
    toastError(String(err));
  } finally {
    restore();
  }
});
const doLockNow = async () => {
  await invoke("lock_now");
  await refreshLock();
  state = { activeAccounts: [], deletedAccounts: [], folders: [], passkeys: [], deviceName: "" };
  closeEdit();
  closeSettings();
  render();
  toastSuccess("已锁定");
};
els.btnLockNow?.addEventListener("click", doLockNow);
els.btnLockNowSettings?.addEventListener("click", doLockNow);

const boot = async () => {
  await refreshLock();
  await loadUiPrefs();
  if (!(lockState.enabled && lockState.locked)) {
    await refreshState();
    await loadSyncSettings();
  }
  if (activityTimer) clearInterval(activityTimer);
  activityTimer = setInterval(async () => {
    try {
      const prev = lockState.locked;
      await refreshLock();
      if (!prev && lockState.locked) {
        state = { activeAccounts: [], deletedAccounts: [], folders: [], passkeys: [], deviceName: "" };
        closeEdit();
        closeSettings();
        render();
        toastSuccess("空闲超时，已锁定");
      }
    } catch (_) {}
  }, 15000);
  if (totpTimer) clearInterval(totpTimer);
  totpTimer = setInterval(() => refreshTotpRows(), 1000);
  window.addEventListener("pointerdown", () => noteActivity());
  window.addEventListener("keydown", () => noteActivity());
};

await boot();
