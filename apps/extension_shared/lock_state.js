export const STORAGE_KEY_LOCK_ENABLED = "pass.lock.enabled";
export const STORAGE_KEY_LOCK_POLICY = "pass.lock.policy";
export const STORAGE_KEY_LOCK_IDLE_MINUTES = "pass.lock.idleMinutes";
export const STORAGE_KEY_LOCK_MASTER_CREDENTIAL = "pass.lock.masterCredential.v1";
export const STORAGE_KEY_LOCK_UNLOCKED_AT = "pass.lock.unlockedAtMs.v1";
export const STORAGE_KEY_LOCK_LAST_ACTIVITY = "pass.lock.lastActivityAtMs.v1";

export const LOCK_POLICY_ONCE_UNTIL_QUIT = "onceUntilQuit";
export const LOCK_POLICY_IDLE_TIMEOUT = "idleTimeout";
export const LOCK_POLICY_ON_BACKGROUND = "onBackground";
export const LOCK_IDLE_MINUTES_DEFAULT = 5;
export const LOCK_IDLE_MINUTES_MIN = 1;
export const LOCK_IDLE_MINUTES_MAX = 60;
export const LOCK_STATE_CHANGED_MESSAGE = "PASS_LOCK_STATE_CHANGED";

export const LOCK_STORAGE_KEYS = new Set([
  STORAGE_KEY_LOCK_ENABLED,
  STORAGE_KEY_LOCK_POLICY,
  STORAGE_KEY_LOCK_IDLE_MINUTES,
  STORAGE_KEY_LOCK_MASTER_CREDENTIAL,
]);

export function normalizeLockPolicy(value) {
  const policy = String(value || "").trim();
  if (policy === LOCK_POLICY_IDLE_TIMEOUT) return LOCK_POLICY_IDLE_TIMEOUT;
  if (policy === LOCK_POLICY_ON_BACKGROUND) return LOCK_POLICY_ON_BACKGROUND;
  return LOCK_POLICY_ONCE_UNTIL_QUIT;
}

export function clampLockIdleMinutes(value) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return LOCK_IDLE_MINUTES_DEFAULT;
  return Math.min(Math.max(parsed, LOCK_IDLE_MINUTES_MIN), LOCK_IDLE_MINUTES_MAX);
}
