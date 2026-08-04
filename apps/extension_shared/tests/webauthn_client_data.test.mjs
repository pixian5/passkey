import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreateClientExtensionResults,
  buildWebAuthnClientDataJSON,
  resolveWebAuthnWindowContext,
} from "../webauthn_client_data.js";

function decodeClientData(input) {
  return JSON.parse(new TextDecoder().decode(input));
}

function frameWindow({ origin, topOrigin = origin, ancestorOrigins = [] }) {
  const self = { location: { origin, ancestorOrigins } };
  self.self = self;
  self.parent = { location: { origin: topOrigin } };
  self.top = { location: { origin: topOrigin } };
  return self;
}

test("Google 同源 iframe 注册不会被误标为跨源", () => {
  const context = resolveWebAuthnWindowContext(frameWindow({
    origin: "https://myaccount.google.com",
    topOrigin: "https://myaccount.google.com",
  }));
  assert.deepEqual(context, {
    origin: "https://myaccount.google.com",
    host: "myaccount.google.com",
    crossOrigin: false,
    topOrigin: "",
  });

  const clientData = decodeClientData(buildWebAuthnClientDataJSON({
    type: "webauthn.create",
    challengeB64u: "YWJjZA==",
    ...context,
  }));
  assert.deepEqual(clientData, {
    type: "webauthn.create",
    challenge: "YWJjZA",
    origin: "https://myaccount.google.com",
  });
});

test("真正跨源的 WebAuthn 请求携带 topOrigin", () => {
  const crossOriginWindow = frameWindow({
    origin: "https://accounts.google.com",
    ancestorOrigins: ["https://myaccount.google.com"],
  });
  crossOriginWindow.top = {
    get location() {
      throw new Error("Blocked by same-origin policy");
    },
  };
  const context = resolveWebAuthnWindowContext(crossOriginWindow);
  const clientData = decodeClientData(buildWebAuthnClientDataJSON({
    type: "webauthn.create",
    challengeB64u: "dGVzdA",
    ...context,
  }));
  assert.equal(clientData.crossOrigin, true);
  assert.equal(clientData.topOrigin, "https://myaccount.google.com");
});

test("about:blank 子框架继承父页面的有效来源", () => {
  const context = resolveWebAuthnWindowContext(frameWindow({
    origin: "null",
    topOrigin: "https://accounts.google.com",
    ancestorOrigins: ["https://accounts.google.com"],
  }));
  assert.deepEqual(context, {
    origin: "https://accounts.google.com",
    host: "accounts.google.com",
    crossOrigin: false,
    topOrigin: "",
  });
});

test("Google 请求 credProps 时声明已创建可发现凭据", () => {
  assert.deepEqual(buildCreateClientExtensionResults({ credProps: true }), {
    credProps: { rk: true },
  });
  assert.deepEqual(buildCreateClientExtensionResults({}), {});
});
