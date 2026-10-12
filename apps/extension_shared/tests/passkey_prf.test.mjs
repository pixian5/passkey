import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

import { ensureDataStorageReady, getPasskeys, setPasskeys } from "../data_store.js";

function createStorageArea() {
  const values = new Map();
  return {
    async get(keys) {
      const result = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
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
  };
}

globalThis.chrome = {
  storage: {
    local: createStorageArea(),
    session: createStorageArea(),
  },
};

const { handlePasskeyBridgeOperation } = await import("../passkey_store.js");

const RP_HOST = "vault.bitwarden.com";
const RP_ORIGIN = "https://vault.bitwarden.com";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64url(input) {
  return Buffer.from(String(input), "base64url");
}

function hmacSha256(secretBytes, saltBytes) {
  return crypto.createHmac("sha256", secretBytes).update(saltBytes).digest();
}

async function createCredential({ withPrf, userName = "u@b.com" }) {
  const res = await handlePasskeyBridgeOperation({
    operation: "create",
    origin: RP_ORIGIN,
    host: RP_HOST,
    publicKey: {
      challengeB64u: base64url(`prf-challenge-${Math.random()}`),
      rp: { id: RP_HOST, name: "Bitwarden" },
      user: { idB64u: base64url("prf-user-id"), name: userName, displayName: "U" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      extensions: withPrf ? { prf: {} } : { credProps: true },
    },
  });
  assert.equal(res.ok, true, JSON.stringify(res.error || {}));
  return res.result.credential;
}

async function getAssertion({ prfExtensions }) {
  const res = await handlePasskeyBridgeOperation({
    operation: "get",
    origin: RP_ORIGIN,
    host: RP_HOST,
    publicKey: {
      challengeB64u: base64url(`prf-assert-${Math.random()}`),
      rpId: RP_HOST,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      extensions: prfExtensions || {},
    },
  });
  assert.equal(res.ok, true, JSON.stringify(res.error || {}));
  return res.result.credential;
}

test("create 请求 PRF 时生成 hmacSecret 并声明支持", async () => {
  await ensureDataStorageReady();
  await setPasskeys([]);
  const credential = await createCredential({ withPrf: true });
  assert.deepEqual(credential.clientExtensionResults, { prf: { enabled: true } });

  const stored = await getPasskeys();
  assert.equal(stored.length, 1);
  assert.ok(stored[0].hmacSecretB64u && stored[0].hmacSecretB64u.length > 0, "应保存 hmacSecretB64u");
  assert.equal(decodeBase64url(stored[0].hmacSecretB64u).length, 32, "hmacSecret 应为 32 字节");
});

test("create 未请求 PRF 时不生成 hmacSecret、不返回 prf", async () => {
  await ensureDataStorageReady();
  await setPasskeys([]);
  const credential = await createCredential({ withPrf: false });
  assert.deepEqual(credential.clientExtensionResults, { credProps: { rk: true } });

  const stored = await getPasskeys();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].hmacSecretB64u == null, true, "未请求 PRF 时不应保存 hmacSecretB64u");
});

test("get 请求 PRF 时按 salt 计算 HMAC-SHA-256 输出", async () => {
  await ensureDataStorageReady();
  await setPasskeys([]);
  await createCredential({ withPrf: true });
  const stored = await getPasskeys();
  const hmacSecretBytes = decodeBase64url(stored[0].hmacSecretB64u);

  const salt1 = Buffer.alloc(32, 0x11);
  const salt2 = Buffer.alloc(32, 0x22);
  const credential = await getAssertion({
    prfExtensions: { prf: { eval: { first: new Uint8Array(salt1), second: new Uint8Array(salt2) } } },
  });
  const prf = credential.clientExtensionResults.prf;
  assert.ok(prf && prf.results, "应返回 prf.results");

  const expectedFirst = hmacSha256(hmacSecretBytes, salt1);
  const expectedSecond = hmacSha256(hmacSecretBytes, salt2);
  assert.equal(decodeBase64url(prf.results.first).toString("hex"), expectedFirst.toString("hex"));
  assert.equal(decodeBase64url(prf.results.second).toString("hex"), expectedSecond.toString("hex"));
});

