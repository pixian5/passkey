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
