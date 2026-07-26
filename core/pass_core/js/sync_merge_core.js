import { DEFAULT_DEVICE_NAME } from "./sync_policy.js";

/**
 * Browser-side merge kernel for pass.sync.bundle.v2.
 *
 * Authority: `pass_merge::v2` in core/pass_core/crates/merge (Rust).
 * Keep this file semantically aligned; prefer calling the Rust engine via
 * FFI/WASM when host embedding is available. Parity harness:
 * `js/check_merge_parity.mjs`.
 */

function asNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fallbackDeviceName(...candidates) {
  for (const value of candidates) {
    const trimmed = asString(value).trim();
    if (trimmed) return trimmed;
  }
  return DEFAULT_DEVICE_NAME;
}

function asString(value) {
  return String(value || "");
}

function stableTieValue(value) {
  // Locale-independent to match Swift String.lowercased() + lexicographic compare.
  return asString(value).trim().toLowerCase();
}

function requireFunction(helpers, name) {
  const candidate = helpers?.[name];
  if (typeof candidate !== "function") {
    throw new Error(`sync_merge_core missing helper: ${name}`);
  }
  return candidate;
}

function resolveHelpers(helpers) {
  return {
    normalizeAccountShape: requireFunction(helpers, "normalizeAccountShape"),
    normalizeFolderIdList: requireFunction(helpers, "normalizeFolderIdList"),
    normalizeFolderId: requireFunction(helpers, "normalizeFolderId"),
    extractAccountFolderIds: requireFunction(helpers, "extractAccountFolderIds"),
    normalizeSites: requireFunction(helpers, "normalizeSites"),
    etldPlusOne: requireFunction(helpers, "etldPlusOne"),
    normalizePasskeyCredentialIds: requireFunction(helpers, "normalizePasskeyCredentialIds"),
    stableUuidFromText: requireFunction(helpers, "stableUuidFromText"),
    normalizePasskeyShape: requireFunction(helpers, "normalizePasskeyShape"),
    normalizePasskeyCreateCompatMethod: requireFunction(helpers, "normalizePasskeyCreateCompatMethod"),
    normalizeFolderShape: requireFunction(helpers, "normalizeFolderShape"),
    sortFoldersForDisplay: requireFunction(helpers, "sortFoldersForDisplay"),
    fixedNewAccountFolderId: asString(helpers?.fixedNewAccountFolderId).trim().toLowerCase(),
    fixedNewAccountFolderName: asString(helpers?.fixedNewAccountFolderName).trim() || "新账号",
  };
}

function newerField(
  lhsValue,
  lhsUpdatedAt,
  lhsDeviceName,
  lhsAccountUpdatedAt,
  rhsValue,
  rhsUpdatedAt,
  rhsDeviceName,
  rhsAccountUpdatedAt
) {
  const leftUpdated = asNumber(lhsUpdatedAt);
  const rightUpdated = asNumber(rhsUpdatedAt);
  if (leftUpdated > rightUpdated) return { value: asString(lhsValue), updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) };
  if (rightUpdated > leftUpdated) return { value: asString(rhsValue), updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };

  const leftValue = asString(lhsValue);
  const rightValue = asString(rhsValue);
  if (leftValue === rightValue) {
    return {
      value: leftValue,
      updatedAtMs: leftUpdated,
      deviceName: fallbackDeviceName(lhsDeviceName, rhsDeviceName),
    };
  }

  // Account-level updates can describe unrelated edits (for example a note
  // change). They must not make an older empty field erase a credential when
  // the field clocks are tied.
  if (!leftValue && rightValue) {
    return { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
  }
  if (leftValue && !rightValue) {
    return { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) };
  }

  const leftAccountUpdated = asNumber(lhsAccountUpdatedAt);
  const rightAccountUpdated = asNumber(rhsAccountUpdatedAt);
  if (leftAccountUpdated > rightAccountUpdated) {
    return { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) };
  }
  if (rightAccountUpdated > leftAccountUpdated) {
    return { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
  }

  const leftDevice = stableTieValue(lhsDeviceName);
  const rightDevice = stableTieValue(rhsDeviceName);
  if (leftDevice !== rightDevice) {
    return leftDevice > rightDevice
      ? { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) }
      : { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
  }
  // Raw lexicographic order matches Swift `lhsValue >= rhsValue`.
  return leftValue >= rightValue
    ? { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) }
    : { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
}

