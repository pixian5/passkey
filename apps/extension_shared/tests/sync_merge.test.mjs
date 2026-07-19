import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  evaluateSyncSafety,
  mergeAccountCollections,
  mergeFolderCollections,
  mergePasskeyCollections,
  reconcileAccountFolders,
} from "../../../core/pass_core/js/sync_merge_core.js";

const helpers = {
  normalizeAccountShape: (value) => ({
    accountId: "account-1",
    recordId: "record-1",
    canonicalSite: "example.com",
    createdAtMs: 1,
    updatedAtMs: 1,
    username: "user",
    usernameAtCreate: "user",
    password: "old-password",
    totpSecret: "",
    recoveryCodes: "",
    note: "",
    sites: ["example.com"],
    folderIds: [],
    folderId: null,
    passkeyCredentialIds: [],
    usernameUpdatedAtMs: 1,
    passwordUpdatedAtMs: 1,
    totpUpdatedAtMs: 1,
    recoveryCodesUpdatedAtMs: 1,
    noteUpdatedAtMs: 1,
    passkeyUpdatedAtMs: 1,
    isDeleted: false,
    isPermanentlyDeleted: false,
    deletedAtMs: null,
    ...value,
  }),
  normalizeFolderIdList: (value) => [...new Set(value.filter(Boolean))],
  normalizeFolderId: (value) => String(value || ""),
  extractAccountFolderIds: (value) => value.folderIds || [],
  normalizeSites: (value) => [...new Set(value.filter(Boolean))].sort(),
  etldPlusOne: (value) => String(value || ""),
  normalizePasskeyCredentialIds: (value) => [...new Set(value.filter(Boolean))].sort(),
  stableUuidFromText: (value) => String(value),
  normalizePasskeyShape: (value) => value,
  normalizePasskeyCreateCompatMethod: (value) => value || "standard",
  normalizeFolderShape: (value) => value,
  sortFoldersForDisplay: (value) => value,
  fixedNewAccountFolderId: "fixed",
  fixedNewAccountFolderName: "新账号",
};

const goldenVectors = JSON.parse(fs.readFileSync(
  path.resolve(process.cwd(), "../../docs/sync-golden-vectors.json"),
  "utf8"
));

test("相同时间戳的字段冲突按设备名确定性裁决", () => {
  const left = helpers.normalizeAccountShape({
    password: "left",
    passwordUpdatedAtMs: 10,
    passwordUpdatedDeviceName: "Device-A",
    updatedAtMs: 10,
  });
  const right = helpers.normalizeAccountShape({
    password: "right",
    passwordUpdatedAtMs: 10,
    passwordUpdatedDeviceName: "Device-B",
    updatedAtMs: 10,
  });
  const first = mergeAccountCollections([left], [right], helpers)[0];
  const second = mergeAccountCollections([right], [left], helpers)[0];
  assert.equal(first.password, "right");
  assert.equal(second.password, "right");
});

test("字段时钟并列时，后续无关账号修改不能让空密码覆盖已有密码", () => {
  const local = helpers.normalizeAccountShape({
    password: "",
    passwordUpdatedAtMs: 100,
    passwordUpdatedDeviceName: "Device-Z",
    updatedAtMs: 200,
  });
  const remote = helpers.normalizeAccountShape({
    password: "remote-secret",
    passwordUpdatedAtMs: 100,
    passwordUpdatedDeviceName: "Device-A",
    updatedAtMs: 100,
  });
  assert.equal(mergeAccountCollections([local], [remote], helpers)[0].password, "remote-secret");
  assert.equal(mergeAccountCollections([remote], [local], helpers)[0].password, "remote-secret");
});

test("恢复时间晚于删除墓碑时，恢复状态胜出", () => {
  const restored = helpers.normalizeAccountShape({
    updatedAtMs: 30,
    passwordUpdatedAtMs: 1,
    isDeleted: false,
  });
  const deleted = helpers.normalizeAccountShape({
    updatedAtMs: 20,
    isDeleted: true,
    deletedAtMs: 20,
  });
  const merged = mergeAccountCollections([restored], [deleted], helpers)[0];
  assert.equal(merged.isDeleted, false);
});

