/**
 * 保险库去重与文件夹删除影响计算纯函数 (Vault Deduplication & Deletion Impact)
 */

import { folderIdsOf } from "./vault_filters.js";
import { escapeHtml } from "./ui_utils.js";

export const formatDedupGroupSummary = (groups = []) => {
  const count = Array.isArray(groups) ? groups.length : 0;
  return count ? `重复组 ${count} 组，按站点别名和用户名分组` : "当前文件夹暂无重复账号";
};

export const dedupAccountLabel = (index, total) => {
  if (total <= 1) return "";
  if (index === 0) return "最新";
  if (index === total - 1) return "最早";
  return "";
};

export const formatDedupEmptyHtml = () =>
  '<div class="dedup-empty">当前文件夹暂无重复账号</div>';

export const formatDedupGroupHeadHtml = (group) => {
  const sites = escapeHtml((group?.siteAliases || []).join(", ") || "未命名站点");
  const username = escapeHtml(group?.username || "(空用户名)");
  const count = group?.accounts?.length || 0;
  return `<div><div class="dedup-group-title">${sites}</div><div class="dedup-account-meta">用户名：${username} · ${count} 个账号</div></div>`;
};

export const formatDedupAccountRowHtml = (
  account,
  index,
  total,
  { formatTimeFn = (t) => String(t || ""), accountKeyFn = (a) => a?.id || "" } = {}
) => {
  const label = dedupAccountLabel(index, total);
  const accountIdentifier = escapeHtml(account?.accountId || accountKeyFn(account) || "账号");
  const sites = escapeHtml((account?.sites || []).join(", ") || account?.canonicalSite || "-");
  const updatedAt = escapeHtml(formatTimeFn(account?.updatedAtMs));
  const createdAt = escapeHtml(formatTimeFn(account?.createdAtMs));
  return `
    <div class="dedup-account-main">
      <div class="dedup-account-id">${label ? `<span class="dedup-keep-label">${label}</span>` : ""}${accountIdentifier}</div>
      <div class="dedup-account-sites">站点：${sites}</div>
      <div class="dedup-account-meta">更新时间：${updatedAt} · 创建时间：${createdAt}</div>
    </div>`;
};

export const calculateFolderDeletionImpact = (folder, activeAccounts = [], deletedAccounts = []) => {
  const folderId = String(folder?.id || "");
  const folderIdLower = folderId.toLowerCase();
  const activeCount = (activeAccounts || []).filter((account) =>
    folderIdsOf(account).some((id) => id.toLowerCase() === folderIdLower)
  ).length;
  const recycleCount = (deletedAccounts || []).filter((account) =>
    folderIdsOf(account).some((id) => id.toLowerCase() === folderIdLower)
  ).length;
  const folderName = folder?.name || "未命名文件夹";
  const total = activeCount + recycleCount;
  const message = !total
    ? `删除「${folderName}」不会删除账号；当前没有账号属于此文件夹。`
    : `删除「${folderName}」不会删除账号。当前有 ${activeCount} 个活动账号、${recycleCount} 个回收站账号属于此文件夹。删除后，活动账号仍在“全部”（没有其他文件夹的会变为未分类），回收站账号仍在“回收站”；有其他文件夹归属的账号会保留其他归属。`;
  return {
    id: folderId,
    name: folderName,
    activeCount,
    recycleCount,
    total,
    message,
  };
};