function mergeFolderMembershipStates(left, right) {
  const collect = (account) => {
    const states = account?.folderMembershipStates && typeof account.folderMembershipStates === "object"
      ? account.folderMembershipStates
      : {};
    const result = new Map();
    for (const [rawId, rawState] of Object.entries(states)) {
      const id = asString(rawId).trim().toLowerCase();
      if (!id) continue;
      result.set(id, {
        isDeleted: Boolean(rawState?.isDeleted),
        updatedAtMs: asNumber(rawState?.updatedAtMs || account?.updatedAtMs || account?.createdAtMs),
        deviceName: asString(rawState?.deviceName || account?.lastOperatedDeviceName).trim(),
      });
    }
    for (const rawId of account?.folderIds || []) {
      const id = asString(rawId).trim().toLowerCase();
      if (id && !result.has(id)) result.set(id, { isDeleted: false, updatedAtMs: asNumber(account?.updatedAtMs || account?.createdAtMs), deviceName: asString(account?.lastOperatedDeviceName).trim() });
    }
    return result;
  };
  const merged = collect(left);
  for (const [id, incoming] of collect(right)) {
    const current = merged.get(id);
    if (!current || shouldPreferRelationState(incoming, current)) {
      merged.set(id, incoming);
    }
  }
  return Object.fromEntries([...merged.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

function shouldPreferRelationState(incoming, current) {
  if (incoming.updatedAtMs > current.updatedAtMs) return true;
  if (incoming.updatedAtMs < current.updatedAtMs) return false;
  if (incoming.isDeleted && !current.isDeleted) return true;
  if (incoming.isDeleted === current.isDeleted) {
    // Match newerField / macOS: case-insensitive device name tie-break.
    return stableTieValue(incoming.deviceName) > stableTieValue(current.deviceName);
  }
  return false;
}

function mergeRelationStates(left, right, stateKey, leftValues, rightValues, normalizeId) {
  const collect = (account, values) => {
    const states = account?.[stateKey] && typeof account[stateKey] === "object" ? account[stateKey] : {};
    const result = new Map();
    for (const [rawId, rawState] of Object.entries(states)) {
      const id = normalizeId(rawId);
      if (!id) continue;
      result.set(id, {
        isDeleted: Boolean(rawState?.isDeleted),
        updatedAtMs: asNumber(rawState?.updatedAtMs || account?.updatedAtMs || account?.createdAtMs),
        deviceName: asString(rawState?.deviceName || account?.lastOperatedDeviceName).trim(),
      });
    }
    for (const rawId of values || []) {
      const id = normalizeId(rawId);
      if (id && !result.has(id)) result.set(id, { isDeleted: false, updatedAtMs: asNumber(account?.updatedAtMs || account?.createdAtMs), deviceName: asString(account?.lastOperatedDeviceName).trim() });
    }
    return result;
  };
  const merged = collect(left, leftValues);
  for (const [id, incoming] of collect(right, rightValues)) {
    const current = merged.get(id);
    if (!current || shouldPreferRelationState(incoming, current)) merged.set(id, incoming);
  }
  return Object.fromEntries([...merged.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

function mergeSameAccount(lhs, rhs, h) {
  const left = h.normalizeAccountShape(lhs);
  const right = h.normalizeAccountShape(rhs);
  const primary = asNumber(left.createdAtMs) <= asNumber(right.createdAtMs) ? left : right;
  const secondary = primary === left ? right : left;

  const siteAliasStates = mergeRelationStates(left, right, "siteAliasStates", left.sites, right.sites, (id) => asString(id).trim().toLowerCase());
  const mergedSites = h.normalizeSites(Object.entries(siteAliasStates).filter(([, state]) => !state.isDeleted).map(([id]) => id));
  const canonicalBySites = h.etldPlusOne(mergedSites[0] || "");
  const canonicalSite = canonicalBySites || primary.canonicalSite || secondary.canonicalSite || "";
  const folderMembershipStates = mergeFolderMembershipStates(left, right);
  const mergedFolderIds = h.normalizeFolderIdList(Object.entries(folderMembershipStates)
    .filter(([, state]) => !state.isDeleted)
    .map(([id]) => id));

  const usernameField = newerField(
    left.username,
    left.usernameUpdatedAtMs,
    left.usernameUpdatedDeviceName,
    left.updatedAtMs,
    right.username,
    right.usernameUpdatedAtMs,
    right.usernameUpdatedDeviceName,
    right.updatedAtMs
  );
  const passwordField = newerField(
    left.password,
    left.passwordUpdatedAtMs,
    left.passwordUpdatedDeviceName,
    left.updatedAtMs,
    right.password,
    right.passwordUpdatedAtMs,
    right.passwordUpdatedDeviceName,
    right.updatedAtMs
  );
  const totpField = newerField(
    left.totpSecret,
    left.totpUpdatedAtMs,
    left.totpUpdatedDeviceName,
    left.updatedAtMs,
    right.totpSecret,
    right.totpUpdatedAtMs,
    right.totpUpdatedDeviceName,
    right.updatedAtMs
  );
  const recoveryField = newerField(
    left.recoveryCodes,
    left.recoveryCodesUpdatedAtMs,
    left.recoveryCodesUpdatedDeviceName,
    left.updatedAtMs,
    right.recoveryCodes,
    right.recoveryCodesUpdatedAtMs,
    right.recoveryCodesUpdatedDeviceName,
    right.updatedAtMs
  );
  const noteField = newerField(
    left.note,
    left.noteUpdatedAtMs,
    left.noteUpdatedDeviceName,
    left.updatedAtMs,
    right.note,
    right.noteUpdatedAtMs,
    right.noteUpdatedDeviceName,
    right.updatedAtMs
  );

  const passkeyLinkStates = mergeRelationStates(left, right, "passkeyLinkStates", left.passkeyCredentialIds, right.passkeyCredentialIds, (id) => asString(id).trim());
  const mergedPasskeyIds = h.normalizePasskeyCredentialIds(Object.entries(passkeyLinkStates).filter(([, state]) => !state.isDeleted).map(([id]) => id));
  const passkeyUpdatedAtMs = Math.max(
    asNumber(left.passkeyUpdatedAtMs || left.updatedAtMs || left.createdAtMs),
    asNumber(right.passkeyUpdatedAtMs || right.updatedAtMs || right.createdAtMs)
  );
  const passkeyUpdatedDeviceName = asNumber(left.passkeyUpdatedAtMs || left.updatedAtMs || left.createdAtMs)
    >= asNumber(right.passkeyUpdatedAtMs || right.updatedAtMs || right.createdAtMs)
    ? asString(left.passkeyUpdatedDeviceName).trim() || asString(left.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME
    : asString(right.passkeyUpdatedDeviceName).trim() || asString(right.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;

  const latestContentUpdatedAt = Math.max(
    usernameField.updatedAtMs,
    passwordField.updatedAtMs,
    totpField.updatedAtMs,
    recoveryField.updatedAtMs,
    noteField.updatedAtMs,
    passkeyUpdatedAtMs
  );

  const leftDeletedAt = left.isDeleted ? asNumber(left.deletedAtMs) : 0;
  const rightDeletedAt = right.isDeleted ? asNumber(right.deletedAtMs) : 0;
  const latestDeletedAt = Math.max(leftDeletedAt, rightDeletedAt);
  // A restore updates the record's account timestamp but clears deletedAtMs.
  // Include that timestamp so a later restore can deterministically beat an
  // older deletion tombstone.
  const latestActivityAt = Math.max(latestContentUpdatedAt, left.updatedAtMs, right.updatedAtMs);
  const keepDeleted = latestDeletedAt > 0 && latestDeletedAt >= latestActivityAt;
  const keepPermanentlyDeleted = Boolean(left.isPermanentlyDeleted || right.isPermanentlyDeleted);
  const deletedDeviceName = leftDeletedAt >= rightDeletedAt
    ? asString(left.deletedDeviceName).trim()
    : asString(right.deletedDeviceName).trim();

  const leftUpdatedAt = asNumber(left.updatedAtMs);
  const rightUpdatedAt = asNumber(right.updatedAtMs);
  const newerAccount = leftUpdatedAt >= rightUpdatedAt ? left : right;
  const olderAccount = newerAccount === left ? right : left;

  const createdAtMs = Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs));
  const updatedAtMs = Math.max(
    leftUpdatedAt,
    rightUpdatedAt,
    latestContentUpdatedAt,
    latestDeletedAt,
    createdAtMs
  );

  const usernameAtCreate = asString(primary.usernameAtCreate).trim()
    || asString(secondary.usernameAtCreate).trim()
    || asString(primary.username).trim()
    || asString(secondary.username).trim();
  const createdDeviceName = asString(primary.createdDeviceName).trim()
    || asString(secondary.createdDeviceName).trim()
    || asString(primary.lastOperatedDeviceName).trim()
    || asString(secondary.lastOperatedDeviceName).trim()
    || DEFAULT_DEVICE_NAME;
  const lastOperatedDeviceName = asString(newerAccount.lastOperatedDeviceName).trim()
    || asString(olderAccount.lastOperatedDeviceName).trim()
    || DEFAULT_DEVICE_NAME;

  return {
    recordId:
      primary.recordId
      || left.recordId
      || right.recordId
      || h.stableUuidFromText(`${primary.accountId}|${createdAtMs}`),
    accountId: primary.accountId,
    canonicalSite,
    usernameAtCreate,
    isPinned: Boolean(newerAccount.isPinned),
    pinnedSortOrder: newerAccount.pinnedSortOrder == null ? null : asNumber(newerAccount.pinnedSortOrder),
    regularSortOrder: newerAccount.regularSortOrder == null ? null : asNumber(newerAccount.regularSortOrder),
    // Pinned state is UI metadata, but it is still synchronized account state.
    // Keep the newest complete map instead of accidentally dropping it during
    // a field merge; the native client follows the same last-writer rule.
    pinnedViews: newerAccount.pinnedViews || olderAccount.pinnedViews || null,
    folderId: mergedFolderIds[0] || (newerAccount.folderId == null ? null : h.normalizeFolderId(newerAccount.folderId)),
    folderIds: mergedFolderIds,
    folderMembershipStates,
    // Empty is intentional: every site may be tombstoned. Never revive primary.sites.
    sites: mergedSites,
    siteAliasStates,
    username: usernameField.value,
    password: passwordField.value,
    totpSecret: totpField.value,
    recoveryCodes: recoveryField.value,
    note: noteField.value,
    passkeyCredentialIds: mergedPasskeyIds,
    passkeyLinkStates,
    usernameUpdatedAtMs: usernameField.updatedAtMs,
    usernameUpdatedDeviceName: usernameField.deviceName,
    passwordUpdatedAtMs: passwordField.updatedAtMs,
    passwordUpdatedDeviceName: passwordField.deviceName,
    totpUpdatedAtMs: totpField.updatedAtMs,
    totpUpdatedDeviceName: totpField.deviceName,
    recoveryCodesUpdatedAtMs: recoveryField.updatedAtMs,
    recoveryCodesUpdatedDeviceName: recoveryField.deviceName,
    noteUpdatedAtMs: noteField.updatedAtMs,
    noteUpdatedDeviceName: noteField.deviceName,
    passkeyUpdatedAtMs,
    passkeyUpdatedDeviceName,
    isDeleted: keepPermanentlyDeleted || keepDeleted,
    isPermanentlyDeleted: keepPermanentlyDeleted,
    deletedAtMs: keepPermanentlyDeleted || keepDeleted ? latestDeletedAt || updatedAtMs : null,
    deletedDeviceName: keepPermanentlyDeleted || keepDeleted ? (deletedDeviceName || lastOperatedDeviceName) : "",
    createdAtMs,
    updatedAtMs,
    lastOperatedDeviceName,
    createdDeviceName,
  };
}

function mergeSamePasskey(lhs, rhs, h) {
  const left = h.normalizePasskeyShape(lhs);
  const right = h.normalizePasskeyShape(rhs);
  const leftUpdated = asNumber(left.updatedAtMs || left.createdAtMs);
  const rightUpdated = asNumber(right.updatedAtMs || right.createdAtMs);
  const leftDeletedAt = left.isDeleted ? asNumber(left.deletedAtMs) : 0;
  const rightDeletedAt = right.isDeleted ? asNumber(right.deletedAtMs) : 0;
  const latestDeletedAt = Math.max(leftDeletedAt, rightDeletedAt);
  const keepPermanentlyDeleted = Boolean(left.isPermanentlyDeleted || right.isPermanentlyDeleted);
  const keepDeleted = keepPermanentlyDeleted || (latestDeletedAt > 0 && latestDeletedAt >= Math.max(leftUpdated, rightUpdated));
  const deletedDeviceName = leftDeletedAt >= rightDeletedAt
    ? asString(left.deletedDeviceName).trim()
    : asString(right.deletedDeviceName).trim();
  const newer = leftUpdated >= rightUpdated ? left : right;
  const older = newer === left ? right : left;
  const resolvedAlg = asNumber(newer.alg || older.alg || -7);

  return {
    credentialIdB64u: newer.credentialIdB64u || older.credentialIdB64u,
    rpId: newer.rpId || older.rpId,
    userName: newer.userName || older.userName,
    displayName: newer.displayName || older.displayName,
    userHandleB64u: newer.userHandleB64u || older.userHandleB64u,
    alg: asNumber(newer.alg || older.alg || -7),
    signCount: Math.max(asNumber(left.signCount), asNumber(right.signCount)),
    privateJwk: newer.privateJwk || older.privateJwk || null,
    publicJwk: newer.publicJwk || older.publicJwk || null,
    createdAtMs: Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs)),
    updatedAtMs: Math.max(leftUpdated, rightUpdated),
    lastUsedAtMs: Math.max(asNumber(left.lastUsedAtMs), asNumber(right.lastUsedAtMs)) || null,
    mode: newer.mode || older.mode || "managed",
    createCompatMethod: h.normalizePasskeyCreateCompatMethod(
      newer.createCompatMethod || older.createCompatMethod,
      resolvedAlg
    ),
    isDeleted: keepDeleted,
    isPermanentlyDeleted: keepPermanentlyDeleted,
    deletedAtMs: keepDeleted ? (latestDeletedAt || Math.max(leftUpdated, rightUpdated)) : null,
    deletedDeviceName: keepDeleted ? (deletedDeviceName || DEFAULT_DEVICE_NAME) : "",
  };
}

function mergeSameFolder(lhs, rhs, h) {
  const left = h.normalizeFolderShape(lhs);
  const right = h.normalizeFolderShape(rhs);
  const id = h.normalizeFolderId(left.id || right.id);
  const leftUpdatedAt = asNumber(left.updatedAtMs || left.createdAtMs);
  const rightUpdatedAt = asNumber(right.updatedAtMs || right.createdAtMs);
  const leftDeletedAt = left.isDeleted ? asNumber(left.deletedAtMs) : 0;
  const rightDeletedAt = right.isDeleted ? asNumber(right.deletedAtMs) : 0;
  const latestDeletedAt = Math.max(leftDeletedAt, rightDeletedAt);
  const keepPermanentlyDeleted = Boolean(left.isPermanentlyDeleted || right.isPermanentlyDeleted);
  const keepDeleted = keepPermanentlyDeleted || (latestDeletedAt > 0 && latestDeletedAt >= Math.max(leftUpdatedAt, rightUpdatedAt));
  const deletedDeviceName = leftDeletedAt >= rightDeletedAt
    ? asString(left.deletedDeviceName).trim()
    : asString(right.deletedDeviceName).trim();
  const orderFromRight = preferRemoteOrder(
    left.regularOrderUpdatedAtMs,
    left.regularOrderUpdatedDeviceName,
    right.regularOrderUpdatedAtMs,
    right.regularOrderUpdatedDeviceName,
  );
  const orderSource = orderFromRight ? right : left;
  const regularOrderFields = {
    regularAccountIds: Array.isArray(orderSource.regularAccountIds)
      ? [...orderSource.regularAccountIds]
      : [],
    regularOrderUpdatedAtMs: asNumber(orderSource.regularOrderUpdatedAtMs),
    regularOrderUpdatedDeviceName: asString(orderSource.regularOrderUpdatedDeviceName).trim(),
  };
  if (id === h.fixedNewAccountFolderId) {
    return {
      id,
      name: h.fixedNewAccountFolderName,
      ...regularOrderFields,
      matchedSites: rightUpdatedAt >= leftUpdatedAt ? right.matchedSites || [] : left.matchedSites || [],
      autoAddMatchingSites: rightUpdatedAt >= leftUpdatedAt ? Boolean(right.autoAddMatchingSites) : Boolean(left.autoAddMatchingSites),
      isDeleted: false,
      isPermanentlyDeleted: false,
      deletedAtMs: null,
      deletedDeviceName: "",
      createdAtMs: Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs)),
      updatedAtMs: Math.max(leftUpdatedAt, rightUpdatedAt),
    };
  }

  const leftName = asString(left.name).trim();
  const rightName = asString(right.name).trim();
  let name = leftName || rightName || `未命名文件夹 ${id.slice(0, 8)}`;
  if (rightUpdatedAt > leftUpdatedAt && rightName) {
    name = rightName;
  } else if (leftUpdatedAt > rightUpdatedAt && leftName) {
    name = leftName;
  }

  return {
    id,
    name,
    ...regularOrderFields,
    matchedSites: rightUpdatedAt > leftUpdatedAt ? right.matchedSites || [] : left.matchedSites || [],
    autoAddMatchingSites: rightUpdatedAt > leftUpdatedAt ? Boolean(right.autoAddMatchingSites) : Boolean(left.autoAddMatchingSites),
    isDeleted: keepDeleted,
    isPermanentlyDeleted: keepPermanentlyDeleted,
    deletedAtMs: keepDeleted ? (latestDeletedAt || Math.max(leftUpdatedAt, rightUpdatedAt)) : null,
    deletedDeviceName: keepDeleted ? (deletedDeviceName || DEFAULT_DEVICE_NAME) : "",
    createdAtMs: Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs)),
    updatedAtMs: Math.max(leftUpdatedAt, rightUpdatedAt),
  };
}

