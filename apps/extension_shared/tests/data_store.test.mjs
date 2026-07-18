import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

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
  getAccounts,
  getSyncSecrets,
  lockDataEncryption,
  migrateLegacySyncSecrets,
  rewrapDataEncryption,
  setSyncSecrets,
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
const WEBDAV_PASSWORD_KEY = "pass.sync.webdav.password.v2";
const SERVER_TOKEN_KEY = "pass.sync.server.token.v2";
const SYNC_ENCRYPTION_KEY = "pass.sync.encryptionKey.v1";
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

async function readEncryptedCollectionRow(key) {
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("pass.local.db.v1", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction("collections", "readonly")
        .objectStore("collections")
        .get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
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

test("迁移标记已存在时仍会转换 Safari 新来源中的旧集合", async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("pass.local.db.v1");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("数据库删除被阻塞"));
  });
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("pass.local.db.v1", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("collections", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("collections", "readwrite");
    transaction.objectStore("collections").put({
      key: "accounts",
      value: [{ accountId: "safari-origin-account", username: "user@example.com" }],
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();

  await local.set({ "pass.data.migratedToIndexedDb.v1": true });
  assert.deepEqual(await getAccounts(), [
    { accountId: "safari-origin-account", username: "user@example.com" },
  ]);
  const migratedRow = await readEncryptedCollectionRow("accounts");
  assert.equal(migratedRow.version, 1);
  assert.equal(typeof migratedRow.nonceBase64, "string");
  assert.equal(typeof migratedRow.ciphertextBase64, "string");
});

test("同步秘密迁移到加密数据库后，锁定状态无法读取且明文键被删除", async () => {
  const password = "sync secrets password";
  const credential = await createLockMasterCredential(password);
  await unlockDataEncryption(password, credential);
  await local.set({
    [WEBDAV_PASSWORD_KEY]: "webdav secret",
    [SERVER_TOKEN_KEY]: "server secret",
    [SYNC_ENCRYPTION_KEY]: "sync secret",
  });

  const migrated = await migrateLegacySyncSecrets();
  assert.deepEqual(migrated, {
    webdavPassword: "webdav secret",
    serverToken: "server secret",
    encryptionKey: "sync secret",
  });
  const plaintext = await local.get([
    WEBDAV_PASSWORD_KEY,
    SERVER_TOKEN_KEY,
    SYNC_ENCRYPTION_KEY,
  ]);
  assert.deepEqual(plaintext, {});
  const encryptedRow = await readEncryptedCollectionRow("syncSecrets");
  assert.equal(encryptedRow.version, 1);
  assert.equal(JSON.stringify(encryptedRow).includes("webdav secret"), false);
  assert.equal(JSON.stringify(encryptedRow).includes("server secret"), false);
  assert.equal(JSON.stringify(encryptedRow).includes("sync secret"), false);

  await lockDataEncryption();
  await assert.rejects(() => getSyncSecrets(), /扩展已锁定/);

  await unlockDataEncryption(password, credential);
  assert.deepEqual(await getSyncSecrets(), migrated);
  await setSyncSecrets({ ...migrated, serverToken: "updated token" });
  assert.equal((await getSyncSecrets()).serverToken, "updated token");
});

test("同步秘密旧密钥失配时仍可从旧明文键恢复并完成初始化", async () => {
  const oldRawKey = crypto.getRandomValues(new Uint8Array(32));
  const currentRawKey = crypto.getRandomValues(new Uint8Array(32));
  await local.set({ [LEGACY_KEY]: bytesToBase64(oldRawKey) });
  await setSyncSecrets({
    webdavPassword: "stale webdav",
    serverToken: "stale server",
    encryptionKey: "stale encryption",
  });
  await lockDataEncryption();

  await local.set({
    [LEGACY_KEY]: bytesToBase64(currentRawKey),
    [WEBDAV_PASSWORD_KEY]: "recovered webdav",
    [SERVER_TOKEN_KEY]: "recovered server",
    [SYNC_ENCRYPTION_KEY]: "recovered encryption",
  });

  const migrated = await migrateLegacySyncSecrets();
  assert.deepEqual(migrated, {
    webdavPassword: "recovered webdav",
    serverToken: "recovered server",
    encryptionKey: "recovered encryption",
  });
  assert.deepEqual(await getSyncSecrets(), migrated);
  assert.deepEqual(await local.get([
    WEBDAV_PASSWORD_KEY,
    SERVER_TOKEN_KEY,
    SYNC_ENCRYPTION_KEY,
  ]), {});
});

test("同步秘密集合损坏且没有旧凭据时拒绝覆盖原始数据", async () => {
  const password = "unreadable sync secrets password";
  const credential = await createLockMasterCredential(password);
  const originalRawKey = crypto.getRandomValues(new Uint8Array(32));
  await local.set({ [LEGACY_KEY]: bytesToBase64(originalRawKey) });
  await setSyncSecrets({
    webdavPassword: "original webdav",
    serverToken: "original server",
    encryptionKey: "original encryption",
  });
  const before = await readEncryptedCollectionRow("syncSecrets");

  await lockDataEncryption();
  await local.set({ [LEGACY_KEY]: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))) });

  await assert.rejects(
    () => migrateLegacySyncSecrets(),
    (error) => error?.code === "SYNC_SECRETS_UNREADABLE"
  );
  const after = await readEncryptedCollectionRow("syncSecrets");
  assert.deepEqual(after, before);
  assert.deepEqual(await local.get([
    WEBDAV_PASSWORD_KEY,
    SERVER_TOKEN_KEY,
    SYNC_ENCRYPTION_KEY,
  ]), {});
});
