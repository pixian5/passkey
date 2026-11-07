import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyState,
  normalizeAppState,
  createDefaultLockState,
  normalizeLockState,
  createDefaultUiPrefs,
  normalizeUiPrefs,
  computeUiStyleProperties,
  SECRET_INPUT_IDS,
  extractUiPrefsFromElements,
  applyUiPrefsToElements,
  SelectionModel,
  VaultStore,
} from "../../codex-tauri/src/store.js";

test("createEmptyState and normalizeAppState provide deterministic structure", () => {
  const empty = createEmptyState();
  assert.deepEqual(empty.activeAccounts, []);
  assert.deepEqual(empty.deletedAccounts, []);
  assert.deepEqual(empty.folders, []);
  assert.deepEqual(empty.passkeys, []);
  assert.deepEqual(empty.allRegularAccountIds, []);
  assert.equal(empty.deviceName, "");
  assert.equal(empty.businessRevision, 0);

  const normalized = normalizeAppState({
    activeAccounts: [{ id: "acc1" }],
    deviceName: "My MacBook",
    businessRevision: "42",
  });
  assert.equal(normalized.activeAccounts.length, 1);
  assert.equal(normalized.deviceName, "My MacBook");
  assert.equal(normalized.businessRevision, 42);
  assert.deepEqual(normalized.deletedAccounts, []);
  assert.deepEqual(normalized.folders, []);
});

test("createDefaultLockState and normalizeLockState handle coercions", () => {
  const lock = createDefaultLockState();
  assert.equal(lock.enabled, false);
  assert.equal(lock.locked, false);
  assert.equal(lock.idleLockMinutes, 5);

  const normalized = normalizeLockState({
    enabled: 1,
    locked: "true",
    idleLockMinutes: "10",
  });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.locked, true);
  assert.equal(normalized.idleLockMinutes, 10);
});

test("normalizeUiPrefs merges defaults and validates numeric properties", () => {
  const prefs = normalizeUiPrefs({
    fontFamily: "Menlo",
    textFontSize: "16",
    toastDurationSeconds: "3.5",
    showPasswordsGlobally: true,
  });
  assert.equal(prefs.fontFamily, "Menlo");
  assert.equal(prefs.textFontSize, 16);
  assert.equal(prefs.toastDurationSeconds, 3.5);
  assert.equal(prefs.showPasswordsGlobally, true);
  assert.equal(prefs.webdavRemotePath, "pass-sync-bundle-v2.json");
});

test("computeUiStyleProperties calculates css variables and font family fallback", () => {
  const defaultStyles = computeUiStyleProperties();
  assert.ok(defaultStyles.font.includes("SF Pro Text"));
  assert.equal(defaultStyles.textSizePx, "14px");
  assert.equal(defaultStyles.buttonSizePx, "13px");
  assert.equal(defaultStyles.scale, "1");
  assert.equal(defaultStyles.btnScale, "1");

  const customStyles = computeUiStyleProperties({
    fontFamily: "Fira Code",
    textFontSize: 16,
    buttonFontSize: 14,
  });
  assert.ok(customStyles.font.startsWith('"Fira Code"'));
  assert.equal(customStyles.textSizePx, "16px");
  assert.equal(customStyles.buttonSizePx, "14px");
});

test("SECRET_INPUT_IDS freezes list of all sensitive input IDs across dialogs", () => {
  assert.ok(Array.isArray(SECRET_INPUT_IDS));
  assert.ok(SECRET_INPUT_IDS.includes("password"));
  assert.ok(SECRET_INPUT_IDS.includes("totpSecret"));
  assert.ok(SECRET_INPUT_IDS.includes("provisionSecretPassword"));
  assert.ok(SECRET_INPUT_IDS.includes("provisionToken"));
  assert.equal(Object.isFrozen(SECRET_INPUT_IDS), true);
});