export function mergeAccountCollections(local, remote, helpers) {
  const h = resolveHelpers(helpers);
  const merged = [];

  for (const account of [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]) {
    const normalized = h.normalizeAccountShape(account);
    const accountId = asString(normalized.accountId).trim();
    const recordId = asString(normalized.recordId || normalized.id).trim().toLowerCase();
    if (!accountId && !recordId) continue;
    const existingIndex = merged.findIndex((candidate) => {
      const candidateAccountId = asString(candidate.accountId).trim();
      const candidateRecordId = asString(candidate.recordId || candidate.id).trim().toLowerCase();
      return (accountId && candidateAccountId === accountId) || (recordId && candidateRecordId === recordId);
    });
    if (existingIndex >= 0) {
      merged[existingIndex] = mergeSameAccount(merged[existingIndex], normalized, h);
    } else {
      merged.push(normalized);
    }
  }

  return merged.filter(Boolean);
}

export function mergePasskeyCollections(local, remote, helpers) {
  const h = resolveHelpers(helpers);
  const mergedById = new Map();
  const source = [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])];

  for (const passkey of source) {
    const normalized = h.normalizePasskeyShape(passkey);
    const id = asString(normalized.credentialIdB64u).trim();
    if (!id) continue;
    if (mergedById.has(id)) {
      mergedById.set(id, mergeSamePasskey(mergedById.get(id), normalized, h));
    } else {
      mergedById.set(id, normalized);
    }
  }

  return Array.from(mergedById.values()).sort((a, b) => {
    const left = asNumber(a?.updatedAtMs || a?.createdAtMs);
    const right = asNumber(b?.updatedAtMs || b?.createdAtMs);
    if (left !== right) return right - left;
    const leftId = asString(a?.credentialIdB64u);
    const rightId = asString(b?.credentialIdB64u);
    if (leftId < rightId) return -1;
    if (leftId > rightId) return 1;
    return 0;
  });
}

