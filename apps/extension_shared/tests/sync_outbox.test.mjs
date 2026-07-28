import assert from "node:assert/strict";
import test from "node:test";

import {
  SYNC_OUTBOX_MAX_ATTEMPTS,
  isSyncOutboxReady,
  normalizeSyncOutbox,
  removeOrphanedSyncOutbox,
  removeSyncOutbox,
  syncOutboxRetryDelayMs,
  syncTargetKey,
  upsertSyncOutbox,
} from "../sync_outbox.js";

test("同步 outbox 规范化会去重、清洗非法数字并保持创建时间顺序", () => {
  const normalized = normalizeSyncOutbox([
    { targetKey: "server|a", payload: { accounts: [] }, createdAtMs: 20, attempts: 3 },
    { targetKey: "server|a", payload: { accounts: [{ id: "latest" }] }, createdAtMs: 10, attempts: 4 },
    { targetKey: "webdav|b", payload: { accounts: [] }, createdAtMs: "bad", attempts: -4 },
  ], 100);

  assert.deepEqual(normalized.map((item) => item.targetKey), ["server|a", "webdav|b"]);
  assert.equal(normalized[0].payload.accounts[0].id, "latest");
  assert.equal(normalized[1].createdAtMs, 100);
  assert.equal(normalized[1].attempts, 0);
});

test("同步 outbox 退避随失败次数指数增长并封顶", () => {
  assert.equal(syncOutboxRetryDelayMs(1), 5_000);
  assert.equal(syncOutboxRetryDelayMs(2), 10_000);
  assert.equal(syncOutboxRetryDelayMs(SYNC_OUTBOX_MAX_ATTEMPTS), 1_280_000);
  assert.equal(syncOutboxRetryDelayMs(SYNC_OUTBOX_MAX_ATTEMPTS + 20), 1_280_000);
});

test("同步 outbox 更新、到期判断和删除保持单目标单任务", () => {
  const target = { kind: "server", url: "https://sync.example" };
  const targetKey = syncTargetKey(target);
  const first = upsertSyncOutbox([], {
    targetKey,
    payload: { accounts: [{ id: "one" }] },
    error: new Error("offline"),
    nowMs: 1_000,
  });
  assert.equal(first.length, 1);
  assert.equal(first[0].attempts, 1);
  assert.equal(isSyncOutboxReady(first[0], 5_999), false);
  assert.equal(isSyncOutboxReady(first[0], 6_000), true);

  const second = upsertSyncOutbox(first, {
    targetKey,
    payload: { accounts: [{ id: "two" }] },
    error: "timeout",
    nowMs: 10_000,
  });
  assert.equal(second.length, 1);
  assert.equal(second[0].attempts, 1);
  assert.equal(second[0].payload.accounts[0].id, "two");
  assert.equal(removeSyncOutbox(second, targetKey).length, 0);
});

test("相同 payload 摘要会保留幂等、会话与操作上下文", () => {
  const targetKey = "server|https://sync.example";
  const first = upsertSyncOutbox([], {
    targetKey,
    payload: { accounts: [{ id: "one" }] },
    payloadSha256: "a".repeat(64),
    idempotencyKey: "idem-1",
    syncSessionId: "session-1",
    operationId: "operation-1",
    error: new Error("offline"),
    nowMs: 1_000,
  });
  const second = upsertSyncOutbox(first, {
    targetKey,
    payload: { accounts: [{ id: "one" }] },
    payloadSha256: "a".repeat(64),
    error: new Error("timeout"),
    nowMs: 10_000,
  });
  assert.equal(second[0].attempts, 2);
  assert.equal(second[0].idempotencyKey, "idem-1");
  assert.equal(second[0].syncSessionId, "session-1");
  assert.equal(second[0].operationId, "operation-1");
});

test("同步 outbox 只清理当前已失效的远端目标", () => {
  const items = normalizeSyncOutbox([
    { targetKey: "server|https://active.example", payload: { accounts: [] } },
    { targetKey: "webdav|https://removed.example", payload: { accounts: [] } },
  ], 1_000);
  const remaining = removeOrphanedSyncOutbox(items, new Set(["server|https://active.example"]));
  assert.deepEqual(remaining.map((item) => item.targetKey), ["server|https://active.example"]);
});