test("extractUiPrefsFromElements and applyUiPrefsToElements roundtrip UI preferences", () => {
  const mockElements = {
    uiFontFamily: { value: "PingFang SC" },
    uiTextSize: { value: "15" },
    uiTextSizeVal: { textContent: "" },
    uiButtonSize: { value: "14" },
    uiButtonSizeVal: { textContent: "" },
    uiToastDuration: { value: "3" },
    uiToastDurationVal: { textContent: "" },
    showPasswordsGlobally: { checked: true },
    exportDirectory: { value: "  /backups  " },
    autoSyncInterval: { value: "10" },
    prevSyncEncKey: { value: "  oldKey  " },
    webdavEnabled: { checked: true },
    webdavBaseUrl: { value: "  https://dav.example.com  " },
    webdavRemotePath: { value: "  pass-backup.json  " },
    webdavUsername: { value: "  davuser  " },
    webdavPassword: { value: "davpass" },
    syncPrimarySource: { value: "webdav" },
  };

  const extracted = extractUiPrefsFromElements(mockElements, { lastSyncPrimaryFingerprint: "fp123" });
  assert.equal(extracted.fontFamily, "PingFang SC");
  assert.equal(extracted.textFontSize, 15);
  assert.equal(extracted.buttonFontSize, 14);
  assert.equal(extracted.toastDurationSeconds, 3);
  assert.equal(extracted.showPasswordsGlobally, true);
  assert.equal(extracted.exportDirectory, "/backups");
  assert.equal(extracted.autoSyncIntervalMinutes, 10);
  assert.equal(extracted.previousEncryptionKey, "oldKey");
  assert.equal(extracted.webdavEnabled, true);
  assert.equal(extracted.webdavBaseUrl, "https://dav.example.com");
  assert.equal(extracted.webdavRemotePath, "pass-backup.json");
  assert.equal(extracted.webdavUsername, "davuser");
  assert.equal(extracted.webdavPassword, "davpass");
  assert.equal(extracted.syncPrimarySource, "webdav");
  assert.equal(extracted.lastSyncPrimaryFingerprint, "fp123");

  // Roundtrip back to target elements
  const targetElements = {
    uiFontFamily: {},
    uiTextSize: {},
    uiTextSizeVal: {},
    uiButtonSize: {},
    uiButtonSizeVal: {},
    uiToastDuration: {},
    uiToastDurationVal: {},
    showPasswordsGlobally: {},
    exportDirectory: {},
    autoSyncInterval: {},
    prevSyncEncKey: {},
    webdavEnabled: {},
    webdavBaseUrl: {},
    webdavRemotePath: {},
    webdavUsername: {},
    webdavPassword: {},
    syncPrimarySource: {},
  };
  applyUiPrefsToElements(targetElements, extracted);
  assert.equal(targetElements.uiFontFamily.value, "PingFang SC");
  assert.equal(targetElements.uiTextSize.value, "15");
  assert.equal(targetElements.uiTextSizeVal.textContent, "15");
  assert.equal(targetElements.uiButtonSize.value, "14");
  assert.equal(targetElements.uiButtonSizeVal.textContent, "14");
  assert.equal(targetElements.uiToastDuration.value, "3");
  assert.equal(targetElements.uiToastDurationVal.textContent, "3s");
  assert.equal(targetElements.showPasswordsGlobally.checked, true);
  assert.equal(targetElements.exportDirectory.value, "/backups");
  assert.equal(targetElements.autoSyncInterval.value, "10");
  assert.equal(targetElements.prevSyncEncKey.value, "oldKey");
  assert.equal(targetElements.webdavEnabled.checked, true);
  assert.equal(targetElements.webdavBaseUrl.value, "https://dav.example.com");
  assert.equal(targetElements.webdavRemotePath.value, "pass-backup.json");
  assert.equal(targetElements.webdavUsername.value, "davuser");
  assert.equal(targetElements.webdavPassword.value, "davpass");
  assert.equal(targetElements.syncPrimarySource.value, "webdav");
});

test("SelectionModel manages single, toggle, range, and selectAll selection", () => {
  const sel = new SelectionModel();
  assert.equal(sel.count(), 0);

  // Single select
  sel.selectOnly("a1");
  assert.equal(sel.selectedId, "a1");
  assert.equal(sel.selectionAnchorId, "a1");
  assert.equal(sel.has("a1"), true);
  assert.equal(sel.count(), 1);

  // Toggle
  sel.toggle("a2");
  assert.equal(sel.has("a1"), true);
  assert.equal(sel.has("a2"), true);
  assert.equal(sel.count(), 2);
  assert.equal(sel.selectedId, "a2");
  assert.equal(sel.selectionAnchorId, "a1"); // Anchor unchanged

  sel.toggle("a1");
  assert.equal(sel.has("a1"), false);
  assert.equal(sel.count(), 1);

  // Range select
  const ordered = ["a1", "a2", "a3", "a4", "a5"];
  sel.selectOnly("a2");
  sel.selectRange("a4", ordered);
  assert.equal(sel.count(), 3);
  assert.deepEqual(sel.ids().sort(), ["a2", "a3", "a4"]);
  assert.equal(sel.selectedId, "a4");

  // Select all
  sel.selectAll(["a1", "a2", "a3"]);
  assert.equal(sel.count(), 3);
  assert.equal(sel.has("a1"), true);
  assert.equal(sel.has("a2"), true);
  assert.equal(sel.has("a3"), true);

  // Clear
  sel.clear();
  assert.equal(sel.count(), 0);
  assert.equal(sel.selectedId, "");
  assert.equal(sel.selectionAnchorId, "");
});

test("SelectionModel prunes removed account IDs safely", () => {
  const sel = new SelectionModel();
  sel.selectAll(["a1", "a2", "a3"]);
  sel.selectOnly("a2");

  // Prune with a set of active IDs that excludes a2 and a3
  sel.prune(new Set(["a1", "a4"]));
  assert.equal(sel.has("a1"), false); // was cleared by selectOnly("a2")
  assert.equal(sel.count(), 0);

  sel.selectAll(["a1", "a2", "a3"]);
  sel.prune(["a2", "a3"]);
  assert.equal(sel.count(), 2);
  assert.equal(sel.has("a1"), false);
  assert.equal(sel.has("a2"), true);
  assert.equal(sel.has("a3"), true);
});

test("VaultStore dispatches reactive events and clears sensitive data on lock", () => {
  const store = new VaultStore({ deviceName: "Initial Device" });
  assert.equal(store.state.deviceName, "Initial Device");

  const events = [];
  const unsubscribe = store.subscribe((evt, payload) => {
    events.push({ evt, payload });
  });

  store.setAppState({
    activeAccounts: [{ id: "acc1", username: "user1" }],
    deviceName: "Updated Device",
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].evt, "state-change");
  assert.equal(store.state.activeAccounts.length, 1);

  store.selection.selectOnly("acc1");
  assert.equal(store.selection.count(), 1);

  // Clear sensitive state on lock
  store.clearSensitiveState();
  assert.equal(events.length, 2);
  assert.equal(events[1].evt, "state-cleared");
  assert.equal(store.state.activeAccounts.length, 0);
  assert.equal(store.selection.count(), 0);

  unsubscribe();
  store.setLockState({ locked: true });
  // Listener was unsubscribed, so no new events pushed
  assert.equal(events.length, 2);
  assert.equal(store.lockState.locked, true);
});
