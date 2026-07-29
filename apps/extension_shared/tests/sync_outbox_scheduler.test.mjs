import assert from "node:assert/strict";
import test from "node:test";

import {
  SYNC_OUTBOX_SCHEDULER_MAX_DELAY_MS,
  syncOutboxSchedulerDelayMs,
} from "../../codex-tauri/src/sync_outbox_scheduler.js";

test("补偿调度器的前置失败按共享曲线退避并封顶", () => {
  assert.equal(syncOutboxSchedulerDelayMs(1), 5_000);
  assert.equal(syncOutboxSchedulerDelayMs(2), 10_000);
  assert.equal(syncOutboxSchedulerDelayMs(9), 1_280_000);
  assert.equal(syncOutboxSchedulerDelayMs(99), 1_280_000);
  assert.ok(syncOutboxSchedulerDelayMs(99) <= SYNC_OUTBOX_SCHEDULER_MAX_DELAY_MS);
});
