import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANONYMOUS_AAGUID,
  buildManagedAuthenticatorFlags,
  buildManagedAttestationObject,
} from "../passkey_store.js";

test("匿名证明使用全零 AAGUID", () => {
  assert.deepEqual([...ANONYMOUS_AAGUID], new Array(16).fill(0));
});

test("新建同步通行密钥在认证数据中声明 BE、BS 和 AT", () => {
  assert.equal(buildManagedAuthenticatorFlags({
    backupEligible: true,
    backupState: true,
    includeAttestedCredentialData: true,
  }), 0x5d);
});

test("同步通行密钥断言保留 BE 和 BS", () => {
  assert.equal(buildManagedAuthenticatorFlags({
    backupEligible: true,
    backupState: true,
  }), 0x1d);
});

test("旧的设备绑定通行密钥保持原有断言标志", () => {
  assert.equal(buildManagedAuthenticatorFlags(), 0x05);
  assert.equal(buildManagedAuthenticatorFlags({ backupState: true }), 0x05);
});

test("网站请求 direct 证明时使用匿名 none 证明", async () => {
  const result = await buildManagedAttestationObject({
    authData: new Uint8Array(37),
  });

  assert.equal(result.format, "none");
  assert.match(new TextDecoder().decode(result.attestationObject), /none/);
  assert.doesNotMatch(new TextDecoder().decode(result.attestationObject), /sig/);
});

test("网站未请求 direct 证明时保留 none 格式", async () => {
  const result = await buildManagedAttestationObject({
    authData: new Uint8Array(37),
  });

  assert.equal(result.format, "none");
  assert.match(new TextDecoder().decode(result.attestationObject), /none/);
});
