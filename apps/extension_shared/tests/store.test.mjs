import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyState,
  normalizeAppState,
  createDefaultLockState,
  normalizeLockState,
  createDefaultUiPrefs,
  normalizeUiPrefs,
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
