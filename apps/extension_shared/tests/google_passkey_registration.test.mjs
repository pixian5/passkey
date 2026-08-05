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

test("Google 风格 direct 请求返回匿名证明并通过独立 WebAuthn 服务端验签", async () => {
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
      attestation: "direct",
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
