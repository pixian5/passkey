const SYNC_REPORT_VERSION = 1;

export function buildSyncOperationReport(input = {}) {
  const safe = input.safe !== false;
  const safety = ["passed", "blocked", "notEvaluated"].includes(input.safety)
    ? input.safety
    : safe
      ? "passed"
      : "blocked";
  const report = {
    reportVersion: SYNC_REPORT_VERSION,
    ok: Boolean(input.ok),
    dryRun: Boolean(input.dryRun),
    mode: ["remoteOverwriteLocal", "localOverwriteRemote"].includes(input.mode)
      ? input.mode
      : "merge",
    message: String(input.message || ""),
    safe,
    safety,
    reasons: (Array.isArray(input.reasons) ? input.reasons : []).map(String),
    localAccounts: Math.max(0, Math.trunc(Number(input.localAccounts) || 0)),
    remoteAccounts: Math.max(0, Math.trunc(Number(input.remoteAccounts) || 0)),
    mergedAccounts: Math.max(0, Math.trunc(Number(input.mergedAccounts) || 0)),
    applied: Boolean(input.applied),
    pushed: Boolean(input.pushed),
    remotePulled: Boolean(input.remotePulled),
    pendingRetry: Boolean(input.pendingRetry),
    retryable: Boolean(input.retryable),
    stage: String(input.stage || "unknown"),
    source: String(input.source || ""),
    syncSessionId: String(input.syncSessionId || ""),
    operationId: String(input.operationId || input.syncSessionId || ""),
  };
  if (input.code != null && String(input.code)) report.code = String(input.code);
  if (input.etag != null && String(input.etag)) report.etag = String(input.etag);
  if (input.revision != null && Number.isFinite(Number(input.revision))) {
    report.revision = Math.max(0, Math.trunc(Number(input.revision)));
  }
  return report;
}
