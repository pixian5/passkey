export {
  SYNC_OUTBOX_MAX_ATTEMPTS,
  SYNC_OUTBOX_BASE_DELAY_MS,
  SYNC_OUTBOX_MAX_DELAY_MS,
  syncOutboxRetryDelayMs,
} from "../../core/pass_core/js/sync_policy.js";

import {
  SYNC_OUTBOX_MAX_ATTEMPTS,
  syncOutboxRetryDelayMs,
} from "../../core/pass_core/js/sync_policy.js";

export function syncTargetKey(target) {
  return `${String(target?.kind || "").trim()}|${String(target?.url || "").trim()}`;
}

export function normalizeSyncOutboxItem(item, nowMs = Date.now()) {
  const targetKey = String(item?.targetKey || "").trim();
  const payload = item?.payload;
  if (!targetKey || !payload || typeof payload !== "object") return null;
  const nonNegativeNumber = (raw, fallback) => {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    targetKey,
    payload,
    createdAtMs: nonNegativeNumber(item?.createdAtMs, nowMs),
    attempts: Math.min(SYNC_OUTBOX_MAX_ATTEMPTS, Math.floor(nonNegativeNumber(item?.attempts, 0))),
    lastAttemptAtMs: nonNegativeNumber(item?.lastAttemptAtMs, 0),
    nextRetryAtMs: nonNegativeNumber(item?.nextRetryAtMs, 0),
    lastError: String(item?.lastError || ""),
  };
}

export function normalizeSyncOutbox(value, nowMs = Date.now()) {
  const byTarget = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    const normalized = normalizeSyncOutboxItem(item, nowMs);
    if (!normalized) continue;
    byTarget.set(normalized.targetKey, normalized);
  }
  return [...byTarget.values()].sort((left, right) => left.createdAtMs - right.createdAtMs);
}

export function isSyncOutboxReady(item, nowMs = Date.now()) {
  return !item || Number(item.nextRetryAtMs || 0) <= nowMs;
}

export function upsertSyncOutbox(value, { targetKey, payload, error, nowMs = Date.now() }) {
  const current = normalizeSyncOutbox(value, nowMs);
  const previous = current.find((item) => item.targetKey === targetKey);
  const attempts = Math.min(SYNC_OUTBOX_MAX_ATTEMPTS, Number(previous?.attempts || 0) + 1);
  const next = normalizeSyncOutboxItem({
    targetKey,
    payload,
    createdAtMs: previous?.createdAtMs || nowMs,
    attempts,
    lastAttemptAtMs: nowMs,
    nextRetryAtMs: nowMs + syncOutboxRetryDelayMs(attempts),
    lastError: String(error?.message || error || ""),
  }, nowMs);
  return normalizeSyncOutbox(current.filter((item) => item.targetKey !== targetKey).concat(next), nowMs);
}

export function removeSyncOutbox(value, targetKey) {
  return normalizeSyncOutbox(value).filter((item) => item.targetKey !== targetKey);
}

export function removeOrphanedSyncOutbox(value, activeTargetKeys) {
  const active = new Set(Array.from(activeTargetKeys || [], (item) => String(item || "").trim()).filter(Boolean));
  return normalizeSyncOutbox(value).filter((item) => active.has(item.targetKey));
}
