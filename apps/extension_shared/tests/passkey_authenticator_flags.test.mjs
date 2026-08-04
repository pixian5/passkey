import assert from "node:assert/strict";
import { test } from "node:test";
import { MANAGED_AAGUID, buildManagedAuthenticatorFlags } from "../passkey_store.js";

test("托管认证器使用稳定的非零 UUID AAGUID", () => {
  assert.deepEqual([...MANAGED_AAGUID], [
    0xb8, 0xe4, 0x34, 0x4b, 0x1b, 0x50, 0x4e, 0xa1,
    0xb4, 0xa9, 0xd0, 0xba, 0x20, 0xa0, 0x07, 0xa6,
  ]);
  assert.notDeepEqual([...MANAGED_AAGUID], new Array(16).fill(0));
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
