import assert from "node:assert/strict";
import test from "node:test";

import { filterFillChooserAccounts, normalizeFillChooserQuery } from "../fill_chooser_filter.js";

const accounts = [
  { accountId: "alice", username: "Alice@example.com" },
  { accountId: "alice-work", username: "alice.work" },
  { accountId: "bob", username: "Bob@example.com" },
];

test("用户名筛选不区分大小写并支持子串", () => {
  assert.deepEqual(
    filterFillChooserAccounts(accounts, "ALICE").map((account) => account.accountId),
    ["alice", "alice-work"],
  );
  assert.deepEqual(
    filterFillChooserAccounts(accounts, "work").map((account) => account.accountId),
    ["alice-work"],
  );
});

test("空查询恢复全部账号并保持原顺序", () => {
  assert.equal(normalizeFillChooserQuery("  "), "");
  assert.deepEqual(filterFillChooserAccounts(accounts, "").map((account) => account.accountId), ["alice", "alice-work", "bob"]);
});

test("没有匹配用户名时返回空列表", () => {
  assert.deepEqual(filterFillChooserAccounts(accounts, "charlie"), []);
});
