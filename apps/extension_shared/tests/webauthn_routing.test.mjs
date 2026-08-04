import assert from "node:assert/strict";
import test from "node:test";

import {
  explainCreateManageability,
  explainGetManageability,
  shouldFallbackToBrowser,
} from "../webauthn_routing.js";

test("读取通行密钥不因网站给出的 transport 提示跳过 Pass", () => {
  assert.deepEqual(
    explainGetManageability({
      hasChallenge: true,
      allowCredentials: [{ transports: ["hybrid", "usb"] }],
    }),
    { manageable: true, reason: "managed-by-pass" },
  );
});

test("创建外置安全密钥和缺失 challenge 的请求仍由浏览器处理", () => {
  assert.deepEqual(
    explainCreateManageability({ hasChallenge: true, hasUserId: true, authenticatorAttachment: "cross-platform" }),
    { manageable: false, reason: "cross-platform-requested" },
  );
  assert.deepEqual(explainGetManageability({ hasChallenge: false }), {
    manageable: false,
    reason: "missing-challenge",
  });
});

test("Pass 通信或超时失败不会静默回退到浏览器原生通行密钥", () => {
  assert.equal(shouldFallbackToBrowser({ code: "PASSKEY_NOT_FOUND" }), true);
  assert.equal(shouldFallbackToBrowser({ code: "PASSKEY_USE_BROWSER" }), true);
  assert.equal(shouldFallbackToBrowser({ code: "PASSKEY_CONTEXT_INVALIDATED" }), false);
  assert.equal(shouldFallbackToBrowser({ name: "TimeoutError" }), false);
});
