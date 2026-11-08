/**
 * 同步预览、差异裁决比对与同步报告格式化核心
 * 纯算法与无 DOM 依赖，服务于 Tauri 桌面、Pass Web 与 Chrome Web 扩展三端
 */

export const SYNC_APPLIED_TEXT = {
  merge: "已合并写入本地",
  remoteOverwriteLocal: "已用云端内容覆盖本地",
  localOverwriteRemote: "已用本地内容覆盖云端",
};

export const formatSyncPushState = (report) => {
  if (!report) return "";
  if (report.dryRun) return "仅预览";
  const appliedText = SYNC_APPLIED_TEXT[report.mode] || SYNC_APPLIED_TEXT.merge;
  const uploaded = Math.max(0, Number(report.uploadedTargets || 0));
  const identical = Math.max(0, Number(report.identicalTargets || 0));
  const pushDetail = () => {
    if (uploaded && identical) return `已上传 ${uploaded} 个目标，另 ${identical} 个内容一致未重复上传`;
    if (uploaded) return `已上传 ${uploaded} 个目标`;
    if (identical) return `${identical} 个目标内容已一致，未重复上传`;
    return null;
  };
  if (report.applied && report.pushed) {
    const detail = pushDetail();
    return detail ? `${appliedText} · ${detail}` : `${appliedText} · 远端已确认一致`;
  }
  if (report.applied && !report.pushed && report.pendingRetry) return `${appliedText} · 远端未推送（待补偿重试）`;
  if (report.applied && !report.pushed) return `${appliedText} · 远端未推送`;
  if (!report.applied && report.ok) return "两端内容已一致，无需写入";
  return report.ok ? "已完成" : "未完成";
};

export const shortSyncTrace = (report) => {
  const raw = String(report?.syncSessionId || report?.operationId || "").trim();
  if (!raw) return "";
  const compact = raw.split("-").at(-1)?.replaceAll("-", "") || raw;
  return `同步编号 ${compact.slice(0, 8).toUpperCase()}`;
};

// Prefer stable recordId/id over accountId so preview matches merge identity
// and permanent-delete tombstones do not reappear as fake "新增".
export const previewRecordKey = (record, fallbackPrefix = "account") =>
  String(
    record?.recordId?.trim()
      || record?.id?.trim()
      || record?.accountId?.trim()
      || `${fallbackPrefix}:${record?.canonicalSite || ""}:${record?.username || ""}`
  ).toLowerCase();

export const previewAccountLabel = (account) => {
  const site = account?.canonicalSite || account?.sites?.[0] || "未命名站点";
  const username = account?.username ? ` · ${account.username}` : "";
  return `${site}${username}`;
};

export const isVisibleSyncAccount = (account) => !account?.isPermanentlyDeleted;
export const isVisibleSyncFolder = (folder) => !folder?.isPermanentlyDeleted;
export const isVisibleSyncPasskey = (passkey) => !passkey?.isPermanentlyDeleted;

export const previewAccountFields = [
  ["sites", "站点"],
  ["username", "用户名"],
  ["password", "密码"],
  ["totpSecret", "TOTP"],
  ["recoveryCodes", "恢复码"],
  ["note", "备注"],
  ["folderIds", "文件夹"],
  ["folderId", "文件夹"],
  ["isDeleted", "删除状态"],
  ["isPermanentlyDeleted", "永久删除状态"],
];

export const previewValue = (value) => JSON.stringify(value ?? null);

