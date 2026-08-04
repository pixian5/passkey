import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManagedAuthenticatorFlags } from "../passkey_store.js";

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
