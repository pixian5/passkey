import test from "node:test";
import assert from "node:assert/strict";
import {
  softDeleteAccount,
  permanentlyDeleteAccount,
  restoreAccountFields,
  setAccountPinned,
} from "../../extension_chrome_web/vault_mutate_core.js";

function sample() {
  return {
    recordId: "acc-1",
    password: "secret",
    totpSecret: "totp",
    recoveryCodes: "codes",
    isDeleted: false,
    isPermanentlyDeleted: false,
    isPinned: false,
    pinnedSortOrder: null,
  };
}

test("soft then permanent keeps id and clears secrets", () => {
  const account = sample();
  assert.equal(softDeleteAccount(account, 10, "A"), true);
  assert.equal(account.isDeleted, true);
  assert.equal(permanentlyDeleteAccount(account, 20, "B"), true);
  assert.equal(account.isPermanentlyDeleted, true);
  assert.equal(account.password, "");
  assert.equal(account.totpSecret, "");
  assert.equal(account.recoveryCodes, "");
});

test("restore rejects permanent tombstones", () => {
  const account = sample();
  softDeleteAccount(account, 10, "A");
  assert.equal(restoreAccountFields(account, 11, "A"), true);
  permanentlyDeleteAccount(account, 12, "A");
  assert.throws(() => restoreAccountFields(account, 13, "A"), /永久删除/);
});

test("setAccountPinned rejects recycle bin", () => {
  const account = sample();
  setAccountPinned(account, true, 3, 30, "C");
  assert.equal(account.isPinned, true);
  assert.equal(account.pinnedSortOrder, 3);
  softDeleteAccount(account, 31, "C");
  assert.throws(() => setAccountPinned(account, true, 1, 32, "C"), /回收站/);
});