test("get 请求 PRF 单 salt 时只返回 first", async () => {
  await ensureDataStorageReady();
  await setPasskeys([]);
  await createCredential({ withPrf: true });
  const stored = await getPasskeys();
  const hmacSecretBytes = decodeBase64url(stored[0].hmacSecretB64u);

  const salt1 = Buffer.alloc(32, 0x33);
  const credential = await getAssertion({
    prfExtensions: { prf: { eval: { first: new Uint8Array(salt1) } } },
  });
  const prf = credential.clientExtensionResults.prf;
  assert.ok(prf && prf.results, "应返回 prf.results");
  assert.equal(decodeBase64url(prf.results.first).toString("hex"), hmacSha256(hmacSecretBytes, salt1).toString("hex"));
  assert.equal(prf.results.second, undefined, "未提供 second 时不应返回 second");
});

test("get 请求 evalByCredentialId 时按凭据 ID 计算 PRF", async () => {
  await ensureDataStorageReady();
  await setPasskeys([]);
  await createCredential({ withPrf: true });
  const stored = await getPasskeys();
  const hmacSecretBytes = decodeBase64url(stored[0].hmacSecretB64u);

  const salt1 = Buffer.alloc(32, 0x44);
  const credential = await getAssertion({
    prfExtensions: {
      prf: { evalByCredentialId: { [stored[0].credentialIdB64u]: { first: new Uint8Array(salt1) } } },
    },
  });
  const prf = credential.clientExtensionResults.prf;
  assert.ok(prf && prf.results, "应返回 prf.results");
  assert.equal(decodeBase64url(prf.results.first).toString("hex"), hmacSha256(hmacSecretBytes, salt1).toString("hex"));
});

test("get 的 PRF salt 以 base64url（firstB64u/secondB64u）传入时同样可计算", async () => {
  // 注入层经 chrome.runtime.sendMessage 传参时，salt 是 base64url 字符串而非 ArrayBuffer。
  await ensureDataStorageReady();
  await setPasskeys([]);
  await createCredential({ withPrf: true });
  const stored = await getPasskeys();
  const hmacSecretBytes = decodeBase64url(stored[0].hmacSecretB64u);

  const salt1 = Buffer.alloc(32, 0x66);
  const salt2 = Buffer.alloc(32, 0x77);
  const credential = await getAssertion({
    prfExtensions: {
      prf: {
        eval: {
          firstB64u: salt1.toString("base64url"),
          secondB64u: salt2.toString("base64url"),
        },
      },
    },
  });
  const prf = credential.clientExtensionResults.prf;
  assert.ok(prf && prf.results, "应返回 prf.results");
  assert.equal(decodeBase64url(prf.results.first).toString("hex"), hmacSha256(hmacSecretBytes, salt1).toString("hex"));
  assert.equal(decodeBase64url(prf.results.second).toString("hex"), hmacSha256(hmacSecretBytes, salt2).toString("hex"));
});

test("get 未请求 PRF 时不返回扩展结果", async () => {
  await ensureDataStorageReady();
  await setPasskeys([]);
  await createCredential({ withPrf: true });
  const credential = await getAssertion({ prfExtensions: {} });
  assert.deepEqual(credential.clientExtensionResults, {});
});

test("get 请求 PRF 但凭据无 hmacSecret 时返回空扩展（旧凭据需重注册）", async () => {
  await ensureDataStorageReady();
  await setPasskeys([]);
  await createCredential({ withPrf: true });
  const stored = await getPasskeys();
  const stripped = stored.map((item) => ({ ...item, hmacSecretB64u: undefined }));
  await setPasskeys(stripped);

  const salt1 = Buffer.alloc(32, 0x55);
  const credential = await getAssertion({
    prfExtensions: { prf: { eval: { first: new Uint8Array(salt1) } } },
  });
  assert.deepEqual(credential.clientExtensionResults, {});
});