export function mergeFolderCollections(local, remote, helpers) {
  const h = resolveHelpers(helpers);
  const merged = new Map();
  const source = [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])];
  for (const folder of source) {
    const normalized = h.normalizeFolderShape(folder);
    const id = h.normalizeFolderId(normalized.id);
    if (!id) continue;
    if (merged.has(id)) {
      merged.set(id, mergeSameFolder(merged.get(id), normalized, h));
    } else {
      merged.set(id, normalized);
    }
  }

  const existingFixed = merged.get(h.fixedNewAccountFolderId);
  if (!existingFixed) {
    merged.set(
      h.fixedNewAccountFolderId,
      h.normalizeFolderShape({
        id: h.fixedNewAccountFolderId,
        name: h.fixedNewAccountFolderName,
        createdAtMs: 0,
      })
    );
  } else {
    merged.set(
      h.fixedNewAccountFolderId,
      {
        ...existingFixed,
        id: h.fixedNewAccountFolderId,
        name: h.fixedNewAccountFolderName,
      }
    );
  }

  return h.sortFoldersForDisplay(Array.from(merged.values()));
}

function preferRemoteOrder(localUpdatedAtMs, localDeviceName, remoteUpdatedAtMs, remoteDeviceName) {
  return asNumber(remoteUpdatedAtMs) > asNumber(localUpdatedAtMs)
    || (asNumber(remoteUpdatedAtMs) === asNumber(localUpdatedAtMs)
      && stableTieValue(remoteDeviceName) > stableTieValue(localDeviceName));
}

