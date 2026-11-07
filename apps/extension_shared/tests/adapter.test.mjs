import test from "node:test";
import assert from "node:assert/strict";
import {
  detectSurface,
  triggerBlobDownload,
  PassClientAdapter,
} from "../../codex-tauri/src/adapter.js";

test("detectSurface detects runtime correctly", () => {
  const originalWindow = globalThis.window;
  try {
    // 1) Extension
    globalThis.window = {
      __PASS_EXTENSION_INVOKE__: () => {},
    };
    assert.equal(detectSurface(), "chrome-extension");

    // 2) Tauri
    globalThis.window = {
      __TAURI__: {
        core: {
          invoke: () => {},
        },
      },
    };
    assert.equal(detectSurface(), "tauri");

    // 3) Web
    globalThis.window = {};
    assert.equal(detectSurface(), "docker-web");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("PassClientAdapter delegates to extension bridge when available", async () => {
  const originalWindow = globalThis.window;
  try {
    let capturedCmd = null;
    let capturedArgs = null;
    globalThis.window = {
      __PASS_EXTENSION_INVOKE__: async (cmd, args) => {
        capturedCmd = cmd;
        capturedArgs = args;
        return { ok: true, surface: "bridge" };
      },
    };

    const adapter = new PassClientAdapter();
    const result = await adapter.invoke("health_check", { test: 123 });
    assert.equal(capturedCmd, "health_check");
    assert.deepEqual(capturedArgs, { test: 123 });
    assert.deepEqual(result, { ok: true, surface: "bridge" });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("PassClientAdapter delegates to Tauri invoke when available", async () => {
  const originalWindow = globalThis.window;
  try {
    let capturedCmd = null;
    let capturedArgs = null;
    globalThis.window = {
      __TAURI__: {
        core: {
          invoke: async (cmd, args) => {
            capturedCmd = cmd;
            capturedArgs = args;
            return { ok: true, surface: "tauri" };
          },
        },
      },
    };

    const adapter = new PassClientAdapter();
    const result = await adapter.invoke("health_check", { ping: "pong" });
    assert.equal(capturedCmd, "health_check");
    assert.deepEqual(capturedArgs, { ping: "pong" });
    assert.deepEqual(result, { ok: true, surface: "tauri" });
  } finally {
    globalThis.window = originalWindow;
  }
});

test("PassClientAdapter invokes HTTP RPC in web mode with token", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  try {
    let fetchUrl = null;
    let fetchOptions = null;
    globalThis.window = {
      localStorage: {
        getItem: (k) => (k === "pass.web.authToken" ? "secret-token-123" : null),
      },
    };
    globalThis.fetch = async (url, options) => {
      fetchUrl = url;
      fetchOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { ok: true, web: true } }),
      };
    };

    const adapter = new PassClientAdapter();
    const result = await adapter.invoke("health_check", { query: "state" });
    assert.equal(fetchUrl, "/api/invoke/health_check");
    assert.equal(fetchOptions.method, "POST");
    assert.equal(fetchOptions.headers["Authorization"], "Bearer secret-token-123");
    assert.equal(fetchOptions.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(fetchOptions.body), { query: "state" });
    assert.deepEqual(result, { ok: true, web: true });
  } finally {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  }
});

test("triggerBlobDownload handles base64 payload cleanly", () => {
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;
  try {
    let clicked = false;
    let downloadAttr = "";
    let hrefAttr = "";
    let revoked = false;

    globalThis.document = {
      createElement: (tag) => {
        if (tag === "a") {
          return {
            set href(val) { hrefAttr = val; },
            get href() { return hrefAttr; },
            set download(val) { downloadAttr = val; },
            get download() { return downloadAttr; },
            click: () => { clicked = true; },
          };
        }
        return {};
      },
    };
    globalThis.URL = {
      createObjectURL: () => "blob:fake-url",
      revokeObjectURL: () => { revoked = true; },
    };

    const sampleBase64 = Buffer.from("test-content").toString("base64");
    triggerBlobDownload(sampleBase64, "text/plain", "export.csv");

    assert.equal(clicked, true);
    assert.equal(downloadAttr, "export.csv");
    assert.equal(hrefAttr, "blob:fake-url");
  } finally {
    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
  }
});
