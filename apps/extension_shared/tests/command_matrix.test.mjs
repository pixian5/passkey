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
const backgroundMessages = [];
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
    sendMessage(message, callback) {
      backgroundMessages.push(message);
      if (message?.type === "PASS_SYNC_OUTBOX_STATUS") {
        callback({ ok: true, items: [{ sourceKey: "server|https://sync.example", attempts: 2, status: "pendingRetry" }] });
        return;
      }
      if (message?.type === "PASS_SYNC_OUTBOX_CLEAR_INACTIVE") {
        callback({ ok: true, removed: 2 });
        return;
      }
      if (message?.type === "PASS_SYNC_RUN") {
        callback({ ok: true, result: { report: { ok: true, dryRun: Boolean(message.payload?.dryRun) } } });
        return;
      }
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

test("扩展不支持能力必须明确失败；服务器版本在已配置时可用", async () => {
  await assert.rejects(() => invoke("sync_webdav_now_mode", { mode: "merge" }), /WebDAV/);
  await assert.rejects(() => invoke("provision_self_hosted_server", {}), /SSH|桌面/);
  await assert.rejects(() => invoke("lock_unlock_biometric", {}), /指纹|生物|不提供/);
  // 未配置 baseUrl 时列表为空；非法 versionId 明确报错
  const versions = await invoke("list_server_versions");
  assert.deepEqual(versions, []);
  await assert.rejects(() => invoke("restore_server_version", { versionId: "x" }), /快照编号|配置|URL|服务器/);
  await assert.rejects(() => invoke("restore_server_version", { versionId: "1" }), /配置|URL|服务器/);
  const health = await invoke("health_check");
  assert.equal(health.capabilities.serverVersions, true);
  assert.equal(health.capabilities.webdavSync, false);
});

test("Chrome Web 管理页把同步和补偿队列委托给后台", async () => {
  await invoke("set_sync_settings", { settings: { enabled: true, baseUrl: "https://sync.example" } });
  const items = await invoke("get_sync_outbox_status");
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceKey, "server|https://sync.example");
  assert.equal(await invoke("clear_inactive_sync_outbox"), 2);
  const preview = await invoke("sync_preview");
  assert.equal(preview.report.dryRun, true);
  const sync = await invoke("sync_now_mode", { mode: "merge", forceOutboxRetry: true });
  assert.equal(sync.report.ok, true);
  assert.ok(backgroundMessages.some((message) => message.type === "PASS_WEB_SYNC_CONFIGURE"));
  assert.ok(backgroundMessages.some((message) => message.type === "PASS_SYNC_RUN" && message.payload?.forceOutboxRetry === true));
});
