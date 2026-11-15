import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocalSyncPayload,
  extractPayload,
  computeBundleImportStats,
  validateSyncBundlePayload,
  formatTimestampForFileName,
  formatExportBrowserFileName,
  formatSyncBundleExportFileName,
  formatImportExportError,
} from "../../codex-tauri/src/vault_import_export.js";

test("buildLocalSyncPayload handles empty inputs and normalizes arrays", () => {
  const emptyPayload = buildLocalSyncPayload();
  assert.deepEqual(emptyPayload.accounts, []);
  assert.deepEqual(emptyPayload.activeAccounts, []);
  assert.deepEqual(emptyPayload.deletedAccounts, []);
  assert.deepEqual(emptyPayload.folders, []);
  assert.deepEqual(emptyPayload.regularOrders, []);
  assert.deepEqual(emptyPayload.passkeys, []);

  const sampleState = {
    activeAccounts: [{ id: "acc-1", name: "Alpha" }],
    deletedAccounts: [{ id: "acc-2", name: "Beta" }],
    folders: [{ id: "f-1", name: "Work" }],
    regularOrders: ["acc-1"],
    passkeys: [{ id: "pk-1" }],
  };
  const payload = buildLocalSyncPayload(sampleState);
  assert.equal(payload.accounts.length, 2);
  assert.equal(payload.activeAccounts.length, 1);
  assert.equal(payload.deletedAccounts.length, 1);
  assert.equal(payload.folders.length, 1);
  assert.equal(payload.passkeys.length, 1);
});

test("extractPayload parses JSON strings and unwraps inner payload safely", () => {
  assert.throws(() => extractPayload(""), /为空/);
  assert.throws(() => extractPayload("  "), /为空/);
  assert.throws(() => extractPayload(null), /为空/);
  assert.throws(() => extractPayload("invalid json"), /不是合法的 JSON/);
  assert.throws(() => extractPayload("123"), /不是有效的 JSON 对象/);
  assert.throws(() => extractPayload("[1, 2, 3]"), /不是有效的 JSON 对象/);

  const directObj = { a: 1, b: "test" };
  assert.deepEqual(extractPayload(directObj), directObj);

  const wrappedObj = { safe: true, payload: { accounts: [1, 2] } };
  assert.deepEqual(extractPayload(wrappedObj), { accounts: [1, 2] });

  const jsonStr = JSON.stringify(wrappedObj);
  assert.deepEqual(extractPayload(jsonStr), { accounts: [1, 2] });
});

test("computeBundleImportStats tallies resources correctly", () => {
  const statsEmpty = computeBundleImportStats(null);
  assert.deepEqual(statsEmpty, {
    activeCount: 0,
    deletedCount: 0,
    folderCount: 0,
    passkeyCount: 0,
    totalAccountCount: 0,
  });

  const stats = computeBundleImportStats({
    activeAccounts: [{ id: 1 }, { id: 2 }],
    deletedAccounts: [{ id: 3 }],
    folders: [{ id: "f1" }],
    passkeys: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
  });
  assert.equal(stats.activeCount, 2);
  assert.equal(stats.deletedCount, 1);
  assert.equal(stats.totalAccountCount, 3);
  assert.equal(stats.folderCount, 1);
  assert.equal(stats.passkeyCount, 3);
});

test("validateSyncBundlePayload checks structural integrity", () => {
  assert.equal(validateSyncBundlePayload(null).valid, false);
  assert.equal(validateSyncBundlePayload("str").valid, false);
  assert.equal(validateSyncBundlePayload([]).valid, false);

  const invalidField = validateSyncBundlePayload({ activeAccounts: "not-an-array" });
  assert.equal(invalidField.valid, false);
  assert.match(invalidField.error, /字段 activeAccounts 必须是数组/);

  const valid = validateSyncBundlePayload({
    activeAccounts: [{ id: "1" }],
    folders: [],
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.stats.activeCount, 1);
});

test("formatExportBrowserFileName and formatSyncBundleExportFileName build timestamped names", () => {
  const fixedTime = new Date("2026-11-15T12:30:45Z").getTime();
  const chromeName = formatExportBrowserFileName("chrome", fixedTime);
  assert.match(chromeName, /^pass-export-chrome-\d{8}-\d{6}\.csv$/);

  const firefoxName = formatExportBrowserFileName("firefox", fixedTime);
  assert.match(firefoxName, /^pass-export-firefox-\d{8}-\d{6}\.csv$/);

  const bundleName = formatSyncBundleExportFileName(fixedTime);
  assert.match(bundleName, /^pass-sync-bundle-\d{8}-\d{6}\.json$/);

  assert.equal(formatTimestampForFileName(NaN), "00000000-000000");
});

test("formatImportExportError provides clear Chinese messages for failure stages", () => {
  assert.equal(
    formatImportExportError("csv", "文件编码错误"),
    "导入失败：文件编码错误"
  );
  assert.equal(
    formatImportExportError("qr", new Error("未检测到二维码")),
    "验证器导入失败：未检测到二维码"
  );
  assert.equal(
    formatImportExportError("bundle", "校验和不匹配"),
    "导入同步包失败：校验和不匹配"
  );
  assert.equal(
    formatImportExportError("export", "无写入权限"),
    "导出失败：无写入权限"
  );
  assert.equal(
    formatImportExportError("unknown", "未知"),
    "操作失败：未知"
  );
});
