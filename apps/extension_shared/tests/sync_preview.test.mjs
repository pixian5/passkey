import test from "node:test";
import assert from "node:assert/strict";
import {
  SYNC_APPLIED_TEXT,
  formatSyncPushState,
  shortSyncTrace,
  previewRecordKey,
  previewAccountLabel,
  isVisibleSyncAccount,
  isVisibleSyncFolder,
  isVisibleSyncPasskey,
  previewAccountFields,
  previewValue,
  calculateSyncPayloadDiff,
  summarizeSyncAccountDiff,
  formatSyncDecisionSummaryLines,
  overwriteWarningText,
  computeSyncSources,
  computeSyncConfirmationWarnings,
  formatSyncFailureLine,
  computePrimaryFingerprint,
  formatSyncReportSummary,
  formatSyncPreviewMetaText,
  formatSyncDiffTitle,
} from "../../codex-tauri/src/sync_preview.js";

test("SYNC_APPLIED_TEXT provides standard Chinese translations for all 3 modes", () => {
  assert.equal(SYNC_APPLIED_TEXT.merge, "已合并写入本地");
  assert.equal(SYNC_APPLIED_TEXT.remoteOverwriteLocal, "已用云端内容覆盖本地");
  assert.equal(SYNC_APPLIED_TEXT.localOverwriteRemote, "已用本地内容覆盖云端");
});

test("formatSyncPushState accurately describes all sync result combinations", () => {
  assert.equal(formatSyncPushState(null), "");
  assert.equal(formatSyncPushState({ dryRun: true }), "仅预览");

  // applied & pushed variants
  assert.equal(
    formatSyncPushState({ mode: "merge", applied: true, pushed: true, uploadedTargets: 2, identicalTargets: 1 }),
    "已合并写入本地 · 已上传 2 个目标，另 1 个内容一致未重复上传"
  );
  assert.equal(
    formatSyncPushState({ mode: "remoteOverwriteLocal", applied: true, pushed: true, uploadedTargets: 3 }),
    "已用云端内容覆盖本地 · 已上传 3 个目标"
  );
  assert.equal(
    formatSyncPushState({ mode: "localOverwriteRemote", applied: true, pushed: true, identicalTargets: 2 }),
    "已用本地内容覆盖云端 · 2 个目标内容已一致，未重复上传"
  );
  assert.equal(
    formatSyncPushState({ mode: "merge", applied: true, pushed: true }),
    "已合并写入本地 · 远端已确认一致"
  );

  // applied & !pushed variants
  assert.equal(
    formatSyncPushState({ mode: "merge", applied: true, pushed: false, pendingRetry: true }),
    "已合并写入本地 · 远端未推送（待补偿重试）"
  );
  assert.equal(
    formatSyncPushState({ mode: "merge", applied: true, pushed: false }),
    "已合并写入本地 · 远端未推送"
  );

  // identical / unapplied
  assert.equal(
    formatSyncPushState({ applied: false, ok: true }),
    "两端内容已一致，无需写入"
  );
  assert.equal(formatSyncPushState({ applied: false, ok: false }), "未完成");
});

test("shortSyncTrace extracts compact 8-char session identifier", () => {
  assert.equal(shortSyncTrace(null), "");
  assert.equal(shortSyncTrace({}), "");
  assert.equal(
    shortSyncTrace({ syncSessionId: "12345678-abcd-ef01-2345-6789abcdef01" }),
    "同步编号 6789ABCD"
  );
  assert.equal(
    shortSyncTrace({ operationId: "op-12345678" }),
    "同步编号 12345678"
  );
});

test("previewRecordKey prioritizes stable identity over fallback fields", () => {
  assert.equal(
    previewRecordKey({ recordId: "REC-1", id: "id-1", accountId: "acc-1" }),
    "rec-1"
  );
  assert.equal(
    previewRecordKey({ id: "ID-1", accountId: "acc-1" }),
    "id-1"
  );
  assert.equal(
    previewRecordKey({ accountId: "ACC-1" }),
    "acc-1"
  );
  assert.equal(
    previewRecordKey({ canonicalSite: "Example.COM", username: "Admin" }),
    "account:example.com:admin"
  );
});

test("previewAccountLabel formats site and username gracefully", () => {
  assert.equal(
    previewAccountLabel({ canonicalSite: "github.com", username: "alice" }),
    "github.com · alice"
  );
  assert.equal(
    previewAccountLabel({ sites: ["gitlab.com"] }),
    "gitlab.com"
  );
  assert.equal(
    previewAccountLabel({}),
    "未命名站点"
  );
});

