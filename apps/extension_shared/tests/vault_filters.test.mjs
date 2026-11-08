import test from "node:test";
import assert from "node:assert/strict";
import {
  accountKey,
  accountRecordId,
  isPinnedAccount,
  hasTotp,
  hasPasskey,
  folderIdsOf,
  matchesSearchQuery,
  sameId,
  moveIdInList,
  filterPasskeysForAccount,
  findAccountByAnyId,
  sortAccountsList,
  computeSearchPlaceholder,
  computeSidebarCounts,
  parseSidebarFilterTag,
  filterAccountsByCriteria,
  isSidebarFilterActive,
  formatSidebarCountLabels,
} from "../../codex-tauri/src/vault_filters.js";

test("accountKey and accountRecordId extract preferred key with fallbacks", () => {
  assert.equal(accountKey({ recordId: "rec-1", id: "id-1", accountId: "acc-1" }), "rec-1");
  assert.equal(accountKey({ id: "id-2", accountId: "acc-2" }), "id-2");
  assert.equal(accountKey({ accountId: "acc-3" }), "acc-3");
  assert.equal(accountKey(null), "");

  assert.equal(accountRecordId({ recordId: "rec-x" }), "rec-x");
  assert.equal(accountRecordId({ id: "id-y" }), "id-y");
  assert.equal(accountRecordId(null), "");
});

test("isPinnedAccount detects pin status", () => {
  assert.equal(isPinnedAccount({ isPinned: true }), true);
  assert.equal(isPinnedAccount({ isPinned: false }), false);
  assert.equal(isPinnedAccount(null), false);
});

test("hasTotp and hasPasskey identify security attributes", () => {
  assert.equal(hasTotp({ totpSecret: "JBSWY3DPEHPK3PXP" }), true);
  assert.equal(hasTotp({ totpSecret: "  " }), false);
  assert.equal(hasTotp(null), false);

  assert.equal(hasPasskey({ passkeyCredentialIds: ["cred-1"] }), true);
  assert.equal(hasPasskey({ passkeyCredentialIds: [] }), false);
  assert.equal(hasPasskey(null), false);
});

test("folderIdsOf merges scalar folderId and array folderIds with deduplication", () => {
  assert.deepEqual(folderIdsOf({ folderIds: ["f1", "f2"], folderId: "f3" }), ["f1", "f2", "f3"]);
  assert.deepEqual(folderIdsOf({ folderIds: ["f1", "f2"], folderId: "f1" }), ["f1", "f2"]);
  assert.deepEqual(folderIdsOf({ folderId: "f-single" }), ["f-single"]);
  assert.deepEqual(folderIdsOf(null), []);
});

test("matchesSearchQuery filters across fields with search criteria", () => {
  const account = {
    username: "alice@example.com",
    accountId: "alice-personal",
    password: "secretPassword123",
    note: "Primary recovery note",
    sites: ["example.com", "mail.example.com"],
  };

  // Search "all"
  assert.equal(matchesSearchQuery(account, "alice", "all"), true);
  assert.equal(matchesSearchQuery(account, "example.com", "all"), true);
  assert.equal(matchesSearchQuery(account, "secret", "all"), true);
  assert.equal(matchesSearchQuery(account, "recovery", "all"), true);
  assert.equal(matchesSearchQuery(account, "nonexistent", "all"), false);

  // Field specific search
  assert.equal(matchesSearchQuery(account, "example", "site"), true);
  assert.equal(matchesSearchQuery(account, "secret", "site"), false);

  assert.equal(matchesSearchQuery(account, "alice", "username"), true);
  assert.equal(matchesSearchQuery(account, "recovery", "username"), false);

  assert.equal(matchesSearchQuery(account, "secret", "password"), true);
  assert.equal(matchesSearchQuery(account, "alice", "password"), false);

  assert.equal(matchesSearchQuery(account, "recovery", "note"), true);
  assert.equal(matchesSearchQuery(account, "alice", "note"), false);

  // Empty query matches all
  assert.equal(matchesSearchQuery(account, "", "all"), true);
});

test("sameId compares identifier strings case-insensitively", () => {
  assert.equal(sameId("Folder-123", "folder-123"), true);
  assert.equal(sameId("ABC", "abc"), true);
  assert.equal(sameId("abc", "def"), false);
  assert.equal(sameId("", null), true);
  assert.equal(sameId(undefined, ""), true);
});

