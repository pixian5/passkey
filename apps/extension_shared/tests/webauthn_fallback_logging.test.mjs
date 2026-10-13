import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");

const findLog = (logs, key) => logs
  .find((entry) => Array.isArray(entry) && entry[1] === key);

// 在最小桩环境里加载主世界注入脚本，验证 runFallbackCreate / runFallbackGet
// 对"Pass 让位 Chrome 原生"的两条路径（成功、失败）都记录真实结果。
test("Pass 让位原生后记录 create/get 的成功与失败", async () => {
  const logs = [];
  const originalConsole = globalThis.console;
  globalThis.console = {
    info: (...args) => { logs.push(args); },
    log() {}, warn() {}, error() {}, debug() {},
  };
  const documentStub = {
    documentElement: { setAttribute() {}, getAttribute() { return null; } },
    addEventListener() {},
  };
  const windowStub = {
    __passWebAuthnBridgeInstalled: false,
    location: { href: "https://example.test/", origin: "https://example.test" },
    addEventListener() {},
    removeEventListener() {},
    postMessage() {},
  };
  let nativeCreateShouldThrow = false;
  const credentials = {
    create: async () => {
      if (nativeCreateShouldThrow) {
        const error = new Error("user canceled");
        error.name = "NotAllowedError";
        throw error;
      }
      return {
        id: "cred-id-1234567890",
        type: "public-key",
        response: { clientDataJSON: new Uint8Array(8), attestationObject: new Uint8Array(8) },
      };
    },
    get: async () => ({
      id: "assert-id",
      type: "public-key",
      response: { clientDataJSON: new Uint8Array(8) },
    }),
  };
  globalThis.window = windowStub;
  globalThis.document = documentStub;
  Object.defineProperty(globalThis, "navigator", { value: { credentials }, configurable: true });
  globalThis.location = windowStub.location;
  try {
    await import(pathToFileURL(path.join(appDir, "webauthn_injected.js")).href);

    // 非可托管（attestation direct，与谷歌同因）→ 让位原生，应记录成功。
    const created = await credentials.create({
      publicKey: {
        rp: { id: "google.com", name: "Google" },
        user: { id: new Uint8Array(8), name: "user@gmail.com" },
        challenge: new Uint8Array(16),
        attestation: "direct",
      },
    });
    assert.equal(created.id, "cred-id-1234567890", "原生 create 返回应原样透传");
    const success = findLog(logs, "create-fallback-native-success");
    assert.ok(success, "应记录原生 create 成功");
    assert.match(JSON.stringify(success[2] || {}), /google\.com/);

    // 原生 create 失败 → 记录错误并向上抛出（页面能拿到真实错误名）。
    nativeCreateShouldThrow = true;
    logs.length = 0;
    await assert.rejects(
      () => credentials.create({
        publicKey: {
          rp: { id: "google.com" },
          user: { id: new Uint8Array(8), name: "user@gmail.com" },
          challenge: new Uint8Array(16),
          attestation: "direct",
        },
      }),
      (error) => error.name === "NotAllowedError",
    );
    const failure = findLog(logs, "create-fallback-native-error");
    assert.ok(failure, "应记录原生 create 失败");
    assert.match(JSON.stringify(failure[2] || {}), /NotAllowedError/);

    // get 让位原生同样记录成功（无 challenge → 不可托管，走原生）。
    logs.length = 0;
    const asserted = await credentials.get({
      publicKey: {
        rpId: "google.com",
        allowCredentials: [],
      },
    });
    assert.equal(asserted.id, "assert-id");
    assert.ok(findLog(logs, "get-fallback-native-success"), "应记录原生 get 成功");
  } finally {
    globalThis.console = originalConsole;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.location;
  }
});
