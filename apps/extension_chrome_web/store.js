/**
 * pass vault store & state model
 *
 * 状态与选择管理器：将保密库状态、锁定状态、用户偏好与多选模型纯函数化与对象化，
 * 零 DOM 依赖，提供同构可测的状态归一化与响应式机制。
 */

export const createEmptyState = () => ({
  activeAccounts: [],
  deletedAccounts: [],
  folders: [],
  passkeys: [],
  allRegularAccountIds: [],
  deviceName: "",
});

export const normalizeAppState = (raw = {}) => ({
  activeAccounts: Array.isArray(raw?.activeAccounts) ? raw.activeAccounts : [],
  deletedAccounts: Array.isArray(raw?.deletedAccounts) ? raw.deletedAccounts : [],
  folders: Array.isArray(raw?.folders) ? raw.folders : [],
  passkeys: Array.isArray(raw?.passkeys) ? raw.passkeys : [],
  allRegularAccountIds: Array.isArray(raw?.allRegularAccountIds) ? raw.allRegularAccountIds : [],
  deviceName: typeof raw?.deviceName === "string" ? raw.deviceName : "",
});

export const createDefaultLockState = () => ({
  enabled: false,
  locked: false,
  idleLockMinutes: 5,
  hasPassword: false,
  lockPolicy: "onceUntilQuit",
  preferBiometrics: true,
  biometricReady: false,
});

export const normalizeLockState = (raw = {}) => {
  const defaults = createDefaultLockState();
  return {
    ...defaults,
    ...(raw || {}),
    enabled: Boolean(raw?.enabled),
    locked: Boolean(raw?.locked),
    idleLockMinutes: Number(raw?.idleLockMinutes ?? defaults.idleLockMinutes),
    hasPassword: Boolean(raw?.hasPassword),
    preferBiometrics: raw?.preferBiometrics !== false,
    biometricReady: Boolean(raw?.biometricReady),
  };
};

export const createDefaultUiPrefs = () => ({
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
  lastSyncPrimaryFingerprint: "",
});

export const normalizeUiPrefs = (raw = {}) => {
  const defaults = createDefaultUiPrefs();
  const merged = { ...defaults, ...(raw || {}) };
  return {
    ...merged,
    textFontSize: Number(merged.textFontSize || 14),
    buttonFontSize: Number(merged.buttonFontSize || 13),
    toastDurationSeconds: Number(merged.toastDurationSeconds || 2.5),
    autoSyncIntervalMinutes: Number(merged.autoSyncIntervalMinutes || 0),
    showPasswordsGlobally: Boolean(merged.showPasswordsGlobally),
    webdavEnabled: Boolean(merged.webdavEnabled),
  };
};

/**
 * 账号列表单选 / 多选 / 范围选取模型
 */
export class SelectionModel {
  constructor() {
    this.selectedId = "";
    this.selectedAccountIds = new Set();
    this.selectionAnchorId = "";
  }

  selectOnly(key) {
    const target = key ? String(key) : "";
    this.selectedId = target;
    this.selectedAccountIds = target ? new Set([target]) : new Set();
    this.selectionAnchorId = target;
  }

  toggle(key) {
    if (!key) return;
    const target = String(key);
    if (this.selectedAccountIds.has(target)) {
      this.selectedAccountIds.delete(target);
    } else {
      this.selectedAccountIds.add(target);
    }
    this.selectedId = target;
    if (!this.selectionAnchorId) {
      this.selectionAnchorId = target;
    }
  }

  selectRange(key, orderedKeys) {
    const keys = (orderedKeys || []).map(String);
    const target = String(key || "");
    let anchor = this.selectionAnchorId || this.selectedId || target;
    if (!keys.includes(String(anchor))) {
      const visibleSelected = [...this.selectedAccountIds].find((id) => keys.includes(String(id)));
      anchor = visibleSelected || target;
      this.selectionAnchorId = anchor;
    }
    const anchorIndex = keys.indexOf(String(anchor));
    const targetIndex = keys.indexOf(target);
    if (anchorIndex === -1 || targetIndex === -1) {
      this.selectOnly(key);
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    this.selectedAccountIds = new Set(keys.slice(start, end + 1));
    this.selectedId = target;
  }

  selectAll(keys) {
    const list = (keys || []).map(String);
    this.selectedAccountIds = new Set(list);
    if (!this.selectedAccountIds.has(this.selectedId)) {
      this.selectedId = list[0] || "";
    }
    if (!this.selectedAccountIds.has(this.selectionAnchorId)) {
      this.selectionAnchorId = this.selectedId;
    }
  }

  clear() {
    this.selectedId = "";
    this.selectedAccountIds.clear();
    this.selectionAnchorId = "";
  }

  prune(validIds) {
    const valid = validIds instanceof Set ? validIds : new Set(validIds || []);
    this.selectedAccountIds = new Set([...this.selectedAccountIds].filter((id) => valid.has(id)));
    if (this.selectedId && !valid.has(this.selectedId)) {
      this.selectedId = "";
    }
    if (this.selectionAnchorId && !valid.has(this.selectionAnchorId)) {
      this.selectionAnchorId = this.selectedAccountIds.values().next().value || "";
    }
  }

  has(key) {
    return this.selectedAccountIds.has(String(key));
  }

  count() {
    return this.selectedAccountIds.size;
  }

  ids() {
    return Array.from(this.selectedAccountIds);
  }
}

/**
 * 响应式保密库 Store
 */
export class VaultStore {
  constructor(initialState = {}) {
    this.state = normalizeAppState(initialState);
    this.lockState = createDefaultLockState();
    this.uiPrefs = createDefaultUiPrefs();
    this.filter = { type: "all" };
    this.selection = new SelectionModel();
    this._listeners = new Set();
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  notify(event, payload) {
    for (const listener of this._listeners) {
      try {
        listener(event, payload, this);
      } catch (err) {
        console.error("VaultStore listener error:", err);
      }
    }
  }

  setAppState(nextState) {
    this.state = normalizeAppState(nextState);
    this.notify("state-change", this.state);
  }

  clearSensitiveState() {
    this.state = createEmptyState();
    this.selection.clear();
    this.notify("state-cleared", this.state);
  }

  setLockState(nextLock) {
    this.lockState = normalizeLockState({ ...this.lockState, ...(nextLock || {}) });
    this.notify("lock-change", this.lockState);
  }

  setFilter(filter) {
    this.filter = filter || { type: "all" };
    this.notify("filter-change", this.filter);
  }

  setUiPrefs(prefs) {
    this.uiPrefs = normalizeUiPrefs({ ...this.uiPrefs, ...(prefs || {}) });
    this.notify("prefs-change", this.uiPrefs);
  }
}
