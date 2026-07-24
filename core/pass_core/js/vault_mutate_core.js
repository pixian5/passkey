/** Shared vault mutation helpers. Keep aligned with pass_merge::v2::mutate. */

export function softDeleteAccount(account, nowMs, deviceName) {
  if (!account || account.isDeleted || account.isPermanentlyDeleted) return false;
  account.isDeleted = true;
  account.deletedAtMs = nowMs;
  account.deletedDeviceName = deviceName || "";
  account.updatedAtMs = nowMs;
  account.lastOperatedDeviceName = deviceName || "";
  return true;
}

export function permanentlyDeleteAccount(account, nowMs, deviceName) {
  if (!account || account.isPermanentlyDeleted) return false;
  account.isDeleted = true;
  account.isPermanentlyDeleted = true;
  account.deletedAtMs = nowMs;
  account.deletedDeviceName = deviceName || "";
  account.updatedAtMs = nowMs;
  account.lastOperatedDeviceName = deviceName || "";
  account.password = "";
  account.totpSecret = "";
  account.recoveryCodes = "";
  return true;
}

export function restoreAccountFields(account, nowMs, deviceName) {
  if (!account) throw new Error("账号不存在");
  if (account.isPermanentlyDeleted) throw new Error("已永久删除的账号不能恢复");
  if (!account.isDeleted) return false;
  account.isDeleted = false;
  account.deletedAtMs = null;
  account.deletedDeviceName = "";
  account.updatedAtMs = nowMs;
  account.lastOperatedDeviceName = deviceName || "";
  return true;
}

export function setAccountPinned(account, pinned, nextPinOrder, nowMs, deviceName) {
  if (!account) throw new Error("账号不存在");
  if (account.isDeleted || account.isPermanentlyDeleted) {
    throw new Error("回收站账号不支持置顶");
  }
  if (pinned) {
    if (!account.isPinned) {
      account.pinnedSortOrder = nextPinOrder == null ? 0 : Number(nextPinOrder);
    }
    account.isPinned = true;
  } else {
    account.isPinned = false;
    account.pinnedSortOrder = null;
  }
  account.updatedAtMs = nowMs;
  account.lastOperatedDeviceName = deviceName || "";
  return true;
}

// Fixed new-account folder id — keep aligned with pass_merge::v2::FIXED_NEW_ACCOUNT_FOLDER_ID
export const FIXED_NEW_ACCOUNT_FOLDER_ID = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";

export function permanentlyDeleteFolder(folder, nowMs, deviceName) {
  if (!folder) throw new Error("文件夹不存在");
  if (String(folder.id || "").toLowerCase() === FIXED_NEW_ACCOUNT_FOLDER_ID.toLowerCase()) {
    throw new Error("固定文件夹不可删除");
  }
  if (folder.isDeleted || folder.isPermanentlyDeleted) return false;
  folder.isDeleted = true;
  folder.isPermanentlyDeleted = true;
  folder.deletedAtMs = nowMs;
  folder.deletedDeviceName = deviceName || "";
  folder.updatedAtMs = nowMs;
  return true;
}

export function markFolderMembership(account, folderId, isDeleted, nowMs, deviceName) {
  if (!account) throw new Error("账号不存在");
  const key = String(folderId || "").trim().toLowerCase();
  if (!key) return false;
  account.folderMembershipStates = {
    ...(account.folderMembershipStates || {}),
    [key]: {
      isDeleted: Boolean(isDeleted),
      updatedAtMs: nowMs,
      deviceName: deviceName || "",
    },
  };
  account.updatedAtMs = nowMs;
  account.lastOperatedDeviceName = deviceName || "";
  return true;
}

