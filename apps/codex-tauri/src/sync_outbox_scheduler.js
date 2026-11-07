export const SYNC_OUTBOX_SCHEDULER_BASE_DELAY_MS = 5_000;
export const SYNC_OUTBOX_SCHEDULER_MAX_DELAY_MS = 60 * 60 * 1_000;

export function syncOutboxSchedulerDelayMs(consecutiveFailures) {
  const failures = Math.max(1, Math.floor(Number(consecutiveFailures) || 1));
  const exponent = Math.min(failures - 1, 8);
  return Math.min(
    SYNC_OUTBOX_SCHEDULER_MAX_DELAY_MS,
    SYNC_OUTBOX_SCHEDULER_BASE_DELAY_MS * (2 ** exponent),
  );
}

export const syncOutboxSourceLabel = (sourceKey) => {
  const kind = String(sourceKey || "").split("|", 1)[0];
  if (kind === "server") return "自建服务器";
  if (kind === "webdav") return "WebDAV";
  return kind || "同步目标";
};

export const formatOutboxModeLabel = (mode) => {
  if (mode === "localOverwriteRemote") return "本地覆盖云端";
  if (mode === "remoteOverwriteLocal") return "云端覆盖本地";
  return "合并同步";
};

export const formatAutoSyncStatus = (intervalMinutes) => {
  const m = Number(intervalMinutes || 0);
  return m > 0 ? `自动同步：每 ${m} 分钟（仅在同步已启用时）` : "自动同步：关闭";
};

export const summarizeOutboxQueue = (items, now = Date.now()) => {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  const waiting = list.filter(
    (item) => item?.status !== "paused" && Number(item?.nextRetryAtMs || 0) > now
  ).length;
  const paused = list.filter((item) => item?.status === "paused").length;
  return `补偿任务 ${list.length} 个（等待退避 ${waiting} 个${paused ? `，已暂停 ${paused} 个` : ""}）`;
};

export const formatOutboxItemLine = (item, { now = Date.now(), formatTimeFn = null } = {}) => {
  if (!item) return "";
  const retryAt = Number(item.nextRetryAtMs || 0);
  const timeStr = typeof formatTimeFn === "function" ? formatTimeFn(retryAt) : new Date(retryAt).toLocaleString();
  const retryText = item.status === "paused"
    ? "已暂停，点击上方按钮恢复"
    : retryAt > now ? `下次 ${timeStr}` : "可立即重试";
  const errorText = String(item.lastError || "同步失败").replace(/\s+/g, " ").slice(0, 220);
  const modeLabel = formatOutboxModeLabel(item.mode);
  const sourceLabel = syncOutboxSourceLabel(item.sourceKey);
  const attempts = item.attempts || 0;
  return `${sourceLabel} · ${modeLabel} · 失败 ${attempts} 次 · ${retryText} · ${errorText}`;
};

export const calculateNextOutboxRetryDelay = (
  items,
  { locked = false, running = false, notBeforeMs = 0, now = Date.now(), isSourceEnabled = () => true } = {}
) => {
  if (locked || running) return null;
  const enabledItems = (Array.isArray(items) ? items : [])
    .filter(isSourceEnabled)
    .filter((item) => item?.status !== "paused");
  if (!enabledItems.length) return null;
  const nextRetryAt = Math.min(...enabledItems.map((item) => Number(item?.nextRetryAtMs || 0)));
  const effectiveRetryAt = Math.max(nextRetryAt, notBeforeMs || 0);
  return Math.min(Math.max(1000, effectiveRetryAt - now), 2_147_000_000);
};