test("moveIdInList repositions items before or after reference target", () => {
  const ids = ["a", "b", "c", "d"];

  // Move "d" before "b" -> ["a", "d", "b", "c"]
  assert.deepEqual(moveIdInList(ids, "d", "b", true), ["a", "d", "b", "c"]);

  // Move "a" after "c" -> ["b", "c", "a", "d"]
  assert.deepEqual(moveIdInList(ids, "a", "c", false), ["b", "c", "a", "d"]);

  // Move "b" before "c" -> dest === from -> null (no change)
  assert.equal(moveIdInList(ids, "b", "c", true), null);

  // Non-existent id -> null
  assert.equal(moveIdInList(ids, "nonexistent", "b", true), null);
  assert.equal(moveIdInList(ids, "a", "nonexistent", true), null);
});

test("filterPasskeysForAccount correlates passkeys by credential ID or RP site", () => {
  const account = {
    sites: ["github.com", "api.github.com"],
    passkeyCredentialIds: ["cred-123"],
  };
  const passkeys = [
    { credentialIdB64u: "cred-123", rpId: "other.com" }, // matches credentialId
    { credentialIdB64u: "cred-456", rpId: "github.com" }, // matches site rpId
    { credentialIdB64u: "cred-789", rpId: "gitlab.com" }, // no match
    { credentialIdB64u: "cred-123", rpId: "github.com", isDeleted: true }, // deleted, ignored
    { credentialIdB64u: "cred-123", rpId: "github.com", isPermanentlyDeleted: true }, // permanently deleted, ignored
  ];

  const matched = filterPasskeysForAccount(account, passkeys);
  assert.equal(matched.length, 2);
  assert.equal(matched[0].credentialIdB64u, "cred-123");
  assert.equal(matched[1].credentialIdB64u, "cred-456");
});

test("findAccountByAnyId matches account by recordId, id, or accountId", () => {
  const accounts = [
    { recordId: "rec-1", accountId: "acc-1", username: "user1" },
    { id: "uuid-2", accountId: "acc-2", username: "user2" },
  ];

  assert.equal(findAccountByAnyId(accounts, "rec-1")?.username, "user1");
  assert.equal(findAccountByAnyId(accounts, "ACC-1")?.username, "user1");
  assert.equal(findAccountByAnyId(accounts, "uuid-2")?.username, "user2");
  assert.equal(findAccountByAnyId(accounts, "acc-2")?.username, "user2");
  assert.equal(findAccountByAnyId(accounts, "nonexistent"), undefined);
});

test("sortAccountsList respects modes, pinned status, regular order, and updatedAt", () => {
  const acc1 = { recordId: "r1", accountId: "a1", username: "Charlie", sites: ["zebra.com"], isPinned: false, updatedAtMs: 100 };
  const acc2 = { recordId: "r2", accountId: "a2", username: "Alice", sites: ["apple.com"], isPinned: true, pinnedSortOrder: 2, updatedAtMs: 200 };
  const acc3 = { recordId: "r3", accountId: "a3", username: "Bob", sites: ["banana.com"], isPinned: true, pinnedSortOrder: 1, updatedAtMs: 150 };
  const acc4 = { recordId: "r4", accountId: "a4", username: "David", sites: ["delta.com"], isPinned: false, updatedAtMs: 300 };

  const list = [acc1, acc2, acc3, acc4];

  // usernameAZ
  const byUsername = sortAccountsList(list, { mode: "usernameAZ" });
  assert.deepEqual(byUsername.map((a) => a.username), ["Alice", "Bob", "Charlie", "David"]);

  // siteAZ
  const bySite = sortAccountsList(list, { mode: "siteAZ" });
  assert.deepEqual(bySite.map((a) => a.sites[0]), ["apple.com", "banana.com", "delta.com", "zebra.com"]);

  // default mode: pinned items first (sorted by pinnedSortOrder: acc3 then acc2),
  // then unpinned items (sorted by regularOrderIds: r1 before r4)
  const defaultSorted = sortAccountsList(list, { mode: "default", regularOrderIds: ["r1", "r4"] });
  assert.deepEqual(defaultSorted.map((a) => a.recordId), ["r3", "r2", "r1", "r4"]);
});

test("computeSearchPlaceholder builds clear placeholders based on field and filter", () => {
  assert.equal(computeSearchPlaceholder({ type: "all" }, "all"), "搜索全部账号（输入即搜）");
  assert.equal(computeSearchPlaceholder({ type: "all" }, "site"), "按站点名搜索全部账号（输入即搜）");
  assert.equal(computeSearchPlaceholder({ type: "passkeys" }, "username"), "按用户名搜索通行密钥账号（输入即搜）");
  assert.equal(computeSearchPlaceholder({ type: "totp" }, "all"), "搜索验证码账号（输入即搜）");
  assert.equal(computeSearchPlaceholder({ type: "recycle" }, "password"), "按密码搜索回收站账号（输入即搜）");
  assert.equal(computeSearchPlaceholder({ type: "folder", id: "f1" }, "note"), "按备注搜索当前文件夹账号（输入即搜）");
});

