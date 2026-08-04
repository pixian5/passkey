import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPasskeyBridgeDiagnostic,
  getLatestCreateDiagnostic,
} from "../webauthn_diagnostics.js";

test("注册诊断只保留协议元数据，不泄露挑战、用户或凭据标识", () => {
  const authenticatorData = Buffer.from([
    ...new Uint8Array(32), 0x5d, 0, 0, 0, 0,
    0xb8, 0xe4, 0x34, 0x4b, 0x1b, 0x50, 0x4e, 0xa1,
    0xb4, 0xa9, 0xd0, 0xba, 0x20, 0xa0, 0x07, 0xa6,
    0, 32,
  ]).toString("base64url");
  const diagnostic = buildPasskeyBridgeDiagnostic({
    extensionVersion: "1.5.1",
    phase: "store-response",
    payload: {
      operation: "create",
      origin: "https://myaccount.google.com",
      host: "myaccount.google.com",
      sourceContext: { origin: "https://myaccount.google.com", host: "myaccount.google.com" },
      publicKey: {
        challengeB64u: "do-not-log-challenge",
        rp: { id: "google.com" },
        user: { idB64u: "do-not-log-user", name: "do-not-log-name" },
        attestation: "none",
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        excludeCredentials: [{ idB64u: "do-not-log-id" }],
        extensions: { credProps: true },
      },
    },
    response: {
      ok: true,
      result: {
        createMode: "created",
        credential: {
          id: "do-not-log-id",
          response: {
            authenticatorDataB64u: authenticatorData,
            publicKeyAlgorithm: -7,
            transports: ["internal"],
          },
          clientExtensionResults: { credProps: { rk: true } },
        },
      },
    },
  });

  const serialized = JSON.stringify(diagnostic);
  assert.equal(serialized.includes("do-not-log"), false);
  assert.equal(diagnostic.request.rpId, "google.com");
  assert.equal(diagnostic.response.authenticatorData.flags, "0x5d");
  assert.equal(diagnostic.response.authenticatorData.aaguid, "b8e4344b1b504ea1b4a9d0ba20a007a6");
  assert.equal(diagnostic.response.authenticatorData.credentialIdLength, 32);
});

test("优先返回最近一次注册而不是断言诊断", () => {
  assert.deepEqual(getLatestCreateDiagnostic([
    { operation: "create", atMs: 1 },
    { operation: "get", atMs: 2 },
    { operation: "create", atMs: 3 },
  ]), { operation: "create", atMs: 3 });
});
