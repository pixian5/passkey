import test from "node:test";
import assert from "node:assert/strict";

import {
  isDndDragEvent,
  computeDropLineStyle,
  computeDropPlacement,
  computeFloatStyle,
  planFolderReorder,
  planAccountReorder,
  applyPinnedSortOrders,
  computeAccountFolderPickerState,
} from "../../codex-tauri/src/dnd_reorder.js";

test("isDndDragEvent: threshold checks", () => {
  assert.equal(isDndDragEvent(0, 0), false);
  assert.equal(isDndDragEvent(2, 2), false);
  assert.equal(isDndDragEvent(3, 3), false);
  assert.equal(isDndDragEvent(4, 0), true);
  assert.equal(isDndDragEvent(0, -4), true);
  assert.equal(isDndDragEvent(1, 1, 1), false);
  assert.equal(isDndDragEvent(2, 0, 1), true);
});

test("computeDropLineStyle: handles null and calculates boundaries", () => {
  assert.equal(computeDropLineStyle(null, true), null);

  const rect = { left: 10, width: 200, top: 50, bottom: 90 };
  const beforeStyle = computeDropLineStyle(rect, true);
  assert.deepEqual(beforeStyle, {
    left: "14px",
    width: "192px",
    top: "48.5px",
  });

  const afterStyle = computeDropLineStyle(rect, false);
  assert.deepEqual(afterStyle, {
    left: "14px",
    width: "192px",
    top: "88.5px",
  });

  // Clamping at edge positions
  const tightRect = { left: 0, width: 30, top: 1, bottom: 20 };
  const tightStyle = computeDropLineStyle(tightRect, true);
  assert.equal(tightStyle.left, "8px"); // max(8, 4)
  assert.equal(tightStyle.width, "40px"); // max(40, 22)
  assert.equal(tightStyle.top, "0px"); // max(0, 1 - 1.5)
});

test("computeDropPlacement: calculates before and cross-pinned snapping", () => {
  const targetRect = { top: 100, height: 40 };

  // Standard drop before (upper half: clientY 110 < 100 + 20)
  assert.deepEqual(
    computeDropPlacement({ clientY: 110, targetRect, kind: "folder" }),
    { before: true }
  );

  // Standard drop after (lower half: clientY 130 >= 100 + 20)
  assert.deepEqual(
    computeDropPlacement({ clientY: 130, targetRect, kind: "folder" }),
    { before: false }
  );

  // Account cross-boundary: pinned dragging onto unpinned forces before: false (to end of pinned group)
  assert.deepEqual(
    computeDropPlacement({
      clientY: 105,
      targetRect,
      kind: "account",
      sourcePinned: true,
      targetPinned: false,
    }),
    { before: false }
  );

  // Account cross-boundary: unpinned dragging onto pinned forces before: true (to top of unpinned group)
  assert.deepEqual(
    computeDropPlacement({
      clientY: 135,
      targetRect,
      kind: "account",
      sourcePinned: false,
      targetPinned: true,
    }),
    { before: true }
  );
});

test("computeFloatStyle: computes correct pixel offsets", () => {
  assert.deepEqual(computeFloatStyle(150, 250, 20, 30), {
    left: "130px",
    top: "220px",
  });
  assert.deepEqual(computeFloatStyle(100, 200), {
    left: "100px",
    top: "200px",
  });
});

test("planFolderReorder: handles reordering active folders and preserves deleted folders", () => {
  const folders = [
    { id: "f1", name: "Folder 1" },
    { id: "f2", name: "Folder 2" },
    { id: "f3", name: "Folder 3" },
    { id: "f4", name: "Trash Folder", isDeleted: true },
  ];

  // Move f3 before f1 -> f3, f1, f2, f4(deleted)
  const result = planFolderReorder(folders, "f3", "f1", true);
  assert.ok(result);
  assert.deepEqual(result.orderedIds, ["f3", "f1", "f2"]);
  assert.deepEqual(
    result.folders.map((f) => f.id),
    ["f3", "f1", "f2", "f4"]
  );

  // Reorder to same position returns null
  assert.equal(planFolderReorder(folders, "f1", "f2", true), null);
});

