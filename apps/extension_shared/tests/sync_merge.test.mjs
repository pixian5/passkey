import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeAccountCollections } from "../../../core/pass_core/js/sync_merge_core.js";

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
