import {
  sameId,
  moveIdInList,
  isPinnedAccount,
  accountKey,
  accountRecordId,
  folderIdsOf,
} from "./vault_filters.js";

/**
 * Checks whether mouse pointer displacement has exceeded drag gesture threshold.
 */
export const isDndDragEvent = (dx, dy, threshold = 3) => {
  return Math.abs(dx) > threshold || Math.abs(dy) > threshold;
};

/**
 * Calculates drop indicator line position and sizing against a target bounding rect.
 */
export const computeDropLineStyle = (rect, before) => {
  if (!rect) return null;
  const y = before ? rect.top : rect.bottom;
  return {
    left: `${Math.max(8, (rect.left || 0) + 4)}px`,
    width: `${Math.max(40, (rect.width || 0) - 8)}px`,
    top: `${Math.max(0, y - 1.5)}px`,
  };
};

/**
 * Determines whether the drop placement should be before or after the target item,
 * taking into account cross-group drag between pinned and unpinned accounts.
 */
export const computeDropPlacement = ({
  clientY,
  targetRect,
  kind,
  sourcePinned = null,
  targetPinned = null,
}) => {
  if (!targetRect) return { before: true };
  const height = targetRect.height || 0;
  let before = clientY < targetRect.top + height / 2;
  if (kind === "account") {
    const isSourcePinned = Boolean(sourcePinned);
    const isTargetPinned = Boolean(targetPinned);
    if (isSourcePinned !== isTargetPinned) {
      before = isSourcePinned ? false : true;
    }
  }
  return { before };
};

/**
 * Computes drag ghost float element style positioning.
 */
export const computeFloatStyle = (clientX, clientY, offsetX = 0, offsetY = 0) => {
  return {
    left: `${clientX - Number(offsetX || 0)}px`,
    top: `${clientY - Number(offsetY || 0)}px`,
  };
};

/**
 * Computes reordered folder list and IDs.
 */
export const planFolderReorder = (folders = [], sourceId, targetId, before) => {
  const activeFolders = (folders || []).filter((f) => !f.isDeleted && !f.isPermanentlyDeleted);
  const ids = activeFolders.map((f) => String(f.id));
  const next = moveIdInList(ids, sourceId, targetId, before);
  if (!next) return null;
  const byId = new Map(activeFolders.map((f) => [String(f.id).toLowerCase(), f]));
  const deleted = (folders || []).filter((f) => f.isDeleted || f.isPermanentlyDeleted);
  const nextFolders = next
    .map((id) => byId.get(String(id).toLowerCase()))
    .filter(Boolean)
    .concat(deleted);
  return {
    orderedIds: next,
    folders: nextFolders,
  };
};

/**
 * Computes reordered account list IDs when moving an account relative to another.
 */
export const planAccountReorder = ({
  sourceAccount,
  targetAccount,
  before,
  scopeAccounts = [],
  pinnedAccounts = [],
}) => {
  if (!sourceAccount || !targetAccount) return null;
  const pinned = isPinnedAccount(sourceAccount);
  const group = pinned ? pinnedAccounts : scopeAccounts;
  const ids = group.map((a) => accountRecordId(a) || accountKey(a));
  const sourceRec = accountRecordId(sourceAccount) || accountKey(sourceAccount);
  let targetRec = accountRecordId(targetAccount) || accountKey(targetAccount);
  let placeBefore = before;

  if (isPinnedAccount(targetAccount) !== pinned) {
    if (!ids.length) return null;
    targetRec = pinned ? ids[ids.length - 1] : ids[0];
    placeBefore = !pinned;
  }

  const next = moveIdInList(ids, sourceRec, targetRec, placeBefore);
  if (!next) return null;
  return {
    orderedIds: next,
    pinned,
    targetRec,
    placeBefore,
  };
};

/**
 * Applies new pinnedSortOrder ranks to active accounts.
 */
export const applyPinnedSortOrders = (accounts = [], orderedIds = []) => {
  const orderRank = new Map(orderedIds.map((id, i) => [String(id).toLowerCase(), i]));
  return accounts.map((acc) => {
    if (!isPinnedAccount(acc)) return acc;
    const rid = String(accountRecordId(acc) || accountKey(acc)).toLowerCase();
    if (orderRank.has(rid)) {
      return { ...acc, pinnedSortOrder: orderRank.get(rid) };
    }
    return acc;
  });
};

/**
 * Calculates folder picker options and initial checkbox states for account selection.
 */
export const computeAccountFolderPickerState = (
  folders = [],
  accountsOrAccount = [],
  currentFolderFilterId = ""
) => {
  const accounts = Array.isArray(accountsOrAccount) ? accountsOrAccount : [accountsOrAccount];
  const activeAccounts = accounts.filter((account) => account && !account.isDeleted);
  if (!activeAccounts.length) {
    return { error: "回收站账号不能添加到文件夹", activeAccounts: [] };
  }
  const activeFolders = (folders || []).filter(
    (folder) => !folder.isDeleted && !folder.isPermanentlyDeleted
  );
  if (!activeFolders.length) {
    return { error: "暂无可添加的文件夹，请先新建文件夹", activeAccounts };
  }
  const existingByFolder = new Map(
    activeAccounts.map((account) => [
      accountKey(account).toLowerCase(),
      new Set(folderIdsOf(account).map((id) => id.toLowerCase())),
    ])
  );
  const targetIds = activeAccounts.map((account) => accountRecordId(account) || accountKey(account));
  const targetNames = activeAccounts.map(
    (account) => account.username || account.accountId || "账号"
  );
  const title = `设置 ${activeAccounts.length} 个账号的文件夹`;
  const currentFolderId = currentFolderFilterId ? String(currentFolderFilterId).toLowerCase() : "";
  const commonFolderIds = new Set(
    activeFolders
      .filter((folder) =>
        activeAccounts.every((account) =>
          existingByFolder.get(accountKey(account).toLowerCase())?.has(String(folder.id).toLowerCase())
        )
      )
      .map((folder) => String(folder.id).toLowerCase())
  );
  const options = activeFolders.map((folder) => {
    const folderKey = String(folder.id).toLowerCase();
    const anyAlreadyAdded = activeAccounts.some((account) =>
      existingByFolder.get(accountKey(account).toLowerCase())?.has(folderKey)
    );
    const checked = currentFolderId
      ? folderKey === currentFolderId || commonFolderIds.has(folderKey)
      : anyAlreadyAdded;
    return {
      id: String(folder.id),
      name: folder.name || folder.id,
      checked,
    };
  });
  return {
    error: null,
    activeAccounts,
    targetIds,
    targetNames,
    title,
    options,
  };
};
