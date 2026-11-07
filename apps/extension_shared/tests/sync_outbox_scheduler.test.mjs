import assert from "node:assert/strict";
import test from "node:test";

import {
  SYNC_OUTBOX_SCHEDULER_MAX_DELAY_MS,
  syncOutboxSchedulerDelayMs,
  syncOutboxSourceLabel,
  formatOutboxModeLabel,
  formatAutoSyncStatus,
  summarizeOutboxQueue,
  formatOutboxItemLine,
  calculateNextOutboxRetryDelay,
} from "../../codex-tauri/src/sync_outbox_scheduler.js";

test("补偿调度器的前置失败按共享曲线退避并封顶", () => {
  assert.equal(syncOutboxSchedulerDelayMs(1), 5_000);
  assert.equal(syncOutboxSchedulerDelayMs(2), 10_000);
  assert.equal(syncOutboxSchedulerDelayMs(9), 1_280_000);
  assert.equal(syncOutboxSchedulerDelayMs(99), 1_280_000);
  assert.ok(syncOutboxSchedulerDelayMs(99) <= SYNC_OUTBOX_SCHEDULER_MAX_DELAY_MS);
});

test("syncOutboxSourceLabel and formatOutboxModeLabel format labels accurately", () => {
  assert.equal(syncOutboxSourceLabel("server|https://example.com"), "自建服务器");
  assert.equal(syncOutboxSourceLabel("webdav|https://dav.example.com"), "WebDAV");
  assert.equal(syncOutboxSourceLabel("custom|target"), "custom");
  assert.equal(syncOutboxSourceLabel(""), "同步目标");
  assert.equal(syncOutboxSourceLabel(null), "同步目标");

  assert.equal(formatOutboxModeLabel("localOverwriteRemote"), "本地覆盖云端");
  assert.equal(formatOutboxModeLabel("remoteOverwriteLocal"), "云端覆盖本地");
  assert.equal(formatOutboxModeLabel("merge"), "合并同步");
  assert.equal(formatOutboxModeLabel(null), "合并同步");
});

test("formatAutoSyncStatus generates human-readable status text", () => {
  assert.equal(formatAutoSyncStatus(5), "自动同步：每 5 分钟（仅在同步已启用时）");
  assert.equal(formatAutoSyncStatus(0), "自动同步：关闭");
  assert.equal(formatAutoSyncStatus(-1), "自动同步：关闭");
  assert.equal(formatAutoSyncStatus(null), "自动同步：关闭");
});

test("summarizeOutboxQueue summarizes waiting and paused queue items", () => {
  assert.equal(summarizeOutboxQueue([]), "");
  assert.equal(summarizeOutboxQueue(null), "");

  const now = 100_000;
  const items = [
    { status: "waiting", nextRetryAtMs: 120_000 },
    { status: "waiting", nextRetryAtMs: 90_000 }, // ready
    { status: "paused", nextRetryAtMs: 150_000 },
  ];

  const summary = summarizeOutboxQueue(items, now);
  assert.match(summary, /补偿任务 3 个/);
  assert.match(summary, /等待退避 1 个/);
  assert.match(summary, /已暂停 1 个/);
});

test("formatOutboxItemLine generates consistent item detail strings", () => {
  const now = 100_000;
  const waitingItem = {
    sourceKey: "server|https://example.com",
    mode: "merge",
    attempts: 3,
    status: "waiting",
    nextRetryAtMs: 120_000,
    lastError: "Connection refused",
  };

  const line1 = formatOutboxItemLine(waitingItem, { now, formatTimeFn: (ms) => `T:${ms}` });
  assert.equal(
    line1,
    "自建服务器 · 合并同步 · 失败 3 次 · 下次 T:120000 · Connection refused"
  );

  const pausedItem = {
    sourceKey: "webdav|https://dav.example.com",
    mode: "localOverwriteRemote",
    attempts: 12,
    status: "paused",
    lastError: "Authentication failed",
  };

  const line2 = formatOutboxItemLine(pausedItem, { now });
  assert.equal(
    line2,
    "WebDAV · 本地覆盖云端 · 失败 12 次 · 已暂停，点击上方按钮恢复 · Authentication failed"
  );
});

test("calculateNextOutboxRetryDelay handles guards, backoff delays, and bounds", () => {
  const now = 100_000;
  const items = [
    { sourceKey: "server|1", status: "waiting", nextRetryAtMs: 110_000 },
    { sourceKey: "webdav|2", status: "waiting", nextRetryAtMs: 105_000 },
    { sourceKey: "server|3", status: "paused", nextRetryAtMs: 102_000 },
  ];

  // Locked or already running must return null
  assert.equal(calculateNextOutboxRetryDelay(items, { locked: true, now }), null);
  assert.equal(calculateNextOutboxRetryDelay(items, { running: true, now }), null);

  // Normal calculation: earliest enabled non-paused retry is 105_000 -> delay = 5_000ms
  const delay = calculateNextOutboxRetryDelay(items, { now });
  assert.equal(delay, 5_000);

  // Delay with notBeforeMs
  const delayWithNotBefore = calculateNextOutboxRetryDelay(items, { now, notBeforeMs: 120_000 });
  assert.equal(delayWithNotBefore, 20_000);

  // Minimum delay is clamped to 1000ms
  const pastDelay = calculateNextOutboxRetryDelay(
    [{ sourceKey: "server|1", status: "waiting", nextRetryAtMs: 90_000 }],
    { now }
  );
  assert.equal(pastDelay, 1000);
});
