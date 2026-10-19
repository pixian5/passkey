import assert from "node:assert/strict";
import test from "node:test";

import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

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
const { getPasskeys } = await import("../data_store.js");
const { explainCreateManageability } = await import("../webauthn_routing.js");

// 说明：托管实现只能产出匿名证明（fmt=none）。因此只有 attestation 为 none /
// indirect / 缺省的请求会真正到达桥接层；direct / enterprise 在注入脚本的路由层
// 就让位给系统认证器（见下一条测试）。本测试只证明"到达桥接后协议自洽"，
// 不代表 RP 会接受匿名证明——2026-10-13 谷歌实测已证明它会被服务端拒绝。
test("到达桥接的托管请求只能产出协议合法的匿名证明", async () => {
  const challenge = Buffer.from("google-passkey-registration-challenge").toString("base64url");
  const userId = Buffer.from("google-user-id").toString("base64url");
  const bridgeResponse = await handlePasskeyBridgeOperation({
    operation: "create",
    origin: "https://myaccount.google.com",
    host: "myaccount.google.com",
    publicKey: {
      challengeB64u: challenge,
      rp: { id: "google.com", name: "Google" },
      user: {
        idB64u: userId,
        name: "user@example.com",
        displayName: "Example User",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      attestation: "none",
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      extensions: {
        credProps: true,
        appidExclude: "https://www.gstatic.com/securitykey/origins.json",
        googleLegacyAppidSupport: false,
      },
    },
  });

  assert.equal(bridgeResponse.ok, true);
  const credential = bridgeResponse.result.credential;
  assert.equal(credential.attestationFormat, "none");
  assert.deepEqual(credential.clientExtensionResults, {
    credProps: { rk: true },
  });

  const verification = await verifyRegistrationResponse({
    response: {
      id: credential.id,
      rawId: credential.rawIdB64u,
      type: "public-key",
      authenticatorAttachment: credential.authenticatorAttachment,
      response: {
        clientDataJSON: credential.response.clientDataJSONB64u,
        attestationObject: credential.response.attestationObjectB64u,
        transports: credential.response.transports,
        authenticatorData: credential.response.authenticatorDataB64u,
        publicKey: credential.response.publicKeyB64u,
        publicKeyAlgorithm: credential.response.publicKeyAlgorithm,
      },
      clientExtensionResults: credential.clientExtensionResults,
    },
    expectedChallenge: challenge,
    expectedOrigin: "https://myaccount.google.com",
    expectedRPID: "google.com",
    requireUserVerification: true,
  });

  assert.equal(verification.verified, true);
  assert.ok(verification.registrationInfo);
  assert.equal(verification.registrationInfo.fmt, "none");
  assert.equal(verification.registrationInfo.aaguid, "00000000-0000-0000-0000-000000000000");
});

test("RP 要求 direct/enterprise 时桥接拒绝落库，交由上层让位", async () => {
  // 两层防线必须同时成立：路由层让位（第一层）+ 桥接层拒绝（第二层，防绕过）。
  // 桥接抛 PASSKEY_USE_BROWSER，注入脚本的 shouldFallbackToBrowser 会认这个 code
  // 并走原生让位；同时必须确认没有留下孤儿凭据。
  const passkeysBefore = await getPasskeys();
  assert.ok(passkeysBefore.length >= 1, "前置测试应已留下一枚凭据，否则下面的断言会空转");
  for (const attestation of ["direct", "enterprise", "DIRECT"]) {
    assert.deepEqual(
      explainCreateManageability({ hasChallenge: true, hasUserId: true, attestation }),
      { manageable: false, reason: "attestation-required-by-rp" },
    );
    const response = await handlePasskeyBridgeOperation({
      operation: "create",
      origin: "https://myaccount.google.com",
      host: "myaccount.google.com",
      publicKey: {
        challengeB64u: Buffer.from("reject-challenge").toString("base64url"),
        rp: { id: "google.com", name: "Google" },
        user: {
          idB64u: Buffer.from("reject-user-id").toString("base64url"),
          name: "reject@example.com",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        attestation,
      },
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.name, "NotSupportedError");
    assert.equal(response.error.code, "PASSKEY_USE_BROWSER");
  }
  const passkeysAfter = await getPasskeys();
  assert.equal(passkeysAfter.length, passkeysBefore.length, "拒绝路径不得写入凭据");
  // 长度相等可能因前置落库失败而空转，再按账号精确断言一次。
  const leaked = passkeysAfter.filter(
    (item) => item?.rpId === "google.com" && String(item?.userName || "").trim() === "reject@example.com",
  );
  assert.deepEqual(leaked, [], "拒绝路径不得留下 reject@example.com 的孤儿凭据");
});

test("请求参数不合法时先报参数错误，而不是让位", async () => {
  // 守卫必须排在 challenge / rpId / user.id 等合法性校验之后：缺 user.id 时应先
  // 得到 PASSKEY_USER_MISSING，不能因同时声明 attestation=direct 提前变成让位。
  const response = await handlePasskeyBridgeOperation({
    operation: "create",
    origin: "https://myaccount.google.com",
    host: "myaccount.google.com",
    publicKey: {
      challengeB64u: Buffer.from("order-challenge").toString("base64url"),
      rp: { id: "google.com", name: "Google" },
      user: { idB64u: "", name: "no-id@example.com" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      attestation: "direct",
    },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "PASSKEY_USER_MISSING");
});
