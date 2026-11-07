/**
 * 保险库实体识别、排序与条件筛选辅助 (Vault Entity & Filter Utilities)
 */

import { compareOptionalOrder } from "./ui_utils.js";

export const accountKey = (a) => String(a?.recordId || a?.id || a?.accountId || "").trim();

export const accountRecordId = (a) => String(a?.recordId || a?.id || a?.accountId || "").trim();

export const isPinnedAccount = (a) => Boolean(a?.isPinned);

export const hasTotp = (a) => Boolean((a?.totpSecret || "").trim());

export const hasPasskey = (a) => (a?.passkeyCredentialIds || []).length > 0;

export const folderIdsOf = (a) => {
  const ids = [...(a?.folderIds || [])];
  if (a?.folderId) ids.push(a.folderId);
  return [...new Set(ids.map(String))];
};

export const matchesSearchQuery = (account, queryText = "", field = "all") => {
  const q = String(queryText || "").trim().toLowerCase();
  if (!q) return true;
  const a = account || {};
  const parts =
    field === "site"
      ? a.sites || []
      : field === "username"
        ? [a.username, a.accountId]
        : field === "password"
          ? [a.password]
          : field === "note"
            ? [a.note]
            : [a.username, a.accountId, a.password, a.note, ...(a.sites || [])];
  const hay = parts.filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
};

export const sameId = (a, b) =>
  String(a || "").toLowerCase() === String(b || "").toLowerCase();

export const moveIdInList = (ids, sourceId, targetId, before) => {
  const list = (ids || []).map(String);
  const from = list.findIndex((id) => sameId(id, sourceId));
  const to = list.findIndex((id) => sameId(id, targetId));
  if (from < 0 || to < 0) return null;
  let dest = before ? to : to + 1;
  if (from < dest) dest -= 1;
  if (dest === from) return null;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, dest)), 0, moved);
  return next;
};

export const filterPasskeysForAccount = (account, passkeys = []) => {
  const a = account || {};
  const ids = new Set((a.passkeyCredentialIds || []).map(String));
  const sites = new Set((a.sites || []).map((s) => String(s).toLowerCase()));
  return (passkeys || []).filter((p) => {
    if (p?.isDeleted || p?.isPermanentlyDeleted) return false;
    if (ids.has(p?.credentialIdB64u)) return true;
    const rp = (p?.rpId || "").toLowerCase();
    return rp && sites.has(rp);
  });
};

export const findAccountByAnyId = (accounts, id) =>
  (accounts || []).find(
    (a) =>
      sameId(accountKey(a), id) ||
      sameId(accountRecordId(a), id) ||
      sameId(a?.accountId, id)
  );

export const sortAccountsList = (list, { mode = "default", regularOrderIds = [] } = {}) => {
  const arr = [...(list || [])];
  const cmp = (x, y) => String(x || "").localeCompare(String(y || ""), "en");
  const regularOrder = new Map(
    (regularOrderIds || []).map((id, index) => [String(id).toLowerCase(), index])
  );
  arr.sort((a, b) => {
    if (mode === "usernameAZ") return cmp(a?.username, b?.username);
    if (mode === "siteAZ") return cmp((a?.sites || [])[0], (b?.sites || [])[0]);
    // default: pinned first, then manual order within each section
    const ap = isPinnedAccount(a);
    const bp = isPinnedAccount(b);
    if (ap !== bp) return ap ? -1 : 1;
    if (ap && bp) {
      const byPin = compareOptionalOrder(a?.pinnedSortOrder, b?.pinnedSortOrder);
      if (byPin) return byPin;
    } else {
      const leftRank = regularOrder.get(accountRecordId(a).toLowerCase());
      const rightRank = regularOrder.get(accountRecordId(b).toLowerCase());
      const byRegularOrder = compareOptionalOrder(leftRank, rightRank);
      if (byRegularOrder) return byRegularOrder;
    }
    const byUpdated = (b?.updatedAtMs || 0) - (a?.updatedAtMs || 0);
    if (byUpdated) return byUpdated;
    return cmp(a?.accountId || accountKey(a), b?.accountId || accountKey(b));
  });
  return arr;
};

export const computeSearchPlaceholder = (filter = { type: "all" }, field = "all") => {
  const f = filter || { type: "all" };
  const fieldLabel =
    field === "site"
      ? "站点名"
      : field === "username"
        ? "用户名"
        : field === "password"
          ? "密码"
          : field === "note"
            ? "备注"
            : "";
  const scope =
    f.type === "passkeys"
      ? "通行密钥账号"
      : f.type === "totp"
        ? "验证码账号"
        : f.type === "recycle"
          ? "回收站账号"
          : f.type === "folder"
            ? "当前文件夹账号"
            : "全部账号";
  return fieldLabel
    ? `按${fieldLabel}搜索${scope}（输入即搜）`
    : `搜索${scope}（输入即搜）`;
};

export const computeSidebarCounts = (state = {}) => {
  const active = Array.isArray(state?.activeAccounts) ? state.activeAccounts : [];
  const deleted = Array.isArray(state?.deletedAccounts) ? state.deletedAccounts : [];
  const folders = (Array.isArray(state?.folders) ? state.folders : []).filter(
    (f) => !f.isDeleted && !f.isPermanentlyDeleted
  );
  return {
    all: active.length,
    passkeys: active.filter(hasPasskey).length,
    totp: active.filter(hasTotp).length,
    recycle: deleted.length,
    folders: folders.length,
  };
};

export const parseSidebarFilterTag = (f = "") => {
  const str = String(f || "").trim();
  if (str === "all") return { type: "all" };
  if (str === "passkeys") return { type: "passkeys" };
  if (str === "totp") return { type: "totp" };
  if (str === "recycle") return { type: "recycle" };
  if (str.startsWith("folder:")) return { type: "folder", id: str.slice("folder:".length) };
  return null;
};
