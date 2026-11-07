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
