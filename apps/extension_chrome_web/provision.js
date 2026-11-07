/**
 * 表现层自建部署与快照恢复纯逻辑 (Provision & Snapshot Utilities)
 */
import { formatTimeMs } from "./ui_utils.js";

/**
 * 规范化 Provision 凭据表单数据
 */
export const normalizeProvisionCredential = ({
  username = "root",
  port = 22,
  authMode = "privateKey",
  secret = "",
  privateKeyPassphrase = "",
} = {}) => ({
  username: String(username || "root").trim() || "root",
  port: Number.parseInt(String(port ?? 22), 10) || 22,
  authMode: authMode === "password" ? "password" : "privateKey",
  secret: String(secret || ""),
  privateKeyPassphrase: String(privateKeyPassphrase || ""),
});

/**
 * 校验 Provision 输入有效性
 */
export const validateProvisionInput = ({ serverUrl, credential } = {}) => {
  const trimmedUrl = String(serverUrl || "").trim();
  if (!trimmedUrl.startsWith("https://")) {
    return { valid: false, error: "服务器地址必须是 HTTPS URL" };
  }
  const secret = String(credential?.secret || "").trim();
  if (!secret) {
    return { valid: false, error: "请填写 SSH 密码或私钥" };
  }
  return { valid: true, error: null };
};

/**
 * 生成 32 字节高熵安全访问令牌 (Base64 URL-safe 风格，去除容易混淆字符)
 */
export const generateProvisionToken = (randomBytesSource = null) => {
  const bytes = new Uint8Array(32);
  if (typeof randomBytesSource === "function") {
    randomBytesSource(bytes);
  } else if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // 转化为 base64 字符串并剔除 +, /, =
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return (typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64"))
    .replace(/=+$/g, "")
    .replace(/\+/g, "")
    .replace(/\//g, "");
};

/**
 * 解析 EXISTING_SERVICE: 异常信息
 */
export const parseExistingServiceError = (raw) => {
  const text = String(raw ?? "");
  if (!text.includes("EXISTING_SERVICE:")) {
    return null;
  }
  const payload = text.split("EXISTING_SERVICE:")[1] || "";
  const parts = payload.split("|");
  const host = parts[0] || "";
  const findings = (parts[1] || "")
    .split("；")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    isExistingService: true,
    host,
    summary: `检测到服务器 ${host} 上已有 Pass 同步服务。`,
    findings,
  };
};

/**
 * 格式化旧服务冲突替换确认弹窗展示信息
 */
export const formatProvisionReplacement = (report) => {
  const summary = report?.summary || "服务器上已存在 Pass 同步服务。";
  const findingsList = Array.isArray(report?.findings) ? report.findings : [];
  const findingsText = findingsList.map((item) => `• ${item}`).join("\n");
  return {
    summary,
    findingsList,
    findingsText,
    hasFindings: findingsList.length > 0,
  };
};

/**
 * 格式化同步包合并确认详情内容 (不泄露密码细节)
 */
export const formatBundleImportDetails = (result, diff = null) => {
  const details = [
    `本地账号：${result?.localAccounts ?? "-"}`,
    `同步包账号：${result?.remoteAccounts ?? "-"}`,
    `合并后账号：${result?.mergedAccounts ?? "-"}`,
    result?.reasons?.length
      ? `安全检查提示：${result.reasons.join("；")}`
      : "安全检查：通过",
  ];
  if (diff?.total) {
    details.push("", `具体账号差异（${diff.total} 条）：`, ...diff.lines);
    if (diff.omitted) details.push(`其余 ${diff.omitted} 条差异已省略。`);
  } else {
    details.push("", "具体账号差异：无（不会改变本地账号）。");
  }
  details.push("", "确认后才会写入本地 vault。");
  return details.join("\n");
};

/**
 * 自建部署各阶段文案
 */
export const provisionStageMessage = (stage, { removeExisting = false } = {}) => {
  switch (stage) {
    case "host_key":
      return "正在确认 SSH 服务器身份…";
    case "detect":
      return "正在检测服务器是否已有旧服务…";
    case "deploy":
      return removeExisting
        ? "正在删除旧服务并创建新服务…"
        : "正在通过 SSH 在服务器上创建服务…";
    case "deploy_status":
      return removeExisting
        ? "正在删除旧服务并创建新服务，请稍候…"
        : "正在通过 SSH 在服务器上创建服务，请稍候…";
    case "verify":
      return "正在验证服务连通性…";
    default:
      return "";
  }
};

/**
 * 格式化服务器快照行展示标签
 */
export const formatServerVersionLabel = (version, formatMs = formatTimeMs) => {
  if (!version) return "-";
  const id = version.id ?? "-";
  const exported = formatMs(version.exportedAtMs);
  const saved = formatMs(version.savedAtMs);
  const hash = (version.payloadSha256 || "").slice(0, 12);
  return `版本 ${id} · 导出 ${exported} · 保存 ${saved} · ${hash}`;
};

/**
 * 格式化本地安全快照按钮展示标签
 */
export const formatLocalSnapshotLabel = (snapshot, formatMs = formatTimeMs) => {
  if (!snapshot) return "-";
  const reason = snapshot.reason || "本地快照";
  const createdAt = formatMs(snapshot.createdAtMs);
  const accounts = snapshot.accounts ?? 0;
  const folders = snapshot.folders ?? 0;
  const passkeys = snapshot.passkeys ?? 0;
  return `${reason} · ${createdAt} · 账号 ${accounts} · 文件夹 ${folders} · 通行密钥 ${passkeys}`;
};

/**
 * 切分逗号/换行分隔的多站点输入字符串并去除空白
 */
export const splitSitesInput = (raw) =>
  String(raw ?? "")
    .split(/[,，\n]/)
    .map((site) => site.trim())
    .filter(Boolean);

/**
 * 规范化 Provision 草稿
 */
export const normalizeProvisionDraft = (draft = {}) => ({
  serverUrl: String(draft.serverUrl || "").trim(),
  tlsCertificate: String(draft.tlsCertificate || ""),
  tlsPrivateKey: String(draft.tlsPrivateKey || ""),
  accessToken: String(draft.accessToken || "").trim(),
  syncEncryptionKey: String(draft.syncEncryptionKey || "").trim(),
});

/**
 * 格式化 Google 验证器导入结果反馈
 */
export const formatGoogleAuthImportSummary = (result = {}) =>
  `验证器导入完成：新增 ${result?.created ?? 0}，更新 ${result?.updated ?? 0}，跳过 ${result?.skipped ?? 0}`;

/**
 * 格式化 CSV 导入结果反馈
 */
export const formatCsvImportSummary = (result = {}) =>
  result?.message || `已导入 ${result?.imported ?? 0} 条`;

/**
 * 格式化文件夹站点规则应用反馈
 */
export const formatFolderSiteRuleSummary = (result = {}) =>
  result?.message || `已加入 ${result?.addedCount ?? 0} 个账号`;

/**
 * 格式化自建部署动作按钮进行时状态文案
 */
export const formatProgressElapsedText = (stageText = "正在处理…", elapsedSeconds = 0) =>
  `${stageText}${elapsedSeconds > 0 ? ` 已耗时 ${elapsedSeconds}s` : ""}`;
