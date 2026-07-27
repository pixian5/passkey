import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyLockStateChangedMessage,
  clampLockIdleMinutes,
  createLockStateTransitionQueue,
  LOCK_IDLE_MINUTES_DEFAULT,
  LOCK_POLICY_IDLE_TIMEOUT,
  LOCK_POLICY_ON_BACKGROUND,
  LOCK_POLICY_ONCE_UNTIL_QUIT,
  LOCK_STATE_CHANGED_MESSAGE,
  LOCK_STORAGE_KEYS,
  normalizeLockPolicy,
  STORAGE_KEY_LOCK_ENABLED,
} from "../lock_state.js";

test("共享锁策略只接受已声明的三种模式", () => {
  assert.equal(normalizeLockPolicy(LOCK_POLICY_IDLE_TIMEOUT), LOCK_POLICY_IDLE_TIMEOUT);
  assert.equal(normalizeLockPolicy(LOCK_POLICY_ON_BACKGROUND), LOCK_POLICY_ON_BACKGROUND);
  assert.equal(normalizeLockPolicy(LOCK_POLICY_ONCE_UNTIL_QUIT), LOCK_POLICY_ONCE_UNTIL_QUIT);
  assert.equal(normalizeLockPolicy("unknown"), LOCK_POLICY_ONCE_UNTIL_QUIT);
});

test("共享锁空闲时间范围在所有扩展上下文一致", () => {
  assert.equal(clampLockIdleMinutes("not-a-number"), LOCK_IDLE_MINUTES_DEFAULT);
  assert.equal(clampLockIdleMinutes(0), 1);
  assert.equal(clampLockIdleMinutes(2.6), 3);
  assert.equal(clampLockIdleMinutes(999), 60);
});

test("锁状态通知和配置键由同一模块声明", () => {
  assert.equal(LOCK_STATE_CHANGED_MESSAGE, "PASS_LOCK_STATE_CHANGED");
  assert.equal(LOCK_STORAGE_KEYS.has(STORAGE_KEY_LOCK_ENABLED), true);
});

test("锁定通知会先撤销数据密钥，再清除页面业务状态", async () => {
  const events = [];
  let finishLock;
  const lockFinished = new Promise((resolve) => { finishLock = resolve; });
  const transition = applyLockStateChangedMessage(
    { type: LOCK_STATE_CHANGED_MESSAGE, payload: { locked: true } },
    {
      lock: async () => {
        events.push("lock-start");
        await lockFinished;
        events.push("lock-finished");
      },
      clear: () => events.push("clear-view"),
    }
  );
  assert.deepEqual(events, ["lock-start"]);
  finishLock();
  assert.equal(await transition, "locked");
  assert.deepEqual(events, ["lock-start", "lock-finished", "clear-view"]);
});

test("数据密钥清理失败时仍清除页面状态，解锁只触发重新加载", async () => {
  const events = [];
  await assert.rejects(
    () => applyLockStateChangedMessage(
      { type: LOCK_STATE_CHANGED_MESSAGE, payload: { locked: true } },
      {
        lock: async () => { throw new Error("storage unavailable"); },
        clear: () => events.push("clear-view"),
      }
    ),
    /storage unavailable/
  );
  assert.deepEqual(events, ["clear-view"]);
  assert.equal(
    await applyLockStateChangedMessage(
      { type: LOCK_STATE_CHANGED_MESSAGE, payload: { locked: false } },
      { unlock: () => events.push("reload") }
    ),
    "unlocked"
  );
  assert.deepEqual(events, ["clear-view", "reload"]);
});

test("连续解锁通知必须等待前一个锁定通知清理完成", async () => {
  const events = [];
  let finishLock;
  let signalLockStarted;
  const lockFinished = new Promise((resolve) => { finishLock = resolve; });
  const lockStarted = new Promise((resolve) => { signalLockStarted = resolve; });
  const enqueue = createLockStateTransitionQueue();
  const locked = enqueue(
    { type: LOCK_STATE_CHANGED_MESSAGE, payload: { locked: true } },
    {
      lock: async () => {
        events.push("lock-start");
        signalLockStarted();
        await lockFinished;
        events.push("lock-finished");
      },
      clear: () => events.push("clear-view"),
    }
  );
  const unlocked = enqueue(
    { type: LOCK_STATE_CHANGED_MESSAGE, payload: { locked: false } },
    { unlock: () => events.push("reload") }
  );
  await lockStarted;
  assert.deepEqual(events, ["lock-start"]);
  finishLock();
  assert.equal(await locked, "locked");
  assert.equal(await unlocked, "unlocked");
  assert.deepEqual(events, ["lock-start", "lock-finished", "clear-view", "reload"]);
});
