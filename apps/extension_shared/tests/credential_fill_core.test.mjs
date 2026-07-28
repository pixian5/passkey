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