test("永久删除墓碑不会被旧设备的活动记录重新生成", () => {
  const purged = helpers.normalizeAccountShape({
    updatedAtMs: 30,
    isDeleted: true,
    isPermanentlyDeleted: true,
    deletedAtMs: 30,
  });
  const staleActive = helpers.normalizeAccountShape({
    updatedAtMs: 10,
    isDeleted: false,
  });
  const merged = mergeAccountCollections([purged], [staleActive], helpers)[0];
  assert.equal(merged.isDeleted, true);
  assert.equal(merged.isPermanentlyDeleted, true);
});

test("同一稳定 recordId 但历史 accountId 不同的记录会合并", () => {
  const left = helpers.normalizeAccountShape({
    accountId: "legacy-account-a",
    recordId: "stable-record-1",
    password: "left",
  });
  const right = helpers.normalizeAccountShape({
    accountId: "legacy-account-b",
    recordId: "stable-record-1",
    password: "right",
    passwordUpdatedAtMs: 2,
    updatedAtMs: 2,
  });
  const merged = mergeAccountCollections([left], [right], helpers);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].recordId, "stable-record-1");
  assert.equal(merged[0].password, "right");
});

test("合并账号会保留最新的 pinnedViews，而不是丢失视图置顶状态", () => {
  const local = helpers.normalizeAccountShape({
    pinnedViews: {
      all: { pinned: true, pinnedSortOrder: 1, regularSortOrder: null },
    },
    updatedAtMs: 10,
  });
  const remote = helpers.normalizeAccountShape({
    password: "new-password",
    passwordUpdatedAtMs: 20,
    updatedAtMs: 20,
    pinnedViews: {
      folder: { pinned: true, pinnedSortOrder: 2, regularSortOrder: null },
    },
  });
  const merged = mergeAccountCollections([local], [remote], helpers)[0];
  assert.deepEqual(merged.pinnedViews, remote.pinnedViews);
});

test("181 条本地账号与 23 条远端账号合并时不能丢失本地账号", () => {
  const local = Array.from({ length: 181 }, (_, index) => helpers.normalizeAccountShape({
    accountId: `local-${index}`,
    recordId: `record-${index}`,
    username: `local-${index}`,
    updatedAtMs: 100,
  }));
  const remote = local.slice(0, 23).map((account) => helpers.normalizeAccountShape({
    ...account,
    password: "remote",
    updatedAtMs: 200,
  }));
  const merged = mergeAccountCollections(local, remote, helpers);
  const safety = evaluateSyncSafety(
    { local: { accounts: local }, remote: { accounts: remote }, merged: { accounts: merged }, mode: "merge" },
    helpers
  );
  assert.equal(merged.length, 181);
  assert.equal(safety.safe, true);
  assert.deepEqual(safety.reasons, []);
});

test("200 条本地账号与 23 条远端账号合并后稳定 ID、字段和计数保持完整", () => {
  const local = Array.from({ length: 200 }, (_, index) => helpers.normalizeAccountShape({
    accountId: `local-${index}`,
    recordId: `record-${index}`,
    username: `local-user-${index}`,
    password: `local-password-${index}`,
    updatedAtMs: 1_000 + index,
  }));
  const remote = Array.from({ length: 23 }, (_, index) => helpers.normalizeAccountShape({
    ...local[index],
    password: `remote-password-${index}`,
    passwordUpdatedAtMs: 10_000 + index,
    updatedAtMs: 10_000 + index,
    passwordUpdatedDeviceName: "ChromeMac",
  }));
  const merged = mergeAccountCollections(local, remote, helpers);
  assert.equal(merged.length, 200);
  assert.deepEqual(
    new Set(merged.map((account) => account.recordId)),
    new Set(local.map((account) => account.recordId))
  );
  const mergedByRecordId = new Map(merged.map((account) => [account.recordId, account]));
  for (let index = 0; index < 23; index += 1) {
    assert.equal(mergedByRecordId.get(`record-${index}`).password, `remote-password-${index}`);
  }
  for (let index = 23; index < 200; index += 1) {
    assert.equal(mergedByRecordId.get(`record-${index}`).password, `local-password-${index}`);
  }
});

