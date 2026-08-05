import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPasskeyDiagnostic,
  buildPasskeyBridgeDiagnostic,
  buildPasskeyPageDiagnostic,
  getLatestCreateDiagnostic,
  getLatestCreateDiagnosticReport,
  STORAGE_KEY_PASSKEY_DIAGNOSTICS,
} from "../webauthn_diagnostics.js";

test("注册诊断只保留协议元数据，不泄露挑战、用户或凭据标识", () => {
  const authenticatorData = Buffer.from([
    ...new Uint8Array(32), 0x5d, 0, 0, 0, 0,
    ...new Uint8Array(16),
    0, 32,
  ]).toString("base64url");
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: "webauthn.create",
    challenge: Buffer.alloc(32, 3).toString("base64url"),
    origin: "https://myaccount.google.com",
    crossOrigin: false,
  })).toString("base64url");
  const rawId = Buffer.alloc(32, 7).toString("base64url");
  const diagnostic = buildPasskeyBridgeDiagnostic({
    extensionVersion: "1.5.1",
    phase: "store-response",
    payload: {
      operation: "create",
      diagnosticSessionId: "req_12345678",
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
          attestationFormat: "none",
          id: "do-not-log-id",
          rawIdB64u: rawId,
          type: "public-key",
          authenticatorAttachment: "platform",
          response: {
            clientDataJSONB64u: clientDataJSON,
            attestationObjectB64u: Buffer.alloc(180, 4).toString("base64url"),
            authenticatorDataB64u: authenticatorData,
            publicKeyB64u: Buffer.alloc(91, 5).toString("base64url"),
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
  assert.equal(diagnostic.response.authenticatorData.aaguid, "00000000000000000000000000000000");
  assert.equal(diagnostic.response.authenticatorData.aaguidIsZero, true);
  assert.equal(diagnostic.response.authenticatorData.credentialIdLength, 32);
  assert.equal(diagnostic.response.attestationFormat, "none");
  assert.equal(diagnostic.response.anonymousAttestation, true);
  assert.ok(diagnostic.request.challengeByteLength > 0);
  assert.equal(diagnostic.response.clientData.challengeByteLength, 32);
  assert.equal(diagnostic.response.clientData.origin, "https://myaccount.google.com");
  assert.equal(diagnostic.response.byteLengths.attestationObject, 180);
  assert.equal(diagnostic.response.byteLengths.publicKey, 91);
  assert.deepEqual(diagnostic.response.clientExtensionResults, { names: ["credProps"], credPropsRk: true });
  assert.deepEqual(diagnostic.selfChecks.nonStandardClientExtensionResultNames, []);
  assert.equal(diagnostic.selfChecks.anonymousAttestationIsConsistent, true);
});

test("页面错误诊断会脱敏 URL、邮箱和长令牌", () => {
  const diagnostic = buildPasskeyPageDiagnostic({
    extensionVersion: "1.5.3",
    payload: {
      operation: "create",
      diagnosticSessionId: "req_abcdefgh",
      phase: "page-unhandled-rejection",
      origin: "https://myaccount.google.com",
      host: "myaccount.google.com",
      details: {
        constructor: "RpcError",
        name: "RpcError",
        code: "13",
        message: "failed https://example.test/path user@example.test abcdefghijklmnopqrstuvwxyz0123456789",
      },
    },
  });

  assert.equal(diagnostic.pageError.constructor, "RpcError");
  assert.equal(diagnostic.pageError.code, "13");
  assert.equal(diagnostic.pageError.message, "failed [url] [email] [token]");
});

test("最近注册报告按同一诊断会话聚合时间线", () => {
  const entries = [
    { operation: "create", diagnosticSessionId: "req_oldsession", phase: "store-response", atMs: 1 },
    { operation: "create", diagnosticSessionId: "req_newsession", phase: "store-response", atMs: 10, extensionVersion: "1.5.4" },
    { operation: "get", diagnosticSessionId: "req_otherget", phase: "store-response", atMs: 11 },
    { operation: "create", diagnosticSessionId: "req_newsession", phase: "page-credential-returned", atMs: 12, extensionVersion: "1.5.4" },
    { operation: "create", diagnosticSessionId: "req_newsession", phase: "page-unhandled-rejection", atMs: 13, extensionVersion: "1.5.4" },
  ];

  const report = getLatestCreateDiagnosticReport(entries);
  assert.equal(report.reportVersion, 2);
  assert.equal(report.diagnosticSessionId, "req_newsession");
  assert.equal(report.eventCount, 3);
  assert.deepEqual(report.events.map((item) => item.phase), [
    "store-response",
    "page-credential-returned",
    "page-unhandled-rejection",
  ]);
});

test("并发诊断事件会串行写入，不丢失 API 时间线", async () => {
  let entries = [];
  const storage = {
    async get() {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { [STORAGE_KEY_PASSKEY_DIAGNOSTICS]: [...entries] };
    },
    async set(value) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      entries = [...value[STORAGE_KEY_PASSKEY_DIAGNOSTICS]];
    },
  };

  await Promise.all([
    appendPasskeyDiagnostic(storage, { operation: "create", phase: "store-response" }),
    appendPasskeyDiagnostic(storage, { operation: "create", phase: "page-credential-returned" }),
    appendPasskeyDiagnostic(storage, { operation: "create", phase: "page-api-called" }),
  ]);

  assert.deepEqual(entries.map((item) => item.phase), [
    "store-response",
    "page-credential-returned",
    "page-api-called",
  ]);
});

test("优先返回最近一次注册而不是断言诊断", () => {
  assert.deepEqual(getLatestCreateDiagnostic([
    { operation: "create", atMs: 1 },
    { operation: "get", atMs: 2 },
    { operation: "create", atMs: 3 },
  ]), { operation: "create", atMs: 3 });
});