test("planAccountReorder: handles normal and cross-pin reordering", () => {
  const acc1 = { id: "a1", isPinned: false };
  const acc2 = { id: "a2", isPinned: false };
  const acc3 = { id: "a3", isPinned: false };
  const pinned1 = { id: "p1", isPinned: true };
  const pinned2 = { id: "p2", isPinned: true };

  // Reorder within scope accounts: move a3 before a1
  const res1 = planAccountReorder({
    sourceAccount: acc3,
    targetAccount: acc1,
    before: true,
    scopeAccounts: [acc1, acc2, acc3],
    pinnedAccounts: [pinned1, pinned2],
  });
  assert.ok(res1);
  assert.deepEqual(res1.orderedIds, ["a3", "a1", "a2"]);
  assert.equal(res1.pinned, false);

  // Reorder within pinned accounts: move p2 before p1
  const res2 = planAccountReorder({
    sourceAccount: pinned2,
    targetAccount: pinned1,
    before: true,
    scopeAccounts: [acc1, acc2, acc3],
    pinnedAccounts: [pinned1, pinned2],
  });
  assert.ok(res2);
  assert.deepEqual(res2.orderedIds, ["p2", "p1"]);
  assert.equal(res2.pinned, true);

  // Cross boundary: dragging unpinned acc3 onto pinned1 -> snaps target to first unpinned item (a1)
  const res3 = planAccountReorder({
    sourceAccount: acc3,
    targetAccount: pinned1,
    before: false,
    scopeAccounts: [acc1, acc2, acc3],
    pinnedAccounts: [pinned1, pinned2],
  });
  assert.ok(res3);
  assert.equal(res3.targetRec, "a1");
  assert.equal(res3.placeBefore, true);
  assert.deepEqual(res3.orderedIds, ["a3", "a1", "a2"]);

  // No change returns null
  const resUnchanged = planAccountReorder({
    sourceAccount: acc1,
    targetAccount: acc2,
    before: true,
    scopeAccounts: [acc1, acc2, acc3],
    pinnedAccounts: [pinned1, pinned2],
  });
  assert.equal(resUnchanged, null);
});

test("applyPinnedSortOrders: updates rank on pinned accounts", () => {
  const accounts = [
    { id: "p1", isPinned: true, pinnedSortOrder: 0 },
    { id: "p2", isPinned: true, pinnedSortOrder: 1 },
    { id: "a1", isPinned: false },
  ];
  const updated = applyPinnedSortOrders(accounts, ["p2", "p1"]);
  assert.equal(updated.find((a) => a.id === "p2").pinnedSortOrder, 0);
  assert.equal(updated.find((a) => a.id === "p1").pinnedSortOrder, 1);
  assert.equal(updated.find((a) => a.id === "a1").pinnedSortOrder, undefined);
});

test("computeAccountFolderPickerState: validates input and sets checkbox status", () => {
  // Empty active accounts error
  const emptyRes = computeAccountFolderPickerState([], []);
  assert.equal(emptyRes.error, "回收站账号不能添加到文件夹");

  // Empty active folders error
  const noFolderRes = computeAccountFolderPickerState([], [{ id: "acc1" }]);
  assert.equal(noFolderRes.error, "暂无可添加的文件夹，请先新建文件夹");

  const folders = [
    { id: "work", name: "Work" },
    { id: "personal", name: "Personal" },
  ];
  const accounts = [
    { id: "acc1", folderId: "work" },
    { id: "acc2", folderId: "work" },
  ];

  // Both accounts are in 'work'
  const state = computeAccountFolderPickerState(folders, accounts);
  assert.equal(state.error, null);
  assert.equal(state.activeAccounts.length, 2);
  assert.equal(state.title, "设置 2 个账号的文件夹");
  assert.deepEqual(state.options, [
    { id: "work", name: "Work", checked: true },
    { id: "personal", name: "Personal", checked: false },
  ]);

  // When filtering by personal, personal folder should be checked
  const filteredState = computeAccountFolderPickerState(folders, accounts, "personal");
  assert.equal(filteredState.options.find((o) => o.id === "personal").checked, true);
});
