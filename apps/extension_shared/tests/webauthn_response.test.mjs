import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthenticatorAssertionResponse,
  buildAuthenticatorAttestationResponse,
} from "../webauthn_response.js";

function bytes(input) {
  return [...new Uint8Array(input)];
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

test("Google 可读取完整的 AuthenticatorAttestationResponse", () => {
  const response = buildAuthenticatorAttestationResponse({
    clientDataJSONB64u: "AQID",
    attestationObjectB64u: "BAUG",
    authenticatorDataB64u: "BwgJ",
    publicKeyB64u: "CgsM",
    publicKeyAlgorithm: -7,
    transports: ["internal"],
  });

  assert.deepEqual(bytes(response.clientDataJSON), [1, 2, 3]);
  assert.deepEqual(bytes(response.attestationObject), [4, 5, 6]);
  assert.deepEqual(bytes(response.getAuthenticatorData()), [7, 8, 9]);
  assert.deepEqual(bytes(response.getPublicKey()), [10, 11, 12]);
  assert.equal(response.getPublicKeyAlgorithm(), -7);
  assert.deepEqual(response.getTransports(), ["internal"]);
  assert.deepEqual(response.toJSON(), {
    clientDataJSON: "AQID",
    attestationObject: "BAUG",
    transports: ["internal"],
    authenticatorData: "BwgJ",
    publicKey: "CgsM",
    publicKeyAlgorithm: -7,
  });
});

test("断言响应提供自己的 toJSON，避免调用原生品牌校验方法", () => {
  const response = buildAuthenticatorAssertionResponse({
    clientDataJSONB64u: "AQ",
    authenticatorDataB64u: "Ag",
    signatureB64u: "Aw",
    userHandleB64u: "BA",
  });
  assert.deepEqual(response.toJSON(), {
    clientDataJSON: "AQ",
    authenticatorData: "Ag",
    signature: "Aw",
    userHandle: "BA",
  });
});

test("注册响应返回的 SPKI 公钥可被 WebCrypto 重新导入", async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const response = buildAuthenticatorAttestationResponse({
    clientDataJSONB64u: "AQ",
    attestationObjectB64u: "Ag",
    authenticatorDataB64u: "Aw",
    publicKeyB64u: base64url(spki),
    publicKeyAlgorithm: -7,
  });

  const imported = await crypto.subtle.importKey(
    "spki",
    response.getPublicKey(),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  assert.equal(imported.type, "public");
  assert.equal(imported.algorithm.name, "ECDSA");
  assert.equal(response.getPublicKeyAlgorithm(), -7);
});
