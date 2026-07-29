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
