function asNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value) {
  return String(value || "");
}

function stableTieValue(value) {
  return asString(value).trim().toLocaleLowerCase();
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
      deviceName: asString(lhsDeviceName).trim() || asString(rhsDeviceName).trim() || "ChromeMac",
    };
  }

  const leftAccountUpdated = asNumber(lhsAccountUpdatedAt);
  const rightAccountUpdated = asNumber(rhsAccountUpdatedAt);
  if (leftAccountUpdated > rightAccountUpdated) {
    return { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) };
  }
  if (rightAccountUpdated > leftAccountUpdated) {
    return { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
  }

  if (!leftValue && rightValue) {
    return { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
  }
  const leftDevice = stableTieValue(lhsDeviceName);
  const rightDevice = stableTieValue(rhsDeviceName);
  if (leftDevice !== rightDevice) {
    return leftDevice > rightDevice
      ? { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) }
      : { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
  }
  return leftValue.localeCompare(rightValue) >= 0
    ? { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) }
    : { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
}

function mergeSameAccount(lhs, rhs, h) {
  const left = h.normalizeAccountShape(lhs);
  const right = h.normalizeAccountShape(rhs);
  const primary = asNumber(left.createdAtMs) <= asNumber(right.createdAtMs) ? left : right;
  const secondary = primary === left ? right : left;

  const mergedSites = h.normalizeSites([...(left.sites || []), ...(right.sites || [])]);
  const canonicalBySites = h.etldPlusOne(mergedSites[0] || "");
  const canonicalSite = canonicalBySites || primary.canonicalSite || secondary.canonicalSite || "";
  const mergedFolderIds = h.normalizeFolderIdList([
    ...h.extractAccountFolderIds(left),
    ...h.extractAccountFolderIds(right),
  ]);

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

  const leftPasskeyIds = h.normalizePasskeyCredentialIds(left.passkeyCredentialIds || []);
  const rightPasskeyIds = h.normalizePasskeyCredentialIds(right.passkeyCredentialIds || []);
  const mergedPasskeyIds = h.normalizePasskeyCredentialIds([...leftPasskeyIds, ...rightPasskeyIds]);
  const passkeyUpdatedAtMs = Math.max(
    asNumber(left.passkeyUpdatedAtMs || left.updatedAtMs || left.createdAtMs),
    asNumber(right.passkeyUpdatedAtMs || right.updatedAtMs || right.createdAtMs)
  );
  const passkeyUpdatedDeviceName = asNumber(left.passkeyUpdatedAtMs || left.updatedAtMs || left.createdAtMs)
    >= asNumber(right.passkeyUpdatedAtMs || right.updatedAtMs || right.createdAtMs)
    ? asString(left.passkeyUpdatedDeviceName).trim() || asString(left.lastOperatedDeviceName).trim() || "ChromeMac"
    : asString(right.passkeyUpdatedDeviceName).trim() || asString(right.lastOperatedDeviceName).trim() || "ChromeMac";

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
    || "ChromeMac";
  const lastOperatedDeviceName = asString(newerAccount.lastOperatedDeviceName).trim()
    || asString(olderAccount.lastOperatedDeviceName).trim()
    || "ChromeMac";

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
    folderId: mergedFolderIds[0] || (newerAccount.folderId == null ? null : h.normalizeFolderId(newerAccount.folderId)),
    folderIds: mergedFolderIds,
    sites: mergedSites.length > 0 ? mergedSites : primary.sites,
    username: usernameField.value,
    password: passwordField.value,
    totpSecret: totpField.value,
    recoveryCodes: recoveryField.value,
    note: noteField.value,
    passkeyCredentialIds: mergedPasskeyIds,
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
  };
}

function mergeSameFolder(lhs, rhs, h) {
  const left = h.normalizeFolderShape(lhs);
  const right = h.normalizeFolderShape(rhs);
  const id = h.normalizeFolderId(left.id || right.id);
  const leftUpdatedAt = asNumber(left.updatedAtMs || left.createdAtMs);
  const rightUpdatedAt = asNumber(right.updatedAtMs || right.createdAtMs);
  if (id === h.fixedNewAccountFolderId) {
    return {
      id,
      name: h.fixedNewAccountFolderName,
      matchedSites: rightUpdatedAt >= leftUpdatedAt ? right.matchedSites || [] : left.matchedSites || [],
      autoAddMatchingSites: rightUpdatedAt >= leftUpdatedAt ? Boolean(right.autoAddMatchingSites) : Boolean(left.autoAddMatchingSites),
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
    matchedSites: rightUpdatedAt > leftUpdatedAt ? right.matchedSites || [] : left.matchedSites || [],
    autoAddMatchingSites: rightUpdatedAt > leftUpdatedAt ? Boolean(right.autoAddMatchingSites) : Boolean(left.autoAddMatchingSites),
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
    return asString(a?.credentialIdB64u).localeCompare(asString(b?.credentialIdB64u));
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

export function reconcileAccountFolders(accounts, folders, helpers) {
  const h = resolveHelpers(helpers);
  const validIds = new Set((Array.isArray(folders) ? folders : []).map((folder) => h.normalizeFolderId(folder?.id)));
  const values = Array.isArray(accounts) ? accounts : [];
  return values.map((account) => {
    const normalized = h.normalizeAccountShape(account);
    const resolved = h.normalizeFolderIdList(
      h.extractAccountFolderIds(normalized).filter((id) => validIds.has(h.normalizeFolderId(id)))
    );
    return {
      ...normalized,
      folderId: resolved[0] || null,
      folderIds: resolved,
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
    accounts: accounts.length,
    activeAccounts: accounts.filter((item) => !item?.isDeleted).length,
    deletedAccounts: accounts.filter((item) => Boolean(item?.isDeleted)).length,
    folders: folders.length,
    passkeys: passkeys.length,
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