export const calculateSyncPayloadDiff = (localPayload, mergedPayload) => {
  const localAccounts = (localPayload?.accounts || []).filter(isVisibleSyncAccount);
  const mergedAccounts = (mergedPayload?.accounts || []).filter(isVisibleSyncAccount);
  const localMap = new Map(localAccounts.map((item) => [previewRecordKey(item, "account"), item]));
  const mergedMap = new Map(mergedAccounts.map((item) => [previewRecordKey(item, "account"), item]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, account] of mergedMap) {
    if (!localMap.has(key)) added.push(account);
  }
  for (const [key, account] of localMap) {
    if (!mergedMap.has(key)) removed.push(account);
  }
  for (const [key, localAccount] of localMap) {
    const mergedAccount = mergedMap.get(key);
    if (!mergedAccount) continue;
    const fields = previewAccountFields
      .filter(([name]) => previewValue(localAccount[name]) !== previewValue(mergedAccount[name]))
      .map(([, label]) => label);
    const uniqueFields = [...new Set(fields)];
    if (uniqueFields.length) changed.push({ account: mergedAccount, fields: uniqueFields });
  }
  const folderDelta = (mergedPayload?.folders || []).filter(isVisibleSyncFolder).length
    - (localPayload?.folders || []).filter(isVisibleSyncFolder).length;
  const passkeyDelta = (mergedPayload?.passkeys || []).filter(isVisibleSyncPasskey).length
    - (localPayload?.passkeys || []).filter(isVisibleSyncPasskey).length;
  const totalChanges = added.length + removed.length + changed.length + Math.abs(folderDelta) + Math.abs(passkeyDelta);
  return {
    added,
    removed,
    changed,
    folderDelta,
    passkeyDelta,
    totalChanges,
  };
};

// 同步包导入确认弹窗只展示会实际写入本地的账号差异，绝不展示密码或密钥内容。
export const summarizeSyncAccountDiff = (localPayload, mergedPayload, limit = 100) => {
  const localAccounts = (localPayload?.accounts || []).filter(isVisibleSyncAccount);
  const mergedAccounts = (mergedPayload?.accounts || []).filter(isVisibleSyncAccount);
  const localMap = new Map(localAccounts.map((item) => [previewRecordKey(item, "account"), item]));
  const mergedMap = new Map(mergedAccounts.map((item) => [previewRecordKey(item, "account"), item]));
  const changes = [];
  for (const [key, account] of mergedMap) {
    if (!localMap.has(key)) {
      changes.push({ kind: "新增", account, fields: [] });
    }
  }
  for (const [key, account] of localMap) {
    if (!mergedMap.has(key)) {
      changes.push({ kind: "移除", account, fields: [] });
    }
  }
  for (const [key, localAccount] of localMap) {
    const mergedAccount = mergedMap.get(key);
    if (!mergedAccount) continue;
    const fields = [...new Set(previewAccountFields
      .filter(([name]) => previewValue(localAccount[name]) !== previewValue(mergedAccount[name]))
      .map(([, label]) => label))];
    if (fields.length) changes.push({ kind: "修改", account: mergedAccount, fields });
  }
  return {
    total: changes.length,
    lines: changes.slice(0, limit).map((item) =>
      `${item.kind}：${previewAccountLabel(item.account)}${item.fields.length ? `（${item.fields.join("、")}）` : ""}`
    ),
    omitted: Math.max(0, changes.length - limit),
  };
};

export const formatSyncDecisionSummaryLines = (reports) => {
  const list = Array.isArray(reports) ? reports : [reports];
  const valid = list.filter(Boolean);
  if (!valid.length) return [];
  const modeNames = {
    merge: "按字段合并",
    remoteOverwriteLocal: "云端覆盖本地",
    localOverwriteRemote: "本地覆盖云端",
  };
  return [
    "裁决摘要：账号优先按 recordId/accountId 匹配；字段按字段更新时间较新者胜，时间相同非空胜空，再按账号更新时间、设备名和字典序稳定裁决。",
    "删除规则：删除时间不早于最新内容更新时间时删除胜出；永久删除标记不会被普通内容恢复。",
    ...valid.map((report) => {
      const source = report.source ? `${report.source}：` : "";
      const mode = modeNames[report.mode] || report.mode || "未知模式";
      const safetyStatus = report.safety || (report.safe === false ? "blocked" : "passed");
      const safety = safetyStatus === "blocked"
        ? `安全检查未通过${report.reasons?.length ? `（${report.reasons.join("、")}）` : ""}`
        : safetyStatus === "notEvaluated"
          ? "尚未执行安全检查"
          : "安全检查通过";
      const pushState = formatSyncPushState(report);
      const trace = shortSyncTrace(report);
      return `${source}${mode} · 本地 ${report.localAccounts ?? "-"} → 合并 ${report.mergedAccounts ?? "-"} · ${safety}${pushState ? ` · ${pushState}` : ""}${trace ? ` · ${trace}` : ""}`;
    }),
  ];
};

