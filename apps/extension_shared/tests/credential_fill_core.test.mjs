import assert from "node:assert/strict";
import test from "node:test";

import { fillCredentialFields } from "../credential_fill_core.js";

function field(kind, value = "") {
  return { kind, value };
}

function fill(activeInput, username, password, related) {
  const writes = [];
  const result = fillCredentialFields({
    activeInput,
    username,
    password,
    isPasswordInput: (input) => input?.kind === "password",
    findRelatedUsername: (input) => related.get(input)?.username || null,
    findRelatedPassword: (input) => related.get(input)?.password || null,
    findFallbackPassword: () => null,
    writeValue: (input, value) => {
      writes.push([input.kind, value]);
      input.value = value;
    },
  });
  return { result, writes };
}

test("选择匹配账号会从用户名框同时填充用户名和密码", () => {
  const username = field("username");
  const password = field("password");
  const related = new Map([[username, { password }], [password, { username }]]);
  const outcome = fill(username, "alice@example.com", "correct-horse", related);

  assert.equal(username.value, "alice@example.com");
  assert.equal(password.value, "correct-horse");
  assert.deepEqual(outcome.writes, [["username", "alice@example.com"], ["password", "correct-horse"]]);
  assert.deepEqual(outcome.result, {
    filledUsername: true,
    filledPassword: true,
    filledAny: true,
    filledBoth: true,
  });
});

test("从密码框选择账号仍会填充配对用户名，空凭据会清除旧值", () => {
  const username = field("username", "old-user");
  const password = field("password", "old-password");
  const related = new Map([[username, { password }], [password, { username }]]);
  const outcome = fill(password, "", "", related);

  assert.equal(username.value, "");
  assert.equal(password.value, "");
  assert.equal(outcome.result.filledBoth, true);
});

test("分步登录只有用户名框时不触碰页面中其他密码框", () => {
  const username = field("username");
  const unrelatedPassword = field("password", "keep-me");
  const writes = [];
  const result = fillCredentialFields({
    activeInput: username,
    username: "alice@example.com",
    password: "correct-horse",
    isPasswordInput: (input) => input?.kind === "password",
    findRelatedUsername: () => null,
    findRelatedPassword: () => null,
    findFallbackPassword: () => unrelatedPassword,
    writeValue: (input, value) => {
      writes.push([input.kind, value]);
      input.value = value;
    },
  });

  assert.deepEqual(writes, [["username", "alice@example.com"]]);
  assert.equal(unrelatedPassword.value, "keep-me");
  assert.equal(result.filledUsername, true);
  assert.equal(result.filledPassword, false);
});

test("分步登录只有密码框时不触碰页面中其他用户名框", () => {
  const password = field("password");
  const unrelatedUsername = field("username", "keep-me");
  const writes = [];
  const result = fillCredentialFields({
    activeInput: password,
    username: "alice@example.com",
    password: "correct-horse",
    isPasswordInput: (input) => input?.kind === "password",
    findRelatedUsername: () => null,
    findRelatedPassword: () => null,
    findFallbackPassword: () => null,
    writeValue: (input, value) => {
      writes.push([input.kind, value]);
      input.value = value;
    },
  });

  assert.deepEqual(writes, [["password", "correct-horse"]]);
  assert.equal(unrelatedUsername.value, "keep-me");
  assert.equal(result.filledUsername, false);
  assert.equal(result.filledPassword, true);
});
