import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDedupGroupSummary,
  dedupAccountLabel,
  calculateFolderDeletionImpact,
  formatDedupEmptyHtml,
  formatDedupGroupHeadHtml,
  formatDedupAccountRowHtml,
} from "../../codex-tauri/src/dedup.js";

test("formatDedupGroupSummary formats group count or empty state", () => {
  assert.equal(formatDedupGroupSummary([]), "当前文件夹暂无重复账号");
  assert.equal(formatDedupGroupSummary(null), "当前文件夹暂无重复账号");
  assert.equal(
    formatDedupGroupSummary([{ id: "g1" }, { id: "g2" }]),
    "重复组 2 组，按站点别名和用户名分组"
  );
});

test("dedupAccountLabel identifies chronological extrema within group", () => {
  assert.equal(dedupAccountLabel(0, 1), ""); // single item group gets no label
  assert.equal(dedupAccountLabel(0, 3), "最新");
  assert.equal(dedupAccountLabel(1, 3), "");
  assert.equal(dedupAccountLabel(2, 3), "最早");
});

test("calculateFolderDeletionImpact determines account impact and builds warning messages", () => {
  const folder = { id: "Folder-Work", name: "工作" };

  // Empty folder
  const emptyImpact = calculateFolderDeletionImpact(folder, [], []);
  assert.equal(emptyImpact.total, 0);
  assert.equal(emptyImpact.activeCount, 0);
  assert.equal(emptyImpact.recycleCount, 0);
  assert.match(emptyImpact.message, /当前没有账号属于此文件夹/);
  assert.match(emptyImpact.message, /不会删除账号/);

  // Folder with active and recycled members (including case-insensitive folderId matching)
  const activeAccounts = [
    { id: "a1", folderIds: ["folder-work"] }, // lower case matches
    { id: "a2", folderId: "Folder-Work" }, // scalar folderId matches
    { id: "a3", folderIds: ["other-folder"] }, // no match
  ];
  const deletedAccounts = [
    { id: "d1", folderIds: ["Folder-Work"] },
  ];

  const populatedImpact = calculateFolderDeletionImpact(folder, activeAccounts, deletedAccounts);
  assert.equal(populatedImpact.activeCount, 2);
  assert.equal(populatedImpact.recycleCount, 1);
  assert.equal(populatedImpact.total, 3);
  assert.match(populatedImpact.message, /当前有 2 个活动账号、1 个回收站账号属于此文件夹/);
  assert.match(populatedImpact.message, /活动账号仍在“全部”/);
});

test("formatDedupEmptyHtml, GroupHeadHtml, and AccountRowHtml render safe structure", () => {
  assert.equal(formatDedupEmptyHtml(), '<div class="dedup-empty">当前文件夹暂无重复账号</div>');

  const head = formatDedupGroupHeadHtml({
    siteAliases: ["github.com", "api.github.com"],
    username: "octocat",
    accounts: [{}, {}],
  });
  assert.match(head, /github\.com, api\.github\.com/);
  assert.match(head, /用户名：octocat · 2 个账号/);

  const row = formatDedupAccountRowHtml(
    {
      accountId: "acc-123",
      sites: ["github.com"],
      updatedAtMs: 1700000000000,
      createdAtMs: 1690000000000,
    },
    0,
    2,
    {
      formatTimeFn: () => "2026-11-08 12:00:00",
      accountKeyFn: () => "acc-123",
    }
  );
  assert.match(row, /dedup-keep-label/);
  assert.match(row, /最新/);
  assert.match(row, /acc-123/);
  assert.match(row, /站点：github\.com/);
  assert.match(row, /更新时间：2026-11-08 12:00:00/);
});