test("多次合并具有结合性且不会重复账号", () => {
  const a = [helpers.normalizeAccountShape({ accountId: "a", recordId: "r-a", updatedAtMs: 1 })];
  const b = [helpers.normalizeAccountShape({ accountId: "b", recordId: "r-b", updatedAtMs: 2 })];
  const c = [helpers.normalizeAccountShape({ accountId: "c", recordId: "r-c", updatedAtMs: 3 })];
  const left = mergeAccountCollections(mergeAccountCollections(a, b, helpers), c, helpers);
  const right = mergeAccountCollections(a, mergeAccountCollections(b, c, helpers), helpers);
  assert.deepEqual(
    new Set(left.map((account) => account.recordId)),
    new Set(right.map((account) => account.recordId))
  );
  assert.equal(left.length, 3);
  assert.equal(right.length, 3);
});

test("空远端不能替换非空本地", () => {
  const local = [helpers.normalizeAccountShape({ recordId: "record-1" })];
  const safety = evaluateSyncSafety(
    { local: { accounts: local }, remote: { accounts: [] }, merged: { accounts: [] }, mode: "remoteOverwriteLocal" },
    helpers
  );
  assert.equal(safety.safe, false);
  assert.deepEqual(safety.reasons, ["REMOTE_EMPTY_FOR_NON_EMPTY_LOCAL"]);
});

test("Golden Vector: 空远端安全闸门", () => {
  const vector = goldenVectors.cases.find((item) => item.name === "empty-remote-safety");
  const local = [helpers.normalizeAccountShape({ recordId: "golden-local" })];
  const safety = evaluateSyncSafety(
    { local: { accounts: local }, remote: { accounts: [] }, merged: { accounts: [] }, mode: "remoteOverwriteLocal" },
    helpers
  );
  assert.equal(safety.safe, vector.expectedSafe);
  assert.equal(safety.reasons[0], vector.reason);
});

test("Golden Vector: 真实账号、文件夹和 Passkey 合并结果稳定", () => {
  const vector = goldenVectors.cases.find((item) => item.name === "field-and-entity-merge");
  assert.ok(vector);
  const mergedAccounts = mergeAccountCollections(
    vector.local.accounts,
    vector.remote.accounts,
    helpers
  );
  const mergedFolders = mergeFolderCollections(
    vector.local.folders,
    vector.remote.folders,
    helpers
  );
  const mergedPasskeys = mergePasskeyCollections(
    vector.local.passkeys,
    vector.remote.passkeys,
    helpers
  );

  const accountsByRecordId = new Map(mergedAccounts.map((item) => [item.recordId, item]));
  for (const expected of vector.expected.accounts) {
    const actual = accountsByRecordId.get(expected.recordId);
    assert.ok(actual, `missing account ${expected.recordId}`);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value);
  }
  const foldersById = new Map(mergedFolders.map((item) => [item.id, item]));
  for (const expected of vector.expected.folders) {
    const actual = foldersById.get(expected.id);
    assert.ok(actual, `missing folder ${expected.id}`);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value);
  }
  const passkeysById = new Map(mergedPasskeys.map((item) => [item.credentialIdB64u, item]));
  for (const expected of vector.expected.passkeys) {
    const actual = passkeysById.get(expected.credentialIdB64u);
    assert.ok(actual, `missing passkey ${expected.credentialIdB64u}`);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value);
  }
});

test("文件夹永久删除墓碑不会被旧设备记录重新生成", () => {
  const deleted = helpers.normalizeFolderShape({
    id: "folder-1",
    name: "已删除",
    updatedAtMs: 30,
    isDeleted: true,
    isPermanentlyDeleted: true,
    deletedAtMs: 30,
  });
  const staleActive = helpers.normalizeFolderShape({
    id: "folder-1",
    name: "旧文件夹",
    updatedAtMs: 10,
    isDeleted: false,
  });
  const merged = mergeFolderCollections([deleted], [staleActive], helpers)
    .find((item) => item.id === "folder-1");
  assert.equal(merged.isDeleted, true);
  assert.equal(merged.isPermanentlyDeleted, true);
  assert.deepEqual(
    reconcileAccountFolders(
      [{ accountId: "a", recordId: "r", folderIds: ["folder-1"] }],
      [merged],
      helpers
    )[0].folderIds,
    []
  );
});