function mergeOrderIds(local, remote, localUpdatedAtMs, localDeviceName, remoteUpdatedAtMs, remoteDeviceName) {
  const remoteWins = preferRemoteOrder(
    localUpdatedAtMs,
    localDeviceName,
    remoteUpdatedAtMs,
    remoteDeviceName,
  );
  const winner = remoteWins ? remote : local;
  const loser = remoteWins ? local : remote;
  const seen = new Set();
  return [...(Array.isArray(winner) ? winner : []), ...(Array.isArray(loser) ? loser : [])]
    .map((id) => asString(id).trim().toLowerCase())
    .filter((id) => id && !seen.has(id) && seen.add(id));
}

function normalizeRegularOrder(savedIds, accounts, folderId, helpers) {
  const normalizedFolderId = folderId == null ? null : helpers.normalizeFolderId(folderId);
  const eligible = (account) => {
    if (account?.isDeleted || account?.isPermanentlyDeleted) return false;
    if (normalizedFolderId == null) return true;
    return helpers.extractAccountFolderIds(account)
      .some((id) => helpers.normalizeFolderId(id) === normalizedFolderId);
  };
  const valid = new Map();
  for (const account of accounts) {
    const id = asString(account?.recordId || account?.id).trim().toLowerCase();
    if (id && eligible(account)) valid.set(id, account);
  }
  const result = [];
  const seen = new Set();
  for (const rawId of Array.isArray(savedIds) ? savedIds : []) {
    const id = asString(rawId).trim().toLowerCase();
    if (id && valid.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  const missing = [...valid.entries()]
    .filter(([id]) => !seen.has(id))
    .sort(([, left], [, right]) => (
      asNumber(left?.regularSortOrder) - asNumber(right?.regularSortOrder)
      || asNumber(right?.updatedAtMs) - asNumber(left?.updatedAtMs)
      || asString(left?.recordId || left?.id).localeCompare(asString(right?.recordId || right?.id))
    ));
  result.push(...missing.map(([id]) => id));
  return result;
}

export function normalizeAllRegularOrder(savedIds, accounts, helpers) {
  const h = resolveHelpers(helpers);
  return normalizeRegularOrder(savedIds, accounts, null, h);
}

export function normalizeFolderRegularOrder(savedIds, folderId, accounts, helpers) {
  const h = resolveHelpers(helpers);
  return normalizeRegularOrder(savedIds, accounts, folderId, h);
}

export function normalizeFolderRegularOrders(folders, accounts, helpers) {
  const h = resolveHelpers(helpers);
  return (Array.isArray(folders) ? folders : []).map((folder) => {
    const next = { ...folder };
    next.regularAccountIds = next.isDeleted || next.isPermanentlyDeleted
      ? []
      : normalizeRegularOrder(next.regularAccountIds, accounts, next.id, h);
    return next;
  });
}

export function applyFolderOrder(folders, savedIds, helpers) {
  const h = resolveHelpers(helpers);
  const byId = new Map((Array.isArray(folders) ? folders : [])
    .map((folder) => [h.normalizeFolderId(folder?.id), folder])
    .filter(([id]) => id));
  const order = [];
  const seen = new Set();
  const fixedId = h.fixedNewAccountFolderId;
  if (byId.get(fixedId) && !byId.get(fixedId).isDeleted && !byId.get(fixedId).isPermanentlyDeleted) {
    order.push(fixedId);
    seen.add(fixedId);
  }
  for (const rawId of Array.isArray(savedIds) ? savedIds : []) {
    const id = h.normalizeFolderId(rawId);
    const folder = byId.get(id);
    if (folder && !folder.isDeleted && !folder.isPermanentlyDeleted && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  for (const [id, folder] of byId) {
    if (!folder.isDeleted && !folder.isPermanentlyDeleted && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  const ordered = [];
  for (const id of order) {
    if (byId.has(id)) ordered.push(byId.get(id));
  }
  for (const [id, folder] of byId) {
    if (!seen.has(id)) ordered.push(folder);
  }
  return { folders: ordered, folderOrderIds: order };
}

/** Merge a complete sync payload, including all independent order scopes. */
export function mergeSyncPayloads(localInput, remoteInput, helpers) {
  const h = resolveHelpers(helpers);
  const local = localInput && typeof localInput === "object" ? localInput : {};
  const remote = remoteInput && typeof remoteInput === "object" ? remoteInput : {};
  let accounts = mergeAccountCollections(local.accounts, remote.accounts, h);
  let folders = mergeFolderCollections(local.folders, remote.folders, h);
  const passkeys = mergePasskeyCollections(local.passkeys, remote.passkeys, h);
  accounts = reconcileAccountFolders(accounts, folders, h);
  const allOrderFromRemote = preferRemoteOrder(
    local.allRegularOrderUpdatedAtMs,
    local.allRegularOrderUpdatedDeviceName,
    remote.allRegularOrderUpdatedAtMs,
    remote.allRegularOrderUpdatedDeviceName,
  );
  const folderOrderFromRemote = preferRemoteOrder(
    local.folderOrderUpdatedAtMs,
    local.folderOrderUpdatedDeviceName,
    remote.folderOrderUpdatedAtMs,
    remote.folderOrderUpdatedDeviceName,
  );
  const allRegularAccountIds = normalizeRegularOrder(
    mergeOrderIds(
      local.allRegularAccountIds,
      remote.allRegularAccountIds,
      local.allRegularOrderUpdatedAtMs,
      local.allRegularOrderUpdatedDeviceName,
      remote.allRegularOrderUpdatedAtMs,
      remote.allRegularOrderUpdatedDeviceName,
    ),
    accounts,
    null,
    h,
  );
  folders = normalizeFolderRegularOrders(folders, accounts, h);
  const folderOrderIds = mergeOrderIds(
    local.folderOrderIds,
    remote.folderOrderIds,
    local.folderOrderUpdatedAtMs,
    local.folderOrderUpdatedDeviceName,
    remote.folderOrderUpdatedAtMs,
    remote.folderOrderUpdatedDeviceName,
  );
  const folderResult = applyFolderOrder(folders, folderOrderIds, h);
  return {
    accounts,
    folders: folderResult.folders,
    passkeys,
    allRegularAccountIds,
    allRegularOrderUpdatedAtMs: allOrderFromRemote
      ? asNumber(remote.allRegularOrderUpdatedAtMs)
      : asNumber(local.allRegularOrderUpdatedAtMs),
    allRegularOrderUpdatedDeviceName: allOrderFromRemote
      ? asString(remote.allRegularOrderUpdatedDeviceName)
      : asString(local.allRegularOrderUpdatedDeviceName),
    folderOrderIds: folderResult.folderOrderIds,
    folderOrderUpdatedAtMs: folderOrderFromRemote
      ? asNumber(remote.folderOrderUpdatedAtMs)
      : asNumber(local.folderOrderUpdatedAtMs),
    folderOrderUpdatedDeviceName: folderOrderFromRemote
      ? asString(remote.folderOrderUpdatedDeviceName)
      : asString(local.folderOrderUpdatedDeviceName),
  };
}

export function reconcileAccountFolders(accounts, folders, helpers) {
  const h = resolveHelpers(helpers);
  const validIds = new Set((Array.isArray(folders) ? folders : [])
    .filter((folder) => !folder?.isDeleted)
    .map((folder) => h.normalizeFolderId(folder?.id)));
  const values = Array.isArray(accounts) ? accounts : [];
  return values.map((account) => {
    const normalized = h.normalizeAccountShape(account);
    const previousIds = h.normalizeFolderIdList(h.extractAccountFolderIds(normalized));
    const resolved = h.normalizeFolderIdList(
      previousIds.filter((id) => validIds.has(h.normalizeFolderId(id)))
    );
    const previousSet = new Set(previousIds.map((id) => h.normalizeFolderId(id)));
    const resolvedSet = new Set(resolved.map((id) => h.normalizeFolderId(id)));
    const folderMembershipStates = {
      ...(normalized.folderMembershipStates && typeof normalized.folderMembershipStates === "object"
        ? normalized.folderMembershipStates
        : {}),
    };
    const tombstoneAt = Math.max(
      asNumber(normalized.updatedAtMs),
      asNumber(normalized.createdAtMs),
      Date.now()
    );
    const deviceName = asString(normalized.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;
    // Match macOS setResolvedFolderIds: dropped memberships become durable tombstones
    // so an offline peer cannot re-add a folder that no longer exists.
    for (const id of previousSet) {
      if (!id || resolvedSet.has(id)) continue;
      const existing = folderMembershipStates[id] || {};
      folderMembershipStates[id] = {
        isDeleted: true,
        updatedAtMs: Math.max(asNumber(existing.updatedAtMs), tombstoneAt),
        deviceName: asString(existing.deviceName).trim() || deviceName,
      };
    }
    for (const id of resolvedSet) {
      if (!id) continue;
      const existing = folderMembershipStates[id];
      if (!existing || existing.isDeleted) {
        folderMembershipStates[id] = {
          isDeleted: false,
          updatedAtMs: Math.max(asNumber(existing?.updatedAtMs), tombstoneAt),
          deviceName: asString(existing?.deviceName).trim() || deviceName,
        };
      }
    }
    return {
      ...normalized,
      folderId: resolved[0] || null,
      folderIds: resolved,
      folderMembershipStates,
    };
  });
}

function identitySet(values, identityFn) {
  const result = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const identity = identityFn(value);
    if (identity) result.add(identity);
  }
  return result;
}

function missingIdentities(source, target, identityFn) {
  const sourceIds = identitySet(source, identityFn);
  const targetIds = identitySet(target, identityFn);
  return Array.from(sourceIds).filter((identity) => !targetIds.has(identity));
}

export function summarizeSyncPayload(payload, helpers) {
  const h = resolveHelpers(helpers);
  const accounts = Array.isArray(payload?.accounts)
    ? payload.accounts.map(h.normalizeAccountShape)
    : [];
  const folders = Array.isArray(payload?.folders)
    ? payload.folders.map(h.normalizeFolderShape)
    : [];
  const passkeys = Array.isArray(payload?.passkeys)
    ? payload.passkeys.map(h.normalizePasskeyShape)
    : [];
  return {
    accounts: accounts.filter((item) => !item?.isPermanentlyDeleted).length,
    activeAccounts: accounts.filter((item) => !item?.isDeleted).length,
    deletedAccounts: accounts.filter((item) => Boolean(item?.isDeleted)).length,
    folders: folders.filter((item) => !item?.isPermanentlyDeleted).length,
    passkeys: passkeys.filter((item) => !item?.isPermanentlyDeleted).length,
    accountIds: identitySet(accounts, (item) => asString(item?.recordId || item?.id || item?.accountId).trim().toLowerCase()),
    folderIds: identitySet(folders, (item) => h.normalizeFolderId(item?.id)),
    passkeyIds: identitySet(passkeys, (item) => asString(item?.credentialIdB64u || item?.id).trim()),
  };
}

/**
 * Validate a merged payload before it is written locally or uploaded.
 * This is intentionally conservative: a normal merge must never lose an
 * entity that was already present locally. Remote-overwrite is allowed only
 * when the caller explicitly opts into that mode and the remote is non-empty.
 */
export function evaluateSyncSafety({ local, remote, merged, mode = "merge" }, helpers) {
  const localSummary = summarizeSyncPayload(local, helpers);
  const remoteSummary = remote == null ? null : summarizeSyncPayload(remote, helpers);
  const mergedSummary = summarizeSyncPayload(merged, helpers);
  const reasons = [];
  const localNonEmpty = localSummary.accounts + localSummary.folders + localSummary.passkeys > 0;
  const remoteNonEmpty = Boolean(remoteSummary) && (
    remoteSummary.accounts + remoteSummary.folders + remoteSummary.passkeys > 0
  );

  if (mode === "merge") {
    if (localNonEmpty && remoteSummary && !remoteNonEmpty) {
      reasons.push("REMOTE_EMPTY_FOR_NON_EMPTY_LOCAL");
    }
    const missingAccounts = missingIdentities(
      local?.accounts,
      merged?.accounts,
      (item) => asString(item?.recordId || item?.id || item?.accountId).trim().toLowerCase()
    );
    const missingFolders = missingIdentities(
      local?.folders,
      merged?.folders,
      (item) => asString(item?.id).trim().toLowerCase()
    );
    const missingPasskeys = missingIdentities(
      local?.passkeys,
      merged?.passkeys,
      (item) => asString(item?.credentialIdB64u || item?.id).trim()
    );
    if (missingAccounts.length > 0) reasons.push("LOCAL_ACCOUNTS_DROPPED");
    if (missingFolders.length > 0) reasons.push("LOCAL_FOLDERS_DROPPED");
    if (missingPasskeys.length > 0) reasons.push("LOCAL_PASSKEYS_DROPPED");
    const missingRemoteAccounts = missingIdentities(
      remote?.accounts,
      merged?.accounts,
      (item) => asString(item?.recordId || item?.id || item?.accountId).trim().toLowerCase()
    );
    const missingRemoteFolders = missingIdentities(
      remote?.folders,
      merged?.folders,
      (item) => asString(item?.id).trim().toLowerCase()
    );
    const missingRemotePasskeys = missingIdentities(
      remote?.passkeys,
      merged?.passkeys,
      (item) => asString(item?.credentialIdB64u || item?.id).trim()
    );
    if (missingRemoteAccounts.length > 0) reasons.push("REMOTE_ACCOUNTS_DROPPED");
    if (missingRemoteFolders.length > 0) reasons.push("REMOTE_FOLDERS_DROPPED");
    if (missingRemotePasskeys.length > 0) reasons.push("REMOTE_PASSKEYS_DROPPED");
    return {
      safe: reasons.length === 0,
      reasons,
      local: { ...localSummary, accountIds: undefined, folderIds: undefined, passkeyIds: undefined },
      remote: remoteSummary
        ? { ...remoteSummary, accountIds: undefined, folderIds: undefined, passkeyIds: undefined }
        : null,
      merged: { ...mergedSummary, accountIds: undefined, folderIds: undefined, passkeyIds: undefined },
    };
  }

  if (mode === "remoteOverwriteLocal") {
    if (!remoteNonEmpty && localNonEmpty) reasons.push("REMOTE_EMPTY_FOR_NON_EMPTY_LOCAL");
    return {
      safe: reasons.length === 0,
      reasons,
      local: { ...localSummary, accountIds: undefined, folderIds: undefined, passkeyIds: undefined },
      remote: remoteSummary
        ? { ...remoteSummary, accountIds: undefined, folderIds: undefined, passkeyIds: undefined }
        : null,
      merged: { ...mergedSummary, accountIds: undefined, folderIds: undefined, passkeyIds: undefined },
    };
  }

  return {
    safe: true,
    reasons,
    local: { ...localSummary, accountIds: undefined, folderIds: undefined, passkeyIds: undefined },
    remote: remoteSummary
      ? { ...remoteSummary, accountIds: undefined, folderIds: undefined, passkeyIds: undefined }
      : null,
    merged: { ...mergedSummary, accountIds: undefined, folderIds: undefined, passkeyIds: undefined },
  };
}
