/**
 * Cross-client sync policy constants shared by browser extension and (by value)
 * the macOS Swift client. Keep in sync with PassSyncPolicy.swift.
 */

export const DEFAULT_DEVICE_NAME = "PassDevice";

export const FIXED_NEW_ACCOUNT_FOLDER_ID = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";
export const FIXED_NEW_ACCOUNT_FOLDER_NAME = "新账号";

/** Multi-label public suffixes used by etldPlusOne (not a full PSL). */
export const ETLD2_SUFFIXES = [
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "com.br",
  "com.mx",
  "co.jp",
  "or.jp",
  "ne.jp",
  "co.kr",
  "co.in",
  "com.hk",
  "com.tw",
  "com.sg",
  "co.nz",
  "org.nz",
  "com.ar",
  "com.tr",
  "co.za",
  "com.ua",
];

export const SYNC_OUTBOX_MAX_ATTEMPTS = 12;
export const SYNC_OUTBOX_BASE_DELAY_MS = 5_000;
export const SYNC_OUTBOX_MAX_DELAY_MS = 60 * 60 * 1000;

/** Concurrent remote push retries after HTTP 412. */
export const SYNC_PUSH_CONFLICT_MAX_ATTEMPTS = 5;

export function syncOutboxRetryDelayMs(attempts) {
  const exponent = Math.max(0, Math.min(Number(attempts || 1) - 1, 8));
  return Math.min(SYNC_OUTBOX_MAX_DELAY_MS, SYNC_OUTBOX_BASE_DELAY_MS * (2 ** exponent));
}

export function normalizeDeviceName(value, fallback = DEFAULT_DEVICE_NAME) {
  const trimmed = String(value || "").trim();
  return trimmed || fallback;
}