test("移出文件夹的关系墓碑会阻止旧设备重新加入", () => {
  const local = helpers.normalizeAccountShape({
    folderIds: [],
    folderMembershipStates: {
      "folder-1": { isDeleted: true, updatedAtMs: 20, deviceName: "Device-A" },
    },
    updatedAtMs: 20,
  });
  const staleRemote = helpers.normalizeAccountShape({
    folderIds: ["folder-1"],
    updatedAtMs: 10,
  });
  const merged = mergeAccountCollections([local], [staleRemote], helpers)[0];
  assert.deepEqual(merged.folderIds, []);
  assert.equal(merged.folderMembershipStates["folder-1"].isDeleted, true);
});

test("删除站点别名和 Passkey 关联不会被旧设备复活", () => {
  const local = helpers.normalizeAccountShape({
    sites: [],
    passkeyCredentialIds: [],
    siteAliasStates: { "old.example": { isDeleted: true, updatedAtMs: 20, deviceName: "A" } },
    passkeyLinkStates: { credential: { isDeleted: true, updatedAtMs: 20, deviceName: "A" } },
    updatedAtMs: 20,
  });
  const staleRemote = helpers.normalizeAccountShape({
    sites: ["old.example"],
    passkeyCredentialIds: ["credential"],
    updatedAtMs: 10,
  });
  const merged = mergeAccountCollections([local], [staleRemote], helpers)[0];
  assert.equal(merged.sites.includes("old.example"), false);
  assert.deepEqual(merged.sites, []);
  assert.equal(merged.passkeyCredentialIds.includes("credential"), false);
});

test("全部站点 tombstone 后不会回退到 primary.sites", () => {
  const local = helpers.normalizeAccountShape({
    sites: ["a.example", "b.example"],
    siteAliasStates: {
      "a.example": { isDeleted: true, updatedAtMs: 30, deviceName: "A" },
      "b.example": { isDeleted: true, updatedAtMs: 30, deviceName: "A" },
    },
    updatedAtMs: 30,
  });
  const remote = helpers.normalizeAccountShape({
    sites: ["a.example", "b.example"],
    updatedAtMs: 10,
  });
  const merged = mergeAccountCollections([local], [remote], helpers)[0];
  assert.deepEqual(merged.sites, []);
});

test("通行密钥永久删除墓碑不会被旧设备记录重新生成", () => {
  const deleted = helpers.normalizePasskeyShape({
    credentialIdB64u: "credential-1",
    updatedAtMs: 30,
    isDeleted: true,
    isPermanentlyDeleted: true,
    deletedAtMs: 30,
  });
  const staleActive = helpers.normalizePasskeyShape({
    credentialIdB64u: "credential-1",
    updatedAtMs: 10,
    isDeleted: false,
  });
  const merged = mergePasskeyCollections([deleted], [staleActive], helpers)[0];
  assert.equal(merged.isDeleted, true);
  assert.equal(merged.isPermanentlyDeleted, true);
});

test("合并结果缺少本地稳定 ID 时必须阻止写入", () => {
  const local = [helpers.normalizeAccountShape({ recordId: "record-1" })];
  const remote = [helpers.normalizeAccountShape({ recordId: "record-2" })];
  const safety = evaluateSyncSafety(
    { local: { accounts: local }, remote: { accounts: remote }, merged: { accounts: remote }, mode: "merge" },
    helpers
  );
  assert.equal(safety.safe, false);
  assert.deepEqual(safety.reasons, ["LOCAL_ACCOUNTS_DROPPED"]);
});

test("合并结果缺少远端稳定 ID 时必须阻止写入", () => {
  const local = [helpers.normalizeAccountShape({ recordId: "record-local" })];
  const remote = [helpers.normalizeAccountShape({ recordId: "record-remote" })];
  const safety = evaluateSyncSafety(
    { local: { accounts: local }, remote: { accounts: remote }, merged: { accounts: local }, mode: "merge" },
    helpers
  );
  assert.equal(safety.safe, false);
  assert.deepEqual(safety.reasons, ["REMOTE_ACCOUNTS_DROPPED"]);
});
