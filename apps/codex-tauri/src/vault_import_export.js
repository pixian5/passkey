/**
 * 保密库导入导出与同步包纯函数算法模块 (Vault Import / Export & Sync Bundle Pure Utilities)
 * 
 * 职责：
 * 1. 纯函数构建与归一化本地同步载荷（buildLocalSyncPayload）；
 * 2. 安全解包与校验外部导入的数据包（extractPayload、validateSyncBundlePayload）；
 * 3. 规范化导出文件命名（formatExportBrowserFileName、formatSyncBundleExportFileName）；
 * 4. 统计与格式化导入导出结果及错误反馈（computeBundleImportStats、formatImportExportError）。
 */

/**
 * 构造标准本地同步/导出载荷结构
 * @param {Object} state - 当前状态集合
 * @returns {Object} 归一化的同步载荷
 */
export const buildLocalSyncPayload = ({
  activeAccounts = [],
  deletedAccounts = [],
  accounts = null,
  folders = [],
  regularOrders = [],
  passkeys = [],
} = {}) => {
  const mergedAccounts = Array.isArray(accounts)
    ? accounts
    : [
        ...(Array.isArray(activeAccounts) ? activeAccounts : []),
        ...(Array.isArray(deletedAccounts) ? deletedAccounts : []),
      ];
  return {
    accounts: mergedAccounts,
    activeAccounts: Array.isArray(activeAccounts) ? activeAccounts : [],
    deletedAccounts: Array.isArray(deletedAccounts) ? deletedAccounts : [],
    folders: Array.isArray(folders) ? folders : [],
    regularOrders: Array.isArray(regularOrders) ? regularOrders : [],
    passkeys: Array.isArray(passkeys) ? passkeys : [],
  };
};

/**
 * 从 JSON 文本或原生对象中安全提取业务载荷
 * @param {string|Object} rawOrText - 输入的 JSON 字符串或对象
 * @param {string} label - 数据标签用于报错提示
 * @returns {Object} 提取出的有效 payload 对象
 */
export const extractPayload = (rawOrText, label = "数据") => {
  if (rawOrText === null || rawOrText === undefined) {
    throw new Error(`${label} 为空`);
  }
  let parsed = rawOrText;
  if (typeof rawOrText === "string") {
    const trimmed = rawOrText.trim();
    if (!trimmed) {
      throw new Error(`${label} 为空`);
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`${label} 不是合法的 JSON 格式：${err.message || err}`);
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 不是有效的 JSON 对象`);
  }
  return parsed.payload !== undefined && typeof parsed.payload === "object"
    ? parsed.payload
    : parsed;
};

/**
 * 计算同步数据包或导入载荷的基础资源统计
 * @param {Object} payload - 载荷对象
 * @returns {Object} 统计指标
 */
export const computeBundleImportStats = (payload = {}) => {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const activeCount = Array.isArray(safePayload.activeAccounts)
    ? safePayload.activeAccounts.length
    : Array.isArray(safePayload.accounts)
      ? safePayload.accounts.length
      : 0;
  const deletedCount = Array.isArray(safePayload.deletedAccounts)
    ? safePayload.deletedAccounts.length
    : 0;
  const folderCount = Array.isArray(safePayload.folders) ? safePayload.folders.length : 0;
  const passkeyCount = Array.isArray(safePayload.passkeys) ? safePayload.passkeys.length : 0;
  return {
    activeCount,
    deletedCount,
    folderCount,
    passkeyCount,
    totalAccountCount: activeCount + deletedCount,
  };
};

/**
 * 校验同步数据包结构合法性与完整性
 * @param {Object} payload - 待校验载荷
 * @returns {{ valid: boolean, error?: string, stats?: Object }}
 */
export const validateSyncBundlePayload = (payload) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, error: "同步包载荷必须是非空对象" };
  }
  const arrayFields = ["accounts", "activeAccounts", "deletedAccounts", "folders", "regularOrders", "passkeys"];
  for (const field of arrayFields) {
    if (field in payload && !Array.isArray(payload[field])) {
      return { valid: false, error: `字段 ${field} 必须是数组` };
    }
  }
  const stats = computeBundleImportStats(payload);
  return {
    valid: true,
    stats,
  };
};

/**
 * 补齐时间数字为双字符
 */
const pad2 = (n) => String(n).padStart(2, "0");

/**
 * 格式化导出时间戳为 YYYYMMDD-HHmmss
 * @param {number|Date} timestamp
 * @returns {string}
 */
export const formatTimestampForFileName = (timestamp = Date.now()) => {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) {
    return "00000000-000000";
  }
  const year = d.getFullYear();
  const month = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hours = pad2(d.getHours());
  const minutes = pad2(d.getMinutes());
  const seconds = pad2(d.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
};

/**
 * 生成浏览器格式导出 CSV 文件的默认文件名
 * @param {string} format - "chrome" | "firefox" | "safari" | "generic"
 * @param {number|Date} timestamp
 * @returns {string} 格式化文件名
 */
export const formatExportBrowserFileName = (format = "generic", timestamp = Date.now()) => {
  const normalizedFormat = String(format || "generic").toLowerCase().trim();
  const timeStr = formatTimestampForFileName(timestamp);
  return `pass-export-${normalizedFormat}-${timeStr}.csv`;
};

/**
 * 生成同步备份包（Sync Bundle）导出默认文件名
 * @param {number|Date} timestamp
 * @returns {string} 格式化文件名
 */
export const formatSyncBundleExportFileName = (timestamp = Date.now()) => {
  const timeStr = formatTimestampForFileName(timestamp);
  return `pass-sync-bundle-${timeStr}.json`;
};

/**
 * 格式化导入或导出操作错误提示文案
 * @param {string} stage - 阶段标识："csv" | "qr" | "bundle" | "parse" | "export"
 * @param {Error|string} err - 原始错误对象或错误文本
 * @returns {string} 友好的中文错误描述
 */
export const formatImportExportError = (stage = "import", err = "") => {
  const msg = err?.message || String(err || "未知错误");
  switch (stage) {
    case "csv":
      return `导入失败：${msg}`;
    case "qr":
      return `验证器导入失败：${msg}`;
    case "bundle":
      return `导入同步包失败：${msg}`;
    case "parse":
      return `数据解析失败：${msg}`;
    case "export":
      return `导出失败：${msg}`;
    default:
      return `操作失败：${msg}`;
  }
};
