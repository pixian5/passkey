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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export async function syncPayloadSha256(payload, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle?.digest) throw new Error("当前环境不支持同步 payload 摘要计算");
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const digest = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
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
    payloadSha256: String(item?.payloadSha256 || "").trim().toLowerCase(),
    expectedEtag: String(item?.expectedEtag || "").trim(),
    expectedRevision: Math.floor(nonNegativeNumber(item?.expectedRevision, 0)),
    idempotencyKey: String(item?.idempotencyKey || "").trim(),
    syncSessionId: String(item?.syncSessionId || "").trim(),
    operationId: String(item?.operationId || "").trim(),
    sourceType: String(item?.sourceType || targetKey.split("|", 1)[0] || "").trim(),
    scope: String(item?.scope || "").trim(),
    status: String(item?.status || "pendingRetry").trim() || "pendingRetry",
    createdAtMs: nonNegativeNumber(item?.createdAtMs, nowMs),
    attempts: Math.min(SYNC_OUTBOX_MAX_ATTEMPTS, Math.floor(nonNegativeNumber(item?.attempts, 0))),
    lastAttemptAtMs: nonNegativeNumber(item?.lastAttemptAtMs, 0),
    nextRetryAtMs: nonNegativeNumber(item?.nextRetryAtMs, 0),
    lastErrorCode: String(item?.lastErrorCode || "").trim(),
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
  return !item
    || (String(item.status || "pendingRetry") !== "paused"
      && Number(item.nextRetryAtMs || 0) <= nowMs);
}

/**
 * Explicitly resume a permanently paused task.  The payload hash guard keeps
 * a stale manual retry from reviving a newer task written for the same target.
 */
export function resumeSyncOutbox(value, targetKey, payloadSha256 = "") {
  const normalizedKey = String(targetKey || "").trim();
  const hash = String(payloadSha256 || "").trim().toLowerCase();
  return normalizeSyncOutbox(value).map((item) => {
    if (item.targetKey !== normalizedKey || item.status !== "paused") return item;
    if (hash && item.payloadSha256 && item.payloadSha256 !== hash) return item;
    return {
      ...item,
      status: "pendingRetry",
      attempts: 0,
      lastAttemptAtMs: 0,
      nextRetryAtMs: 0,
      lastErrorCode: "",
      lastError: "",
    };
  });
}

export function upsertSyncOutbox(value, {
  targetKey,
  payload,
  error,
  payloadSha256 = "",
  expectedEtag = "",
  expectedRevision = 0,
  idempotencyKey = "",
  syncSessionId = "",
  operationId = "",
  sourceType = "",
  scope = "",
  forceResume = false,
  nowMs = Date.now(),
}) {
  const current = normalizeSyncOutbox(value, nowMs);
  const previous = current.find((item) => item.targetKey === targetKey);
  const normalizedHash = String(payloadSha256 || "").trim().toLowerCase();
  const sameLogicalWrite = Boolean(previous && normalizedHash && previous.payloadSha256 === normalizedHash);
  const wasPaused = previous?.status === "paused";
  const attempts = Math.min(
    SYNC_OUTBOX_MAX_ATTEMPTS,
    (sameLogicalWrite ? (forceResume && wasPaused ? 0 : Number(previous?.attempts || 0)) : 0) + 1,
  );
  const next = normalizeSyncOutboxItem({
    targetKey,
    payload,
    payloadSha256: normalizedHash,
    expectedEtag,
    expectedRevision,
    idempotencyKey: idempotencyKey || (sameLogicalWrite ? previous.idempotencyKey : ""),
    syncSessionId: syncSessionId || (sameLogicalWrite ? previous.syncSessionId : ""),
    operationId: operationId || (sameLogicalWrite ? previous.operationId : ""),
    sourceType,
    scope,
    status: attempts >= SYNC_OUTBOX_MAX_ATTEMPTS ? "paused" : "pendingRetry",
    createdAtMs: sameLogicalWrite ? previous.createdAtMs : nowMs,
    attempts,
    lastAttemptAtMs: nowMs,
    nextRetryAtMs: nowMs + syncOutboxRetryDelayMs(attempts),
    lastErrorCode: String(error?.code || ""),
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
