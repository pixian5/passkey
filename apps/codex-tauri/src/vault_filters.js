/**
 * 保险库实体识别、排序与条件筛选辅助 (Vault Entity & Filter Utilities)
 */

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
