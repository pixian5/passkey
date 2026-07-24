import assert from "node:assert/strict";
import test from "node:test";

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

test("清空回收站保留永久删除墓碑并清除敏感字段", async () => {
  const account = await invoke("create_account", {
    input: {
      sites: ["example.com"],
      username: "alice",
      password: "secret",
      totpSecret: "totp-secret",
      recoveryCodes: "recovery-codes",
    },
  });
  await invoke("soft_delete_accounts", { accountIds: [account.recordId] });
  assert.equal(await invoke("hard_delete_all_deleted_accounts"), 1);

  const history = await invoke("get_operation_history");
  const purgeEntry = history.find((entry) => entry.title === "清空回收站") || history[0];
  const tombstone = purgeEntry.after.accounts.find((item) => item.recordId === account.recordId);
  assert.ok(tombstone, "永久删除后必须保留稳定 ID 的账号墓碑");
  assert.equal(tombstone.isDeleted, true);
  assert.equal(tombstone.isPermanentlyDeleted, true);
  assert.equal(tombstone.password, "");
  assert.equal(tombstone.totpSecret, "");
  assert.equal(tombstone.recoveryCodes, "");
  assert.ok(tombstone.deletedAtMs > 0);
  assert.ok(tombstone.updatedAtMs >= tombstone.deletedAtMs);
  assert.ok(tombstone.deletedDeviceName);
});

test("批量恢复清理删除状态、恢复有效文件夹并保持原顺序", async () => {
  const folder = await invoke("create_folder", { name: "工作" });
  const first = await invoke("create_account", { input: { sites: ["a.example"], username: "a", folderIds: [folder.id] } });
  const second = await invoke("create_account", { input: { sites: ["b.example"], username: "b", folderIds: [folder.id] } });
  await invoke("soft_delete_accounts", { accountIds: [first.recordId, second.recordId] });
  assert.equal(await invoke("restore_all_deleted_accounts"), 2);

  const state = await invoke("get_app_state");
  const restoredFirst = state.activeAccounts.find((item) => item.recordId === first.recordId);
  const restoredSecond = state.activeAccounts.find((item) => item.recordId === second.recordId);
  assert.equal(restoredFirst.deletedAtMs, null);
  assert.equal(restoredFirst.deletedDeviceName, "");
  assert.deepEqual(restoredFirst.folderIds, [folder.id]);
  assert.equal(restoredFirst.folderMembershipStates[folder.id.toLowerCase()].isDeleted, false);
  assert.equal(restoredSecond.deletedAtMs, null);
  assert.deepEqual(state.allRegularAccountIds.slice(0, 2), [first.recordId, second.recordId]);
  const restoredFolder = state.folders.find((item) => item.id === folder.id);
  assert.deepEqual(restoredFolder.regularAccountIds.slice(0, 2), [first.recordId, second.recordId]);
});