export const overwriteWarningText = (mode) => (mode === "remoteOverwriteLocal"
  ? [
      "云端覆盖本地：以云端内容为准，本地会被云端整份替换。",
      "本地独有、云端没有的新增与修改将被丢弃，执行后无法通过“合并”自动找回。",
      "建议先用“预览合并”确认差异。",
    ].join("\n\n")
  : [
      "本地覆盖云端：以本地内容为准，云端会被本地整份替换。",
      "云端独有、本地没有的新增与修改将被丢弃（含云端已保留的永久删除墓碑），执行后无法通过“合并”自动找回。",
      "建议先用“预览合并”确认差异。",
    ].join("\n\n"));

export const computeSyncSources = ({
  syncEnabled = false,
  webdavEnabled = false,
  configuredPrimary = "selfHosted",
} = {}) => {
  const sources = [];
  if (syncEnabled) sources.push("selfHosted");
  if (webdavEnabled) sources.push("webdav");
  if (!sources.length) {
    throw new Error("请先启用自建服务器或 WebDAV 同步");
  }
  const preferred = sources.includes(configuredPrimary) ? configuredPrimary : sources[0];
  const ordered = [...sources].sort((left, right) => (right === preferred) - (left === preferred));
  return {
    sources,
    preferred,
    ordered,
  };
};

export const computeSyncConfirmationWarnings = ({
  mode = "merge",
  previousFingerprint = "",
  fingerprint = "",
} = {}) => {
  const warnings = [];
  if (mode !== "merge") {
    warnings.push(overwriteWarningText(mode));
  }
  const prev = String(previousFingerprint || "").trim();
  const curr = String(fingerprint || "").trim();
  if (prev && curr && prev !== curr) {
    warnings.push(
      `检测到主同步源与上次成功同步不一致。\n\n上次：${prev}\n当前：${curr}\n\n不同设备/客户端应使用同一主源，否则可能产生分叉。`
    );
  }
  const label =
    mode === "merge"
      ? "合并"
      : mode === "remoteOverwriteLocal"
        ? "云端覆盖本地"
        : "本地覆盖云端";
  return {
    needsConfirmation: warnings.length > 0,
    warnings,
    label,
    title: `${label}确认`,
    message: `${warnings.join("\n\n")}\n\n确定继续执行${label}？`,
    confirmText: mode === "merge" ? "继续同步" : "继续覆盖",
    danger: mode !== "merge",
  };
};

export const formatSyncFailureLine = (report = {}) => {
  const code = report?.code ? ` [${report.code}]` : "";
  const trace = shortSyncTrace(report);
  const source = report?.source || "同步服务";
  const message = report?.message || "同步未完成";
  return `${source}${code}：${message}${trace ? `（${trace}）` : ""}`;
};

export const computePrimaryFingerprint = ({
  primary = "selfHosted",
  selfHostedBaseUrl = "",
  webdavBaseUrl = "",
  webdavRemotePath = "",
} = {}) => {
  if (primary === "webdav") {
    return `webdav|${String(webdavBaseUrl || "").trim().replace(/\/+$/, "")}|${String(webdavRemotePath || "").trim()}`;
  }
  return `selfHosted|${String(selfHostedBaseUrl || "").trim().replace(/\/+$/, "")}`;
};

export const formatSyncReportSummary = (reports = []) => {
  const list = Array.isArray(reports) ? reports : [reports];
  return list
    .filter(Boolean)
    .map((item) => `${item.source}：${item.message || "完成"}${formatSyncPushState(item) ? `（${formatSyncPushState(item)}）` : ""}`)
    .join("；");
};

export const formatSyncPreviewMetaText = (folderDelta = 0, passkeyDelta = 0) => {
  const fd = folderDelta >= 0 ? `+${folderDelta}` : `${folderDelta}`;
  const pd = passkeyDelta >= 0 ? `+${passkeyDelta}` : `${passkeyDelta}`;
  return `文件夹数量变化 ${fd}；通行密钥数量变化 ${pd}。仅显示字段名，不显示密码或密钥内容。`;
};

export const formatSyncDiffTitle = (totalChanges = 0, addedCount = 0, removedCount = 0, changedCount = 0) => {
  return totalChanges
    ? `预计写入本地：新增 ${addedCount}，移除 ${removedCount}，修改 ${changedCount}`
    : "预计不会改变本地数据";
};

export const formatMergeSummaryText = (result = {}) =>
  `safe=${Boolean(result?.safe)}\n${(result?.reasons || []).join(", ")}`;