test("computeSidebarCounts tallies active, passkeys, totp, recycle and active folders", () => {
  const dummyState = {
    activeAccounts: [
      { id: "1", passkeyCredentialIds: ["c1"] },
      { id: "2", totpSecret: "secret" },
      { id: "3", passkeyCredentialIds: ["c2"], totpSecret: "secret2" },
      { id: "4" },
    ],
    deletedAccounts: [{ id: "5" }, { id: "6" }],
    folders: [
      { id: "f1", name: "Work" },
      { id: "f2", name: "Personal", isDeleted: true },
      { id: "f3", name: "Finance", isPermanentlyDeleted: true },
    ],
  };

  const counts = computeSidebarCounts(dummyState);
  assert.deepEqual(counts, {
    all: 4,
    passkeys: 2,
    totp: 2,
    recycle: 2,
    folders: 1,
  });
});

test("parseSidebarFilterTag parses standard categories and custom folder IDs", () => {
  assert.deepEqual(parseSidebarFilterTag("all"), { type: "all" });
  assert.deepEqual(parseSidebarFilterTag("passkeys"), { type: "passkeys" });
  assert.deepEqual(parseSidebarFilterTag("totp"), { type: "totp" });
  assert.deepEqual(parseSidebarFilterTag("recycle"), { type: "recycle" });
  assert.deepEqual(parseSidebarFilterTag("folder:my-work-folder"), {
    type: "folder",
    id: "my-work-folder",
  });
  assert.equal(parseSidebarFilterTag("unknown"), null);
  assert.equal(parseSidebarFilterTag(""), null);
});

test("filterAccountsByCriteria filters accounts by folder, passkeys, totp, recycle, and search query", () => {
  const dummyState = {
    activeAccounts: [
      { id: "1", sites: ["github.com"], username: "dev", passkeyCredentialIds: ["pk1"], folderIds: ["f1"] },
      { id: "2", sites: ["google.com"], username: "work", totpSecret: "secret", folderIds: ["f2"] },
      { id: "3", sites: ["gitlab.com"], username: "dev", folderIds: ["f1"] },
    ],
    deletedAccounts: [
      { id: "4", sites: ["legacy.com"], username: "old" },
    ],
  };

  // All active
  assert.equal(filterAccountsByCriteria(dummyState, { type: "all" }).length, 3);

  // Recycle
  const recycle = filterAccountsByCriteria(dummyState, { type: "recycle" });
  assert.equal(recycle.length, 1);
  assert.equal(recycle[0].id, "4");

  // Passkeys
  const pk = filterAccountsByCriteria(dummyState, { type: "passkeys" });
  assert.equal(pk.length, 1);
  assert.equal(pk[0].id, "1");

  // Totp
  const totp = filterAccountsByCriteria(dummyState, { type: "totp" });
  assert.equal(totp.length, 1);
  assert.equal(totp[0].id, "2");

  // Folder
  const f1 = filterAccountsByCriteria(dummyState, { type: "folder", id: "f1" });
  assert.equal(f1.length, 2);

  // Search query
  const searched = filterAccountsByCriteria(dummyState, { type: "all" }, "gitlab");
  assert.equal(searched.length, 1);
  assert.equal(searched[0].id, "3");
});

test("isSidebarFilterActive and formatSidebarCountLabels format sidebar accurately", () => {
  assert.equal(isSidebarFilterActive("all", { type: "all" }), true);
  assert.equal(isSidebarFilterActive("passkeys", { type: "passkeys" }), true);
  assert.equal(isSidebarFilterActive("totp", { type: "totp" }), true);
  assert.equal(isSidebarFilterActive("recycle", { type: "recycle" }), true);
  assert.equal(isSidebarFilterActive("folder:f1", { type: "folder", id: "f1" }), true);
  assert.equal(isSidebarFilterActive("folder:F1", { type: "folder", id: "f1" }), true);
  assert.equal(isSidebarFilterActive("folder:f2", { type: "folder", id: "f1" }), false);
  assert.equal(isSidebarFilterActive("all", { type: "recycle" }), false);

  const labels = formatSidebarCountLabels({
    all: 10,
    passkeys: 3,
    totp: 4,
    recycle: 1,
    folders: 2,
  });
  assert.deepEqual(labels, {
    all: "全部 (10)",
    passkeys: "通行密钥 (3)",
    totp: "验证码 (4)",
    recycle: "回收站 (1)",
    folders: "文件夹 (2)",
  });
});

