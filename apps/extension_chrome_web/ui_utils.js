/**
 * UI 交互与格式化辅助工具 (UI Utilities)
 */

export const TOAST_LEVELS = ["success", "error", "warn"];

export const inferToastLevel = (text) => {
  const s = String(text ?? "");
  // Explicit failure cues first
  if (
    /失败|错误|无法|拒绝|异常|超时|未通过|无效|不能|禁止|未配置|不可达|412|401|403|500|HTTP\s*\d{3}/i.test(
      s
    )
  ) {
    return "error";
  }
  // Warnings / cancellations / empty / risk
  if (
    /取消|警告|风险|注意|未写入|未启用|为空|跳过|请先|请填写|可能|暂无|无已保存|停止|安全检查/i.test(
      s
    )
  ) {
    return "warn";
  }
  return "success";
};

export const commandMessage = (value, fallback = "") => {
  if (value && typeof value === "object" && typeof value.message === "string") return value.message;
  return value == null || value === "" ? fallback : String(value);
};

export const escapeHtml = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const isApplePlatform = (nav = (typeof navigator !== "undefined" ? navigator : null)) =>
  /Mac|iPhone|iPad|iPod/i.test(
    `${nav?.platform || ""} ${nav?.userAgent || ""}`
  );

/** ⌘ on macOS, Ctrl elsewhere — never Ctrl on Apple (reserved for context menu). */
export const isMultiSelectModifier = (e, isApple = isApplePlatform()) =>
  isApple ? Boolean(e.metaKey && !e.ctrlKey) : Boolean(e.metaKey || e.ctrlKey);

export const compareOptionalOrder = (lo, ro) => {
  if (lo != null && ro != null && lo !== ro) return lo - ro;
  if (lo != null && ro == null) return -1;
  if (lo == null && ro != null) return 1;
  return 0;
};

export const formatTimeMs = (ms, fallback = "-") => {
  const n = Number(ms || 0);
  if (!n) return fallback;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return String(ms);
  const yy = String(d.getFullYear()).slice(2);
  return `${yy}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
};

export const formatTime = (ms, fallback = "-") => {
  if (!ms) return fallback;
  try {
    const d = new Date(Number(ms));
    return Number.isNaN(d.getTime()) ? fallback : d.toLocaleString();
  } catch {
    return fallback;
  }
};

export const readFileAsText = (file) =>
  new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    if (typeof FileReader === "undefined") {
      if (typeof file.text === "function") {
        file.text().then(resolve, reject);
        return;
      }
      resolve(String(file));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsText(file);
  });

export const formatUndoRedoTooltip = (status, type = "undo") => {
  if (!status) {
    return type === "undo" ? "当前没有可撤销的本地操作" : "当前没有可重做的本地操作";
  }
  const fallback = type === "undo" ? "最近一次本地操作" : "待重做的本地操作";
  return String(status?.title || fallback)
    .replace(/前自动备份$/, "")
    .trim();
};

export const formatOperationHistoryRow = (entry, formatTimeFn = formatTime) => {
  const stateLabel = entry?.stack === "redo" ? "可重做" : "可撤销";
  const title = escapeHtml(entry?.title || "本地操作");
  const time = escapeHtml(formatTimeFn(entry?.createdAtMs));
  return `<div class="history-row-head"><span class="history-row-title">${title}</span><span class="history-row-meta">${stateLabel}</span></div><div class="history-row-meta">${time}</div>`;
};

export const formatLockStatusText = (
  lockState = {},
  { biometricAvailable = false, canBiometric = false } = {}
) => {
  if (!lockState?.enabled) {
    return "状态：未启用";
  }
  const policyTitle = {
    onceUntilQuit: "退出前不锁定",
    idleTimeout: `空闲 ${lockState.idleLockMinutes || 5} 分钟锁定`,
    onBackground: "切到后台锁定",
  }[lockState.lockPolicy] || "退出前不锁定";
  const bioHint = canBiometric
    ? "；可用指纹"
    : biometricAvailable && lockState.preferBiometrics
      ? "；指纹待主密码初始化"
      : "";
  return `状态：已启用；${lockState.locked ? "已锁定" : "已解锁"}；${policyTitle}${bioHint}`;
};

export const formatOtpDigitsHtml = (code, remainSeconds) => {
  const digits = !code || code.length !== 6 ? (code || "------") : `${code.slice(0, 3)} ${code.slice(3)}`;
  return `验证码: <span class="otp-digits">${digits}</span> <span class="otp-remain">(剩余 ${remainSeconds}s)</span>`;
};

export const formatAccountRowHtml = (account, {
  isPinned = false,
  isRecycleFilter = false,
  passkeys = [],
} = {}) => {
  const a = account || {};
  const title = a.accountId || a.username || (a.sites || [])[0] || "账号";
  const sites = (a.sites || []).join("  ");
  const pks = passkeys || [];
  const pkLine = pks
    .slice(0, 2)
    .map((p) => `通行密钥 RP ID: ${p.rpId || "—"} 用户名: ${p.userName || p.displayName || "—"}`)
    .join(" · ");

  const deleted = a.isDeleted && !isRecycleFilter
    ? '<span class="deleted-tag">已删除</span>'
    : "";
  const pinBadge = isPinned && !a.isDeleted
    ? '<span class="pinned-tag" title="置顶">置顶</span>'
    : "";

  return [
    `<div class="row-title">${escapeHtml(title)}${pinBadge}${deleted}</div>`,
    `<div class="row-line row-username">用户名: ${escapeHtml(a.username || "—")}</div>`,
    `<div class="row-sub row-sites">站点别名: ${escapeHtml(sites || "—")}</div>`,
    pkLine ? `<div class="row-sub">${escapeHtml(pkLine)}</div>` : "",
    `<div class="row-otp" data-totp="${escapeHtml((a.totpSecret || "").trim())}" hidden></div>`,
  ].filter(Boolean).join("\n      ");
};

export const resolveKeyboardAction = (e, {
  isTextInput = false,
  hasOpenModal = false,
  isApple = isApplePlatform(),
} = {}) => {
  if (!e) return null;
  const meta = isMultiSelectModifier(e, isApple);
  if (meta && (e.key === "a" || e.key === "A") && !isTextInput && !hasOpenModal) {
    return "selectAll";
  }
  if (meta && (e.key === "," || e.code === "Comma")) {
    return "openSettings";
  }
  if (meta && (e.key === "n" || e.key === "N") && !e.shiftKey && !isTextInput) {
    return "newAccount";
  }
  if (e.key === "Escape") {
    return "escape";
  }
  return null;
};
