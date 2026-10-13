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
  // 可选明细：真正发起过上传的目标数 vs 远端内容已一致而跳过上传的目标数。
  // 用于把"远端已推送"这类含糊说法说清楚——pushed 只表示"所有目标已确认"，
  // 确认既可能是上传成功，也可能是内容本来就一致无需上传。
  if (Number.isFinite(Number(input.uploadedTargets))) {
    report.uploadedTargets = Math.max(0, Math.trunc(Number(input.uploadedTargets)));
  }
  if (Number.isFinite(Number(input.identicalTargets))) {
    report.identicalTargets = Math.max(0, Math.trunc(Number(input.identicalTargets)));
  }
  if (input.revision != null && Number.isFinite(Number(input.revision))) {
    report.revision = Math.max(0, Math.trunc(Number(input.revision)));
  }
  return report;
}