test("isVisibleSync filters exclude permanently deleted tombstones only", () => {
  assert.equal(isVisibleSyncAccount({ isPermanentlyDeleted: true }), false);
  assert.equal(isVisibleSyncAccount({ isDeleted: true }), true);
  assert.equal(isVisibleSyncAccount({ id: "acc1" }), true);

  assert.equal(isVisibleSyncFolder({ isPermanentlyDeleted: true }), false);
  assert.equal(isVisibleSyncFolder({ isDeleted: true }), true);
  assert.equal(isVisibleSyncFolder({ id: "f1" }), true);

  assert.equal(isVisibleSyncPasskey({ isPermanentlyDeleted: true }), false);
  assert.equal(isVisibleSyncPasskey({ id: "p1" }), true);
});

test("calculateSyncPayloadDiff and summarizeSyncAccountDiff compute diffs cleanly without leaking secrets", () => {
  const localPayload = {
    accounts: [
      { recordId: "rec-1", canonicalSite: "apple.com", username: "user1", password: "SecretOldPassword" },
      { recordId: "rec-2", canonicalSite: "google.com", username: "user2", isDeleted: false },
    ],
    folders: [{ id: "f1", name: "Folder1" }],
    passkeys: [{ id: "pk1", credentialId: "cred1" }],
  };

  const mergedPayload = {
    accounts: [
      { recordId: "rec-1", canonicalSite: "apple.com", username: "user1", password: "SecretNewPassword" },
      // rec-2 removed
      { recordId: "rec-3", canonicalSite: "microsoft.com", username: "user3", password: "SecretNewPassword3" },
      // permanently deleted account should not appear as addition
      { recordId: "rec-4", canonicalSite: "deleted.com", isPermanentlyDeleted: true },
    ],
    folders: [
      { id: "f1", name: "Folder1" },
      { id: "f2", name: "Folder2" },
    ],
    passkeys: [],
  };

  const diff = calculateSyncPayloadDiff(localPayload, mergedPayload);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].recordId, "rec-3");
  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].recordId, "rec-2");
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].account.recordId, "rec-1");
  assert.deepEqual(diff.changed[0].fields, ["密码"]);
  assert.equal(diff.folderDelta, 1);
  assert.equal(diff.passkeyDelta, -1);
  assert.equal(diff.totalChanges, 1 + 1 + 1 + 1 + 1);

  const summary = summarizeSyncAccountDiff(localPayload, mergedPayload, 10);
  assert.equal(summary.total, 3);
  assert.equal(summary.omitted, 0);
  const fullText = summary.lines.join("\n");
  assert.match(fullText, /新增：microsoft\.com · user3/);
  assert.match(fullText, /移除：google\.com · user2/);
  assert.match(fullText, /修改：apple\.com · user1（密码）/);

  // CRITICAL SECURITY ASSERTION: Passwords and secrets must NEVER leak into summary lines
  assert.equal(fullText.includes("SecretOldPassword"), false);
  assert.equal(fullText.includes("SecretNewPassword"), false);
  assert.equal(fullText.includes("SecretNewPassword3"), false);
});

test("formatSyncDecisionSummaryLines formats report summaries and safety statuses", () => {
  const reports = [
    {
      source: "WebDAV",
      mode: "merge",
      localAccounts: 10,
      mergedAccounts: 12,
      safety: "passed",
      mode: "merge",
      applied: true,
      pushed: true,
      uploadedTargets: 1,
      syncSessionId: "12345678-1234-1234-1234-123456789abc",
    },
    {
      source: "SelfHosted",
      mode: "remoteOverwriteLocal",
      localAccounts: 10,
      mergedAccounts: 8,
      safety: "blocked",
      reasons: ["PERMANENT_TOMBSTONES_DROPPED"],
    },
  ];

  const lines = formatSyncDecisionSummaryLines(reports);
  assert.equal(lines.length, 4); // 2 header rule lines + 2 report lines
  assert.match(lines[0], /裁决摘要/);
  assert.match(lines[1], /删除规则/);
  assert.match(lines[2], /WebDAV：按字段合并 · 本地 10 → 合并 12 · 安全检查通过/);
  assert.match(lines[3], /SelfHosted：云端覆盖本地 · 本地 10 → 合并 8 · 安全检查未通过（PERMANENT_TOMBSTONES_DROPPED）/);
});

test("overwriteWarningText provides distinct warnings for remote vs local overwrite", () => {
  const remoteWarning = overwriteWarningText("remoteOverwriteLocal");
  assert.match(remoteWarning, /云端覆盖本地：以云端内容为准，本地会被云端整份替换/);
  assert.match(remoteWarning, /本地独有、云端没有的新增与修改将被丢弃/);

  const localWarning = overwriteWarningText("localOverwriteRemote");
  assert.match(localWarning, /本地覆盖云端：以本地内容为准，云端会被本地整份替换/);
  assert.match(localWarning, /云端独有、本地没有的新增与修改将被丢弃/);
});

