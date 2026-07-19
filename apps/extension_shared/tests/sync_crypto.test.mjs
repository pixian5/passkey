import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptSyncBundleDocument,
  encryptSyncBundleDocument,
  generateSyncEncryptionKey,
  syncEncryptionKeyId,
} from "../sync_crypto.js";

test("同步加密信封写入稳定 keyId 且可由同一密钥解密", async () => {
  const key = generateSyncEncryptionKey();
  const document = {
    schema: "pass.sync.bundle.v2",
    exportedAtMs: 100,
    source: { app: "test", platform: "node", deviceName: "test", deviceId: "test", logicalClockMs: 100, formatVersion: 2 },
    payload: { accounts: [], folders: [], passkeys: [] },
  };
  const envelope = await encryptSyncBundleDocument(document, key);
  assert.equal(envelope.keyId, await syncEncryptionKeyId(key));
  assert.deepEqual(await decryptSyncBundleDocument(envelope, key), document);
});

test("同步加密信封拒绝声明了其他 keyId 的密钥", async () => {
  const key = generateSyncEncryptionKey();
  const otherKey = generateSyncEncryptionKey();
  const envelope = await encryptSyncBundleDocument({ schema: "pass.sync.bundle.v2", payload: {} }, key);
  await assert.rejects(
    () => decryptSyncBundleDocument(envelope, otherKey),
    /密钥 ID 不匹配/
  );
});

test("同步密钥轮换期间可用保留的上一把密钥读取旧信封", async () => {
  const oldKey = generateSyncEncryptionKey();
  const nextKey = generateSyncEncryptionKey();
  const document = { schema: "pass.sync.bundle.v2", payload: { accounts: [{ recordId: "old" }], folders: [], passkeys: [] } };
  const oldEnvelope = await encryptSyncBundleDocument(document, oldKey);
  assert.deepEqual(
    await decryptSyncBundleDocument(oldEnvelope, nextKey, [oldKey]),
    document
  );
});

test("远程同步禁止明文上传，且配置密钥后拒绝明文同步包", async () => {
  const key = generateSyncEncryptionKey();
  const plaintext = { schema: "pass.sync.bundle.v2", payload: { accounts: [], folders: [], passkeys: [] } };
  await assert.rejects(
    () => encryptSyncBundleDocument(plaintext, ""),
    /必须配置 256 位同步加密密钥/
  );
  await assert.rejects(
    () => decryptSyncBundleDocument(plaintext, key),
    /拒绝未加密同步包/
  );
  assert.deepEqual(await decryptSyncBundleDocument(plaintext, ""), plaintext);
});
