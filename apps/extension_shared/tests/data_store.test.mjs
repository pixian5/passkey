import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

function createStorageArea() {
  const values = new Map();
  return {
    async get(keys) {
      const result = {};
      const requested = Array.isArray(keys) ? keys : [keys];
      for (const key of requested) {
        if (values.has(key)) result[key] = values.get(key);
      }
      return result;
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, value);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    async clear() {
      values.clear();
    },
  };
}

const local = createStorageArea();
const session = createStorageArea();
globalThis.chrome = { storage: { local, session } };

const {
  disableDataEncryption,
  lockDataEncryption,
  rewrapDataEncryption,
  unlockDataEncryption,
} = await import("../data_store.js");
const {
  base64ToBytes,
  bytesToBase64,
  createLockMasterCredential,
} = await import("../lock_crypto.js");

const WRAPPED_KEY = "pass.data.wrappedEncryptionKey.v2";
const LEGACY_KEY = "pass.data.encryptionKey.v1";
const SESSION_KEY = "pass.data.sessionEncryptionKey.v2";
const V2_AAD = new TextEncoder().encode("pass.data.encryptionKey.v2");
const V3_AAD = new TextEncoder().encode("pass.data.encryptionKey.v3");

async function createV2Envelope(password, credential, rawKey) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.trim()),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(credential.saltBase64),
      iterations: credential.iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: V2_AAD },
    wrappingKey,
    rawKey
  );
  return {
    version: 2,
    nonceBase64: bytesToBase64(nonce),
    ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

beforeEach(async () => {
  await lockDataEncryption();
  await local.clear();
  await session.clear();
});

test("v3 包装不能被主密码摘要直接解密，且锁定会清除会话密钥", async () => {
  const password = "correct horse battery staple";
  const credential = await createLockMasterCredential(password);
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  await local.set({ [LEGACY_KEY]: bytesToBase64(rawKey) });

  await unlockDataEncryption(password, credential);

  const stored = await local.get([WRAPPED_KEY, LEGACY_KEY]);
  const wrapped = stored[WRAPPED_KEY];
  assert.equal(wrapped.version, 3);
  assert.equal(wrapped.kdf, "PBKDF2-SHA-256");
  assert.notEqual(wrapped.wrapSaltBase64, credential.saltBase64);
  assert.equal(stored[LEGACY_KEY], undefined);

  const leakedDigestKey = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(credential.digestBase64),
    "AES-GCM",
    false,
    ["decrypt"]
  );
  await assert.rejects(() => crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(wrapped.nonceBase64),
      additionalData: V3_AAD,
    },
    leakedDigestKey,
    base64ToBytes(wrapped.ciphertextBase64)
  ));

  await lockDataEncryption();
  assert.equal((await session.get([SESSION_KEY]))[SESSION_KEY], undefined);
  await assert.rejects(() => unlockDataEncryption("wrong password", credential));
  await unlockDataEncryption(password, credential);
  assert.deepEqual(
    base64ToBytes((await session.get([SESSION_KEY]))[SESSION_KEY]),
    rawKey
  );
});

test("正确主密码解开 v2 后会立即迁移并重包为 v3", async () => {
  const password = "migration password";
  const credential = await createLockMasterCredential(password);
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const v2Envelope = await createV2Envelope(password, credential, rawKey);
  await local.set({ [WRAPPED_KEY]: v2Envelope });

  await unlockDataEncryption(password, credential);

  const migrated = (await local.get([WRAPPED_KEY]))[WRAPPED_KEY];
  assert.equal(migrated.version, 3);
  assert.equal(migrated.kdf, "PBKDF2-SHA-256");
  assert.notEqual(migrated.wrapSaltBase64, credential.saltBase64);
  assert.deepEqual(
    base64ToBytes((await session.get([SESSION_KEY]))[SESSION_KEY]),
    rawKey
  );
});

test("更新主密码、关闭保护和重新启用都会保持 v3 包装可用", async () => {
  const currentPassword = "current password";
  const nextPassword = "next password";
  const currentCredential = await createLockMasterCredential(currentPassword);
  const nextCredential = await createLockMasterCredential(nextPassword);
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  await local.set({ [LEGACY_KEY]: bytesToBase64(rawKey) });

  await unlockDataEncryption(currentPassword, currentCredential);
  await rewrapDataEncryption(
    currentPassword,
    currentCredential,
    nextPassword,
    nextCredential
  );
  await lockDataEncryption();

  await assert.rejects(() => unlockDataEncryption(currentPassword, currentCredential));
  await unlockDataEncryption(nextPassword, nextCredential);
  assert.deepEqual(
    base64ToBytes((await session.get([SESSION_KEY]))[SESSION_KEY]),
    rawKey
  );

  await disableDataEncryption(nextPassword, nextCredential);
  let stored = await local.get([WRAPPED_KEY, LEGACY_KEY]);
  assert.equal(stored[WRAPPED_KEY], undefined);
  assert.deepEqual(base64ToBytes(stored[LEGACY_KEY]), rawKey);
  assert.equal((await session.get([SESSION_KEY]))[SESSION_KEY], undefined);

  await unlockDataEncryption(nextPassword, nextCredential);
  stored = await local.get([WRAPPED_KEY, LEGACY_KEY]);
  assert.equal(stored[WRAPPED_KEY].version, 3);
  assert.equal(stored[LEGACY_KEY], undefined);
});
