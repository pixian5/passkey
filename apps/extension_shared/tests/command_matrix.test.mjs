import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("三端命令矩阵检查通过", () => {
  const script = path.join(repositoryRoot, "scripts/check_command_matrix.mjs");
  const result = spawnSync(process.execPath, [script], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + "\n" + result.stderr);
  assert.match(result.stdout, /command matrix OK/);
});

const storage = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const result = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (storage.has(key)) result[key] = storage.get(key);
        }
        return result;
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) storage.set(key, value);
      },
    },
  },
  runtime: {
    lastError: null,
    sendMessage(_message, callback) {
      callback({ ok: true });
    },
  },
};

await import(`../../extension_chrome_web/extension-bridge.js?test=${Date.now()}-${Math.random()}`);
const invoke = globalThis.__PASS_EXTENSION_INVOKE__;

test("批量删除/恢复/清空返回数字 count", async () => {
  const a = await invoke("create_account", { input: { sites: ["a.example"], username: "a", password: "p" } });
  const b = await invoke("create_account", { input: { sites: ["b.example"], username: "b", password: "p" } });
  const soft = await invoke("soft_delete_accounts", { accountIds: [a.recordId, b.recordId] });
  assert.equal(typeof soft, "number");
  assert.equal(soft, 2);
  const restored = await invoke("restore_all_deleted_accounts");
  assert.equal(typeof restored, "number");
  assert.equal(restored, 2);
  await invoke("soft_delete_accounts", { accountIds: [a.recordId, b.recordId] });
  const purged = await invoke("hard_delete_all_deleted_accounts");
  assert.equal(typeof purged, "number");
  assert.equal(purged, 2);
});

test("扩展不支持能力必须明确失败或空列表", async () => {
  await assert.rejects(() => invoke("sync_webdav_now_mode", { mode: "merge" }), /WebDAV/);
  await assert.rejects(() => invoke("restore_server_version", { versionId: "x" }), /服务器版本/);
  await assert.rejects(() => invoke("provision_self_hosted_server", {}), /SSH|桌面/);
  await assert.rejects(() => invoke("lock_unlock_biometric", {}), /指纹|生物|不提供/);
  const versions = await invoke("list_server_versions");
  assert.deepEqual(versions, []);
});
