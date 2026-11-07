/**
 * 保险库去重与文件夹删除影响计算纯函数 (Vault Deduplication & Deletion Impact)
 */

import { folderIdsOf } from "./vault_filters.js";

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