test("computeSyncSources resolves enabled sources and orders preferred first", () => {
  assert.throws(
    () => computeSyncSources({ syncEnabled: false, webdavEnabled: false }),
    /请先启用自建服务器或 WebDAV 同步/
  );

  const onlySelfHosted = computeSyncSources({ syncEnabled: true, webdavEnabled: false });
  assert.deepEqual(onlySelfHosted.sources, ["selfHosted"]);
  assert.equal(onlySelfHosted.preferred, "selfHosted");
  assert.deepEqual(onlySelfHosted.ordered, ["selfHosted"]);

  const bothWithWebdavPreferred = computeSyncSources({
    syncEnabled: true,
    webdavEnabled: true,
    configuredPrimary: "webdav",
  });
  assert.deepEqual(bothWithWebdavPreferred.sources, ["selfHosted", "webdav"]);
  assert.equal(bothWithWebdavPreferred.preferred, "webdav");
  assert.deepEqual(bothWithWebdavPreferred.ordered, ["webdav", "selfHosted"]);
});

test("computeSyncConfirmationWarnings handles merge and overwrite modes with fingerprint drift", () => {
  // Merge mode with no fingerprint drift needs no confirmation
  const mergeNoDrift = computeSyncConfirmationWarnings({
    mode: "merge",
    previousFingerprint: "fp1",
    fingerprint: "fp1",
  });
  assert.equal(mergeNoDrift.needsConfirmation, false);
  assert.equal(mergeNoDrift.danger, false);

  // Merge mode with fingerprint drift requires confirmation
  const mergeWithDrift = computeSyncConfirmationWarnings({
    mode: "merge",
    previousFingerprint: "fp-old",
    fingerprint: "fp-new",
  });
  assert.equal(mergeWithDrift.needsConfirmation, true);
  assert.equal(mergeWithDrift.danger, false);
  assert.match(mergeWithDrift.message, /检测到主同步源与上次成功同步不一致/);
  assert.equal(mergeWithDrift.confirmText, "继续同步");

  // Overwrite mode is always dangerous and requires confirmation
  const overwrite = computeSyncConfirmationWarnings({
    mode: "remoteOverwriteLocal",
    fingerprint: "fp1",
  });
  assert.equal(overwrite.needsConfirmation, true);
  assert.equal(overwrite.danger, true);
  assert.match(overwrite.message, /云端覆盖本地/);
  assert.equal(overwrite.confirmText, "继续覆盖");
});

test("formatSyncFailureLine formats error message with code and session trace", () => {
  const lineWithTrace = formatSyncFailureLine({
    source: "自建服务器",
    code: "ETAG_MISMATCH",
    message: "远端已有更新版本",
    syncSessionId: "12345678-abcd-ef01-2345-6789abcdef01",
  });
  assert.equal(lineWithTrace, "自建服务器 [ETAG_MISMATCH]：远端已有更新版本（同步编号 6789ABCD）");

  const lineSimple = formatSyncFailureLine({
    source: "WebDAV",
    message: "连接超时",
  });
  assert.equal(lineSimple, "WebDAV：连接超时");
});

test("computePrimaryFingerprint formats selfHosted and webdav identifiers cleanly", () => {
  assert.equal(
    computePrimaryFingerprint({
      primary: "selfHosted",
      selfHostedBaseUrl: "https://sync.example.com///",
    }),
    "selfHosted|https://sync.example.com"
  );

  assert.equal(
    computePrimaryFingerprint({
      primary: "webdav",
      webdavBaseUrl: "https://dav.example.com/remote.php/webdav//",
      webdavRemotePath: "/pass/vault.json",
    }),
    "webdav|https://dav.example.com/remote.php/webdav|/pass/vault.json"
  );
});

test("formatSyncReportSummary formats concise status message with push status", () => {
  const reports = [
    { source: "自建服务器", message: "完成", applied: true, pushed: true, mode: "merge" },
    { source: "WebDAV", message: "已检查", applied: false, ok: true },
  ];
  assert.equal(
    formatSyncReportSummary(reports),
    "自建服务器：完成（已合并写入本地 · 远端已确认一致）；WebDAV：已检查（两端内容已一致，无需写入）"
  );
});

test("formatSyncPreviewMetaText and formatSyncDiffTitle format human readable diffs", () => {
  assert.equal(
    formatSyncDiffTitle(5, 2, 1, 2),
    "预计写入本地：新增 2，移除 1，修改 2"
  );
  assert.equal(
    formatSyncDiffTitle(0, 0, 0, 0),
    "预计不会改变本地数据"
  );
  assert.equal(
    formatSyncPreviewMetaText(2, -1),
    "文件夹数量变化 +2；通行密钥数量变化 -1。仅显示字段名，不显示密码或密钥内容。"
  );
  assert.equal(
    formatSyncPreviewMetaText(-1, 0),
    "文件夹数量变化 -1；通行密钥数量变化 +0。仅显示字段名，不显示密码或密钥内容。"
  );
});

