import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampLockIdleMinutes,
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
