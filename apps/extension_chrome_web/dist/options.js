(() => {
  // ../../core/pass_core/js/sync_policy.js
  var DEFAULT_DEVICE_NAME = "PassDevice";
  var FIXED_NEW_ACCOUNT_FOLDER_ID = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";
  var FIXED_NEW_ACCOUNT_FOLDER_NAME = "\u65B0\u8D26\u53F7";
  var ETLD2_SUFFIXES = [
    "com.cn",
    "net.cn",
    "org.cn",
    "gov.cn",
    "edu.cn",
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "com.au",
    "net.au",
    "org.au",
    "com.br",
    "com.mx",
    "co.jp",
    "or.jp",
    "ne.jp",
    "co.kr",
    "co.in",
    "com.hk",
    "com.tw",
    "com.sg",
    "co.nz",
    "org.nz",
    "com.ar",
    "com.tr",
    "co.za",
    "com.ua"
  ];
  var SYNC_OUTBOX_MAX_ATTEMPTS = 12;
  var SYNC_OUTBOX_BASE_DELAY_MS = 5e3;
  var SYNC_OUTBOX_MAX_DELAY_MS = 60 * 60 * 1e3;
  var SYNC_PUSH_CONFLICT_MAX_ATTEMPTS = 5;
  function syncOutboxRetryDelayMs(attempts) {
    const exponent = Math.max(0, Math.min(Number(attempts || 1) - 1, 8));
    return Math.min(SYNC_OUTBOX_MAX_DELAY_MS, SYNC_OUTBOX_BASE_DELAY_MS * 2 ** exponent);
  }
  function normalizeDeviceName(value, fallback = DEFAULT_DEVICE_NAME) {
    const trimmed = String(value || "").trim();
    return trimmed || fallback;
  }

  // ../../core/pass_core/js/sync_alias_core.js
  function syncAliasGroups(accounts, helpers, options = {}) {
    if (!Array.isArray(accounts) || accounts.length < 2) {
      return { accounts, changed: false };
    }
    const normalize = helpers?.normalizeDomain || ((s) => String(s || "").trim().toLowerCase());
    const etldPlusOne2 = helpers?.etldPlusOne || ((s) => {
      const n2 = normalize(s);
      const parts = n2.split(".").filter(Boolean);
      if (parts.length < 2) return n2;
      return parts.slice(-2).join(".");
    });
    const domainAliasGroupKey2 = typeof helpers?.domainAliasGroupKey === "function" ? helpers.domainAliasGroupKey : () => "";
    const nowMs = options.nowMs ?? Date.now();
    const deviceName = options.deviceName || "Browser";
    const n = accounts.length;
    const siteSets = accounts.map((a) => {
      const sites = Array.isArray(a?.sites) ? a.sites : [];
      return new Set(sites.map(normalize).filter(Boolean));
    });
    const etldSets = siteSets.map((set) => {
      const out = /* @__PURE__ */ new Set();
      for (const s of set) {
        const e = etldPlusOne2(s);
        if (e) out.add(e);
      }
      return out;
    });
    const aliasGroupSets = siteSets.map((set) => {
      const out = /* @__PURE__ */ new Set();
      for (const site of set) {
        const group = domainAliasGroupKey2(site);
        if (group) out.add(group);
      }
      return out;
    });
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i) => {
      let cur = i;
      while (parent[cur] !== cur) cur = parent[cur];
      let c2 = i;
      while (parent[c2] !== c2) {
        const next2 = parent[c2];
        parent[c2] = cur;
        c2 = next2;
      }
      return cur;
    };
    const union = (a, b) => {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent[pb] = pa;
    };
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let overlap = false;
        for (const s of siteSets[i]) {
          if (siteSets[j].has(s)) {
            overlap = true;
            break;
          }
        }
        let sameEtld = false;
        for (const e of etldSets[i]) {
          if (etldSets[j].has(e)) {
            sameEtld = true;
            break;
          }
        }
        const sameAliasGroup = [...aliasGroupSets[i]].some((group) => aliasGroupSets[j].has(group));
        if (overlap || sameEtld || sameAliasGroup) union(i, j);
      }
    }
    const components = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) components[find(i)].push(i);
    let changed = false;
    const next = accounts.map((a) => ({ ...a }));
    for (const component of components) {
      if (component.length < 2) continue;
      const merged = [];
      const seen = /* @__PURE__ */ new Set();
      for (const idx of component) {
        for (const s of siteSets[idx]) {
          if (!seen.has(s)) {
            seen.add(s);
            merged.push(s);
          }
        }
      }
      merged.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      for (const idx of component) {
        const prev = Array.isArray(next[idx].sites) ? [...new Set(next[idx].sites.map(normalize).filter(Boolean))].sort(
          (a, b) => a < b ? -1 : a > b ? 1 : 0
        ) : [];
        const same = prev.length === merged.length && prev.every((v, i) => v === merged[i]);
        if (!same) {
          next[idx] = {
            ...next[idx],
            sites: merged.slice(),
            updatedAtMs: nowMs,
            lastOperatedDeviceName: deviceName
          };
          changed = true;
        } else if (Array.isArray(next[idx].sites) && next[idx].sites.join("\0") !== merged.join("\0")) {
          next[idx] = {
            ...next[idx],
            sites: merged.slice()
          };
          changed = true;
        }
      }
    }
    return { accounts: next, changed };
  }

  // account_core.js
  var ETLD2_SUFFIXES2 = new Set(ETLD2_SUFFIXES);
  var DOMAIN_ALIAS_GROUPS = Object.freeze([
    Object.freeze({
      id: "apple",
      domains: Object.freeze(["apple.com", "apple.com.cn", "icloud.com", "icloud.com.cn"])
    }),
    Object.freeze({
      id: "qq",
      domains: Object.freeze(["qq.com", "wx.qq.com"])
    }),
    Object.freeze({
      id: "baidu",
      domains: Object.freeze(["baidu.com", "passport.baidu.com", "pan.baidu.com"])
    }),
    Object.freeze({
      id: "sina",
      domains: Object.freeze(["sina.com", "mail.sina.com", "weibo.com"])
    }),
    Object.freeze({
      id: "github",
      domains: Object.freeze(["github.com", "gist.github.com"])
    }),
    Object.freeze({
      id: "gitlab",
      domains: Object.freeze(["gitlab.com", "about.gitlab.com"])
    }),
    Object.freeze({
      id: "google",
      domains: Object.freeze(["google.com", "accounts.google.com"])
    }),
    Object.freeze({
      id: "youtube",
      domains: Object.freeze(["youtube.com", "studio.youtube.com"])
    }),
    Object.freeze({
      id: "x",
      domains: Object.freeze(["x.com", "twitter.com"])
    }),
    Object.freeze({
      id: "facebook",
      domains: Object.freeze(["facebook.com", "messenger.com"])
    }),
    Object.freeze({
      id: "amazon",
      domains: Object.freeze(["amazon.com", "smile.amazon.com"])
    }),
    Object.freeze({
      id: "microsoft",
      domains: Object.freeze([
        "microsoft.com",
        "microsoftonline.com",
        // Keep the common shorthand used by older records linked to the same
        // Microsoft sign-in provider as the fully qualified host names.
        "microsoftonline",
        "login.microsoftonline.com",
        "login.microsoft.com",
        "account.microsoft.com",
        "live.com",
        "hotmail.com",
        "outlook.com",
        "account.live.com",
        "office.com",
        "outlook.office.com",
        "microsoft365.com",
        "office365.com",
        "azure.com",
        "msn.com"
      ])
    }),
    Object.freeze({
      id: "paypal",
      domains: Object.freeze(["paypal.com"])
    }),
    Object.freeze({
      id: "netflix",
      domains: Object.freeze(["netflix.com", "help.netflix.com"])
    }),
    Object.freeze({
      id: "spotify",
      domains: Object.freeze(["spotify.com", "open.spotify.com"])
    }),
    Object.freeze({
      id: "linkedin",
      domains: Object.freeze(["linkedin.com"])
    }),
    Object.freeze({
      id: "dropbox",
      domains: Object.freeze(["dropbox.com"])
    })
  ]);
  function normalizeDomain(input) {
    if (!input) return "";
    let value = String(input).trim().toLowerCase();
    try {
      if (value.startsWith("http://") || value.startsWith("https://")) {
        value = new URL(value).hostname;
      }
    } catch {
      return "";
    }
    while (value.endsWith(".")) {
      value = value.slice(0, -1);
    }
    return value;
  }
  function isIpHost(domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return false;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
      return normalized.split(".").every((part) => {
        const value = Number(part);
        return Number.isInteger(value) && value >= 0 && value <= 255;
      });
    }
    if (normalized.includes(":")) {
      return /^[0-9a-f:]+$/i.test(normalized);
    }
    return false;
  }
  function etldPlusOne(domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return "";
    if (isIpHost(normalized)) return normalized;
    const labels = normalized.split(".");
    if (labels.length < 2) return normalized;
    const tail2 = labels.slice(-2).join(".");
    if (ETLD2_SUFFIXES2.has(tail2) && labels.length >= 3) {
      return labels.slice(-3).join(".");
    }
    return tail2;
  }
  function domainAliasGroupKey(domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return "";
    for (const group of DOMAIN_ALIAS_GROUPS) {
      const matched = group.domains.some(
        (alias) => normalized === alias || normalized.endsWith(`.${alias}`)
      );
      if (matched) return group.id;
    }
    return "";
  }
  function domainsMatch(left, right) {
    const normalizedLeft = normalizeDomain(left);
    const normalizedRight = normalizeDomain(right);
    if (!normalizedLeft || !normalizedRight) return false;
    if (normalizedLeft === normalizedRight) return true;
    if (etldPlusOne(normalizedLeft) === etldPlusOne(normalizedRight)) return true;
    const leftGroup = domainAliasGroupKey(normalizedLeft);
    return Boolean(leftGroup && leftGroup === domainAliasGroupKey(normalizedRight));
  }
  function normalizeSites(sites) {
    const values = Array.isArray(sites) ? sites : [];
    return [...new Set(values.map(normalizeDomain).filter(Boolean))].sort();
  }
  function normalizeUsername(value) {
    return String(value || "").trim();
  }
  function formatYYMMDDHHmmss(ms) {
    const date = new Date(ms);
    const yy = String(date.getUTCFullYear() % 100).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");
    const minute = String(date.getUTCMinutes()).padStart(2, "0");
    const second = String(date.getUTCSeconds()).padStart(2, "0");
    return `${yy}${month}${day}${hour}${minute}${second}`;
  }
  function buildAccountId(canonicalSite, username, createdAtMs) {
    return `${canonicalSite}-${formatYYMMDDHHmmss(createdAtMs)}-${username}`;
  }
  function syncAliasGroups2(inputAccounts, options = {}) {
    const helpers = {
      domainAliasGroupKey,
      normalizeDomain,
      etldPlusOne
    };
    const result = syncAliasGroups(inputAccounts, helpers, {
      nowMs: options.nowMs,
      deviceName: options.deviceName || "Browser"
    });
    return result.accounts;
  }

  // ../../core/pass_core/js/sync_merge_core.js
  function asNumber(value) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function asString(value) {
    return String(value || "");
  }
  function stableTieValue(value) {
    return asString(value).trim().toLowerCase();
  }
  function accountSourceTieKey(account) {
    return [
      stableTieValue(account?.createdDeviceName),
      stableTieValue(account?.lastOperatedDeviceName),
      stableTieValue(account?.accountId),
      stableTieValue(account?.canonicalSite),
      stableTieValue(account?.usernameAtCreate),
      stableTieValue(account?.recordId || account?.id)
    ].join("\0");
  }
  function preferAccountSource(left, right) {
    return accountSourceTieKey(left) >= accountSourceTieKey(right) ? left : right;
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
      fixedNewAccountFolderName: asString(helpers?.fixedNewAccountFolderName).trim() || "\u65B0\u8D26\u53F7"
    };
  }
  function newerField(lhsValue, lhsUpdatedAt, lhsDeviceName, lhsAccountUpdatedAt, rhsValue, rhsUpdatedAt, rhsDeviceName, rhsAccountUpdatedAt) {
    const leftUpdated = asNumber(lhsUpdatedAt);
    const rightUpdated = asNumber(rhsUpdatedAt);
    if (leftUpdated > rightUpdated) return { value: asString(lhsValue), updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) };
    if (rightUpdated > leftUpdated) return { value: asString(rhsValue), updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
    const leftValue = asString(lhsValue);
    const rightValue = asString(rhsValue);
    if (leftValue === rightValue) {
      const leftDevice2 = stableTieValue(lhsDeviceName);
      const rightDevice2 = stableTieValue(rhsDeviceName);
      const deviceName = leftDevice2 >= rightDevice2 ? asString(lhsDeviceName).trim() : asString(rhsDeviceName).trim();
      return {
        value: leftValue,
        updatedAtMs: leftUpdated,
        deviceName: deviceName || DEFAULT_DEVICE_NAME
      };
    }
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
      return leftDevice > rightDevice ? { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) } : { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
    }
    return leftValue >= rightValue ? { value: leftValue, updatedAtMs: leftUpdated, deviceName: asString(lhsDeviceName) } : { value: rightValue, updatedAtMs: rightUpdated, deviceName: asString(rhsDeviceName) };
  }
  function mergeFolderMembershipStates(left, right) {
    const collect = (account) => {
      const states = account?.folderMembershipStates && typeof account.folderMembershipStates === "object" ? account.folderMembershipStates : {};
      const result = /* @__PURE__ */ new Map();
      for (const [rawId, rawState] of Object.entries(states)) {
        const id = asString(rawId).trim().toLowerCase();
        if (!id) continue;
        result.set(id, {
          isDeleted: Boolean(rawState?.isDeleted),
          updatedAtMs: asNumber(rawState?.updatedAtMs || account?.updatedAtMs || account?.createdAtMs),
          deviceName: asString(rawState?.deviceName || account?.lastOperatedDeviceName).trim()
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
      return stableTieValue(incoming.deviceName) > stableTieValue(current.deviceName);
    }
    return false;
  }
  function mergeRelationStates(left, right, stateKey, leftValues, rightValues, normalizeId) {
    const collect = (account, values) => {
      const states = account?.[stateKey] && typeof account[stateKey] === "object" ? account[stateKey] : {};
      const result = /* @__PURE__ */ new Map();
      for (const [rawId, rawState] of Object.entries(states)) {
        const id = normalizeId(rawId);
        if (!id) continue;
        result.set(id, {
          isDeleted: Boolean(rawState?.isDeleted),
          updatedAtMs: asNumber(rawState?.updatedAtMs || account?.updatedAtMs || account?.createdAtMs),
          deviceName: asString(rawState?.deviceName || account?.lastOperatedDeviceName).trim()
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
    const primary = asNumber(left.createdAtMs) < asNumber(right.createdAtMs) ? left : asNumber(right.createdAtMs) < asNumber(left.createdAtMs) ? right : preferAccountSource(left, right);
    const secondary = primary === left ? right : left;
    const siteAliasStates = mergeRelationStates(left, right, "siteAliasStates", left.sites, right.sites, (id) => asString(id).trim().toLowerCase());
    const mergedSites = h.normalizeSites(Object.entries(siteAliasStates).filter(([, state]) => !state.isDeleted).map(([id]) => id));
    const canonicalBySites = h.etldPlusOne(mergedSites[0] || "");
    const canonicalSite = canonicalBySites || primary.canonicalSite || secondary.canonicalSite || "";
    const folderMembershipStates = mergeFolderMembershipStates(left, right);
    const mergedFolderIds = h.normalizeFolderIdList(Object.entries(folderMembershipStates).filter(([, state]) => !state.isDeleted).map(([id]) => id));
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
    const leftPasskeyActivity = asNumber(left.passkeyUpdatedAtMs || left.updatedAtMs || left.createdAtMs);
    const rightPasskeyActivity = asNumber(right.passkeyUpdatedAtMs || right.updatedAtMs || right.createdAtMs);
    const passkeySource = leftPasskeyActivity > rightPasskeyActivity ? left : rightPasskeyActivity > leftPasskeyActivity ? right : preferAccountSource(left, right);
    const passkeyUpdatedDeviceName = asString(passkeySource.passkeyUpdatedDeviceName).trim() || asString(passkeySource.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;
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
    const latestActivityAt = Math.max(latestContentUpdatedAt, left.updatedAtMs, right.updatedAtMs);
    const keepDeleted = latestDeletedAt > 0 && latestDeletedAt >= latestActivityAt;
    const keepPermanentlyDeleted = Boolean(left.isPermanentlyDeleted || right.isPermanentlyDeleted);
    const deletedDeviceName = leftDeletedAt > rightDeletedAt ? asString(left.deletedDeviceName).trim() : rightDeletedAt > leftDeletedAt ? asString(right.deletedDeviceName).trim() : stableTieValue(left.deletedDeviceName) >= stableTieValue(right.deletedDeviceName) ? asString(left.deletedDeviceName).trim() : asString(right.deletedDeviceName).trim();
    const leftUpdatedAt = asNumber(left.updatedAtMs);
    const rightUpdatedAt = asNumber(right.updatedAtMs);
    const newerAccount = leftUpdatedAt > rightUpdatedAt ? left : rightUpdatedAt > leftUpdatedAt ? right : preferAccountSource(left, right);
    const olderAccount = newerAccount === left ? right : left;
    const createdAtMs = Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs));
    const updatedAtMs = Math.max(
      leftUpdatedAt,
      rightUpdatedAt,
      latestContentUpdatedAt,
      latestDeletedAt,
      createdAtMs
    );
    const usernameAtCreate = asString(primary.usernameAtCreate).trim() || asString(secondary.usernameAtCreate).trim() || asString(primary.username).trim() || asString(secondary.username).trim();
    const createdDeviceName = asString(primary.createdDeviceName).trim() || asString(secondary.createdDeviceName).trim() || asString(primary.lastOperatedDeviceName).trim() || asString(secondary.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;
    const lastOperatedDeviceName = asString(newerAccount.lastOperatedDeviceName).trim() || asString(olderAccount.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;
    return {
      recordId: primary.recordId || left.recordId || right.recordId || h.stableUuidFromText(`${primary.accountId}|${createdAtMs}`),
      accountId: primary.accountId,
      canonicalSite,
      usernameAtCreate,
      isPinned: Boolean(newerAccount.isPinned),
      pinnedSortOrder: newerAccount.pinnedSortOrder == null ? null : asNumber(newerAccount.pinnedSortOrder),
      regularSortOrder: newerAccount.regularSortOrder == null ? null : asNumber(newerAccount.regularSortOrder),
      // Pinned state is synchronized per view scope. Keep views that only exist
      // on one side, while the newer account wins when both sides edited the
      // same scope.
      pinnedViews: mergePinnedViews(
        left.pinnedViews,
        right.pinnedViews,
        newerAccount === right
      ),
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
      deletedDeviceName: keepPermanentlyDeleted || keepDeleted ? deletedDeviceName || lastOperatedDeviceName : "",
      createdAtMs,
      updatedAtMs,
      lastOperatedDeviceName,
      createdDeviceName
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
    const keepDeleted = keepPermanentlyDeleted || latestDeletedAt > 0 && latestDeletedAt >= Math.max(leftUpdated, rightUpdated);
    const deletedDeviceName = leftDeletedAt >= rightDeletedAt ? asString(left.deletedDeviceName).trim() : asString(right.deletedDeviceName).trim();
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
      deletedAtMs: keepDeleted ? latestDeletedAt || Math.max(leftUpdated, rightUpdated) : null,
      deletedDeviceName: keepDeleted ? deletedDeviceName || DEFAULT_DEVICE_NAME : ""
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
    const keepDeleted = keepPermanentlyDeleted || latestDeletedAt > 0 && latestDeletedAt >= Math.max(leftUpdatedAt, rightUpdatedAt);
    const deletedDeviceName = leftDeletedAt >= rightDeletedAt ? asString(left.deletedDeviceName).trim() : asString(right.deletedDeviceName).trim();
    const orderFromRight = preferRemoteOrder(
      left.regularOrderUpdatedAtMs,
      left.regularOrderUpdatedDeviceName,
      right.regularOrderUpdatedAtMs,
      right.regularOrderUpdatedDeviceName
    );
    const orderSource = orderFromRight ? right : left;
    const regularOrderFields = {
      regularAccountIds: Array.isArray(orderSource.regularAccountIds) ? [...orderSource.regularAccountIds] : [],
      regularOrderUpdatedAtMs: asNumber(orderSource.regularOrderUpdatedAtMs),
      regularOrderUpdatedDeviceName: asString(orderSource.regularOrderUpdatedDeviceName).trim()
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
        updatedAtMs: Math.max(leftUpdatedAt, rightUpdatedAt)
      };
    }
    const leftName = asString(left.name).trim();
    const rightName = asString(right.name).trim();
    let name = leftName || rightName || `\u672A\u547D\u540D\u6587\u4EF6\u5939 ${id.slice(0, 8)}`;
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
      deletedAtMs: keepDeleted ? latestDeletedAt || Math.max(leftUpdatedAt, rightUpdatedAt) : null,
      deletedDeviceName: keepDeleted ? deletedDeviceName || DEFAULT_DEVICE_NAME : "",
      createdAtMs: Math.min(asNumber(left.createdAtMs), asNumber(right.createdAtMs)),
      updatedAtMs: Math.max(leftUpdatedAt, rightUpdatedAt)
    };
  }
  function mergeAccountCollections(local, remote, helpers) {
    const h = resolveHelpers(helpers);
    const merged = [];
    for (const account of [...Array.isArray(local) ? local : [], ...Array.isArray(remote) ? remote : []]) {
      const normalized = h.normalizeAccountShape(account);
      const accountId = asString(normalized.accountId).trim();
      const recordId = asString(normalized.recordId || normalized.id).trim().toLowerCase();
      if (!accountId && !recordId) continue;
      const existingIndex = merged.findIndex((candidate) => {
        const candidateAccountId = asString(candidate.accountId).trim();
        const candidateRecordId = asString(candidate.recordId || candidate.id).trim().toLowerCase();
        if (recordId) return candidateRecordId === recordId;
        return !candidateRecordId && accountId && candidateAccountId === accountId;
      });
      if (existingIndex >= 0) {
        merged[existingIndex] = mergeSameAccount(merged[existingIndex], normalized, h);
      } else {
        merged.push(normalized);
      }
    }
    return merged.filter(Boolean).sort((left, right) => {
      const leftRecordId = asString(left?.recordId || left?.id).trim().toLowerCase();
      const rightRecordId = asString(right?.recordId || right?.id).trim().toLowerCase();
      if (leftRecordId < rightRecordId) return -1;
      if (leftRecordId > rightRecordId) return 1;
      const leftAccountId = asString(left?.accountId).trim().toLowerCase();
      const rightAccountId = asString(right?.accountId).trim().toLowerCase();
      if (leftAccountId < rightAccountId) return -1;
      if (leftAccountId > rightAccountId) return 1;
      return 0;
    });
  }
  function mergePasskeyCollections(local, remote, helpers) {
    const h = resolveHelpers(helpers);
    const mergedById = /* @__PURE__ */ new Map();
    const source = [...Array.isArray(local) ? local : [], ...Array.isArray(remote) ? remote : []];
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
  function mergeFolderCollections(local, remote, helpers) {
    const h = resolveHelpers(helpers);
    const merged = /* @__PURE__ */ new Map();
    const source = [...Array.isArray(local) ? local : [], ...Array.isArray(remote) ? remote : []];
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
          createdAtMs: 0
        })
      );
    } else {
      merged.set(
        h.fixedNewAccountFolderId,
        {
          ...existingFixed,
          id: h.fixedNewAccountFolderId,
          name: h.fixedNewAccountFolderName
        }
      );
    }
    return h.sortFoldersForDisplay(Array.from(merged.values()));
  }
  function preferRemoteOrder(localUpdatedAtMs, localDeviceName, remoteUpdatedAtMs, remoteDeviceName) {
    return asNumber(remoteUpdatedAtMs) > asNumber(localUpdatedAtMs) || asNumber(remoteUpdatedAtMs) === asNumber(localUpdatedAtMs) && stableTieValue(remoteDeviceName) > stableTieValue(localDeviceName);
  }
  function mergeOrderIds(local, remote, localUpdatedAtMs, localDeviceName, remoteUpdatedAtMs, remoteDeviceName) {
    const remoteWins = preferRemoteOrder(
      localUpdatedAtMs,
      localDeviceName,
      remoteUpdatedAtMs,
      remoteDeviceName
    );
    const winner = remoteWins ? remote : local;
    const loser = remoteWins ? local : remote;
    const seen = /* @__PURE__ */ new Set();
    return [...Array.isArray(winner) ? winner : [], ...Array.isArray(loser) ? loser : []].map((id) => asString(id).trim().toLowerCase()).filter((id) => id && !seen.has(id) && seen.add(id));
  }
  function normalizeRegularOrder(savedIds, accounts, folderId, helpers) {
    const normalizedFolderId = folderId == null ? null : helpers.normalizeFolderId(folderId);
    const eligible = (account) => {
      if (account?.isDeleted || account?.isPermanentlyDeleted) return false;
      if (normalizedFolderId == null) return true;
      return helpers.extractAccountFolderIds(account).some((id) => helpers.normalizeFolderId(id) === normalizedFolderId);
    };
    const valid = /* @__PURE__ */ new Map();
    for (const account of accounts) {
      const id = asString(account?.recordId || account?.id).trim().toLowerCase();
      if (id && eligible(account)) valid.set(id, account);
    }
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    for (const rawId of Array.isArray(savedIds) ? savedIds : []) {
      const id = asString(rawId).trim().toLowerCase();
      if (id && valid.has(id) && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
    const missing = [...valid.entries()].filter(([id]) => !seen.has(id)).sort(([, left], [, right]) => asNumber(left?.regularSortOrder) - asNumber(right?.regularSortOrder) || asNumber(right?.updatedAtMs) - asNumber(left?.updatedAtMs) || asString(left?.recordId || left?.id).localeCompare(asString(right?.recordId || right?.id)));
    result.push(...missing.map(([id]) => id));
    return result;
  }
  function normalizeFolderRegularOrders(folders, accounts, helpers) {
    const h = resolveHelpers(helpers);
    return (Array.isArray(folders) ? folders : []).map((folder) => {
      const next = { ...folder };
      next.regularAccountIds = next.isDeleted || next.isPermanentlyDeleted ? [] : normalizeRegularOrder(next.regularAccountIds, accounts, next.id, h);
      return next;
    });
  }
  function applyFolderOrder(folders, savedIds, helpers) {
    const h = resolveHelpers(helpers);
    const byId = new Map((Array.isArray(folders) ? folders : []).map((folder) => [h.normalizeFolderId(folder?.id), folder]).filter(([id]) => id));
    const order = [];
    const seen = /* @__PURE__ */ new Set();
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
  function mergeSyncPayloads(localInput, remoteInput, helpers) {
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
      remote.allRegularOrderUpdatedDeviceName
    );
    const folderOrderFromRemote = preferRemoteOrder(
      local.folderOrderUpdatedAtMs,
      local.folderOrderUpdatedDeviceName,
      remote.folderOrderUpdatedAtMs,
      remote.folderOrderUpdatedDeviceName
    );
    const allRegularAccountIds = normalizeRegularOrder(
      mergeOrderIds(
        local.allRegularAccountIds,
        remote.allRegularAccountIds,
        local.allRegularOrderUpdatedAtMs,
        local.allRegularOrderUpdatedDeviceName,
        remote.allRegularOrderUpdatedAtMs,
        remote.allRegularOrderUpdatedDeviceName
      ),
      accounts,
      null,
      h
    );
    folders = normalizeFolderRegularOrders(folders, accounts, h);
    const folderOrderIds = mergeOrderIds(
      local.folderOrderIds,
      remote.folderOrderIds,
      local.folderOrderUpdatedAtMs,
      local.folderOrderUpdatedDeviceName,
      remote.folderOrderUpdatedAtMs,
      remote.folderOrderUpdatedDeviceName
    );
    const folderResult = applyFolderOrder(folders, folderOrderIds, h);
    return {
      accounts,
      folders: folderResult.folders,
      passkeys,
      allRegularAccountIds,
      allRegularOrderUpdatedAtMs: allOrderFromRemote ? asNumber(remote.allRegularOrderUpdatedAtMs) : asNumber(local.allRegularOrderUpdatedAtMs),
      allRegularOrderUpdatedDeviceName: allOrderFromRemote ? asString(remote.allRegularOrderUpdatedDeviceName) : asString(local.allRegularOrderUpdatedDeviceName),
      folderOrderIds: folderResult.folderOrderIds,
      folderOrderUpdatedAtMs: folderOrderFromRemote ? asNumber(remote.folderOrderUpdatedAtMs) : asNumber(local.folderOrderUpdatedAtMs),
      folderOrderUpdatedDeviceName: folderOrderFromRemote ? asString(remote.folderOrderUpdatedDeviceName) : asString(local.folderOrderUpdatedDeviceName)
    };
  }
  function reconcileAccountFolders(accounts, folders, helpers) {
    const h = resolveHelpers(helpers);
    const validIds = new Set((Array.isArray(folders) ? folders : []).filter((folder) => !folder?.isDeleted).map((folder) => h.normalizeFolderId(folder?.id)));
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
        ...normalized.folderMembershipStates && typeof normalized.folderMembershipStates === "object" ? normalized.folderMembershipStates : {}
      };
      const tombstoneAt = Math.max(
        asNumber(normalized.updatedAtMs),
        asNumber(normalized.createdAtMs)
      );
      const deviceName = asString(normalized.lastOperatedDeviceName).trim() || DEFAULT_DEVICE_NAME;
      for (const id of previousSet) {
        if (!id || resolvedSet.has(id)) continue;
        const existing = folderMembershipStates[id] || {};
        folderMembershipStates[id] = {
          isDeleted: true,
          updatedAtMs: Math.max(asNumber(existing.updatedAtMs), tombstoneAt),
          deviceName: asString(existing.deviceName).trim() || deviceName
        };
      }
      for (const id of resolvedSet) {
        if (!id) continue;
        const existing = folderMembershipStates[id];
        if (!existing || existing.isDeleted) {
          folderMembershipStates[id] = {
            isDeleted: false,
            updatedAtMs: Math.max(asNumber(existing?.updatedAtMs), tombstoneAt),
            deviceName: asString(existing?.deviceName).trim() || deviceName
          };
        }
      }
      return {
        ...normalized,
        folderId: resolved[0] || null,
        folderIds: resolved,
        folderMembershipStates
      };
    });
  }
  function identitySet(values, identityFn) {
    const result = /* @__PURE__ */ new Set();
    for (const value of Array.isArray(values) ? values : []) {
      const identity = identityFn(value);
      if (identity) result.add(identity);
    }
    return result;
  }
  function mergePinnedViews(leftValue, rightValue, preferRight) {
    const left = leftValue && typeof leftValue === "object" && !Array.isArray(leftValue) ? leftValue : {};
    const right = rightValue && typeof rightValue === "object" && !Array.isArray(rightValue) ? rightValue : {};
    const merged = {};
    for (const key of /* @__PURE__ */ new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (Object.prototype.hasOwnProperty.call(left, key) && Object.prototype.hasOwnProperty.call(right, key)) {
        merged[key] = preferRight ? right[key] : left[key];
      } else if (Object.prototype.hasOwnProperty.call(left, key)) {
        merged[key] = left[key];
      } else {
        merged[key] = right[key];
      }
    }
    return Object.keys(merged).length > 0 ? merged : null;
  }
  function missingIdentities(source, target, identityFn) {
    const sourceIds = identitySet(source, identityFn);
    const targetIds = identitySet(target, identityFn);
    return Array.from(sourceIds).filter((identity) => !targetIds.has(identity));
  }
  function summarizeSyncPayload(payload, helpers) {
    const h = resolveHelpers(helpers);
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts.map(h.normalizeAccountShape) : [];
    const folders = Array.isArray(payload?.folders) ? payload.folders.map(h.normalizeFolderShape) : [];
    const passkeys = Array.isArray(payload?.passkeys) ? payload.passkeys.map(h.normalizePasskeyShape) : [];
    return {
      accounts: accounts.filter((item) => !item?.isPermanentlyDeleted).length,
      activeAccounts: accounts.filter((item) => !item?.isDeleted && !item?.isPermanentlyDeleted).length,
      deletedAccounts: accounts.filter((item) => Boolean(item?.isDeleted) && !item?.isPermanentlyDeleted).length,
      folders: folders.filter((item) => !item?.isPermanentlyDeleted).length,
      passkeys: passkeys.filter((item) => !item?.isPermanentlyDeleted).length,
      accountIds: identitySet(accounts, (item) => asString(item?.recordId || item?.id || item?.accountId).trim().toLowerCase()),
      folderIds: identitySet(folders, (item) => h.normalizeFolderId(item?.id)),
      passkeyIds: identitySet(passkeys, (item) => asString(item?.credentialIdB64u || item?.id).trim())
    };
  }
  function evaluateSyncSafety({ local, remote, merged, mode = "merge" }, helpers) {
    const localSummary = summarizeSyncPayload(local, helpers);
    const remoteSummary = remote == null ? null : summarizeSyncPayload(remote, helpers);
    const mergedSummary = summarizeSyncPayload(merged, helpers);
    const reasons = [];
    const localNonEmpty = localSummary.accounts + localSummary.folders + localSummary.passkeys > 0;
    const remoteNonEmpty = Boolean(remoteSummary) && remoteSummary.accounts + remoteSummary.folders + remoteSummary.passkeys > 0;
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
        local: { ...localSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 },
        remote: remoteSummary ? { ...remoteSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 } : null,
        merged: { ...mergedSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 }
      };
    }
    if (mode === "remoteOverwriteLocal") {
      if (!remoteNonEmpty && localNonEmpty) reasons.push("REMOTE_EMPTY_FOR_NON_EMPTY_LOCAL");
      return {
        safe: reasons.length === 0,
        reasons,
        local: { ...localSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 },
        remote: remoteSummary ? { ...remoteSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 } : null,
        merged: { ...mergedSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 }
      };
    }
    return {
      safe: true,
      reasons,
      local: { ...localSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 },
      remote: remoteSummary ? { ...remoteSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 } : null,
      merged: { ...mergedSummary, accountIds: void 0, folderIds: void 0, passkeyIds: void 0 }
    };
  }

  // lock_crypto.js
  var LOCK_CREDENTIAL_VERSION = 2;
  var LOCK_PBKDF2_ITERATIONS = 31e4;
  function bytesToBase64(bytes) {
    let binary = "";
    for (const value of bytes) binary += String.fromCharCode(value);
    return btoa(binary);
  }
  function base64ToBytes(base64) {
    try {
      const binary = atob(String(base64 || ""));
      const output = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
      return output;
    } catch {
      return new Uint8Array();
    }
  }
  function normalizeLockMasterCredential(value) {
    if (!value || typeof value !== "object") return null;
    const version = Number(value.version || 1);
    const saltBase64 = String(value.saltBase64 || "");
    const digestBase64 = String(value.digestBase64 || "");
    if (![1, LOCK_CREDENTIAL_VERSION].includes(version) || !saltBase64 || !digestBase64) return null;
    const saltBytes = base64ToBytes(saltBase64);
    if (saltBytes.length < 16) return null;
    const iterations = version === LOCK_CREDENTIAL_VERSION ? Number(value.iterations || LOCK_PBKDF2_ITERATIONS) : 1;
    if (!Number.isInteger(iterations) || iterations < 1) return null;
    return { version, saltBase64, digestBase64, iterations };
  }
  async function legacyDigest(password, saltBytes) {
    const passwordBytes = new TextEncoder().encode(String(password || ""));
    const merged = new Uint8Array(saltBytes.length + passwordBytes.length);
    merged.set(saltBytes, 0);
    merged.set(passwordBytes, saltBytes.length);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", merged));
  }
  async function pbkdf2Digest(password, saltBytes, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(String(password || "")),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
      keyMaterial,
      256
    );
    return new Uint8Array(bits);
  }
  async function createLockMasterCredential(password) {
    const normalizedPassword = String(password || "");
    if (!normalizedPassword) return null;
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const digest = await pbkdf2Digest(normalizedPassword, saltBytes, LOCK_PBKDF2_ITERATIONS);
    return {
      version: LOCK_CREDENTIAL_VERSION,
      saltBase64: bytesToBase64(saltBytes),
      digestBase64: bytesToBase64(digest),
      iterations: LOCK_PBKDF2_ITERATIONS
    };
  }
  async function verifyLockMasterPassword(credential, password) {
    const normalized = normalizeLockMasterCredential(credential);
    if (!normalized) return false;
    const saltBytes = base64ToBytes(normalized.saltBase64);
    const digest = normalized.version === 1 ? await legacyDigest(String(password || ""), saltBytes) : await pbkdf2Digest(String(password || ""), saltBytes, normalized.iterations);
    return timingSafeEqual(digest, base64ToBytes(normalized.digestBase64));
  }
  function timingSafeEqual(lhs, rhs) {
    if (lhs.length !== rhs.length) return false;
    let difference = 0;
    for (let i = 0; i < lhs.length; i += 1) difference |= lhs[i] ^ rhs[i];
    return difference === 0;
  }

  // sync_outbox.js
  function syncTargetKey(target) {
    return `${String(target?.kind || "").trim()}|${String(target?.url || "").trim()}`;
  }
  function normalizeSyncOutboxItem(item, nowMs = Date.now()) {
    const targetKey = String(item?.targetKey || "").trim();
    const payload = item?.payload;
    if (!targetKey || !payload || typeof payload !== "object") return null;
    const nonNegativeNumber = (raw, fallback) => {
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    return {
      targetKey,
      payload,
      createdAtMs: nonNegativeNumber(item?.createdAtMs, nowMs),
      attempts: Math.min(SYNC_OUTBOX_MAX_ATTEMPTS, Math.floor(nonNegativeNumber(item?.attempts, 0))),
      lastAttemptAtMs: nonNegativeNumber(item?.lastAttemptAtMs, 0),
      nextRetryAtMs: nonNegativeNumber(item?.nextRetryAtMs, 0),
      lastError: String(item?.lastError || "")
    };
  }
  function normalizeSyncOutbox(value, nowMs = Date.now()) {
    const byTarget = /* @__PURE__ */ new Map();
    for (const item of Array.isArray(value) ? value : []) {
      const normalized = normalizeSyncOutboxItem(item, nowMs);
      if (!normalized) continue;
      byTarget.set(normalized.targetKey, normalized);
    }
    return [...byTarget.values()].sort((left, right) => left.createdAtMs - right.createdAtMs);
  }
  function upsertSyncOutbox(value, { targetKey, payload, error, nowMs = Date.now() }) {
    const current = normalizeSyncOutbox(value, nowMs);
    const previous = current.find((item) => item.targetKey === targetKey);
    const attempts = Math.min(SYNC_OUTBOX_MAX_ATTEMPTS, Number(previous?.attempts || 0) + 1);
    const next = normalizeSyncOutboxItem({
      targetKey,
      payload,
      createdAtMs: previous?.createdAtMs || nowMs,
      attempts,
      lastAttemptAtMs: nowMs,
      nextRetryAtMs: nowMs + syncOutboxRetryDelayMs(attempts),
      lastError: String(error?.message || error || "")
    }, nowMs);
    return normalizeSyncOutbox(current.filter((item) => item.targetKey !== targetKey).concat(next), nowMs);
  }
  function removeOrphanedSyncOutbox(value, activeTargetKeys) {
    const active = new Set(Array.from(activeTargetKeys || [], (item) => String(item || "").trim()).filter(Boolean));
    return normalizeSyncOutbox(value).filter((item) => active.has(item.targetKey));
  }

  // data_store.js
  var DB_NAME = "pass.local.db.v1";
  var DB_VERSION = 1;
  var STORE_COLLECTIONS = "collections";
  var COLLECTION_ACCOUNTS = "accounts";
  var COLLECTION_PASSKEYS = "passkeys";
  var COLLECTION_FOLDERS = "folders";
  var COLLECTION_LAYOUT = "layout";
  var COLLECTION_HISTORY = "history";
  var COLLECTION_SYNC_SECRETS = "syncSecrets";
  var COLLECTION_SYNC_SAFETY_SNAPSHOTS = "syncSafetySnapshots";
  var COLLECTION_SYNC_OUTBOX = "syncOutbox";
  var HISTORY_MAX_ENTRIES = 500;
  var SAFETY_SNAPSHOT_MAX_ENTRIES = 5;
  var LEGACY_STORAGE_KEY_ACCOUNTS = "pass.accounts";
  var LEGACY_STORAGE_KEY_PASSKEYS = "pass.passkeys";
  var LEGACY_STORAGE_KEY_FOLDERS = "pass.folders";
  var STORAGE_KEY_MIGRATION_DONE = "pass.data.migratedToIndexedDb.v1";
  var STORAGE_KEY_ENCRYPTION_KEY = "pass.data.encryptionKey.v1";
  var STORAGE_KEY_WRAPPED_ENCRYPTION_KEY = "pass.data.wrappedEncryptionKey.v2";
  var STORAGE_KEY_SESSION_ENCRYPTION_KEY = "pass.data.sessionEncryptionKey.v2";
  var LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD = "pass.sync.webdav.password.v2";
  var LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN = "pass.sync.server.token.v2";
  var LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY = "pass.sync.encryptionKey.v1";
  var LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS = "pass.localSafetySnapshots.v1";
  var STORAGE_KEY_DATA_BUMP = "pass.data.bump.v1";
  var dbPromise = null;
  var readyPromise = null;
  var unlockedEncryptionKey = null;
  var encryptionKeyPromise = null;
  function sanitizeHistoryAction(value) {
    const action = String(value || "").trim();
    if (!action) return "";
    const normalized = action.replace(/:/g, "\uFF1A");
    if (/(创建账号|created account)\s*[（(][\s\S]*?(密码改为|password\s*(?:changed|to)|password was set to)[\s\S]*?[）)]/i.test(normalized)) {
      return "\u65B0\u5EFA\u8D26\u53F7";
    }
    const separator = normalized.indexOf("\uFF1A");
    const prefix = separator >= 0 ? `${normalized.slice(0, separator)}\uFF1A` : "";
    if (/(密码改为|password\s*(?:changed|to)|password was set to)/i.test(normalized)) {
      return `${prefix}\u5BC6\u7801\u5DF2\u4FEE\u6539`;
    }
    if (/(TOTP\s*改为|totp\s*(?:changed|to)|otp\s*(?:changed|to))/i.test(normalized)) {
      return `${prefix}TOTP \u5DF2\u4FEE\u6539`;
    }
    if (/(恢复码改为|recovery(?:\s*codes?)?\s*(?:changed|to))/i.test(normalized)) {
      return `${prefix}\u6062\u590D\u7801\u5DF2\u4FEE\u6539`;
    }
    if (/(备注改为|note\s*(?:changed|to)|notes?\s*(?:changed|to))/i.test(normalized)) {
      return `${prefix}\u5907\u6CE8\u5DF2\u4FEE\u6539`;
    }
    return action;
  }
  function requestAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }
  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
          db.createObjectStore(STORE_COLLECTIONS, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error("Failed to open IndexedDB"));
      };
      request.onblocked = () => {
        dbPromise = null;
        reject(new Error("Failed to open IndexedDB: blocked"));
      };
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }
  async function readCollection(key) {
    const db = await openDatabase();
    const tx = db.transaction(STORE_COLLECTIONS, "readonly");
    const store = tx.objectStore(STORE_COLLECTIONS);
    const row = await requestAsPromise(store.get(key));
    if (!row) return [];
    if (Array.isArray(row.value)) {
      await writeCollection(key, row.value);
      return row.value;
    }
    if (Number(row.version) !== 1 || !row.nonceBase64 || !row.ciphertextBase64) {
      throw new Error(`IndexedDB \u96C6\u5408\u683C\u5F0F\u65E0\u6548: ${key}`);
    }
    const cryptoKey = await loadOrCreateEncryptionKey();
    let plaintext;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(row.nonceBase64), additionalData: new TextEncoder().encode(key) },
        cryptoKey,
        base64ToBytes(row.ciphertextBase64)
      );
    } catch (error) {
      if (key === COLLECTION_HISTORY && String(error?.name || "") === "OperationError") return [];
      throw error;
    }
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    return Array.isArray(decoded) ? decoded : [];
  }
  async function writeCollection(key, value) {
    await writeCollectionRows([{ key, value }]);
  }
  async function encryptCollectionRow(key, value) {
    const cryptoKey = await loadOrCreateEncryptionKey();
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(Array.isArray(value) ? value : []));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(key) },
      cryptoKey,
      plaintext
    );
    return {
      key,
      version: 1,
      nonceBase64: bytesToBase64(nonce),
      ciphertextBase64: bytesToBase64(new Uint8Array(ciphertext))
    };
  }
  async function writeCollectionRows(entries) {
    const rows = await Promise.all(entries.map((entry) => encryptCollectionRow(entry.key, entry.value)));
    const db = await openDatabase();
    const tx = db.transaction(STORE_COLLECTIONS, "readwrite");
    const store = tx.objectStore(STORE_COLLECTIONS);
    for (const row of rows) store.put(row);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  }
  async function loadOrCreateEncryptionKey() {
    if (unlockedEncryptionKey) return unlockedEncryptionKey;
    if (encryptionKeyPromise) return encryptionKeyPromise;
    encryptionKeyPromise = (async () => {
      if (unlockedEncryptionKey) return unlockedEncryptionKey;
      const session = await chrome.storage.session.get([STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
      const sessionKey = base64ToBytes(session[STORAGE_KEY_SESSION_ENCRYPTION_KEY]);
      if (sessionKey.length === 32) {
        unlockedEncryptionKey = await crypto.subtle.importKey("raw", sessionKey, "AES-GCM", false, ["encrypt", "decrypt"]);
        return unlockedEncryptionKey;
      }
      const stored = await chrome.storage.local.get([
        STORAGE_KEY_ENCRYPTION_KEY,
        STORAGE_KEY_WRAPPED_ENCRYPTION_KEY
      ]);
      if (stored[STORAGE_KEY_WRAPPED_ENCRYPTION_KEY]) {
        throw new Error("\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u672C\u5730\u6570\u636E");
      }
      let rawKey = base64ToBytes(stored[STORAGE_KEY_ENCRYPTION_KEY]);
      if (rawKey.length !== 32) {
        if (await hasEncryptedCollections()) {
          throw new Error("\u672C\u5730\u6570\u636E\u5BC6\u94A5\u7F3A\u5931\uFF0C\u8BF7\u6062\u590D\u5BC6\u94A5\u6216\u4ECE\u5907\u4EFD\u5BFC\u5165");
        }
        rawKey = crypto.getRandomValues(new Uint8Array(32));
        await chrome.storage.local.set({ [STORAGE_KEY_ENCRYPTION_KEY]: bytesToBase64(rawKey) });
      }
      unlockedEncryptionKey = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
      return unlockedEncryptionKey;
    })().catch((error) => {
      encryptionKeyPromise = null;
      throw error;
    });
    return encryptionKeyPromise;
  }
  async function hasEncryptedCollections() {
    return await new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
          db.createObjectStore(STORE_COLLECTIONS, { keyPath: "key" });
        }
      };
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        try {
          const tx = db.transaction(STORE_COLLECTIONS, "readonly");
          const store = tx.objectStore(STORE_COLLECTIONS);
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const rows = Array.isArray(getAll.result) ? getAll.result : [];
            db.close();
            resolve(rows.some((row) => {
              return row && Number(row.version) === 1 && row.nonceBase64 && row.ciphertextBase64;
            }));
          };
          getAll.onerror = () => {
            db.close();
            resolve(false);
          };
        } catch {
          try {
            db.close();
          } catch {
          }
          resolve(false);
        }
      };
    });
  }
  async function lockDataEncryption() {
    unlockedEncryptionKey = null;
    encryptionKeyPromise = null;
    await chrome.storage.session.remove(STORAGE_KEY_SESSION_ENCRYPTION_KEY);
  }
  async function touchDataBump(reason) {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY_DATA_BUMP]: Date.now(),
        "pass.data.bumpReason.v1": String(reason || "")
      });
    } catch {
    }
  }
  function legacyCollectionValue(legacy, key) {
    const value = legacy[key];
    return Array.isArray(value) ? value : [];
  }
  function collectionRecordIdentity(value, collectionKey, index) {
    if (!value || typeof value !== "object") return `index:${index}`;
    const candidates = collectionKey === COLLECTION_ACCOUNTS ? [value.accountId, value.recordId, value.id] : collectionKey === COLLECTION_PASSKEYS ? [value.credentialIdB64u, value.credentialId, value.id] : [value.id, value.folderId];
    const identity = candidates.find((candidate) => String(candidate || "").trim());
    if (!identity) return `index:${index}`;
    const normalized = String(identity).trim();
    return collectionKey === COLLECTION_FOLDERS ? normalized.toLowerCase() : normalized;
  }
  function collectionRecordUpdatedAt(value) {
    const timestamp = Number(value?.updatedAtMs ?? value?.createdAtMs ?? 0);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  function mergeLegacyCollection(current, legacy, collectionKey) {
    const merged = /* @__PURE__ */ new Map();
    const order = [];
    const add = (value, index, preferOnEqual) => {
      const identity = collectionRecordIdentity(value, collectionKey, index);
      const existing = merged.get(identity);
      if (!existing) {
        merged.set(identity, { value, updatedAtMs: collectionRecordUpdatedAt(value) });
        order.push(identity);
        return;
      }
      const updatedAtMs = collectionRecordUpdatedAt(value);
      if (updatedAtMs > existing.updatedAtMs || preferOnEqual && updatedAtMs === existing.updatedAtMs) {
        merged.set(identity, { value, updatedAtMs });
      }
    };
    legacy.forEach((value, index) => add(value, index, false));
    current.forEach((value, index) => add(value, index, true));
    return order.map((identity) => merged.get(identity).value);
  }
  async function migrateLegacyCollections(currentCollections, legacy) {
    const collectionPairs = [
      [COLLECTION_ACCOUNTS, currentCollections.accounts, legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_ACCOUNTS)],
      [COLLECTION_PASSKEYS, currentCollections.passkeys, legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_PASSKEYS)],
      [COLLECTION_FOLDERS, currentCollections.folders, legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_FOLDERS)]
    ];
    let changed = false;
    for (const [collectionKey, current, legacyValue] of collectionPairs) {
      if (legacyValue.length === 0) continue;
      const merged = mergeLegacyCollection(current, legacyValue, collectionKey);
      if (JSON.stringify(merged) === JSON.stringify(current)) continue;
      await writeCollection(collectionKey, merged);
      changed = true;
    }
    if (changed) await touchDataBump("legacy-migration");
    return changed;
  }
  async function readCollectionForMigration(key, legacyValue) {
    try {
      return await readCollection(key);
    } catch (error) {
      if (legacyValue.length > 0 && String(error?.name || "") === "OperationError") return [];
      throw error;
    }
  }
  async function migrateLegacyStorageIfNeeded() {
    const legacy = await chrome.storage.local.get([
      LEGACY_STORAGE_KEY_ACCOUNTS,
      LEGACY_STORAGE_KEY_PASSKEYS,
      LEGACY_STORAGE_KEY_FOLDERS
    ]);
    try {
      const legacyAccounts = legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_ACCOUNTS);
      const legacyPasskeys = legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_PASSKEYS);
      const legacyFolders = legacyCollectionValue(legacy, LEGACY_STORAGE_KEY_FOLDERS);
      const [accounts, passkeys, folders] = await Promise.all([
        readCollectionForMigration(COLLECTION_ACCOUNTS, legacyAccounts),
        readCollectionForMigration(COLLECTION_PASSKEYS, legacyPasskeys),
        readCollectionForMigration(COLLECTION_FOLDERS, legacyFolders)
      ]);
      await migrateLegacyCollections({ accounts, passkeys, folders }, legacy);
    } catch (error) {
      if (String(error?.message || "") === "\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u672C\u5730\u6570\u636E") return;
      throw error;
    }
    await chrome.storage.local.set({ [STORAGE_KEY_MIGRATION_DONE]: true });
  }
  async function ensureDataStorageReady() {
    if (!readyPromise) {
      readyPromise = (async () => {
        await openDatabase();
        await migrateLegacyStorageIfNeeded();
      })().catch((error) => {
        readyPromise = null;
        throw error;
      });
    }
    return readyPromise;
  }
  async function setAccounts(accounts) {
    await ensureDataStorageReady();
    await writeCollection(COLLECTION_ACCOUNTS, accounts);
    await touchDataBump(COLLECTION_ACCOUNTS);
  }
  async function setFolders(folders) {
    await ensureDataStorageReady();
    await writeCollection(COLLECTION_FOLDERS, folders);
    await touchDataBump(COLLECTION_FOLDERS);
  }
  async function getAllData() {
    await ensureDataStorageReady();
    const [accounts, passkeys, folders, layoutRows] = await Promise.all([
      readCollection(COLLECTION_ACCOUNTS),
      readCollection(COLLECTION_PASSKEYS),
      readCollection(COLLECTION_FOLDERS),
      readCollection(COLLECTION_LAYOUT)
    ]);
    const layout = layoutRows[0] && typeof layoutRows[0] === "object" ? layoutRows[0] : {};
    return {
      accounts,
      passkeys,
      folders,
      allRegularAccountIds: Array.isArray(layout.allRegularAccountIds) ? layout.allRegularAccountIds : [],
      allRegularOrderUpdatedAtMs: Number(layout.allRegularOrderUpdatedAtMs) || 0,
      allRegularOrderUpdatedDeviceName: String(layout.allRegularOrderUpdatedDeviceName || ""),
      folderOrderIds: Array.isArray(layout.folderOrderIds) ? layout.folderOrderIds : [],
      folderOrderUpdatedAtMs: Number(layout.folderOrderUpdatedAtMs) || 0,
      folderOrderUpdatedDeviceName: String(layout.folderOrderUpdatedDeviceName || ""),
      deviceName: String(layout.deviceName || "")
    };
  }
  async function setAllData({
    accounts,
    passkeys,
    folders,
    allRegularAccountIds = [],
    allRegularOrderUpdatedAtMs = 0,
    allRegularOrderUpdatedDeviceName = "",
    folderOrderIds = [],
    folderOrderUpdatedAtMs = 0,
    folderOrderUpdatedDeviceName = "",
    deviceName = ""
  }) {
    try {
      await ensureDataStorageReady();
    } catch (error) {
      if (String(error?.name || "") !== "OperationError") throw error;
    }
    await writeCollectionRows([
      { key: COLLECTION_ACCOUNTS, value: accounts },
      { key: COLLECTION_PASSKEYS, value: passkeys },
      { key: COLLECTION_FOLDERS, value: folders },
      {
        key: COLLECTION_LAYOUT,
        value: [{
          allRegularAccountIds: Array.isArray(allRegularAccountIds) ? allRegularAccountIds : [],
          allRegularOrderUpdatedAtMs: Number(allRegularOrderUpdatedAtMs) || 0,
          allRegularOrderUpdatedDeviceName: String(allRegularOrderUpdatedDeviceName || ""),
          folderOrderIds: Array.isArray(folderOrderIds) ? folderOrderIds : [],
          folderOrderUpdatedAtMs: Number(folderOrderUpdatedAtMs) || 0,
          folderOrderUpdatedDeviceName: String(folderOrderUpdatedDeviceName || ""),
          deviceName: String(deviceName || "")
        }]
      }
    ]);
    await touchDataBump("all");
  }
  function normalizeSyncSecrets(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      webdavPassword: String(source.webdavPassword || ""),
      serverToken: String(source.serverToken || "").trim(),
      encryptionKey: String(source.encryptionKey || "").trim(),
      previousEncryptionKey: String(source.previousEncryptionKey || "").trim()
    };
  }
  async function getSyncSecrets() {
    await ensureDataStorageReady();
    const entries = await readCollection(COLLECTION_SYNC_SECRETS);
    return normalizeSyncSecrets(Array.isArray(entries) ? entries[0] : null);
  }
  async function setSyncSecrets(value) {
    await ensureDataStorageReady();
    const normalized = normalizeSyncSecrets(value);
    await writeCollection(COLLECTION_SYNC_SECRETS, [normalized]);
    return normalized;
  }
  function normalizeSafetySnapshots(value) {
    return (Array.isArray(value) ? value : []).filter((item) => item && typeof item === "object" && item.payload && typeof item.payload === "object").map((item) => ({
      createdAtMs: Number(item.createdAtMs || 0),
      reason: String(item.reason || "\u540C\u6B65\u524D\u5907\u4EFD"),
      payload: item.payload
    })).filter((item) => Number.isFinite(item.createdAtMs) && item.createdAtMs > 0).sort((lhs, rhs) => rhs.createdAtMs - lhs.createdAtMs).slice(0, SAFETY_SNAPSHOT_MAX_ENTRIES);
  }
  async function getSafetySnapshots() {
    await ensureDataStorageReady();
    const legacyResult = await chrome.storage.local.get([LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS]);
    const legacy = normalizeSafetySnapshots(legacyResult[LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS]);
    let encrypted;
    try {
      encrypted = normalizeSafetySnapshots(await readCollection(COLLECTION_SYNC_SAFETY_SNAPSHOTS));
    } catch (error) {
      if (String(error?.name || "") !== "OperationError" || legacy.length === 0) throw error;
      encrypted = [];
    }
    const merged = normalizeSafetySnapshots([...encrypted, ...legacy]);
    if (legacy.length > 0 || JSON.stringify(merged) !== JSON.stringify(encrypted)) {
      await writeCollection(COLLECTION_SYNC_SAFETY_SNAPSHOTS, merged);
    }
    if (legacyResult[LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS] !== void 0) {
      await chrome.storage.local.remove(LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS);
    }
    return merged;
  }
  async function setSafetySnapshots(value) {
    await ensureDataStorageReady();
    const normalized = normalizeSafetySnapshots(value);
    await writeCollection(COLLECTION_SYNC_SAFETY_SNAPSHOTS, normalized);
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY_LOCAL_SAFETY_SNAPSHOTS);
    return normalized;
  }
  async function getSyncOutbox() {
    await ensureDataStorageReady();
    return normalizeSyncOutbox(await readCollection(COLLECTION_SYNC_OUTBOX));
  }
  async function setSyncOutbox(value) {
    await ensureDataStorageReady();
    const normalized = normalizeSyncOutbox(value);
    await writeCollection(COLLECTION_SYNC_OUTBOX, normalized);
    return normalized;
  }
  async function migrateLegacySyncSecrets() {
    let existing = normalizeSyncSecrets(null);
    let existingCollectionUnreadable = false;
    try {
      existing = await getSyncSecrets();
    } catch (error) {
      if (String(error?.name || "") !== "OperationError") throw error;
      existingCollectionUnreadable = true;
    }
    const legacy = await chrome.storage.local.get([
      LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD,
      LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN,
      LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY
    ]);
    const migrated = normalizeSyncSecrets({
      webdavPassword: existing.webdavPassword || legacy[LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD],
      serverToken: existing.serverToken || legacy[LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN],
      encryptionKey: existing.encryptionKey || legacy[LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY],
      previousEncryptionKey: existing.previousEncryptionKey
    });
    const hasLegacyRecoverySecrets = Boolean(
      migrated.webdavPassword || migrated.serverToken || migrated.encryptionKey
    );
    if (existingCollectionUnreadable && !hasLegacyRecoverySecrets) {
      const error = new Error("\u540C\u6B65\u51ED\u636E\u96C6\u5408\u65E0\u6CD5\u89E3\u5BC6\uFF0C\u4E14\u6CA1\u6709\u53EF\u7528\u65E7\u51ED\u636E\uFF1B\u539F\u6570\u636E\u672A\u8986\u76D6");
      error.code = "SYNC_SECRETS_UNREADABLE";
      throw error;
    }
    if (existingCollectionUnreadable || hasLegacyRecoverySecrets) {
      await setSyncSecrets(migrated);
    }
    await chrome.storage.local.remove([
      LEGACY_STORAGE_KEY_SYNC_WEBDAV_PASSWORD,
      LEGACY_STORAGE_KEY_SYNC_SERVER_TOKEN,
      LEGACY_STORAGE_KEY_SYNC_ENCRYPTION_KEY
    ]);
    return migrated;
  }
  async function getHistory() {
    await ensureDataStorageReady();
    const rawEntries = await readCollection(COLLECTION_HISTORY);
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    const normalized = entries.filter((item) => item && typeof item === "object").map((item) => ({
      id: String(item.id || ""),
      timestampMs: Number(item.timestampMs || 0),
      action: sanitizeHistoryAction(item.action)
    })).filter((item) => item.timestampMs > 0 && item.action.trim().length > 0).sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    });
    const needsMigration = entries.length !== normalized.length || entries.some(
      (item, index) => String(item?.action || "").trim() !== normalized[index]?.action
    );
    if (needsMigration) {
      await writeCollection(COLLECTION_HISTORY, normalized);
      await touchDataBump(COLLECTION_HISTORY);
    }
    return normalized;
  }
  async function setHistory(entries) {
    await ensureDataStorageReady();
    const normalized = (Array.isArray(entries) ? entries : []).filter((item) => item && typeof item === "object").map((item) => ({
      id: String(item.id || ""),
      timestampMs: Number(item.timestampMs || 0),
      action: sanitizeHistoryAction(item.action)
    })).filter((item) => item.timestampMs > 0 && item.action.length > 0).sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    }).slice(0, HISTORY_MAX_ENTRIES);
    await writeCollection(COLLECTION_HISTORY, normalized);
    await touchDataBump(COLLECTION_HISTORY);
  }
  async function appendHistoryEntry({ timestampMs, action }) {
    const normalizedAction = sanitizeHistoryAction(action);
    if (!normalizedAction) return;
    const ts = Number(timestampMs || Date.now());
    const entry = {
      id: (() => {
        try {
          if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
          const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
          return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
        } catch {
          throw new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u5B89\u5168\u968F\u673A\u6570");
        }
      })(),
      timestampMs: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
      action: normalizedAction
    };
    const current = await getHistory();
    await setHistory([entry, ...current]);
  }

  // lock_state.js
  var STORAGE_KEY_LOCK_ENABLED = "pass.lock.enabled";
  var STORAGE_KEY_LOCK_POLICY = "pass.lock.policy";
  var STORAGE_KEY_LOCK_IDLE_MINUTES = "pass.lock.idleMinutes";
  var STORAGE_KEY_LOCK_MASTER_CREDENTIAL = "pass.lock.masterCredential.v1";
  var LOCK_POLICY_ONCE_UNTIL_QUIT = "onceUntilQuit";
  var LOCK_POLICY_IDLE_TIMEOUT = "idleTimeout";
  var LOCK_POLICY_ON_BACKGROUND = "onBackground";
  var LOCK_IDLE_MINUTES_DEFAULT = 5;
  var LOCK_IDLE_MINUTES_MIN = 1;
  var LOCK_IDLE_MINUTES_MAX = 60;
  var LOCK_STATE_CHANGED_MESSAGE = "PASS_LOCK_STATE_CHANGED";
  function normalizeLockPolicy(value) {
    const policy = String(value || "").trim();
    if (policy === LOCK_POLICY_IDLE_TIMEOUT) return LOCK_POLICY_IDLE_TIMEOUT;
    if (policy === LOCK_POLICY_ON_BACKGROUND) return LOCK_POLICY_ON_BACKGROUND;
    return LOCK_POLICY_ONCE_UNTIL_QUIT;
  }
  function clampLockIdleMinutes(value) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return LOCK_IDLE_MINUTES_DEFAULT;
    return Math.min(Math.max(parsed, LOCK_IDLE_MINUTES_MIN), LOCK_IDLE_MINUTES_MAX);
  }
  async function applyLockStateChangedMessage(message, { lock, clear, unlock } = {}) {
    if (message?.type !== LOCK_STATE_CHANGED_MESSAGE) return false;
    if (message?.payload?.locked) {
      try {
        await lock?.();
      } finally {
        await clear?.();
      }
      return "locked";
    }
    await unlock?.();
    return "unlocked";
  }
  function createLockStateTransitionQueue() {
    let pending = Promise.resolve();
    return (message, callbacks) => {
      pending = pending.catch(() => {
      }).then(() => applyLockStateChangedMessage(message, callbacks));
      return pending;
    };
  }

  // sync_crypto.js
  var SYNC_ENCRYPTED_SCHEMA_V1 = "pass.sync.encrypted.v1";
  var SYNC_PLAINTEXT_SCHEMA = "pass.sync.bundle.v2";
  function generateSyncEncryptionKey() {
    return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  }
  function normalizeSyncEncryptionKey(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    return base64UrlToBytes(normalized).length === 32 ? normalized : "";
  }
  function isSyncEncryptionEnabled(rawKey) {
    return Boolean(normalizeSyncEncryptionKey(rawKey));
  }
  async function syncEncryptionKeyId(rawKey) {
    const key = normalizeSyncEncryptionKey(rawKey);
    if (!key) return "";
    const digest = await crypto.subtle.digest("SHA-256", base64UrlToBytes(key));
    return `k1-${Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 16)}`;
  }
  async function encryptSyncBundleDocument(document2, rawKey) {
    const key = normalizeSyncEncryptionKey(rawKey);
    if (!key) {
      return document2;
    }
    const imported = await importSyncKey(key, ["encrypt"]);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(document2));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(SYNC_ENCRYPTED_SCHEMA_V1) },
      imported,
      plaintext
    );
    return {
      schema: SYNC_ENCRYPTED_SCHEMA_V1,
      exportedAtMs: Number(document2?.exportedAtMs || Date.now()),
      keyId: await syncEncryptionKeyId(key),
      cipher: "AES-256-GCM",
      nonceBase64: bytesToBase642(new Uint8Array(nonce)),
      ciphertextBase64: bytesToBase642(new Uint8Array(ciphertext))
    };
  }
  async function decryptSyncBundleDocument(envelope, rawKey, fallbackKeys = []) {
    const schema = String(envelope?.schema || "");
    if (schema === SYNC_PLAINTEXT_SCHEMA) {
      if (isSyncEncryptionEnabled(rawKey)) {
        throw new Error("\u540C\u6B65\u5BC6\u94A5\u5DF2\u914D\u7F6E\uFF0C\u62D2\u7EDD\u672A\u52A0\u5BC6\u540C\u6B65\u5305");
      }
      return envelope;
    }
    if (schema !== SYNC_ENCRYPTED_SCHEMA_V1) {
      throw new Error("\u4E0D\u652F\u6301\u7684\u540C\u6B65\u5305\u683C\u5F0F");
    }
    const candidates = [...new Set([rawKey, ...Array.isArray(fallbackKeys) ? fallbackKeys : []].map(normalizeSyncEncryptionKey).filter(Boolean))];
    if (candidates.length === 0) {
      throw new Error("\u8BE5\u540C\u6B65\u5305\u4E3A\u52A0\u5BC6\u4FE1\u5C01\uFF0C\u4F46\u5F53\u524D\u672A\u914D\u7F6E\u540C\u6B65\u52A0\u5BC6\u5BC6\u94A5");
    }
    if (envelope?.cipher !== "AES-256-GCM") throw new Error("\u4E0D\u652F\u6301\u7684\u540C\u6B65\u52A0\u5BC6\u7B97\u6CD5");
    const declaredKeyId = String(envelope?.keyId || "").trim();
    const matchingCandidates = declaredKeyId ? (await Promise.all(candidates.map(async (key) => ({ key, keyId: await syncEncryptionKeyId(key) })))).filter((candidate) => candidate.keyId === declaredKeyId).map((candidate) => candidate.key) : candidates;
    if (matchingCandidates.length === 0) {
      throw new Error("\u540C\u6B65\u5BC6\u94A5 ID \u4E0D\u5339\u914D\uFF0C\u8BF7\u9009\u62E9\u4E0E\u8FDC\u7AEF\u6570\u636E\u76F8\u540C\u7684\u540C\u6B65\u5BC6\u94A5\u6216\u5B8C\u6210\u5BC6\u94A5\u8F6E\u6362");
    }
    for (const key of matchingCandidates) {
      try {
        const imported = await importSyncKey(key, ["decrypt"]);
        const plaintext = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: base64ToBytes2(envelope.nonceBase64),
            additionalData: new TextEncoder().encode(SYNC_ENCRYPTED_SCHEMA_V1)
          },
          imported,
          base64ToBytes2(envelope.ciphertextBase64)
        );
        return JSON.parse(new TextDecoder().decode(plaintext));
      } catch {
      }
    }
    throw new Error("\u540C\u6B65\u5305\u89E3\u5BC6\u5931\u8D25\uFF0C\u8BF7\u786E\u8BA4\u6240\u6709\u8BBE\u5907\u4F7F\u7528\u540C\u4E00\u540C\u6B65\u5BC6\u94A5");
  }
  async function importSyncKey(rawKey, usages) {
    const normalized = normalizeSyncEncryptionKey(rawKey);
    if (!normalized) throw new Error("\u540C\u6B65\u52A0\u5BC6\u5BC6\u94A5\u65E0\u6548\uFF0C\u5FC5\u987B\u662F 256 \u4F4D\u5BC6\u94A5");
    return crypto.subtle.importKey("raw", base64UrlToBytes(normalized), "AES-GCM", false, usages);
  }
  function bytesToBase642(bytes) {
    let binary = "";
    for (const value of bytes) binary += String.fromCharCode(value);
    return btoa(binary);
  }
  function bytesToBase64Url(bytes) {
    return bytesToBase642(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }
  function base64ToBytes2(base64) {
    try {
      const binary = atob(String(base64 || ""));
      const output = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
      return output;
    } catch {
      return new Uint8Array();
    }
  }
  function base64UrlToBytes(value) {
    const base64 = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
    return base64ToBytes2(base64 + "=".repeat((4 - base64.length % 4) % 4));
  }

  // secure_random.js
  function secureRandomUuid(cryptoApi = globalThis.crypto) {
    if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
    if (typeof cryptoApi?.getRandomValues !== "function") {
      throw new Error("\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u5B89\u5168\u968F\u673A\u6570\uFF0C\u5DF2\u505C\u6B62\u540C\u6B65\u64CD\u4F5C");
    }
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
  function createSyncIdempotencyKey(now = Date.now(), cryptoApi = globalThis.crypto) {
    return `pass-${Number(now)}-${secureRandomUuid(cryptoApi)}`;
  }

  // download_file.js
  function downloadTextFile(fileName, content, mimeType, {
    documentRef = globalThis.document,
    urlRef = globalThis.URL,
    BlobCtor = globalThis.Blob,
    revokeDelayMs = 1e3
  } = {}) {
    return new Promise((resolve, reject) => {
      let url = "";
      let anchor = null;
      try {
        if (!documentRef?.body) throw new Error("\u5BFC\u51FA\u9875\u9762\u5C1A\u672A\u5B8C\u6210\u52A0\u8F7D");
        if (typeof BlobCtor !== "function") throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u6587\u4EF6\u5BFC\u51FA");
        if (typeof urlRef?.createObjectURL !== "function") throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u6587\u4EF6\u5BFC\u51FA");
        const blob = new BlobCtor([content], { type: mimeType });
        url = urlRef.createObjectURL(blob);
        anchor = documentRef.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.style.display = "none";
        documentRef.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => {
          if (url) urlRef.revokeObjectURL(url);
          anchor?.remove();
          resolve();
        }, revokeDelayMs);
      } catch (error) {
        if (url) urlRef.revokeObjectURL(url);
        anchor?.remove();
        reject(error);
      }
    });
  }

  // options.js
  var STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
  var STORAGE_KEY_SYNC_ENABLE_WEBDAV = "pass.sync.enableWebDAV.v3";
  var STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER = "pass.sync.enableSelfHostedServer.v3";
  var STORAGE_KEY_SYNC_WEBDAV_BASE_URL = "pass.sync.webdav.baseUrl.v2";
  var STORAGE_KEY_SYNC_WEBDAV_PATH = "pass.sync.webdav.path.v2";
  var STORAGE_KEY_SYNC_WEBDAV_USERNAME = "pass.sync.webdav.username.v2";
  var STORAGE_KEY_SYNC_SERVER_BASE_URL = "pass.sync.server.baseUrl.v2";
  var STORAGE_KEY_SYNC_PRIMARY_SOURCE = "pass.sync.primarySource.v1";
  var STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES = "pass.sync.autoIntervalMinutes.v1";
  var STORAGE_KEY_SYNC_DEVICE_ID = "pass.sync.deviceId.v1";
  var STORAGE_KEY_SYNC_OPERATION_LOCK = "pass.sync.operationLock.v1";
  var SYNC_OPERATION_LOCK_TTL_MS = 10 * 60 * 1e3;
  var DEFAULT_SELF_HOSTED_SERVER_BASE_URL = "https://uk.sbbz.tech:5443";
  var SYNC_MODE_MERGE = "merge";
  var SYNC_MODE_REMOTE_OVERWRITE_LOCAL = "remoteOverwriteLocal";
  var SYNC_MODE_LOCAL_OVERWRITE_REMOTE = "localOverwriteRemote";
  var SYNC_PRIMARY_SERVER = "server";
  var SYNC_PRIMARY_WEBDAV = "webdav";
  var SYNC_BUNDLE_SCHEMA_V2 = "pass.sync.bundle.v2";
  var TOTP_PERIOD_SECONDS = 30;
  var TOTP_DIGITS = 6;
  var TOTP_REFRESH_INTERVAL_MS = 1e3;
  var OPTIONS_TOAST_DURATION_MS = 3e3;
  var SYNC_HTTP_TIMEOUT_MS = 3e4;
  async function fetchWithSyncTimeout(url, options = {}, stage = "\u540C\u6B65\u8BF7\u6C42") {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), SYNC_HTTP_TIMEOUT_MS) : null;
    try {
      return await fetch(url, controller ? { ...options, signal: controller.signal } : options);
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new Error(`${stage}\u8D85\u65F6\uFF08${SYNC_HTTP_TIMEOUT_MS / 1e3} \u79D2\uFF09`);
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
  function normalizeWebdavRemotePath(value) {
    const raw = String(value || "").trim();
    if (!raw || /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.includes("?") || raw.includes("#")) {
      throw new Error("WebDAV \u8FDC\u7AEF\u8DEF\u5F84\u5FC5\u987B\u662F\u76F8\u5BF9\u8DEF\u5F84\uFF0C\u4E14\u4E0D\u80FD\u5305\u542B\u67E5\u8BE2\u4E32\u6216\u951A\u70B9");
    }
    const path = raw.replace(/^\/+/, "");
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error("WebDAV \u8FDC\u7AEF\u8DEF\u5F84\u5305\u542B\u975E\u6CD5\u8DEF\u5F84\u6BB5");
    }
    return parts.join("/");
  }
  function normalizeLegacySelfHostedServerBaseUrl(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return DEFAULT_SELF_HOSTED_SERVER_BASE_URL;
    try {
      const parsed = new URL(trimmed);
      if (!isSecureSyncEndpoint(parsed)) return "";
      const host = String(parsed.hostname || "").toLowerCase();
      const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
      if ((host === "127.0.0.1" || host === "localhost") && port === 53333) {
        return DEFAULT_SELF_HOSTED_SERVER_BASE_URL;
      }
      if (host === "or.sbbz.tech" && port === 5443) {
        return DEFAULT_SELF_HOSTED_SERVER_BASE_URL;
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  function isSecureSyncEndpoint(url) {
    if (url.protocol === "https:") return true;
    const host = String(url.hostname || "").toLowerCase();
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(host);
  }
  function isSecureSyncEndpointValue(value) {
    try {
      return isSecureSyncEndpoint(new URL(String(value || "").trim()));
    } catch {
      return false;
    }
  }
  var dom = {
    deviceName: document.getElementById("deviceName"),
    syncEnableWebdav: document.getElementById("syncEnableWebdav"),
    syncEnableServer: document.getElementById("syncEnableServer"),
    syncPrimarySource: document.getElementById("syncPrimarySource"),
    syncMergeBtn: document.getElementById("syncMergeBtn"),
    syncPreviewBtn: document.getElementById("syncPreviewBtn"),
    syncPreviewStatus: document.getElementById("syncPreviewStatus"),
    syncRemoteOverwriteLocalBtn: document.getElementById("syncRemoteOverwriteLocalBtn"),
    syncLocalOverwriteRemoteBtn: document.getElementById("syncLocalOverwriteRemoteBtn"),
    syncLoadVersionsBtn: document.getElementById("syncLoadVersionsBtn"),
    syncVersionsStatus: document.getElementById("syncVersionsStatus"),
    syncVersionsList: document.getElementById("syncVersionsList"),
    syncWebdavFields: document.getElementById("syncWebdavFields"),
    syncServerFields: document.getElementById("syncServerFields"),
    syncWebdavBaseUrl: document.getElementById("syncWebdavBaseUrl"),
    syncWebdavPath: document.getElementById("syncWebdavPath"),
    syncWebdavUsername: document.getElementById("syncWebdavUsername"),
    syncWebdavPassword: document.getElementById("syncWebdavPassword"),
    syncServerBaseUrl: document.getElementById("syncServerBaseUrl"),
    syncServerToken: document.getElementById("syncServerToken"),
    syncEncryptionKey: document.getElementById("syncEncryptionKey"),
    syncEncryptionKeyIdStatus: document.getElementById("syncEncryptionKeyIdStatus"),
    syncPreviousEncryptionKey: document.getElementById("syncPreviousEncryptionKey"),
    generateSyncEncryptionKeyBtn: document.getElementById("generateSyncEncryptionKeyBtn"),
    syncAutoInterval: document.getElementById("syncAutoInterval"),
    syncAutoStatus: document.getElementById("syncAutoStatus"),
    syncOutboxStatus: document.getElementById("syncOutboxStatus"),
    syncRetryOutboxBtn: document.getElementById("syncRetryOutboxBtn"),
    syncClearOrphanedOutboxBtn: document.getElementById("syncClearOrphanedOutboxBtn"),
    storageSelfCheckBtn: document.getElementById("storageSelfCheckBtn"),
    exportDiagnosticsBtn: document.getElementById("exportDiagnosticsBtn"),
    restoreLatestSnapshotBtn: document.getElementById("restoreLatestSnapshotBtn"),
    storageDiagnosticsStatus: document.getElementById("storageDiagnosticsStatus"),
    deviceStatus: document.getElementById("deviceStatus"),
    lockEnabled: document.getElementById("lockEnabled"),
    lockAdvancedFields: document.getElementById("lockAdvancedFields"),
    lockPolicyOnceRadio: document.getElementById("lockPolicyOnce"),
    lockPolicyIdleRadio: document.getElementById("lockPolicyIdle"),
    lockPolicyBackgroundRadio: document.getElementById("lockPolicyBackground"),
    lockIdleMinutesRow: document.getElementById("lockIdleMinutesRow"),
    lockIdleMinutes: document.getElementById("lockIdleMinutes"),
    lockMasterPassword: document.getElementById("lockMasterPassword"),
    lockMasterPasswordConfirm: document.getElementById("lockMasterPasswordConfirm"),
    lockCredentialHint: document.getElementById("lockCredentialHint"),
    allAccountsCount: document.getElementById("allAccountsCount"),
    passkeyAccountsCount: document.getElementById("passkeyAccountsCount"),
    totpAccountsCount: document.getElementById("totpAccountsCount"),
    allAccountsList: document.getElementById("allAccountsList"),
    recycleAccountsCount: document.getElementById("recycleAccountsCount"),
    accountsTabAll: document.getElementById("accountsTabAll"),
    accountsTabPasskey: document.getElementById("accountsTabPasskey"),
    accountsTabTotp: document.getElementById("accountsTabTotp"),
    accountsTabRecycle: document.getElementById("accountsTabRecycle"),
    accountsFolderList: document.getElementById("accountsFolderList"),
    createFolderBtn: document.getElementById("createFolderBtn"),
    allAccountsSearchWrap: document.getElementById("allAccountsSearchWrap"),
    allAccountsSearchFieldsBtn: document.getElementById("allAccountsSearchFieldsBtn"),
    allAccountsSearchFieldsPanel: document.getElementById("allAccountsSearchFieldsPanel"),
    allAccountsSearchFieldAll: document.getElementById("allAccountsSearchFieldAll"),
    allAccountsSearchFieldUsername: document.getElementById("allAccountsSearchFieldUsername"),
    allAccountsSearchFieldSites: document.getElementById("allAccountsSearchFieldSites"),
    allAccountsSearchFieldNote: document.getElementById("allAccountsSearchFieldNote"),
    allAccountsSearchFieldPassword: document.getElementById("allAccountsSearchFieldPassword"),
    allAccountsSearch: document.getElementById("allAccountsSearch"),
    openSortModalBtn: document.getElementById("openSortModal"),
    openHistoryModalBtn: document.getElementById("openHistoryModal"),
    clearActiveAccountsBtn: document.getElementById("clearActiveAccounts"),
    clearRecycleBinBtn: document.getElementById("clearRecycleBin"),
    sortModal: document.getElementById("sortModal"),
    sortModalList: document.getElementById("sortModalList"),
    closeSortModalBtn: document.getElementById("closeSortModal"),
    historyModal: document.getElementById("historyModal"),
    historyModalList: document.getElementById("historyModalList"),
    closeHistoryModalBtn: document.getElementById("closeHistoryModal"),
    addSitesToFolderModal: document.getElementById("addSitesToFolderModal"),
    addSitesToFolderInput: document.getElementById("addSitesToFolderInput"),
    addSitesToFolderAutoAdd: document.getElementById("addSitesToFolderAutoAdd"),
    cancelAddSitesToFolderBtn: document.getElementById("cancelAddSitesToFolder"),
    confirmAddSitesToFolderBtn: document.getElementById("confirmAddSitesToFolder"),
    refreshBtn: document.getElementById("refreshBtn"),
    exportSyncBundleBtn: document.getElementById("exportSyncBundleBtn"),
    exportChromeCsvBtn: document.getElementById("exportChromeCsvBtn"),
    exportFirefoxCsvBtn: document.getElementById("exportFirefoxCsvBtn"),
    exportSafariCsvBtn: document.getElementById("exportSafariCsvBtn"),
    importSyncBundleBtn: document.getElementById("importSyncBundleBtn"),
    importBrowserCsvBtn: document.getElementById("importBrowserCsvBtn"),
    importGoogleAuthQrBtn: document.getElementById("importGoogleAuthQrBtn"),
    importGoogleAuthQrFilesBtn: document.getElementById("importGoogleAuthQrFilesBtn"),
    importGoogleAuthFolderSelect: document.getElementById("importGoogleAuthFolderSelect"),
    importGoogleAuthNewFolderName: document.getElementById("importGoogleAuthNewFolderName"),
    clearBtn: document.getElementById("clearBtn"),
    status: document.getElementById("status")
  };
  var accountsRaw = [];
  var passkeysRaw = [];
  var foldersRaw = [];
  var editingAccountId = null;
  var totpRefreshTimer = null;
  var accountSearchUseAll = true;
  var accountSearchFields = /* @__PURE__ */ new Set();
  var activeAccountView = "all";
  var contextMenuElement = null;
  var contextMenuOutsideHandler = null;
  var contextMenuEscapeHandler = null;
  var lockCredentialExists = false;
  var sortModalOrderIds = [];
  var sortModalDraggingAccountId = "";
  var historyEntries = [];
  var optionsToastTimer = null;
  var addSitesTargetFolderId = null;
  var deviceNameSaveTimer = null;
  var syncSettingsSaveTimer = null;
  var lockSettingsSaveTimer = null;
  var syncInFlight = false;
  var optionsLocked = false;
  var enqueueLockStateTransition = createLockStateTransitionQueue();
  async function acquireSyncOperationLock(owner) {
    const storage = chrome.storage?.session;
    if (!storage) return owner;
    const now = Date.now();
    const current = await storage.get([STORAGE_KEY_SYNC_OPERATION_LOCK]);
    const lock = current[STORAGE_KEY_SYNC_OPERATION_LOCK];
    if (lock && Number(lock.expiresAtMs) > now && lock.owner !== owner) return null;
    await storage.set({
      [STORAGE_KEY_SYNC_OPERATION_LOCK]: { owner, expiresAtMs: now + SYNC_OPERATION_LOCK_TTL_MS }
    });
    const verified = await storage.get([STORAGE_KEY_SYNC_OPERATION_LOCK]);
    return verified[STORAGE_KEY_SYNC_OPERATION_LOCK]?.owner === owner ? owner : null;
  }
  async function releaseSyncOperationLock(owner) {
    const storage = chrome.storage?.session;
    if (!storage) return;
    const current = await storage.get([STORAGE_KEY_SYNC_OPERATION_LOCK]);
    if (current[STORAGE_KEY_SYNC_OPERATION_LOCK]?.owner === owner) {
      await storage.remove(STORAGE_KEY_SYNC_OPERATION_LOCK);
    }
  }
  var AUTO_SYNC_INTERVAL_OPTIONS = /* @__PURE__ */ new Set(["0", "1", "3", "5", "10", "15", "30", "60"]);
  init().catch((error) => {
    console.error("[Pass options] \u521D\u59CB\u5316\u5931\u8D25", error);
    const detail = [error?.name, error?.code, error?.message, String(error)].map((value) => String(value || "").trim()).filter((value, index, values) => value && values.indexOf(value) === index).join(" | ");
    setStatus(`\u521D\u59CB\u5316\u5931\u8D25: ${detail || "\u672A\u77E5\u9519\u8BEF\uFF0C\u8BF7\u67E5\u770B\u6269\u5C55 Service Worker \u63A7\u5236\u53F0"}\uFF1B\u6570\u636E\u672A\u88AB\u4FEE\u6539`);
  });
  async function init() {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    await loadDeviceName();
    await loadLockSettings();
    await ensureOptionsUnlocked();
    await ensureDataStorageReady();
    await loadSyncSettings();
    await refreshSyncOutboxStatus();
    await refresh();
    startTotpRefreshTicker();
    dom.syncMergeBtn.addEventListener("click", () => syncNowWithRemote(SYNC_MODE_MERGE));
    dom.syncRetryOutboxBtn.addEventListener("click", () => syncNowWithRemote(SYNC_MODE_MERGE));
    dom.syncClearOrphanedOutboxBtn.addEventListener("click", () => void clearOrphanedSyncOutbox());
    dom.storageSelfCheckBtn.addEventListener("click", () => void runStorageSelfCheck());
    dom.exportDiagnosticsBtn.addEventListener("click", () => void exportStorageDiagnostics());
    dom.restoreLatestSnapshotBtn.addEventListener("click", () => void restoreLatestSafetySnapshot());
    dom.syncPreviewBtn.addEventListener("click", () => void previewSyncWithRemote());
    dom.syncRemoteOverwriteLocalBtn.addEventListener("click", async () => {
      const shouldContinue = await confirmRemoteOverwriteLocalIfNeeded();
      if (!shouldContinue) return;
      await syncNowWithRemote(SYNC_MODE_REMOTE_OVERWRITE_LOCAL);
    });
    dom.syncLocalOverwriteRemoteBtn.addEventListener("click", async () => {
      const shouldContinue = await confirmLocalOverwriteRemoteIfNeeded();
      if (!shouldContinue) return;
      await syncNowWithRemote(SYNC_MODE_LOCAL_OVERWRITE_REMOTE);
    });
    dom.syncLoadVersionsBtn.addEventListener("click", () => void loadServerSyncVersions());
    dom.deviceName.addEventListener("input", () => {
      scheduleDeviceNameSave();
    });
    dom.deviceName.addEventListener("change", () => {
      void saveDeviceName({ showStatus: false });
    });
    dom.syncEnableWebdav.addEventListener("change", () => {
      renderSyncBackendFields();
      void persistSyncSettings({ showStatus: false });
    });
    dom.syncEnableServer.addEventListener("change", () => {
      renderSyncBackendFields();
      void persistSyncSettings({ showStatus: false });
    });
    dom.syncPrimarySource.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
    dom.syncAutoInterval.addEventListener("change", () => {
      renderAutoSyncStatus();
      void persistSyncSettings({ showStatus: false });
    });
    dom.syncWebdavBaseUrl.addEventListener("input", scheduleSyncSettingsSave);
    dom.syncWebdavPath.addEventListener("input", scheduleSyncSettingsSave);
    dom.syncWebdavUsername.addEventListener("input", scheduleSyncSettingsSave);
    dom.syncWebdavPassword.addEventListener("input", scheduleSyncSettingsSave);
    dom.syncServerBaseUrl.addEventListener("input", scheduleSyncSettingsSave);
    dom.syncServerToken.addEventListener("input", scheduleSyncSettingsSave);
    dom.syncEncryptionKey.addEventListener("input", scheduleSyncSettingsSave);
    dom.syncEncryptionKey.addEventListener("input", () => void refreshSyncEncryptionKeyIdStatus());
    dom.syncWebdavBaseUrl.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
    dom.syncWebdavPath.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
    dom.syncWebdavUsername.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
    dom.syncWebdavPassword.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
    dom.syncServerBaseUrl.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
    dom.syncServerToken.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
    dom.syncEncryptionKey.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
    dom.syncPreviousEncryptionKey.addEventListener("input", scheduleSyncSettingsSave);
    dom.syncPreviousEncryptionKey.addEventListener("change", () => void persistSyncSettings({ showStatus: false }));
    dom.generateSyncEncryptionKeyBtn.addEventListener("click", () => {
      dom.syncEncryptionKey.value = generateSyncEncryptionKey();
      void persistSyncSettings({ showStatus: true });
    });
    dom.lockEnabled.addEventListener("change", () => {
      renderLockSettingsFields();
      void saveLockSettings({ showStatus: false });
    });
    dom.lockPolicyOnceRadio.addEventListener("change", () => {
      renderLockSettingsFields();
      void saveLockSettings({ showStatus: false });
    });
    dom.lockPolicyIdleRadio.addEventListener("change", () => {
      renderLockSettingsFields();
      void saveLockSettings({ showStatus: false });
    });
    dom.lockPolicyBackgroundRadio.addEventListener("change", () => {
      renderLockSettingsFields();
      void saveLockSettings({ showStatus: false });
    });
    dom.lockIdleMinutes.addEventListener("input", scheduleLockSettingsSave);
    dom.lockIdleMinutes.addEventListener("change", () => void saveLockSettings({ showStatus: false }));
    dom.lockMasterPassword.addEventListener("input", scheduleLockSettingsSave);
    dom.lockMasterPasswordConfirm.addEventListener("input", scheduleLockSettingsSave);
    dom.lockMasterPassword.addEventListener("change", () => void saveLockSettings({ showStatus: false }));
    dom.lockMasterPasswordConfirm.addEventListener("change", () => void saveLockSettings({ showStatus: false }));
    dom.createFolderBtn.addEventListener("click", createFolderFromPrompt);
    dom.accountsFolderList.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".account-view-tab")) return;
      event.preventDefault();
      closeContextMenu();
    });
    dom.allAccountsList.addEventListener("contextmenu", (event) => {
      if (event.target.closest(".account")) return;
      event.preventDefault();
      closeContextMenu();
    });
    dom.accountsTabAll.addEventListener("click", () => setAccountView("all"));
    dom.accountsTabPasskey.addEventListener("click", () => setAccountView("passkeys"));
    dom.accountsTabTotp.addEventListener("click", () => setAccountView("totp"));
    dom.accountsTabRecycle.addEventListener("click", () => setAccountView("recycle"));
    dom.allAccountsSearch.addEventListener("input", () => renderCurrentView(accountsRaw));
    dom.openSortModalBtn.addEventListener("click", openSortModal);
    dom.openHistoryModalBtn.addEventListener("click", openHistoryModal);
    dom.closeSortModalBtn.addEventListener("click", closeSortModal);
    dom.closeHistoryModalBtn.addEventListener("click", closeHistoryModal);
    dom.cancelAddSitesToFolderBtn.addEventListener("click", closeAddSitesToFolderModal);
    dom.confirmAddSitesToFolderBtn.addEventListener("click", addAccountsMatchingSitesToFolderFromModal);
    dom.sortModal.addEventListener("click", (event) => {
      if (event.target === dom.sortModal) {
        closeSortModal();
      }
    });
    dom.historyModal.addEventListener("click", (event) => {
      if (event.target === dom.historyModal) {
        closeHistoryModal();
      }
    });
    dom.addSitesToFolderModal.addEventListener("click", (event) => {
      if (event.target === dom.addSitesToFolderModal) {
        closeAddSitesToFolderModal();
      }
    });
    dom.allAccountsSearchFieldsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      dom.allAccountsSearchFieldsPanel.classList.toggle("hidden");
      syncAllAccountSearchFieldCheckboxes();
    });
    dom.allAccountsSearchFieldAll.addEventListener("change", onAllAccountSearchFieldAllChanged);
    dom.allAccountsSearchFieldUsername.addEventListener("change", onAllAccountSearchFieldChanged);
    dom.allAccountsSearchFieldSites.addEventListener("change", onAllAccountSearchFieldChanged);
    dom.allAccountsSearchFieldNote.addEventListener("change", onAllAccountSearchFieldChanged);
    dom.allAccountsSearchFieldPassword.addEventListener("change", onAllAccountSearchFieldChanged);
    dom.allAccountsSearchFieldsPanel.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    document.addEventListener("click", (event) => {
      closeContextMenuIfNeeded(event);
      if (dom.allAccountsSearchFieldsPanel.classList.contains("hidden")) return;
      const wrap = dom.allAccountsSearchFieldsPanel.closest(".search-filter-wrap");
      if (wrap && wrap.contains(event.target)) return;
      closeAllAccountsSearchFieldsPanel();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
      if (event.key === "Escape" && !dom.sortModal.classList.contains("hidden")) {
        closeSortModal();
        return;
      }
      if (event.key === "Escape" && !dom.historyModal.classList.contains("hidden")) {
        closeHistoryModal();
        return;
      }
      if (event.key === "Escape" && !dom.addSitesToFolderModal.classList.contains("hidden")) {
        closeAddSitesToFolderModal();
        return;
      }
      if (event.key === "Escape" && !dom.allAccountsSearchFieldsPanel.classList.contains("hidden")) {
        closeAllAccountsSearchFieldsPanel();
      }
      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) {
        if (isMultilineInputTarget(event.target)) return;
        const actionButton = findDefaultActionButtonForOptions(event.target);
        if (actionButton && !actionButton.disabled) {
          event.preventDefault();
          actionButton.click();
        }
      }
    });
    document.addEventListener("scroll", () => {
      closeContextMenu();
    }, true);
    dom.clearActiveAccountsBtn.addEventListener("click", clearActiveAccounts);
    dom.clearRecycleBinBtn.addEventListener("click", clearRecycleBin);
    dom.refreshBtn.addEventListener("click", () => refresh());
    dom.exportSyncBundleBtn.addEventListener("click", exportSyncBundle);
    dom.exportChromeCsvBtn.addEventListener("click", () => exportBrowserPasswordCsv("chrome"));
    dom.exportFirefoxCsvBtn.addEventListener("click", () => exportBrowserPasswordCsv("firefox"));
    dom.exportSafariCsvBtn.addEventListener("click", () => exportBrowserPasswordCsv("safari"));
    dom.importSyncBundleBtn.addEventListener("click", importSyncBundleAndMerge);
    dom.importBrowserCsvBtn.addEventListener("click", importBrowserPasswordCsv);
    dom.importGoogleAuthQrBtn.addEventListener("click", importGoogleAuthenticatorExportQrFromClipboard);
    dom.importGoogleAuthQrFilesBtn.addEventListener("click", importGoogleAuthenticatorExportQrFromFiles);
    dom.clearBtn.addEventListener("click", clearAll);
  }
  function handleRuntimeMessage(message) {
    if (message?.type !== LOCK_STATE_CHANGED_MESSAGE) return;
    void enqueueLockStateTransition(message, {
      lock: async () => {
        optionsLocked = true;
        await lockDataEncryption();
      },
      clear: () => {
        clearOptionsSensitiveState();
        setStatus("\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u8BF7\u8F93\u5165\u4E3B\u5BC6\u7801\u540E\u91CD\u65B0\u52A0\u8F7D\u8BBE\u7F6E\u3002");
      },
      unlock: async () => {
        optionsLocked = false;
        await resumeOptionsAfterExternalUnlock();
      }
    }).catch((error) => {
      console.warn("[Pass options] \u9501\u72B6\u6001\u5207\u6362\u5931\u8D25", error);
    });
  }
  function clearOptionsSensitiveState() {
    accountsRaw = [];
    passkeysRaw = [];
    foldersRaw = [];
    historyEntries = [];
    editingAccountId = null;
    closeContextMenu();
    closeSortModal();
    closeHistoryModal();
    closeAddSitesToFolderModal();
    closeAllAccountsSearchFieldsPanel();
    dom.syncWebdavPassword.value = "";
    dom.syncServerToken.value = "";
    dom.syncEncryptionKey.value = "";
    dom.syncPreviousEncryptionKey.value = "";
    dom.lockMasterPassword.value = "";
    dom.lockMasterPasswordConfirm.value = "";
    renderSidebar(accountsRaw);
    renderCurrentView(accountsRaw);
  }
  async function resumeOptionsAfterExternalUnlock() {
    try {
      await ensureOptionsUnlocked();
      if (optionsLocked) return;
      await Promise.all([loadSyncSettings(), refreshSyncOutboxStatus(), refresh({ silent: true })]);
      setStatus("\u6269\u5C55\u5DF2\u89E3\u9501\uFF0C\u5DF2\u91CD\u65B0\u52A0\u8F7D\u6570\u636E\u3002");
    } catch {
    }
  }
  async function ensureOptionsUnlocked() {
    const status = await chrome.runtime.sendMessage({ type: "PASS_LOCK_STATUS" });
    optionsLocked = Boolean(status?.enabled && status?.locked);
    if (!optionsLocked) return;
    const password = String(window.prompt("\u8BF7\u8F93\u5165\u4E3B\u5BC6\u7801\u4EE5\u6253\u5F00 Pass \u8BBE\u7F6E", "") || "");
    if (!password) throw new Error("\u6269\u5C55\u5DF2\u9501\u5B9A\uFF0C\u672A\u52A0\u8F7D\u8D26\u53F7\u6570\u636E");
    const result = await chrome.runtime.sendMessage({
      type: "PASS_LOCK_UNLOCK",
      payload: { password }
    });
    if (!result?.ok || result?.locked) throw new Error("\u4E3B\u5BC6\u7801\u9519\u8BEF\uFF0C\u672A\u52A0\u8F7D\u8D26\u53F7\u6570\u636E");
    optionsLocked = false;
  }
  async function loadDeviceName() {
    const result = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
    dom.deviceName.value = String(result[STORAGE_KEY_DEVICE_NAME] || DEFAULT_DEVICE_NAME);
  }
  function scheduleDeviceNameSave() {
    window.clearTimeout(deviceNameSaveTimer);
    deviceNameSaveTimer = window.setTimeout(() => {
      void saveDeviceName({ showStatus: false });
    }, 250);
  }
  function scheduleSyncSettingsSave() {
    window.clearTimeout(syncSettingsSaveTimer);
    syncSettingsSaveTimer = window.setTimeout(() => {
      void persistSyncSettings({ showStatus: false });
    }, 250);
  }
  function scheduleLockSettingsSave() {
    window.clearTimeout(lockSettingsSaveTimer);
    lockSettingsSaveTimer = window.setTimeout(() => {
      void saveLockSettings({ showStatus: false });
    }, 350);
  }
  async function saveDeviceName({ showStatus = true } = {}) {
    const next = String(dom.deviceName.value || "").trim();
    if (!next) {
      if (showStatus) {
        setDeviceStatus("\u8BBE\u5907\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
      }
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: next });
    if (showStatus) {
      setDeviceStatus(`\u8BBE\u5907\u540D\u79F0\u5DF2\u4FDD\u5B58\u4E3A ${next}`);
    }
  }
  async function readBusinessDataFromStore() {
    const stored = await getAllData();
    return {
      accounts: Array.isArray(stored?.accounts) ? stored.accounts : [],
      passkeys: Array.isArray(stored?.passkeys) ? stored.passkeys : [],
      folders: Array.isArray(stored?.folders) ? stored.folders : [],
      allRegularAccountIds: Array.isArray(stored?.allRegularAccountIds) ? stored.allRegularAccountIds : [],
      allRegularOrderUpdatedAtMs: Number(stored?.allRegularOrderUpdatedAtMs) || 0,
      allRegularOrderUpdatedDeviceName: String(stored?.allRegularOrderUpdatedDeviceName || ""),
      folderOrderIds: Array.isArray(stored?.folderOrderIds) ? stored.folderOrderIds : [],
      folderOrderUpdatedAtMs: Number(stored?.folderOrderUpdatedAtMs) || 0,
      folderOrderUpdatedDeviceName: String(stored?.folderOrderUpdatedDeviceName || ""),
      deviceName: String(stored?.deviceName || "")
    };
  }
  function normalizeSyncPayloadShape(payload) {
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts.map(normalizeAccountShape) : [];
    const rawPasskeys = Array.isArray(payload?.passkeys) ? payload.passkeys.map(normalizePasskeyShape) : [];
    const folders = Array.isArray(payload?.folders) ? payload.folders.map(normalizeFolderShape) : [];
    return {
      accounts,
      passkeys: buildUnifiedPasskeys(accounts, rawPasskeys),
      folders,
      allRegularAccountIds: Array.isArray(payload?.allRegularAccountIds) ? payload.allRegularAccountIds.map(String).filter(Boolean) : [],
      allRegularOrderUpdatedAtMs: Number(payload?.allRegularOrderUpdatedAtMs) || 0,
      allRegularOrderUpdatedDeviceName: String(payload?.allRegularOrderUpdatedDeviceName || ""),
      folderOrderIds: Array.isArray(payload?.folderOrderIds) ? payload.folderOrderIds.map(String).filter(Boolean) : [],
      folderOrderUpdatedAtMs: Number(payload?.folderOrderUpdatedAtMs) || 0,
      folderOrderUpdatedDeviceName: String(payload?.folderOrderUpdatedDeviceName || ""),
      deviceName: String(payload?.deviceName || "")
    };
  }
  function visibleSyncCount(values) {
    return (Array.isArray(values) ? values : []).filter((item) => item?.isPermanentlyDeleted !== true).length;
  }
  function syncPayloadEquals(lhs, rhs) {
    return JSON.stringify(sortSyncPayloadCollections(normalizeSyncPayloadShape(lhs))) === JSON.stringify(sortSyncPayloadCollections(normalizeSyncPayloadShape(rhs)));
  }
  function sortSyncPayloadCollections(payload) {
    const compare = (lhs, rhs, keys) => {
      for (const key of keys) {
        const left = String(lhs?.[key] || "").trim().toLowerCase();
        const right = String(rhs?.[key] || "").trim().toLowerCase();
        if (left < right) return -1;
        if (left > right) return 1;
      }
      return 0;
    };
    return {
      ...payload,
      accounts: [...payload?.accounts || []].sort((lhs, rhs) => compare(lhs, rhs, ["recordId", "accountId"])),
      passkeys: [...payload?.passkeys || []].sort((lhs, rhs) => compare(lhs, rhs, ["credentialIdB64u"])),
      folders: [...payload?.folders || []].sort((lhs, rhs) => compare(lhs, rhs, ["id"]))
    };
  }
  function countSyncAccountConflicts(localAccounts, remoteAccounts) {
    const localByKey = /* @__PURE__ */ new Map();
    for (const account of localAccounts || []) {
      const key = String(account?.recordId || account?.id || account?.accountId || "").trim().toLowerCase();
      if (key) localByKey.set(key, account);
    }
    const fields = ["username", "password", "totpSecret", "recoveryCodes", "note", "isDeleted"];
    let count = 0;
    for (const remote of remoteAccounts || []) {
      const key = String(remote?.recordId || remote?.id || remote?.accountId || "").trim().toLowerCase();
      const local = localByKey.get(key);
      if (!local) continue;
      count += fields.filter((field) => String(local[field] ?? "") !== String(remote[field] ?? "")).length;
    }
    return count;
  }
  async function writeBusinessDataToStore(payload = {}) {
    const currentPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
    const nextPayload = normalizeSyncPayloadShape({ ...currentPayload, ...payload || {} });
    if (syncPayloadEquals(currentPayload, nextPayload)) {
      return false;
    }
    await setAllData(nextPayload);
    return true;
  }
  async function loadHistory() {
    const raw = await getHistory();
    historyEntries = (Array.isArray(raw) ? raw : []).map((item) => ({
      id: String(item?.id || ""),
      timestampMs: Number(item?.timestampMs || 0),
      action: String(item?.action || "").trim()
    })).filter((item) => item.timestampMs > 0 && item.action.length > 0).sort((lhs, rhs) => {
      if (lhs.timestampMs !== rhs.timestampMs) return rhs.timestampMs - lhs.timestampMs;
      return lhs.id.localeCompare(rhs.id);
    });
  }
  async function appendHistory(action, timestampMs = Date.now()) {
    const normalizedAction = String(action || "").trim();
    if (!normalizedAction) return;
    await appendHistoryEntry({ action: normalizedAction, timestampMs });
    if (!dom.historyModal.classList.contains("hidden")) {
      await loadHistory();
      renderHistoryModalList();
    }
  }
  function historyValueSnippet(input, maxLength = 80) {
    const normalized = String(input || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!normalized) return "(\u7A7A)";
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}...`;
  }
  async function loadSyncSettings() {
    const result = await chrome.storage.local.get([
      STORAGE_KEY_SYNC_ENABLE_WEBDAV,
      STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER,
      STORAGE_KEY_SYNC_WEBDAV_BASE_URL,
      STORAGE_KEY_SYNC_WEBDAV_PATH,
      STORAGE_KEY_SYNC_WEBDAV_USERNAME,
      STORAGE_KEY_SYNC_SERVER_BASE_URL,
      STORAGE_KEY_SYNC_PRIMARY_SOURCE,
      STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES
    ]);
    let secrets;
    try {
      secrets = await migrateLegacySyncSecrets();
    } catch (error) {
      if (error?.code !== "SYNC_SECRETS_UNREADABLE") throw error;
      secrets = { webdavPassword: "", serverToken: "", encryptionKey: "" };
      dom.storageDiagnosticsStatus.textContent = "\u540C\u6B65\u51ED\u636E\u96C6\u5408\u65E0\u6CD5\u89E3\u5BC6\uFF0C\u539F\u6570\u636E\u672A\u8986\u76D6\uFF1B\u8BF7\u5148\u5BFC\u51FA\u8BCA\u65AD\u6216\u91CD\u65B0\u914D\u7F6E\u540C\u6B65\u51ED\u636E";
    }
    const hasEnableWebdav = typeof result[STORAGE_KEY_SYNC_ENABLE_WEBDAV] === "boolean";
    const hasEnableServer = typeof result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER] === "boolean";
    const enableWebdav = hasEnableWebdav ? Boolean(result[STORAGE_KEY_SYNC_ENABLE_WEBDAV]) : false;
    const enableServer = hasEnableServer ? Boolean(result[STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER]) : false;
    dom.syncEnableWebdav.checked = enableWebdav;
    dom.syncEnableServer.checked = enableServer;
    dom.syncPrimarySource.value = normalizeSyncPrimarySource(result[STORAGE_KEY_SYNC_PRIMARY_SOURCE]);
    dom.syncWebdavBaseUrl.value = String(result[STORAGE_KEY_SYNC_WEBDAV_BASE_URL] || "");
    dom.syncWebdavPath.value = String(result[STORAGE_KEY_SYNC_WEBDAV_PATH] || "pass-sync-bundle-v2.json");
    dom.syncWebdavUsername.value = String(result[STORAGE_KEY_SYNC_WEBDAV_USERNAME] || "");
    dom.syncWebdavPassword.value = secrets.webdavPassword;
    const normalizedServerBaseUrl = normalizeLegacySelfHostedServerBaseUrl(
      result[STORAGE_KEY_SYNC_SERVER_BASE_URL] || DEFAULT_SELF_HOSTED_SERVER_BASE_URL
    );
    dom.syncServerBaseUrl.value = normalizedServerBaseUrl;
    if (normalizedServerBaseUrl !== String(result[STORAGE_KEY_SYNC_SERVER_BASE_URL] || "").trim()) {
      await chrome.storage.local.set({ [STORAGE_KEY_SYNC_SERVER_BASE_URL]: normalizedServerBaseUrl });
    }
    dom.syncServerToken.value = secrets.serverToken;
    const syncEncryptionKey = normalizeSyncEncryptionKey(secrets.encryptionKey);
    dom.syncEncryptionKey.value = syncEncryptionKey;
    dom.syncPreviousEncryptionKey.value = normalizeSyncEncryptionKey(secrets.previousEncryptionKey);
    await refreshSyncEncryptionKeyIdStatus();
    if (syncEncryptionKey !== secrets.encryptionKey) {
      await setSyncSecrets({ ...secrets, encryptionKey: syncEncryptionKey });
    }
    dom.syncAutoInterval.value = normalizeAutoSyncIntervalMinutes(result[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]);
    if (normalizedServerBaseUrl !== String(result[STORAGE_KEY_SYNC_SERVER_BASE_URL] || "")) {
      await chrome.storage.local.set({ [STORAGE_KEY_SYNC_SERVER_BASE_URL]: normalizedServerBaseUrl });
    }
    renderSyncBackendFields();
  }
  function renderSyncBackendFields() {
    dom.syncWebdavFields.classList.toggle("hidden", !dom.syncEnableWebdav.checked);
    dom.syncServerFields.classList.toggle("hidden", !dom.syncEnableServer.checked);
    renderAutoSyncStatus();
  }
  function normalizeAutoSyncIntervalMinutes(value) {
    const normalized = String(value ?? "0").trim();
    return AUTO_SYNC_INTERVAL_OPTIONS.has(normalized) ? normalized : "0";
  }
  function normalizeSyncPrimarySource(value) {
    return String(value || "").trim() === SYNC_PRIMARY_WEBDAV ? SYNC_PRIMARY_WEBDAV : SYNC_PRIMARY_SERVER;
  }
  function confirmPlaintextSync(encryptionKey) {
    if (String(encryptionKey || "").trim()) return true;
    return window.confirm(
      "\u5F53\u524D\u672A\u914D\u7F6E\u540C\u6B65\u52A0\u5BC6\u5BC6\u94A5\uFF0C\u5C06\u4F7F\u7528\u660E\u6587\u540C\u6B65\u5305\uFF08\u53EF\u80FD\u5305\u542B\u5BC6\u7801\u3001TOTP\u3001\u5907\u6CE8\uFF09\u3002\n\n\u4EC5\u5EFA\u8BAE\u5728\u53EF\u4FE1\u7F51\u7EDC/\u81EA\u5EFA\u73AF\u5883\u4E34\u65F6\u4F7F\u7528\u3002\u786E\u5B9A\u7EE7\u7EED\uFF1F"
    );
  }
  function confirmOverwriteSync(mode) {
    if (mode === "merge" || mode === SYNC_MODE_MERGE) return true;
    const label = mode === SYNC_MODE_REMOTE_OVERWRITE_LOCAL || mode === "remoteOverwriteLocal" ? "\u4E91\u7AEF\u8986\u76D6\u672C\u5730" : "\u672C\u5730\u8986\u76D6\u4E91\u7AEF";
    return window.confirm(
      `${label}\u4F1A\u4E22\u5F03\u4E00\u4FA7\u7684\u72EC\u6709\u4FEE\u6539\uFF0C\u4E14\u4E0D\u53EF\u901A\u8FC7\u201C\u5408\u5E76\u201D\u81EA\u52A8\u6062\u590D\u3002

\u8BF7\u5148\u9884\u89C8\u5DEE\u5F02\u3002\u786E\u5B9A\u7EE7\u7EED\u6267\u884C${label}\uFF1F`
    );
  }
  function primarySourceLabel(value) {
    return normalizeSyncPrimarySource(value) === SYNC_PRIMARY_WEBDAV ? "WebDAV" : "\u670D\u52A1\u5668";
  }
  function renderAutoSyncStatus() {
    const interval = normalizeAutoSyncIntervalMinutes(dom.syncAutoInterval.value);
    const enabledLabels = [];
    if (dom.syncEnableWebdav.checked) enabledLabels.push("WebDAV");
    if (dom.syncEnableServer.checked) enabledLabels.push("\u670D\u52A1\u5668");
    if (interval === "0") {
      dom.syncAutoStatus.textContent = "\u81EA\u52A8\u540C\u6B65\u5DF2\u5173\u95ED";
      return;
    }
    if (enabledLabels.length === 0) {
      dom.syncAutoStatus.textContent = "\u81EA\u52A8\u540C\u6B65\u5DF2\u5F00\u542F\uFF0C\u4F46\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u8FDC\u7AEF\u540C\u6B65\u6E90";
      return;
    }
    dom.syncAutoStatus.textContent = `\u81EA\u52A8\u6309\u201C\u5408\u5E76\u201D\u6A21\u5F0F\u6267\u884C\uFF0C\u6BCF ${interval} \u5206\u949F\u540C\u6B65\u4E00\u6B21\uFF08${enabledLabels.join(" + ")}\uFF09`;
  }
  async function refreshSyncEncryptionKeyIdStatus() {
    const key = normalizeSyncEncryptionKey(dom.syncEncryptionKey.value);
    dom.syncEncryptionKeyIdStatus.textContent = key ? `\u5F53\u524D\u540C\u6B65\u5BC6\u94A5 ID\uFF1A${await syncEncryptionKeyId(key)}\u3002\u914D\u5BF9\u3001\u8F6E\u6362\u6216\u6392\u67E5\u5BC6\u94A5\u4E0D\u5339\u914D\u65F6\u8BF7\u6838\u5BF9\u6B64\u6807\u8BC6\u3002` : "\u5F53\u524D\u672A\u914D\u7F6E\u540C\u6B65\u5BC6\u94A5\uFF0C\u5C06\u4F7F\u7528\u660E\u6587\u540C\u6B65\u5305\uFF1B\u8BF7\u786E\u8BA4\u540C\u6B65\u670D\u52A1\u5668\u5141\u8BB8\u660E\u6587\u3002";
  }
  async function refreshSyncOutboxStatus() {
    if (!dom.syncOutboxStatus) return;
    try {
      const items = await getSyncOutbox();
      dom.syncRetryOutboxBtn.disabled = items.length === 0;
      if (!items.length) {
        dom.syncOutboxStatus.textContent = "\u540C\u6B65\u8865\u507F\u961F\u5217\u4E3A\u7A7A";
        return;
      }
      const now = Date.now();
      const waiting = items.filter((item) => Number(item.nextRetryAtMs || 0) > now).length;
      const details = items.map((item) => {
        const [kind, ...targetParts] = String(item.targetKey || "").split("|");
        const target = targetParts.join("|");
        let host = target;
        try {
          host = new URL(target).host || target;
        } catch {
        }
        const label = kind === "server" ? "\u670D\u52A1\u5668" : kind === "webdav" ? "WebDAV" : kind;
        const retryAt = Number(item.nextRetryAtMs || 0);
        const retry = retryAt > now ? `\u4E0B\u6B21 ${new Date(retryAt).toLocaleTimeString()}` : "\u53EF\u7ACB\u5373\u91CD\u8BD5";
        const error = String(item.lastError || "").trim();
        return `${label} ${host}\uFF1A\u5931\u8D25 ${Number(item.attempts || 0)} \u6B21\uFF0C${retry}${error ? `\uFF0C${error}` : ""}`;
      });
      dom.syncOutboxStatus.textContent = `\u8865\u507F\u4EFB\u52A1 ${items.length} \u4E2A\uFF08\u7B49\u5F85 ${waiting} \u4E2A\uFF09\uFF1A${details.join("\uFF1B")}`;
      dom.syncOutboxStatus.title = details.join("\n");
    } catch (error) {
      dom.syncOutboxStatus.textContent = `\u540C\u6B65\u8865\u507F\u961F\u5217\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`;
    }
  }
  async function clearOrphanedSyncOutbox() {
    try {
      const items = await getSyncOutbox();
      const targets = buildRemoteSyncTargetsFromDom() || [];
      const activeKeys = new Set(targets.map(syncTargetKey));
      const next = removeOrphanedSyncOutbox(items, activeKeys);
      const removed = items.length - next.length;
      if (removed > 0) await setSyncOutbox(next);
      await refreshSyncOutboxStatus();
      setStatus(removed > 0 ? `\u5DF2\u6E05\u7406 ${removed} \u4E2A\u5931\u6548\u540C\u6B65\u76EE\u6807\u4EFB\u52A1` : "\u6CA1\u6709\u5931\u6548\u540C\u6B65\u76EE\u6807\u4EFB\u52A1");
    } catch (error) {
      setStatus(`\u6E05\u7406\u540C\u6B65\u8865\u507F\u4EFB\u52A1\u5931\u8D25\uFF1A${error.message}`);
    }
  }
  async function recordSyncOutboxFailure(target, payload, error) {
    const targetKey = syncTargetKey(target);
    const items = await getSyncOutbox();
    await setSyncOutbox(upsertSyncOutbox(items, {
      targetKey,
      payload: normalizeSyncPayloadShape(payload),
      error
    }));
  }
  async function clearSyncOutbox(target) {
    const targetKey = syncTargetKey(target);
    const items = await getSyncOutbox();
    if (!items.some((item) => item.targetKey === targetKey)) return;
    await setSyncOutbox(items.filter((item) => item.targetKey !== targetKey));
  }
  async function loadLockSettings() {
    const result = await chrome.storage.local.get([
      STORAGE_KEY_LOCK_ENABLED,
      STORAGE_KEY_LOCK_POLICY,
      STORAGE_KEY_LOCK_IDLE_MINUTES,
      STORAGE_KEY_LOCK_MASTER_CREDENTIAL
    ]);
    const credential = normalizeLockMasterCredential(result[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
    lockCredentialExists = Boolean(credential);
    const enabled = Boolean(result[STORAGE_KEY_LOCK_ENABLED]) && lockCredentialExists;
    const policy = normalizeLockPolicy(result[STORAGE_KEY_LOCK_POLICY]);
    const idleMinutes = clampLockIdleMinutes(result[STORAGE_KEY_LOCK_IDLE_MINUTES]);
    dom.lockEnabled.checked = enabled;
    setLockPolicySelection(policy);
    dom.lockIdleMinutes.value = String(idleMinutes);
    dom.lockMasterPassword.value = "";
    dom.lockMasterPasswordConfirm.value = "";
    dom.lockCredentialHint.textContent = lockCredentialExists ? "\u5DF2\u8BBE\u7F6E\u4E3B\u5BC6\u7801" : "";
    renderLockSettingsFields();
    if (Boolean(result[STORAGE_KEY_LOCK_ENABLED]) && !lockCredentialExists) {
      await chrome.storage.local.set({ [STORAGE_KEY_LOCK_ENABLED]: false });
    }
  }
  function renderLockSettingsFields() {
    const lockEnabled = Boolean(dom.lockEnabled.checked);
    dom.lockAdvancedFields.classList.toggle("hidden", !lockEnabled);
    const idleTimeout = getSelectedLockPolicy() === LOCK_POLICY_IDLE_TIMEOUT;
    dom.lockIdleMinutesRow.classList.toggle("hidden", !lockEnabled || !idleTimeout);
  }
  function getSelectedLockPolicy() {
    if (dom.lockPolicyIdleRadio.checked) return LOCK_POLICY_IDLE_TIMEOUT;
    if (dom.lockPolicyBackgroundRadio.checked) return LOCK_POLICY_ON_BACKGROUND;
    return LOCK_POLICY_ONCE_UNTIL_QUIT;
  }
  function setLockPolicySelection(policy) {
    const normalized = normalizeLockPolicy(policy);
    dom.lockPolicyOnceRadio.checked = normalized === LOCK_POLICY_ONCE_UNTIL_QUIT;
    dom.lockPolicyIdleRadio.checked = normalized === LOCK_POLICY_IDLE_TIMEOUT;
    dom.lockPolicyBackgroundRadio.checked = normalized === LOCK_POLICY_ON_BACKGROUND;
  }
  async function saveLockSettings({ showStatus = true } = {}) {
    const lockEnabled = Boolean(dom.lockEnabled.checked);
    const policy = getSelectedLockPolicy();
    const idleMinutes = clampLockIdleMinutes(dom.lockIdleMinutes.value);
    const password = String(dom.lockMasterPassword.value || "");
    const confirm = String(dom.lockMasterPasswordConfirm.value || "");
    const result = await chrome.storage.local.get([
      STORAGE_KEY_LOCK_ENABLED,
      STORAGE_KEY_LOCK_MASTER_CREDENTIAL
    ]);
    const existingCredential = normalizeLockMasterCredential(result[STORAGE_KEY_LOCK_MASTER_CREDENTIAL]);
    const wasLockEnabled = Boolean(result[STORAGE_KEY_LOCK_ENABLED]) && Boolean(existingCredential);
    let nextCredential = existingCredential;
    let currentPasswordForRewrap = "";
    if (lockEnabled) {
      const shouldSetOrUpdatePassword = !existingCredential || password || confirm;
      if (shouldSetOrUpdatePassword) {
        if (!password) {
          if (showStatus) {
            setDeviceStatus("\u4E3B\u5BC6\u7801\u4E0D\u80FD\u4E3A\u7A7A");
          }
          return;
        }
        if (password !== confirm) {
          if (showStatus) {
            setDeviceStatus("\u4E24\u6B21\u8F93\u5165\u7684\u4E3B\u5BC6\u7801\u4E0D\u4E00\u81F4");
          }
          return;
        }
        if (existingCredential) {
          const promptResult = window.prompt("\u8BF7\u8F93\u5165\u5F53\u524D\u4E3B\u5BC6\u7801\u4EE5\u66F4\u65B0\u4E3B\u5BC6\u7801", "");
          currentPasswordForRewrap = String(promptResult || "");
          if (!currentPasswordForRewrap) {
            if (showStatus) setDeviceStatus("\u672A\u8F93\u5165\u5F53\u524D\u4E3B\u5BC6\u7801\uFF0C\u5DF2\u53D6\u6D88\u66F4\u65B0");
            return;
          }
        }
        nextCredential = await createLockMasterCredential(password);
      }
      if (!nextCredential) {
        if (showStatus) {
          setDeviceStatus("\u7F3A\u5C11\u4E3B\u5BC6\u7801\uFF0C\u65E0\u6CD5\u542F\u7528\u89E3\u9501");
        }
        return;
      }
    } else if (existingCredential) {
      let disablePassword = password;
      if (!disablePassword) {
        const promptResult = window.prompt("\u8BF7\u8F93\u5165\u5F53\u524D\u4E3B\u5BC6\u7801\u4EE5\u5173\u95ED\u4E3B\u5BC6\u7801\u9501", "");
        disablePassword = String(promptResult || "");
      }
      if (!disablePassword) {
        dom.lockEnabled.checked = true;
        renderLockSettingsFields();
        if (showStatus) {
          setDeviceStatus("\u672A\u8F93\u5165\u5F53\u524D\u4E3B\u5BC6\u7801\uFF0C\u5DF2\u53D6\u6D88\u5173\u95ED");
        }
        return;
      }
      const verified = await verifyLockMasterPassword(existingCredential, disablePassword);
      if (!verified) {
        dom.lockEnabled.checked = true;
        renderLockSettingsFields();
        if (showStatus) {
          setDeviceStatus("\u5F53\u524D\u4E3B\u5BC6\u7801\u9519\u8BEF\uFF0C\u65E0\u6CD5\u5173\u95ED\u89E3\u9501");
        }
        return;
      }
      const disableResult = await chrome.runtime.sendMessage({
        type: "PASS_LOCK_DISABLE_DATA",
        payload: { password: disablePassword }
      });
      if (!disableResult?.ok) {
        dom.lockEnabled.checked = true;
        renderLockSettingsFields();
        if (showStatus) setDeviceStatus(disableResult?.error || "\u65E0\u6CD5\u5173\u95ED\u672C\u5730\u6570\u636E\u4FDD\u62A4");
        return;
      }
    }
    if (lockEnabled && !existingCredential) {
      await chrome.storage.local.set({ [STORAGE_KEY_LOCK_MASTER_CREDENTIAL]: nextCredential });
      const configureResult = await chrome.runtime.sendMessage({
        type: "PASS_LOCK_CONFIGURE_DATA",
        payload: { password }
      });
      if (!configureResult?.ok) {
        await chrome.storage.local.remove(STORAGE_KEY_LOCK_MASTER_CREDENTIAL);
        if (showStatus) setDeviceStatus(configureResult?.error || "\u65E0\u6CD5\u4FDD\u62A4\u672C\u5730\u6570\u636E");
        return;
      }
      nextCredential = normalizeLockMasterCredential(configureResult.credential) || nextCredential;
    }
    if (lockEnabled && existingCredential && !wasLockEnabled && !(password || confirm)) {
      const promptResult = window.prompt("\u8BF7\u8F93\u5165\u5F53\u524D\u4E3B\u5BC6\u7801\u4EE5\u542F\u7528\u672C\u5730\u6570\u636E\u4FDD\u62A4", "");
      const currentPassword = String(promptResult || "");
      if (!currentPassword) {
        dom.lockEnabled.checked = false;
        renderLockSettingsFields();
        if (showStatus) setDeviceStatus("\u672A\u8F93\u5165\u5F53\u524D\u4E3B\u5BC6\u7801\uFF0C\u5DF2\u53D6\u6D88\u542F\u7528");
        return;
      }
      const configureResult = await chrome.runtime.sendMessage({
        type: "PASS_LOCK_CONFIGURE_DATA",
        payload: { password: currentPassword }
      });
      if (!configureResult?.ok) {
        dom.lockEnabled.checked = false;
        renderLockSettingsFields();
        if (showStatus) setDeviceStatus(configureResult?.error || "\u65E0\u6CD5\u4FDD\u62A4\u672C\u5730\u6570\u636E");
        return;
      }
      nextCredential = normalizeLockMasterCredential(configureResult.credential) || nextCredential;
    }
    if (lockEnabled && existingCredential && (password || confirm)) {
      const rewrapResult = await chrome.runtime.sendMessage({
        type: "PASS_LOCK_REWRAP_DATA",
        payload: {
          currentPassword: currentPasswordForRewrap,
          nextPassword: password,
          nextCredential
        }
      });
      if (!rewrapResult?.ok) {
        if (showStatus) setDeviceStatus(rewrapResult?.error || "\u65E0\u6CD5\u66F4\u65B0\u672C\u5730\u6570\u636E\u4FDD\u62A4");
        return;
      }
    }
    const updates = {
      [STORAGE_KEY_LOCK_ENABLED]: lockEnabled && Boolean(nextCredential),
      [STORAGE_KEY_LOCK_POLICY]: policy,
      [STORAGE_KEY_LOCK_IDLE_MINUTES]: idleMinutes,
      [STORAGE_KEY_LOCK_MASTER_CREDENTIAL]: nextCredential
    };
    await chrome.storage.local.set(updates);
    await chrome.runtime.sendMessage({ type: "PASS_LOCK_NOW" });
    lockCredentialExists = Boolean(nextCredential);
    dom.lockMasterPassword.value = "";
    dom.lockMasterPasswordConfirm.value = "";
    dom.lockCredentialHint.textContent = lockCredentialExists ? "\u5DF2\u8BBE\u7F6E\u4E3B\u5BC6\u7801" : "";
    renderLockSettingsFields();
    if (!showStatus) {
      return;
    }
    if (!lockEnabled) {
      setDeviceStatus("\u4E3B\u5BC6\u7801\u9501\u5DF2\u5173\u95ED");
      return;
    }
    if (!existingCredential) {
      setDeviceStatus("\u4E3B\u5BC6\u7801\u9501\u5DF2\u542F\u7528");
      return;
    }
    if (password || confirm) {
      setDeviceStatus("\u4E3B\u5BC6\u7801\u5DF2\u66F4\u65B0\uFF0C\u89E3\u9501\u7B56\u7565\u5DF2\u4FDD\u5B58");
      return;
    }
    setDeviceStatus("\u89E3\u9501\u7B56\u7565\u5DF2\u4FDD\u5B58");
  }
  async function persistSyncSettings({ showStatus = true } = {}) {
    const enableWebdav = Boolean(dom.syncEnableWebdav.checked);
    const enableServer = Boolean(dom.syncEnableServer.checked);
    const primarySource = normalizeSyncPrimarySource(dom.syncPrimarySource.value);
    const autoSyncIntervalMinutes = normalizeAutoSyncIntervalMinutes(dom.syncAutoInterval.value);
    if (enableWebdav && !isSecureSyncEndpointValue(dom.syncWebdavBaseUrl.value)) {
      if (showStatus) setStatus("WebDAV \u5730\u5740\u5FC5\u987B\u4F7F\u7528 HTTPS\uFF08\u672C\u673A\u56DE\u73AF\u5730\u5740\u53EF\u4F7F\u7528 HTTP\uFF09");
      return false;
    }
    if (enableServer && !normalizeLegacySelfHostedServerBaseUrl(dom.syncServerBaseUrl.value || "")) {
      if (showStatus) setStatus("\u670D\u52A1\u5668\u5730\u5740\u5FC5\u987B\u4F7F\u7528 HTTPS\uFF08\u672C\u673A\u56DE\u73AF\u5730\u5740\u53EF\u4F7F\u7528 HTTP\uFF09");
      return false;
    }
    const nextSettings = {
      [STORAGE_KEY_SYNC_ENABLE_WEBDAV]: enableWebdav,
      [STORAGE_KEY_SYNC_ENABLE_SELF_HOSTED_SERVER]: enableServer,
      [STORAGE_KEY_SYNC_PRIMARY_SOURCE]: primarySource,
      [STORAGE_KEY_SYNC_WEBDAV_BASE_URL]: String(dom.syncWebdavBaseUrl.value || "").trim(),
      [STORAGE_KEY_SYNC_WEBDAV_PATH]: String(dom.syncWebdavPath.value || "").trim() || "pass-sync-bundle-v2.json",
      [STORAGE_KEY_SYNC_WEBDAV_USERNAME]: String(dom.syncWebdavUsername.value || "").trim(),
      [STORAGE_KEY_SYNC_SERVER_BASE_URL]: normalizeLegacySelfHostedServerBaseUrl(dom.syncServerBaseUrl.value || ""),
      [STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]: Number(autoSyncIntervalMinutes)
    };
    const nextSecrets = {
      webdavPassword: String(dom.syncWebdavPassword.value || ""),
      serverToken: String(dom.syncServerToken.value || "").trim(),
      encryptionKey: normalizeSyncEncryptionKey(dom.syncEncryptionKey.value),
      previousEncryptionKey: normalizeSyncEncryptionKey(dom.syncPreviousEncryptionKey.value)
    };
    if (dom.syncEncryptionKey.value.trim() && !nextSecrets.encryptionKey) {
      if (showStatus) setStatus("\u540C\u6B65\u52A0\u5BC6\u5BC6\u94A5\u65E0\u6548\uFF0C\u5FC5\u987B\u662F 256 \u4F4D\u5BC6\u94A5\uFF1B\u7559\u7A7A\u8868\u793A\u4F7F\u7528\u660E\u6587\u540C\u6B65\u5305");
      return false;
    }
    if (dom.syncPreviousEncryptionKey.value.trim() && !nextSecrets.previousEncryptionKey) {
      if (showStatus) setStatus("\u8F6E\u6362\u524D\u540C\u6B65\u5BC6\u94A5\u65E0\u6548\uFF0C\u5FC5\u987B\u662F 256 \u4F4D\u5BC6\u94A5");
      return false;
    }
    if (nextSecrets.previousEncryptionKey && nextSecrets.previousEncryptionKey === nextSecrets.encryptionKey) {
      nextSecrets.previousEncryptionKey = "";
    }
    await chrome.storage.local.set(nextSettings);
    await setSyncSecrets(nextSecrets);
    await refreshSyncEncryptionKeyIdStatus();
    const persisted = await chrome.storage.local.get([
      STORAGE_KEY_SYNC_SERVER_BASE_URL,
      STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES
    ]);
    dom.syncServerBaseUrl.value = String(
      persisted[STORAGE_KEY_SYNC_SERVER_BASE_URL] || nextSettings[STORAGE_KEY_SYNC_SERVER_BASE_URL] || DEFAULT_SELF_HOSTED_SERVER_BASE_URL
    );
    dom.syncServerToken.value = nextSecrets.serverToken;
    dom.syncPrimarySource.value = primarySource;
    dom.syncAutoInterval.value = normalizeAutoSyncIntervalMinutes(
      persisted[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES] ?? nextSettings[STORAGE_KEY_SYNC_AUTO_INTERVAL_MINUTES]
    );
    renderSyncBackendFields();
    if (!showStatus) return;
    const enabledLabels = [];
    if (enableWebdav) enabledLabels.push("WebDAV");
    if (enableServer) enabledLabels.push("\u670D\u52A1\u5668");
    const autoSyncLabel = autoSyncIntervalMinutes === "0" ? "\u81EA\u52A8\u540C\u6B65\u5173\u95ED" : `\u81EA\u52A8\u540C\u6B65\u6BCF ${autoSyncIntervalMinutes} \u5206\u949F`;
    setDeviceStatus(
      enabledLabels.length > 0 ? `\u540C\u6B65\u6E90\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF08\u4E3B\u6E90\uFF1A${primarySourceLabel(primarySource)}\uFF1B\u5DF2\u542F\u7528\uFF1A${enabledLabels.join(" + ")}\uFF1B${autoSyncLabel}\uFF09` : `\u540C\u6B65\u6E90\u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF08\u5F53\u524D\u672A\u542F\u7528\u4EFB\u4F55\u8FDC\u7AEF\u6E90\uFF1B${autoSyncLabel}\uFF09`
    );
    return true;
  }
  async function saveSyncSettings() {
    return persistSyncSettings({ showStatus: true });
  }
  async function refresh({ silent = false } = {}) {
    const { accounts, passkeys, folders } = await readBusinessDataFromStore();
    await loadHistory();
    accountsRaw = cloneAccounts(accounts);
    passkeysRaw = passkeys.map(normalizePasskeyShape);
    foldersRaw = sortFoldersForDisplay(withFixedFolder(
      folders.filter((folder) => !folder?.isDeleted).map(normalizeFolderShape)
    ));
    closeContextMenu();
    renderGoogleAuthenticatorImportFolderOptions();
    renderSidebar(accountsRaw);
    renderCurrentView(accountsRaw);
    setAccountView(activeAccountView);
    if (!dom.historyModal.classList.contains("hidden")) {
      renderHistoryModalList();
    }
    if (!silent) {
      setStatus(`\u5DF2\u52A0\u8F7D ${accountsRaw.length} \u6761\u8D26\u53F7\uFF0C${passkeysRaw.length} \u6761\u901A\u884C\u5BC6\u94A5\uFF0C${foldersRaw.length} \u4E2A\u6587\u4EF6\u5939`);
    }
  }
  async function clearAll() {
    await writeBusinessDataToStore({ accounts: [], passkeys: [], folders: [] });
    await appendHistory("\u6E05\u7A7A\u5168\u90E8\u6570\u636E\uFF1A\u8D26\u53F7\u3001\u901A\u884C\u5BC6\u94A5\u3001\u6587\u4EF6\u5939");
    editingAccountId = null;
    await refresh({ silent: true });
    await refreshSyncOutboxStatus();
    setStatus("\u8D26\u53F7\u3001\u901A\u884C\u5BC6\u94A5\u4E0E\u6587\u4EF6\u5939\u5DF2\u6E05\u7A7A");
  }
  async function exportSyncBundle() {
    try {
      const encryptionKey = normalizeSyncEncryptionKey(dom.syncEncryptionKey.value);
      const bundle = await buildSyncBundle();
      const encrypted = await encryptSyncBundleDocument(bundle, encryptionKey);
      const fileName = `pass-sync-bundle-${formatFileTimestamp(bundle.exportedAtMs)}.json`;
      const text = JSON.stringify(encrypted, null, 2);
      await downloadTextFile(fileName, text, "application/json");
      setStatus(
        `\u540C\u6B65\u5305\u5DF2\u5BFC\u51FA${encryptionKey ? "\uFF08\u5DF2\u52A0\u5BC6\uFF09" : "\uFF08\u672A\u52A0\u5BC6\uFF0C\u8BF7\u59A5\u5584\u4FDD\u7BA1\uFF09"}\uFF1A${visibleSyncCount(bundle.payload.accounts)} \u6761\u8D26\u53F7\uFF0C${visibleSyncCount(bundle.payload.passkeys)} \u6761\u901A\u884C\u5BC6\u94A5\uFF0C${visibleSyncCount(bundle.payload.folders)} \u4E2A\u6587\u4EF6\u5939`
      );
    } catch (error) {
      setStatus(`\u540C\u6B65\u5305\u5BFC\u51FA\u5931\u8D25\uFF1A${error.message}`);
    }
  }
  async function exportBrowserPasswordCsv(format) {
    try {
      const browser = normalizeBrowserExportFormat(format);
      const localStored = await readBusinessDataFromStore();
      const localAccounts = Array.isArray(localStored.accounts) ? localStored.accounts.map(normalizeAccountShape) : [];
      const activeAccounts = localAccounts.filter((account) => !account.isDeleted && !account.isPermanentlyDeleted);
      const csv = buildBrowserPasswordCsv(activeAccounts, browser);
      const fileName = `pass-${browser}-passwords-${formatFileTimestamp(Date.now())}.csv`;
      await downloadTextFile(fileName, csv, "text/csv;charset=utf-8");
      setStatus(`\u5DF2\u5BFC\u51FA ${browserExportLabel(browser)} \u5BC6\u7801 CSV\uFF0C\u5171 ${countBrowserPasswordRows(activeAccounts)} \u884C`);
    } catch (error) {
      setStatus(`\u5BC6\u7801 CSV \u5BFC\u51FA\u5931\u8D25\uFF1A${error.message}`);
    }
  }
  async function importSyncBundleAndMerge() {
    const file = await pickJsonFile();
    if (!file) {
      setStatus("\u5DF2\u53D6\u6D88\u5BFC\u5165\u540C\u6B65\u5305");
      return;
    }
    let parsed;
    try {
      parsed = await decryptSyncBundleDocument(
        JSON.parse(await file.text()),
        dom.syncEncryptionKey.value,
        [dom.syncPreviousEncryptionKey.value]
      );
    } catch (error) {
      setStatus(`\u540C\u6B65\u5305\u8BFB\u53D6\u5931\u8D25: ${error.message}`);
      return;
    }
    const incomingPayload = parseSyncBundlePayload(parsed, { requireBundleSchema: true });
    if (!incomingPayload) {
      setStatus("\u540C\u6B65\u5305\u683C\u5F0F\u9519\u8BEF\uFF0C\u4EC5\u652F\u6301 pass.sync.bundle.v2");
      return;
    }
    const localStored = await readBusinessDataFromStore();
    const localPayload = normalizeSyncPayloadShape(localStored);
    const localAccounts = localPayload.accounts;
    const localPasskeys = localPayload.passkeys;
    const localFolders = localPayload.folders;
    const remotePayload = normalizeSyncPayloadShape(incomingPayload);
    let mergedPayload = mergeSyncPayloads(localPayload, remotePayload, syncMergeHelpers());
    mergedPayload.accounts = syncAliasGroups2(mergedPayload.accounts);
    mergedPayload.passkeys = buildUnifiedPasskeys(mergedPayload.accounts, mergedPayload.passkeys);
    const safety = validateSyncSafety(localPayload, remotePayload, mergedPayload, SYNC_MODE_MERGE);
    if (!safety.safe) {
      setStatus(`\u540C\u6B65\u5305\u5BFC\u5165\u505C\u6B62\uFF0C\u5B89\u5168\u68C0\u67E5\u672A\u901A\u8FC7\uFF1A${safety.reasons.join("\u3001")}`);
      return;
    }
    const confirmed = window.confirm(
      `\u540C\u6B65\u5305\u5408\u5E76\u9884\u89C8\uFF1A\u8D26\u53F7 ${visibleSyncCount(localAccounts)} \u2192 ${visibleSyncCount(mergedPayload.accounts)}\uFF0C\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(localPasskeys)} \u2192 ${visibleSyncCount(mergedPayload.passkeys)}\uFF0C\u6587\u4EF6\u5939 ${visibleSyncCount(localFolders)} \u2192 ${visibleSyncCount(mergedPayload.folders)}

\u786E\u8BA4\u5199\u5165\u672C\u5730\u5417\uFF1F`
    );
    if (!confirmed) {
      setStatus("\u5DF2\u53D6\u6D88\u5BFC\u5165\u540C\u6B65\u5305");
      return;
    }
    await saveLocalSafetySnapshot("\u5BFC\u5165\u540C\u6B65\u5305\u524D\u81EA\u52A8\u5907\u4EFD");
    await writeBusinessDataToStore(mergedPayload);
    await appendHistory(
      `\u5BFC\u5165\u540C\u6B65\u5305\u5E76\u5408\u5E76\uFF1A\u8D26\u53F7 ${visibleSyncCount(localAccounts)}->${visibleSyncCount(mergedPayload.accounts)}\uFF0C\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(localPasskeys)}->${visibleSyncCount(mergedPayload.passkeys)}`
    );
    editingAccountId = null;
    await refresh({ silent: true });
    setStatus(
      `\u540C\u6B65\u5305\u5408\u5E76\u5B8C\u6210\uFF1A\u8D26\u53F7 ${visibleSyncCount(localAccounts)}+${visibleSyncCount(remotePayload.accounts)}->${visibleSyncCount(mergedPayload.accounts)}\uFF0C\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(localPasskeys)}+${visibleSyncCount(remotePayload.passkeys)}->${visibleSyncCount(mergedPayload.passkeys)}\uFF0C\u6587\u4EF6\u5939 ${visibleSyncCount(localFolders)}+${visibleSyncCount(remotePayload.folders)}->${visibleSyncCount(mergedPayload.folders)}`
    );
  }
  async function importBrowserPasswordCsv() {
    const file = await pickCsvFile();
    if (!file) {
      setStatus("\u5DF2\u53D6\u6D88\u6D4F\u89C8\u5668\u5BC6\u7801 CSV \u5BFC\u5165");
      return;
    }
    let parsed;
    try {
      parsed = parseBrowserPasswordCsv(await file.text());
    } catch (error) {
      setStatus(`\u6D4F\u89C8\u5668\u5BC6\u7801 CSV \u5BFC\u5165\u5931\u8D25: ${error.message}`);
      return;
    }
    const localStored = await readBusinessDataFromStore();
    let mergedAccounts = Array.isArray(localStored.accounts) ? localStored.accounts.map(normalizeAccountShape) : [];
    const localStoredPasskeys = Array.isArray(localStored.passkeys) ? localStored.passkeys.map(normalizePasskeyShape) : [];
    const localPasskeys = buildUnifiedPasskeys(mergedAccounts, localStoredPasskeys);
    const localFolders = Array.isArray(localStored.folders) ? localStored.folders.map(normalizeFolderShape) : [];
    const startedAtMs = Date.now();
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    parsed.entries.forEach((entry, index) => {
      const nowMs = startedAtMs + index;
      const matchIndex = findImportedBrowserAccountIndex(mergedAccounts, entry);
      if (matchIndex >= 0) {
        const updated = applyImportedBrowserEntryToAccount(mergedAccounts[matchIndex], entry, nowMs);
        if (JSON.stringify(updated) === JSON.stringify(mergedAccounts[matchIndex])) {
          unchangedCount += 1;
        } else {
          mergedAccounts[matchIndex] = updated;
          updatedCount += 1;
        }
        return;
      }
      const createdAtMs = startedAtMs + index * 1e3;
      const canonicalSite = etldPlusOne(entry.sites[0] || "");
      mergedAccounts.push(normalizeAccountShape({
        accountId: buildAccountId(canonicalSite, entry.username, createdAtMs),
        canonicalSite,
        usernameAtCreate: entry.username,
        sites: entry.sites,
        username: entry.username,
        password: entry.password,
        note: entry.note,
        createdAtMs,
        updatedAtMs: createdAtMs,
        usernameUpdatedAtMs: createdAtMs,
        usernameUpdatedDeviceName: currentImportDeviceName(),
        passwordUpdatedAtMs: createdAtMs,
        passwordUpdatedDeviceName: currentImportDeviceName(),
        noteUpdatedAtMs: entry.note ? createdAtMs : 0,
        noteUpdatedDeviceName: currentImportDeviceName(),
        deletedDeviceName: "",
        lastOperatedDeviceName: currentImportDeviceName(),
        createdDeviceName: currentImportDeviceName(),
        isDeleted: false,
        deletedAtMs: null,
        folderIds: [],
        passkeyCredentialIds: []
      }));
      createdCount += 1;
    });
    if (createdCount === 0 && updatedCount === 0) {
      setStatus(
        `\u6D4F\u89C8\u5668\u5BC6\u7801 CSV \u5BFC\u5165\u5B8C\u6210\uFF08${parsed.formatLabel}\uFF09\uFF0C\u6CA1\u6709\u65B0\u589E\u6216\u66F4\u65B0\u8D26\u53F7` + (parsed.skippedRowCount > 0 ? `\uFF0C\u8DF3\u8FC7 ${parsed.skippedRowCount} \u884C` : "") + (unchangedCount > 0 ? `\uFF0C\u672A\u53D8\u5316 ${unchangedCount} \u884C` : "")
      );
      return;
    }
    mergedAccounts = syncAliasGroups2(mergedAccounts);
    mergedAccounts = reconcileAccountFolders2(mergedAccounts, localFolders);
    const mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, localPasskeys);
    await writeBusinessDataToStore({
      accounts: mergedAccounts,
      passkeys: mergedPasskeys,
      folders: localFolders
    });
    await appendHistory(
      `\u5BFC\u5165 ${parsed.formatLabel} \u5BC6\u7801 CSV\uFF1A\u65B0\u589E ${createdCount} \u6761\uFF0C\u66F4\u65B0 ${updatedCount} \u6761` + (parsed.skippedRowCount > 0 ? `\uFF0C\u8DF3\u8FC7 ${parsed.skippedRowCount} \u884C` : "") + (unchangedCount > 0 ? `\uFF0C\u672A\u53D8\u5316 ${unchangedCount} \u884C` : "")
    );
    editingAccountId = null;
    await refresh({ silent: true });
    setStatus(
      `\u6D4F\u89C8\u5668\u5BC6\u7801 CSV \u5BFC\u5165\u5B8C\u6210\uFF08${parsed.formatLabel}\uFF09\uFF1A\u65B0\u589E ${createdCount} \u6761\uFF0C\u66F4\u65B0 ${updatedCount} \u6761` + (parsed.skippedRowCount > 0 ? `\uFF0C\u8DF3\u8FC7 ${parsed.skippedRowCount} \u884C` : "") + (unchangedCount > 0 ? `\uFF0C\u672A\u53D8\u5316 ${unchangedCount} \u884C` : "")
    );
  }
  async function importGoogleAuthenticatorExportQrFromClipboard() {
    let migration;
    try {
      migration = await readGoogleAuthenticatorMigrationFromClipboard();
    } catch (error) {
      setStatus(`\u8C37\u6B4C\u9A8C\u8BC1\u5668\u5BFC\u5165\u5931\u8D25: ${error.message}`);
      return;
    }
    if (!migration) {
      setStatus("\u526A\u8D34\u677F\u91CC\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u8C37\u6B4C\u9A8C\u8BC1\u5668\u5BFC\u51FA\u4E8C\u7EF4\u7801");
      return;
    }
    await importGoogleAuthenticatorMigration(migration, buildGoogleAuthenticatorImportFolderPlan());
  }
  async function importGoogleAuthenticatorExportQrFromFiles() {
    const files = await pickImageFiles();
    if (!files || files.length === 0) {
      setStatus("\u5DF2\u53D6\u6D88\u8C37\u6B4C\u9A8C\u8BC1\u5668\u4E8C\u7EF4\u7801\u5BFC\u5165");
      return;
    }
    let migration;
    try {
      migration = await readGoogleAuthenticatorMigrationFromFiles(files);
    } catch (error) {
      setStatus(`\u8C37\u6B4C\u9A8C\u8BC1\u5668\u5BFC\u5165\u5931\u8D25: ${error.message}`);
      return;
    }
    if (!migration) {
      setStatus("\u672A\u4ECE\u6240\u9009\u56FE\u7247\u4E2D\u8BC6\u522B\u5230\u8C37\u6B4C\u9A8C\u8BC1\u5668\u5BFC\u51FA\u4E8C\u7EF4\u7801");
      return;
    }
    await importGoogleAuthenticatorMigration(migration, buildGoogleAuthenticatorImportFolderPlan());
  }
  async function importGoogleAuthenticatorMigration(migration, folderPlan = null) {
    const localStored = await readBusinessDataFromStore();
    let mergedAccounts = Array.isArray(localStored.accounts) ? localStored.accounts.map(normalizeAccountShape) : [];
    const localStoredPasskeys = Array.isArray(localStored.passkeys) ? localStored.passkeys.map(normalizePasskeyShape) : [];
    const localPasskeys = buildUnifiedPasskeys(mergedAccounts, localStoredPasskeys);
    let localFolders = Array.isArray(localStored.folders) ? localStored.folders.map(normalizeFolderShape) : [];
    const resolvedImportFolder = resolveGoogleAuthenticatorImportFolder(folderPlan, localFolders);
    if ((String(folderPlan?.newFolderName || "").trim() || String(folderPlan?.selectedFolderId || "").trim()) && !resolvedImportFolder.folderId) {
      return;
    }
    localFolders = resolvedImportFolder.folders;
    const startedAtMs = Date.now();
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let skippedCount = Number(migration.skippedCount || 0);
    migration.entries.forEach((entry, index) => {
      if (!entry?.siteAlias || !entry?.secret) {
        skippedCount += 1;
        return;
      }
      const nowMs = startedAtMs + index;
      const matchIndex = findImportedTotpAccountIndex(mergedAccounts, entry);
      if (matchIndex >= 0) {
        const updated = applyImportedTotpEntryToAccount(
          mergedAccounts[matchIndex],
          entry,
          nowMs,
          resolvedImportFolder.folderId
        );
        if (JSON.stringify(updated) === JSON.stringify(mergedAccounts[matchIndex])) {
          unchangedCount += 1;
        } else {
          mergedAccounts[matchIndex] = updated;
          updatedCount += 1;
        }
        return;
      }
      const createdAtMs = startedAtMs + index * 1e3;
      const canonicalSite = etldPlusOne(entry.siteAlias || "");
      mergedAccounts.push(normalizeAccountShape({
        accountId: buildAccountId(canonicalSite, entry.username || "", createdAtMs),
        canonicalSite,
        usernameAtCreate: entry.username || "",
        sites: [entry.siteAlias],
        username: entry.username || "",
        password: "",
        totpSecret: entry.secret,
        createdAtMs,
        updatedAtMs: createdAtMs,
        usernameUpdatedAtMs: createdAtMs,
        usernameUpdatedDeviceName: currentImportDeviceName(),
        passwordUpdatedAtMs: createdAtMs,
        passwordUpdatedDeviceName: currentImportDeviceName(),
        totpUpdatedAtMs: createdAtMs,
        totpUpdatedDeviceName: currentImportDeviceName(),
        deletedDeviceName: "",
        lastOperatedDeviceName: currentImportDeviceName(),
        createdDeviceName: currentImportDeviceName(),
        isDeleted: false,
        deletedAtMs: null,
        folderIds: resolvedImportFolder.folderId ? [resolvedImportFolder.folderId] : [],
        folderId: resolvedImportFolder.folderId,
        passkeyCredentialIds: []
      }));
      createdCount += 1;
    });
    if (createdCount === 0 && updatedCount === 0) {
      setStatus(
        `\u8C37\u6B4C\u9A8C\u8BC1\u5668\u5BFC\u5165\u5B8C\u6210\uFF0C\u6CA1\u6709\u65B0\u589E\u6216\u66F4\u65B0\u8D26\u53F7` + buildGoogleAuthenticatorImportSuffix({
          importedCount: migration.entries.length,
          skippedCount,
          unchangedCount,
          batchSize: migration.batchSize,
          batchIndex: migration.batchIndex
        })
      );
      return;
    }
    mergedAccounts = syncAliasGroups2(mergedAccounts);
    mergedAccounts = reconcileAccountFolders2(mergedAccounts, localFolders);
    const mergedPasskeys = buildUnifiedPasskeys(mergedAccounts, localPasskeys);
    await writeBusinessDataToStore({
      accounts: mergedAccounts,
      passkeys: mergedPasskeys,
      folders: localFolders
    });
    await appendHistory(
      (resolvedImportFolder.createdFolderName ? `\u521B\u5EFA\u6587\u4EF6\u5939\uFF1A${resolvedImportFolder.createdFolderName}\uFF1B` : "") + `\u5BFC\u5165\u8C37\u6B4C\u9A8C\u8BC1\u5668\u5BFC\u51FA\u4E8C\u7EF4\u7801\uFF1A\u65B0\u589E ${createdCount} \u6761\uFF0C\u66F4\u65B0 ${updatedCount} \u6761` + buildGoogleAuthenticatorImportSuffix({
        importedCount: migration.entries.length,
        skippedCount,
        unchangedCount,
        batchSize: migration.batchSize,
        batchIndex: migration.batchIndex
      })
    );
    editingAccountId = null;
    await refresh({ silent: true });
    setStatus(
      `\u8C37\u6B4C\u9A8C\u8BC1\u5668\u5BFC\u5165\u5B8C\u6210\uFF1A\u65B0\u589E ${createdCount} \u6761\uFF0C\u66F4\u65B0 ${updatedCount} \u6761` + (resolvedImportFolder.folderName ? `\uFF0C\u5BFC\u5165\u5230\u6587\u4EF6\u5939 ${resolvedImportFolder.folderName}` : "") + buildGoogleAuthenticatorImportSuffix({
        importedCount: migration.entries.length,
        skippedCount,
        unchangedCount,
        batchSize: migration.batchSize,
        batchIndex: migration.batchIndex
      })
    );
  }
  async function previewSyncWithRemote() {
    dom.syncPreviewStatus.textContent = "\u6B63\u5728\u62C9\u53D6\u8FDC\u7AEF\u5E76\u8BA1\u7B97\u9884\u89C8\u2026";
    try {
      if (!await saveSyncSettings()) throw new Error("\u540C\u6B65\u914D\u7F6E\u65E0\u6548");
      const targets = buildRemoteSyncTargetsFromDom();
      if (!targets || targets.length === 0) throw new Error("\u8BF7\u5148\u542F\u7528\u540C\u6B65\u6E90");
      const localStored = await readBusinessDataFromStore();
      const localPayload = normalizeSyncPayloadShape(localStored);
      let primaryRemotePayload = null;
      const pullErrors = [];
      for (const target of targets) {
        let response;
        try {
          response = await pullRemotePayload(target);
        } catch (error) {
          if (target.isPrimary) throw error;
          pullErrors.push(`${target.label}: ${error.message}`);
          continue;
        }
        target.remotePayload = response.payload;
        target.remoteEncrypted = response.encrypted;
        if (target.isPrimary) {
          primaryRemotePayload = response.payload ? normalizeSyncPayloadShape(response.payload) : null;
        }
      }
      const mergedPayload = primaryRemotePayload ? mergeSyncPayloads2(localPayload, primaryRemotePayload) : localPayload;
      const safety = validateSyncSafety(localPayload, primaryRemotePayload, mergedPayload, SYNC_MODE_MERGE);
      if (!safety.safe) throw new Error(`\u5B89\u5168\u68C0\u67E5\u672A\u901A\u8FC7\uFF1A${safety.reasons.join("\u3001")}`);
      dom.syncPreviewStatus.textContent = `\u9884\u89C8\uFF08\u672A\u5199\u5165\uFF09\uFF1A\u8D26\u53F7 ${visibleSyncCount(localPayload.accounts)}->${visibleSyncCount(mergedPayload.accounts)}\uFF0C\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(localPayload.passkeys)}->${visibleSyncCount(mergedPayload.passkeys)}\uFF0C\u6587\u4EF6\u5939 ${visibleSyncCount(localPayload.folders)}->${visibleSyncCount(mergedPayload.folders)}\uFF1B\u4E3B\u6E90 ${targets.find((target) => target.isPrimary)?.label || "\u672A\u6307\u5B9A"}`;
    } catch (error) {
      dom.syncPreviewStatus.textContent = `\u9884\u89C8\u5931\u8D25\uFF1A${error.message}`;
    }
  }
  async function syncNowWithRemote(syncMode = SYNC_MODE_MERGE) {
    if (syncInFlight) {
      setStatus("\u540C\u6B65\u8FDB\u884C\u4E2D\uFF0C\u8BF7\u7A0D\u5019\uFF1B\u672C\u6B21\u8BF7\u6C42\u672A\u91CD\u590D\u6267\u884C");
      return false;
    }
    const lockOwner = createSyncIdempotencyKey();
    if (!await acquireSyncOperationLock(lockOwner)) {
      setStatus("\u5DF2\u6709\u540C\u6B65\u4EFB\u52A1\u6B63\u5728\u8FD0\u884C\uFF0C\u8BF7\u7A0D\u5019\uFF1B\u672C\u6B21\u8BF7\u6C42\u672A\u91CD\u590D\u6267\u884C");
      return false;
    }
    syncInFlight = true;
    try {
      return await performSyncNowWithRemote(syncMode);
    } finally {
      syncInFlight = false;
      await releaseSyncOperationLock(lockOwner);
    }
  }
  async function performSyncNowWithRemote(syncMode = SYNC_MODE_MERGE) {
    if (!await saveSyncSettings()) return;
    const targets = buildRemoteSyncTargetsFromDom();
    if (!targets || targets.length === 0) return;
    const normalizedSyncMode = normalizeSyncMode(syncMode);
    const encryptionKey = normalizeSyncEncryptionKey(dom.syncEncryptionKey?.value || "");
    if (!confirmPlaintextSync(encryptionKey)) return;
    if (!confirmOverwriteSync(normalizedSyncMode)) return;
    const localStored = await readBusinessDataFromStore();
    const localPayload = normalizeSyncPayloadShape(localStored);
    const localAccounts = localPayload.accounts;
    const localPasskeys = localPayload.passkeys;
    const localFolders = localPayload.folders;
    try {
      await saveLocalSafetySnapshot(`\u540C\u6B65\u524D\u81EA\u52A8\u5907\u4EFD\uFF08${getSyncModeHistoryLabel(normalizedSyncMode)}\uFF09`);
    } catch (error) {
      setStatus(`\u540C\u6B65\u5DF2\u505C\u6B62\uFF0C\u65E0\u6CD5\u521B\u5EFA\u672C\u5730\u5B89\u5168\u5907\u4EFD\uFF1A${error.message}`);
      return;
    }
    let mergedPayload = localPayload;
    let conflictCount = 0;
    let primaryRemotePayload = null;
    const pullErrors = [];
    {
      for (const target of targets) {
        let remotePayload = null;
        try {
          const remoteResponse = await pullRemotePayload(target);
          updateRemoteConcurrencyState(target, remoteResponse.etag);
          target.remotePayload = remoteResponse.payload;
          target.remoteEncrypted = remoteResponse.encrypted;
          remotePayload = remoteResponse.payload;
          if (target.kind === "webdav" && remotePayload && !String(remoteResponse.etag || "").trim()) {
            throw new Error(
              "WebDAV \u8FDC\u7AEF\u5DF2\u6709\u540C\u6B65\u5305\u4F46\u672A\u8FD4\u56DE ETag\uFF0C\u65E0\u6CD5\u5B89\u5168\u505A\u6761\u4EF6\u5199\u5165\u3002\u8BF7\u6539\u7528\u652F\u6301 ETag \u7684 WebDAV\uFF0C\u6216\u6539\u7528\u81EA\u5EFA\u670D\u52A1\u5668\u4F5C\u4E3A\u4E3B\u6E90\u3002"
            );
          }
        } catch (error) {
          if (target.isPrimary) {
            setStatus(`${target.label} \u62C9\u53D6\u5931\u8D25: ${error.message}`);
            return;
          }
          pullErrors.push(`${target.label}: ${error.message}`);
          continue;
        }
        if (target.isPrimary) {
          primaryRemotePayload = remotePayload ? normalizeSyncPayloadShape(remotePayload) : null;
        }
      }
      const currentLocalPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
      if (!syncPayloadEquals(currentLocalPayload, localPayload)) {
        setStatus("\u540C\u6B65\u671F\u95F4\u672C\u5730\u6570\u636E\u5DF2\u53D8\u5316\uFF0C\u672C\u6B21\u540C\u6B65\u5DF2\u53D6\u6D88\uFF0C\u8BF7\u91CD\u65B0\u540C\u6B65");
        return;
      }
      const primaryTarget = targets.find((target) => target.isPrimary) || targets[0];
      if (normalizedSyncMode === SYNC_MODE_MERGE) {
        if (primaryRemotePayload) {
          conflictCount = countSyncAccountConflicts(localAccounts, primaryRemotePayload.accounts);
          if (conflictCount > 0) {
            await saveLocalSafetySnapshot("\u540C\u6B65\u51B2\u7A81\u4E3B\u6E90\u5907\u4EFD", primaryRemotePayload);
          }
          mergedPayload = mergeSyncPayloads2(localPayload, primaryRemotePayload);
        }
      } else if (normalizedSyncMode === SYNC_MODE_REMOTE_OVERWRITE_LOCAL) {
        const primaryPayload = primaryTarget?.remotePayload || null;
        const remoteIsEmpty = !primaryPayload || visibleSyncCount(primaryPayload.accounts) === 0 && visibleSyncCount(primaryPayload.passkeys) === 0 && visibleSyncCount(primaryPayload.folders) === 0;
        const localIsNonEmpty = visibleSyncCount(localAccounts) > 0 || visibleSyncCount(localPasskeys) > 0 || visibleSyncCount(localFolders) > 0;
        if (remoteIsEmpty && localIsNonEmpty) {
          setStatus("\u4E91\u7AEF\u8986\u76D6\u672C\u5730\u5DF2\u505C\u6B62\uFF1A\u4E3B\u540C\u6B65\u6E90\u4E3A\u7A7A\uFF0C\u907F\u514D\u6E05\u7A7A\u672C\u5730\u6570\u636E");
          return;
        }
        mergedPayload = normalizeSyncPayloadShape(primaryPayload || {});
      }
    }
    if (normalizedSyncMode === SYNC_MODE_MERGE && primaryRemotePayload) {
      const safety = validateSyncSafety(
        localPayload,
        primaryRemotePayload,
        mergedPayload,
        SYNC_MODE_MERGE
      );
      if (!safety.safe) {
        setStatus(`\u540C\u6B65\u5DF2\u505C\u6B62\uFF0C\u5B89\u5168\u68C0\u67E5\u672A\u901A\u8FC7\uFF1A${safety.reasons.join("\u3001")}`);
        return;
      }
    }
    await writeBusinessDataToStore(mergedPayload);
    await appendHistory(
      `${getSyncModeHistoryLabel(normalizedSyncMode)}\uFF1A\u8D26\u53F7 ${visibleSyncCount(localAccounts)}->${visibleSyncCount(mergedPayload.accounts)}\uFF0C\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(localPasskeys)}->${visibleSyncCount(mergedPayload.passkeys)}` + (conflictCount > 0 ? `\uFF0C\u68C0\u6D4B\u5230 ${conflictCount} \u4E2A\u5B57\u6BB5\u51B2\u7A81\u5E76\u6309\u65F6\u95F4/\u8BBE\u5907\u89C4\u5219\u88C1\u51B3` : "")
    );
    const pushErrors = [...pullErrors];
    let primaryPushFailed = false;
    const pushTargets = [...targets].sort(
      (left, right) => Number(right.isPrimary) - Number(left.isPrimary) || Number(right.supportsEtag) - Number(left.supportsEtag)
    );
    for (const target of pushTargets) {
      if (primaryPushFailed && target.isPrimary === false) {
        pushErrors.push(`${target.label}: \u4E3B\u540C\u6B65\u6E90\u4E0A\u4F20\u5931\u8D25\uFF0C\u5DF2\u8DF3\u8FC7\u955C\u50CF\u5199\u5165`);
        continue;
      }
      try {
        const result = await pushRemotePayloadWithMode(target, {
          ...mergedPayload
        }, normalizedSyncMode);
        mergedPayload = normalizeSyncPayloadShape(result.payload);
        await clearSyncOutbox(target);
      } catch (error) {
        pushErrors.push(`${target.label}: ${error.message}`);
        await recordSyncOutboxFailure(target, mergedPayload, error);
        if (target.isPrimary) primaryPushFailed = true;
      }
    }
    editingAccountId = null;
    await refresh({ silent: true });
    await refreshSyncOutboxStatus();
    const sourceSummary = targets.map((item) => item.label).join(" + ");
    if (pushErrors.length > 0) {
      setStatus(
        `${getSyncModeStatusLabel(normalizedSyncMode)}\uFF0C\u4F46\u90E8\u5206\u6E90\u4E0A\u4F20\u5931\u8D25\uFF08${sourceSummary}\uFF09\uFF1A${pushErrors.join("\uFF1B")}\uFF08\u8D26\u53F7 ${visibleSyncCount(localAccounts)}->${visibleSyncCount(mergedPayload.accounts)}\uFF0C\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(localPasskeys)}->${visibleSyncCount(mergedPayload.passkeys)}\uFF0C\u6587\u4EF6\u5939 ${visibleSyncCount(localFolders)}->${visibleSyncCount(mergedPayload.folders)}\uFF09`
      );
      return;
    }
    setStatus(
      `${getSyncModeStatusLabel(normalizedSyncMode)}\uFF08${sourceSummary}\uFF09\uFF1A\u8D26\u53F7 ${visibleSyncCount(localAccounts)}->${visibleSyncCount(mergedPayload.accounts)}\uFF0C\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(localPasskeys)}->${visibleSyncCount(mergedPayload.passkeys)}\uFF0C\u6587\u4EF6\u5939 ${visibleSyncCount(localPayload.folders)}->${visibleSyncCount(mergedPayload.folders)}` + (conflictCount > 0 ? `\uFF0C\u5B57\u6BB5\u51B2\u7A81 ${conflictCount} \u4E2A` : "")
    );
  }
  async function confirmRemoteOverwriteLocalIfNeeded() {
    const targets = buildRemoteSyncTargetsFromDom();
    if (!targets || targets.length === 0) return false;
    const unreachableTargets = [];
    const emptyTargets = [];
    for (const target of targets) {
      try {
        const remoteResponse = await pullRemotePayload(target);
        const remotePayload = remoteResponse.payload ? normalizeSyncPayloadShape(remoteResponse.payload) : null;
        if (!remotePayload || visibleSyncCount(remotePayload.accounts) === 0 && visibleSyncCount(remotePayload.passkeys) === 0 && visibleSyncCount(remotePayload.folders) === 0) {
          emptyTargets.push(target.label);
        }
      } catch (error) {
        unreachableTargets.push(`${target.label}\uFF08${error.message}\uFF09`);
      }
    }
    if (unreachableTargets.length === 0 && emptyTargets.length === 0) {
      return true;
    }
    const messages = [];
    if (unreachableTargets.length > 0) {
      messages.push(`\u4EE5\u4E0B\u8FDC\u7AEF\u5F53\u524D\u4E0D\u53EF\u8FBE\uFF1A${unreachableTargets.join("\uFF1B")}\u3002\u7EE7\u7EED\u6267\u884C\u540E\uFF0C\u672C\u6B21\u64CD\u4F5C\u5F88\u53EF\u80FD\u76F4\u63A5\u5931\u8D25\u3002`);
    }
    if (emptyTargets.length > 0) {
      messages.push(`\u4EE5\u4E0B\u8FDC\u7AEF\u5F53\u524D\u4E3A\u7A7A\uFF1A${emptyTargets.join("\u3001")}\u3002\u5982\u679C\u6240\u6709\u53EF\u7528\u8FDC\u7AEF\u90FD\u4E3A\u7A7A\uFF0C\u7EE7\u7EED\u6267\u884C\u53EF\u80FD\u628A\u672C\u5730\u6570\u636E\u8986\u76D6\u6210\u7A7A\u3002`);
    }
    messages.push("\u786E\u5B9A\u4ECD\u8981\u7EE7\u7EED\u6267\u884C\u201C\u4E91\u7AEF\u8986\u76D6\u672C\u5730\u201D\u5417\uFF1F");
    return window.confirm(messages.join("\n\n"));
  }
  async function confirmLocalOverwriteRemoteIfNeeded() {
    const localStored = await readBusinessDataFromStore();
    const localAccounts = Array.isArray(localStored.accounts) ? localStored.accounts : [];
    const localPasskeys = Array.isArray(localStored.passkeys) ? localStored.passkeys : [];
    const localFolders = Array.isArray(localStored.folders) ? localStored.folders : [];
    const isEmpty = visibleSyncCount(localAccounts) === 0 && visibleSyncCount(localPasskeys) === 0 && visibleSyncCount(localFolders) === 0;
    if (!isEmpty) {
      return true;
    }
    return window.confirm("\u672C\u5730\u6570\u636E\u5F53\u524D\u4E3A\u7A7A\u3002\n\n\u7EE7\u7EED\u6267\u884C\u201C\u672C\u5730\u8986\u76D6\u4E91\u7AEF\u201D\u4F1A\u628A\u6240\u6709\u5DF2\u542F\u7528\u8FDC\u7AEF\u540C\u6B65\u6E90\u8986\u76D6\u6210\u7A7A\u6570\u636E\u3002\n\n\u786E\u5B9A\u7EE7\u7EED\u5417\uFF1F");
  }
  function buildRemoteSyncTargetsFromDom() {
    const targets = [];
    const primarySource = normalizeSyncPrimarySource(dom.syncPrimarySource.value);
    if (dom.syncEnableWebdav.checked) {
      const baseUrl = String(dom.syncWebdavBaseUrl.value || "").trim();
      const remotePath = normalizeWebdavRemotePath(String(dom.syncWebdavPath.value || "").trim() || "pass-sync-bundle-v2.json");
      if (!baseUrl || !remotePath) {
        setStatus("WebDAV \u914D\u7F6E\u4E0D\u5B8C\u6574\uFF1A\u8BF7\u586B\u5199\u5730\u5740\u548C\u8FDC\u7AEF\u8DEF\u5F84");
        return null;
      }
      let url;
      try {
        const normalizedBase2 = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
        const base = new URL(normalizedBase2);
        if (base.username || base.password || base.search || base.hash) throw new Error("WebDAV \u5730\u5740\u4E0D\u80FD\u5305\u542B\u8D26\u53F7\u3001\u67E5\u8BE2\u4E32\u6216\u951A\u70B9");
        url = new URL(remotePath, normalizedBase2).toString();
      } catch {
        setStatus("WebDAV \u5730\u5740\u683C\u5F0F\u4E0D\u6B63\u786E");
        return null;
      }
      const username = String(dom.syncWebdavUsername.value || "");
      const password = String(dom.syncWebdavPassword.value || "");
      let authHeader = null;
      if (username || password) {
        authHeader = `Basic ${base64EncodeUtf8(`${username}:${password}`)}`;
      }
      targets.push({ label: "WebDAV", kind: "webdav", url, authHeader, supportsEtag: false, remoteEtag: null, remoteEncrypted: false, isPrimary: primarySource === SYNC_PRIMARY_WEBDAV });
    }
    if (dom.syncEnableServer.checked) {
      const serverBaseUrl = String(dom.syncServerBaseUrl.value || "").trim();
      if (!serverBaseUrl) {
        setStatus("\u670D\u52A1\u5668\u914D\u7F6E\u4E0D\u5B8C\u6574\uFF1A\u8BF7\u586B\u5199\u670D\u52A1\u5730\u5740");
        return null;
      }
      let url;
      try {
        const normalizedBase2 = serverBaseUrl.endsWith("/") ? serverBaseUrl : `${serverBaseUrl}/`;
        url = new URL("v2/sync/state", normalizedBase2).toString();
      } catch {
        setStatus("\u670D\u52A1\u5668\u5730\u5740\u683C\u5F0F\u4E0D\u6B63\u786E");
        return null;
      }
      const token = String(dom.syncServerToken.value || "").trim();
      const authHeader = token ? `Bearer ${token}` : null;
      targets.push({
        label: "\u670D\u52A1\u5668",
        kind: "server",
        url,
        versionsUrl: new URL("v2/sync/versions", normalizedBase).toString(),
        authHeader,
        supportsEtag: true,
        remoteEtag: null,
        remoteEncrypted: false,
        isPrimary: primarySource === SYNC_PRIMARY_SERVER
      });
    }
    if (targets.length === 0) {
      setStatus("\u8BF7\u81F3\u5C11\u542F\u7528\u4E00\u4E2A\u8FDC\u7AEF\u540C\u6B65\u6E90\uFF08WebDAV \u6216 \u81EA\u5EFA\u670D\u52A1\u5668\uFF09");
      return null;
    }
    const primaryTarget = targets.find((target) => target.kind === primarySource) || targets.find((target) => target.kind === SYNC_PRIMARY_SERVER) || targets[0];
    for (const target of targets) target.isPrimary = target === primaryTarget;
    return targets;
  }
  async function pullRemotePayload(target) {
    const headers = {
      Accept: "application/json"
    };
    if (target.authHeader) {
      headers.Authorization = target.authHeader;
    }
    const response = await fetchWithSyncTimeout(target.url, {
      method: "GET",
      headers,
      cache: "no-store"
    });
    if (response.status === 404) {
      return { payload: null, etag: null, encrypted: false };
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    if (!String(text || "").trim()) {
      return {
        payload: null,
        etag: response.headers.get("ETag"),
        encrypted: false
      };
    }
    let parsed;
    try {
      const envelope = JSON.parse(text);
      const encrypted = String(envelope?.schema || "") === "pass.sync.encrypted.v1";
      parsed = await decryptSyncBundleDocument(envelope, dom.syncEncryptionKey.value, [dom.syncPreviousEncryptionKey.value]);
      const payload = parseSyncBundlePayload(parsed, { requireBundleSchema: true });
      if (!payload) {
        throw new Error("\u8FDC\u7AEF\u6570\u636E\u683C\u5F0F\u9519\u8BEF\uFF0C\u4EC5\u652F\u6301 pass.sync.bundle.v2");
      }
      return {
        payload,
        etag: response.headers.get("ETag"),
        encrypted
      };
    } catch (error) {
      throw new Error(`\u8FDC\u7AEF JSON \u89E3\u6790\u5931\u8D25: ${error.message}`);
    }
  }
  async function loadServerSyncVersions() {
    dom.syncVersionsStatus.textContent = "\u6B63\u5728\u8BFB\u53D6\u2026";
    dom.syncVersionsList.replaceChildren();
    try {
      if (!await saveSyncSettings()) throw new Error("\u540C\u6B65\u670D\u52A1\u5668\u914D\u7F6E\u65E0\u6548");
      const targets = buildRemoteSyncTargetsFromDom();
      const target = targets?.find((item) => item.kind === "server");
      if (!target) throw new Error("\u8BF7\u5148\u542F\u7528\u5E76\u914D\u7F6E\u81EA\u5EFA\u670D\u52A1\u5668");
      const headers = { Accept: "application/json" };
      if (target.authHeader) headers.Authorization = target.authHeader;
      const response = await fetchWithSyncTimeout(target.versionsUrl, { method: "GET", headers, cache: "no-store" }, "\u8BFB\u53D6\u670D\u52A1\u5668\u5FEB\u7167");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = await response.json();
      const versions = Array.isArray(parsed?.versions) ? parsed.versions : [];
      renderServerSyncVersions(target, versions);
      dom.syncVersionsStatus.textContent = `\u5171 ${versions.length} \u4E2A\u5FEB\u7167`;
    } catch (error) {
      dom.syncVersionsStatus.textContent = `\u8BFB\u53D6\u5931\u8D25\uFF1A${error.message}`;
    }
  }
  function renderServerSyncVersions(target, versions) {
    dom.syncVersionsList.replaceChildren();
    if (versions.length === 0) {
      dom.syncVersionsList.textContent = "\u670D\u52A1\u5668\u6682\u65E0\u53EF\u6062\u590D\u5FEB\u7167";
      return;
    }
    for (const version of versions) {
      const row = document.createElement("div");
      row.className = "sync-version-row";
      const summary = document.createElement("span");
      summary.textContent = `\u7248\u672C ${version.versionId} \xB7 \u5BFC\u51FA ${formatTime(version.exportedAtMs)} \xB7 \u4FDD\u5B58 ${formatTime(version.savedAtMs)} \xB7 ${String(version.payloadSha256 || "").slice(0, 12)}`;
      const restoreButton = document.createElement("button");
      restoreButton.type = "button";
      restoreButton.textContent = "\u6062\u590D\u6B64\u7248\u672C";
      restoreButton.addEventListener("click", () => void restoreServerSyncVersion(target, version));
      row.append(summary, restoreButton);
      dom.syncVersionsList.append(row);
    }
  }
  async function saveLocalSafetySnapshot(reason, payloadOverride = null) {
    const payload = normalizeSyncPayloadShape(payloadOverride || await readBusinessDataFromStore());
    const snapshots = await getSafetySnapshots();
    snapshots.unshift({
      createdAtMs: Date.now(),
      reason: String(reason || "\u540C\u6B65\u524D\u5907\u4EFD"),
      payload
    });
    await setSafetySnapshots(snapshots);
  }
  async function runStorageSelfCheck() {
    dom.storageDiagnosticsStatus.textContent = "\u6B63\u5728\u68C0\u67E5\u2026";
    try {
      const data = await readBusinessDataFromStore();
      const secrets = await migrateLegacySyncSecrets();
      const snapshots = await getSafetySnapshots();
      const invalidSnapshots = snapshots.filter((item) => !item || !item.payload || !Number(item.createdAtMs));
      if (invalidSnapshots.length > 0) throw new Error(`\u53D1\u73B0 ${invalidSnapshots.length} \u4E2A\u635F\u574F\u672C\u5730\u5FEB\u7167`);
      dom.storageDiagnosticsStatus.textContent = `\u81EA\u68C0\u901A\u8FC7\uFF1A\u8D26\u53F7 ${visibleSyncCount(data.accounts)}\u3001\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(data.passkeys)}\u3001\u6587\u4EF6\u5939 ${visibleSyncCount(data.folders)}\u3001\u5FEB\u7167 ${snapshots.length}\u3001\u540C\u6B65\u5BC6\u94A5 ${secrets.encryptionKey ? "\u5DF2\u914D\u7F6E" : "\u672A\u914D\u7F6E"}`;
    } catch (error) {
      dom.storageDiagnosticsStatus.textContent = `\u81EA\u68C0\u5931\u8D25${error.code ? `\uFF08${error.code}\uFF09` : ""}\uFF1A${error.message}\uFF1B\u672A\u4FEE\u6539\u6570\u636E`;
    }
  }
  async function exportStorageDiagnostics() {
    try {
      const data = await readBusinessDataFromStore();
      const result = await chrome.storage.local.get([STORAGE_KEY_SYNC_DEVICE_ID]);
      const snapshots = await getSafetySnapshots();
      const payload = {
        exportedAtMs: Date.now(),
        deviceId: String(result[STORAGE_KEY_SYNC_DEVICE_ID] || ""),
        counts: {
          accounts: visibleSyncCount(data.accounts),
          passkeys: visibleSyncCount(data.passkeys),
          folders: visibleSyncCount(data.folders)
        },
        snapshotCount: snapshots.length,
        note: "\u8BCA\u65AD\u5BFC\u51FA\u4E0D\u5305\u542B\u5BC6\u7801\u5B57\u6BB5\u3001\u540C\u6B65\u4EE4\u724C\u6216\u540C\u6B65\u52A0\u5BC6\u5BC6\u94A5"
      };
      await downloadTextFile(`pass-diagnostics-${formatFileTimestamp(payload.exportedAtMs)}.json`, JSON.stringify(payload, null, 2), "application/json");
      dom.storageDiagnosticsStatus.textContent = "\u8BCA\u65AD\u6587\u4EF6\u5DF2\u5BFC\u51FA\uFF08\u4E0D\u542B\u654F\u611F\u5B57\u6BB5\uFF09";
    } catch (error) {
      dom.storageDiagnosticsStatus.textContent = `\u5BFC\u51FA\u5931\u8D25\uFF1A${error.message}`;
    }
  }
  async function restoreLatestSafetySnapshot() {
    let snapshots;
    try {
      snapshots = await getSafetySnapshots();
    } catch (error) {
      dom.storageDiagnosticsStatus.textContent = `\u8BFB\u53D6\u672C\u5730\u5B89\u5168\u5FEB\u7167\u5931\u8D25\uFF1A${error.message}`;
      return;
    }
    const latest = snapshots[0];
    if (!latest?.payload) {
      dom.storageDiagnosticsStatus.textContent = "\u6CA1\u6709\u53EF\u6062\u590D\u7684\u672C\u5730\u5B89\u5168\u5FEB\u7167";
      return;
    }
    if (!window.confirm(`\u6062\u590D\u6700\u8FD1\u5FEB\u7167\uFF08${latest.reason || "\u540C\u6B65\u524D\u5907\u4EFD"}\uFF09\uFF1F\u6062\u590D\u524D\u4F1A\u518D\u4FDD\u5B58\u5F53\u524D\u6570\u636E\u3002`)) return;
    try {
      await saveLocalSafetySnapshot("\u6062\u590D\u6700\u8FD1\u5FEB\u7167\u524D");
      await writeBusinessDataToStore(latest.payload);
      await appendHistory(`\u6062\u590D\u6700\u8FD1\u672C\u5730\u5B89\u5168\u5FEB\u7167\uFF1A\u8D26\u53F7 ${visibleSyncCount(latest.payload.accounts)}`);
      await refresh({ silent: true });
      dom.storageDiagnosticsStatus.textContent = `\u5DF2\u6062\u590D\u5FEB\u7167\uFF1A\u8D26\u53F7 ${visibleSyncCount(latest.payload.accounts)}\u3001\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(latest.payload.passkeys)}`;
    } catch (error) {
      dom.storageDiagnosticsStatus.textContent = `\u6062\u590D\u5931\u8D25\uFF1A${error.message}`;
    }
  }
  async function restoreServerSyncVersion(target, version) {
    const versionId = Number(version?.versionId);
    if (!Number.isInteger(versionId) || versionId <= 0) return;
    const confirmed = window.confirm(
      `\u786E\u5B9A\u6062\u590D\u670D\u52A1\u5668\u5FEB\u7167\u7248\u672C ${versionId} \u5417\uFF1F

\u6062\u590D\u524D\u4F1A\u4FDD\u5B58\u5F53\u524D\u672C\u673A\u6570\u636E\uFF1B\u6062\u590D\u540E\u672C\u673A\u6570\u636E\u5C06\u66FF\u6362\u4E3A\u8BE5\u5FEB\u7167\u5185\u5BB9\u3002`
    );
    if (!confirmed) return;
    dom.syncVersionsStatus.textContent = `\u6B63\u5728\u6062\u590D\u7248\u672C ${versionId}\u2026`;
    try {
      await saveLocalSafetySnapshot(`\u6062\u590D\u670D\u52A1\u5668\u5FEB\u7167\u7248\u672C ${versionId} \u524D`);
      const currentResponse = await pullRemotePayload(target);
      if (!currentResponse.payload || !currentResponse.etag) {
        throw new Error("\u670D\u52A1\u5668\u5F53\u524D\u6CA1\u6709\u53EF\u7528\u4E8E\u5E76\u53D1\u4FDD\u62A4\u7684 ETag");
      }
      const headers = { Accept: "application/json", "If-Match": currentResponse.etag };
      if (target.authHeader) headers.Authorization = target.authHeader;
      const restoreUrl = `${target.versionsUrl}/${encodeURIComponent(versionId)}/restore`;
      const idempotencyKey = createSyncIdempotencyKey();
      headers["Idempotency-Key"] = idempotencyKey;
      const response = await fetchWithSyncTimeout(restoreUrl, { method: "POST", headers, cache: "no-store" }, "\u6062\u590D\u670D\u52A1\u5668\u5FEB\u7167");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await verifySelfHostedWriteReceipt(response, idempotencyKey);
      const restoredRemote = await pullRemotePayload(target);
      if (!restoredRemote.payload) throw new Error("\u6062\u590D\u540E\u670D\u52A1\u5668\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u6570\u636E");
      const before = await readBusinessDataFromStore();
      await writeBusinessDataToStore(restoredRemote.payload);
      await appendHistory(
        `\u6062\u590D\u670D\u52A1\u5668\u5FEB\u7167\u7248\u672C ${versionId}\uFF1A\u8D26\u53F7 ${visibleSyncCount(before.accounts)}->${visibleSyncCount(restoredRemote.payload.accounts)}\uFF0C\u901A\u884C\u5BC6\u94A5 ${visibleSyncCount(before.passkeys)}->${visibleSyncCount(restoredRemote.payload.passkeys)}`
      );
      await refresh({ silent: true });
      dom.syncVersionsStatus.textContent = `\u7248\u672C ${versionId} \u6062\u590D\u5B8C\u6210`;
    } catch (error) {
      dom.syncVersionsStatus.textContent = `\u6062\u590D\u5931\u8D25\uFF1A${error.message}`;
    }
  }
  function updateRemoteConcurrencyState(target, etag) {
    const normalizedEtag = typeof etag === "string" && etag.trim() ? etag : null;
    target.remoteEtag = normalizedEtag;
    if (target.kind === "webdav") {
      target.supportsEtag = Boolean(normalizedEtag);
    }
  }
  async function verifySelfHostedWriteReceipt(response, idempotencyKey) {
    const scope = response.headers.get("X-Sync-Scope");
    const etag = response.headers.get("ETag");
    const payloadSha256 = response.headers.get("X-Payload-Sha256");
    const revisionHeader = Number(response.headers.get("X-Sync-Revision"));
    const idempotencyHeader = response.headers.get("X-Sync-Idempotency-Key");
    if (!scope || !etag || !payloadSha256) {
      throw new Error("\u670D\u52A1\u5668\u672A\u8FD4\u56DE\u53EF\u9A8C\u8BC1\u7684\u540C\u6B65\u63D0\u4EA4\u56DE\u6267");
    }
    let receipt;
    try {
      receipt = await response.json();
    } catch {
      throw new Error("\u670D\u52A1\u5668\u63D0\u4EA4\u56DE\u6267\u4E0D\u662F\u6709\u6548 JSON");
    }
    if (!receipt?.ok || !receipt?.committed || receipt.scope !== scope || receipt.etag !== etag || receipt.payloadSha256 !== payloadSha256 || !Number.isInteger(receipt.revision) || receipt.revision < 1 || receipt.revision !== revisionHeader || idempotencyKey && idempotencyHeader !== idempotencyKey || idempotencyKey && receipt.idempotencyKey !== idempotencyKey) {
      throw new Error("\u670D\u52A1\u5668\u63D0\u4EA4\u56DE\u6267\u6821\u9A8C\u5931\u8D25");
    }
    return etag;
  }
  async function pushRemotePayload(target, payload, ifMatch = null, idempotencyKey = null) {
    if (target.remoteEncrypted && target.remotePayload && syncPayloadEquals(target.remotePayload, payload)) {
      return { etag: target.remoteEtag, skipped: true };
    }
    const bundle = await buildSyncBundleFromPayload(payload);
    const encryptedBundle = await encryptSyncBundleDocument(bundle, dom.syncEncryptionKey.value);
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    if (target.authHeader) {
      headers.Authorization = target.authHeader;
    }
    if (ifMatch) {
      headers["If-Match"] = ifMatch;
    } else if (target.kind === "webdav") {
      headers["If-None-Match"] = "*";
    }
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await fetchWithSyncTimeout(target.url, {
      method: "PUT",
      headers,
      body: JSON.stringify(encryptedBundle, null, 2)
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const confirmedEtag = target.kind === "server" ? await verifySelfHostedWriteReceipt(response, idempotencyKey) : response.headers.get("ETag");
    target.remotePayload = payload;
    target.remoteEncrypted = true;
    return {
      etag: confirmedEtag
    };
  }
  async function pushRemotePayloadWithRetry(target, payload) {
    let candidate = payload;
    const idempotencyKey = createSyncIdempotencyKey();
    for (let attempt = 0; attempt < SYNC_PUSH_CONFLICT_MAX_ATTEMPTS; attempt += 1) {
      try {
        const pushResult = await pushRemotePayload(target, candidate, target.remoteEtag, idempotencyKey);
        updateRemoteConcurrencyState(target, pushResult.etag);
        target.remotePayload = candidate;
        target.remoteEncrypted = true;
        return { payload: candidate };
      } catch (error) {
        if (error?.status !== 412 && error?.status !== 428) {
          try {
            const probe = await pullRemotePayload(target);
            if (probe.payload && syncPayloadEquals(probe.payload, candidate)) {
              updateRemoteConcurrencyState(target, probe.etag);
              target.remotePayload = candidate;
              target.remoteEncrypted = true;
              return { payload: candidate };
            }
          } catch (_) {
          }
          throw error;
        }
        if (attempt === SYNC_PUSH_CONFLICT_MAX_ATTEMPTS - 1) throw error;
      }
      const latestResponse = await pullRemotePayload(target);
      updateRemoteConcurrencyState(target, latestResponse.etag);
      target.remotePayload = latestResponse.payload;
      target.remoteEncrypted = latestResponse.encrypted;
      if (target.isPrimary === false) {
        continue;
      }
      const remotePayload = latestResponse.payload || { accounts: [], passkeys: [], folders: [] };
      const currentLocalPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
      if (!syncPayloadEquals(currentLocalPayload, candidate)) {
        throw new Error("\u672C\u5730\u6570\u636E\u5728\u8FDC\u7AEF\u51B2\u7A81\u91CD\u8BD5\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u5199\u5165\uFF0C\u8BF7\u91CD\u65B0\u540C\u6B65");
      }
      const localAccounts = Array.isArray(candidate.accounts) ? candidate.accounts.map(normalizeAccountShape) : [];
      const localPasskeys = buildUnifiedPasskeys(
        localAccounts,
        Array.isArray(candidate.passkeys) ? candidate.passkeys.map(normalizePasskeyShape) : []
      );
      const localFolders = Array.isArray(candidate.folders) ? candidate.folders.map(normalizeFolderShape) : [];
      const localBeforeMerge = {
        ...candidate,
        accounts: localAccounts,
        passkeys: localPasskeys,
        folders: localFolders
      };
      if (target.isPrimary !== false) {
        candidate = mergeSyncPayloads2(localBeforeMerge, remotePayload);
      }
      const safety = validateSyncSafety(
        localBeforeMerge,
        remotePayload,
        candidate,
        SYNC_MODE_MERGE
      );
      if (!safety.safe) {
        throw new Error(`\u5E76\u53D1\u91CD\u8BD5\u5408\u5E76\u88AB\u5B89\u5168\u68C0\u67E5\u963B\u6B62\uFF1A${safety.reasons.join("\u3001")}`);
      }
      if (target.isPrimary !== false) {
        await writeBusinessDataToStore(candidate);
      }
    }
    throw new Error("\u8FDC\u7AEF\u5E76\u53D1\u51B2\u7A81\u91CD\u8BD5\u6B21\u6570\u5DF2\u7528\u5C3D");
  }
  async function pushRemotePayloadRemotePreferred(target, payload) {
    let candidate = payload;
    const idempotencyKey = createSyncIdempotencyKey();
    for (let attempt = 0; attempt < SYNC_PUSH_CONFLICT_MAX_ATTEMPTS; attempt += 1) {
      try {
        const pushResult = await pushRemotePayload(target, candidate, target.remoteEtag, idempotencyKey);
        updateRemoteConcurrencyState(target, pushResult.etag);
        target.remotePayload = candidate;
        return { payload: candidate };
      } catch (error) {
        if (error?.status !== 412 && error?.status !== 428) {
          try {
            const probe = await pullRemotePayload(target);
            if (probe.payload && syncPayloadEquals(probe.payload, candidate)) {
              updateRemoteConcurrencyState(target, probe.etag);
              target.remotePayload = candidate;
              target.remoteEncrypted = true;
              return { payload: candidate };
            }
          } catch (_) {
          }
          throw error;
        }
        if (attempt === SYNC_PUSH_CONFLICT_MAX_ATTEMPTS - 1) throw error;
      }
      const latestResponse = await pullRemotePayload(target);
      updateRemoteConcurrencyState(target, latestResponse.etag);
      if (target.isPrimary === false) {
        target.remotePayload = latestResponse.payload;
        target.remoteEncrypted = latestResponse.encrypted;
        continue;
      }
      const latestPayload = latestResponse.payload || { accounts: [], passkeys: [], folders: [] };
      const currentLocalPayload = normalizeSyncPayloadShape(await readBusinessDataFromStore());
      if (!syncPayloadEquals(currentLocalPayload, candidate)) {
        throw new Error("\u672C\u5730\u6570\u636E\u5728\u8FDC\u7AEF\u51B2\u7A81\u91CD\u8BD5\u671F\u95F4\u53D1\u751F\u53D8\u5316\uFF0C\u5DF2\u505C\u6B62\u5199\u5165\uFF0C\u8BF7\u91CD\u65B0\u540C\u6B65");
      }
      const safety = validateSyncSafety(
        candidate,
        latestPayload,
        latestPayload,
        SYNC_MODE_REMOTE_OVERWRITE_LOCAL
      );
      if (!safety.safe) {
        throw new Error(`\u5E76\u53D1\u91CD\u8BD5\u7684\u4E91\u7AEF\u8986\u76D6\u88AB\u5B89\u5168\u68C0\u67E5\u963B\u6B62: ${safety.reasons.join(",")}`);
      }
      if (target.isPrimary !== false) {
        candidate = latestPayload;
      }
      target.remotePayload = candidate;
      target.remoteEncrypted = true;
      if (target.isPrimary !== false) {
        await writeBusinessDataToStore(candidate);
      }
    }
    throw new Error("\u8FDC\u7AEF\u5E76\u53D1\u51B2\u7A81\u91CD\u8BD5\u6B21\u6570\u5DF2\u7528\u5C3D");
  }
  async function pushRemotePayloadWithMode(target, payload, syncMode) {
    switch (syncMode) {
      case SYNC_MODE_LOCAL_OVERWRITE_REMOTE: {
        const pushResult = await pushRemotePayload(target, payload, target.remoteEtag, createSyncIdempotencyKey());
        updateRemoteConcurrencyState(target, pushResult.etag);
        return { payload };
      }
      case SYNC_MODE_REMOTE_OVERWRITE_LOCAL:
        return pushRemotePayloadRemotePreferred(target, payload);
      case SYNC_MODE_MERGE:
      default:
        return pushRemotePayloadWithRetry(target, payload);
    }
  }
  function normalizeSyncMode(value) {
    switch (String(value || "").trim()) {
      case SYNC_MODE_REMOTE_OVERWRITE_LOCAL:
        return SYNC_MODE_REMOTE_OVERWRITE_LOCAL;
      case SYNC_MODE_LOCAL_OVERWRITE_REMOTE:
        return SYNC_MODE_LOCAL_OVERWRITE_REMOTE;
      case SYNC_MODE_MERGE:
      default:
        return SYNC_MODE_MERGE;
    }
  }
  function getSyncModeHistoryLabel(syncMode) {
    switch (syncMode) {
      case SYNC_MODE_REMOTE_OVERWRITE_LOCAL:
        return "\u4E91\u7AEF\u8986\u76D6\u672C\u5730";
      case SYNC_MODE_LOCAL_OVERWRITE_REMOTE:
        return "\u672C\u5730\u8986\u76D6\u4E91\u7AEF";
      case SYNC_MODE_MERGE:
      default:
        return "\u8FDC\u7AEF\u540C\u6B65\u5408\u5E76";
    }
  }
  function getSyncModeStatusLabel(syncMode) {
    switch (syncMode) {
      case SYNC_MODE_REMOTE_OVERWRITE_LOCAL:
        return "\u4E91\u7AEF\u8986\u76D6\u672C\u5730\u5B8C\u6210";
      case SYNC_MODE_LOCAL_OVERWRITE_REMOTE:
        return "\u672C\u5730\u8986\u76D6\u4E91\u7AEF\u5B8C\u6210";
      case SYNC_MODE_MERGE:
      default:
        return "\u8FDC\u7AEF\u540C\u6B65\u5B8C\u6210";
    }
  }
  async function buildSyncBundleFromPayload(payload) {
    const [deviceName, deviceId] = await Promise.all([getDeviceName(), getOrCreateSyncDeviceId()]);
    const accounts = Array.isArray(payload?.accounts) ? payload.accounts.map(normalizeAccountShape) : [];
    const rawPasskeys = Array.isArray(payload?.passkeys) ? payload.passkeys.map(normalizePasskeyShape) : [];
    const passkeys = buildUnifiedPasskeys(accounts, rawPasskeys);
    const folders = Array.isArray(payload?.folders) ? payload.folders.map(normalizeFolderShape) : [];
    return {
      schema: SYNC_BUNDLE_SCHEMA_V2,
      exportedAtMs: Date.now(),
      source: {
        app: "pass-extension",
        platform: "chrome-extension",
        deviceName,
        deviceId,
        logicalClockMs: Date.now(),
        formatVersion: 2
      },
      payload: sortSyncPayloadCollections({
        ...normalizeSyncPayloadShape(payload),
        accounts,
        passkeys,
        folders
      })
    };
  }
  function base64EncodeUtf8(input) {
    const bytes = new TextEncoder().encode(String(input || ""));
    let binary = "";
    for (const value of bytes) {
      binary += String.fromCharCode(value);
    }
    return btoa(binary);
  }
  async function buildSyncBundle() {
    const [deviceName, deviceId, stored] = await Promise.all([
      getDeviceName(),
      getOrCreateSyncDeviceId(),
      readBusinessDataFromStore()
    ]);
    const accounts = Array.isArray(stored.accounts) ? stored.accounts.map(normalizeAccountShape) : [];
    const storedPasskeys = Array.isArray(stored.passkeys) ? stored.passkeys.map(normalizePasskeyShape) : [];
    const passkeys = buildUnifiedPasskeys(accounts, storedPasskeys);
    const folders = Array.isArray(stored.folders) ? stored.folders.map(normalizeFolderShape) : [];
    return {
      schema: SYNC_BUNDLE_SCHEMA_V2,
      exportedAtMs: Date.now(),
      source: {
        app: "pass-extension",
        platform: "chrome-extension",
        deviceName,
        deviceId,
        logicalClockMs: Date.now(),
        formatVersion: 2
      },
      payload: sortSyncPayloadCollections({
        ...normalizeSyncPayloadShape(stored),
        accounts,
        passkeys,
        folders
      })
    };
  }
  function parseSyncBundlePayload(input, { requireBundleSchema = false } = {}) {
    if (!input || typeof input !== "object") return null;
    const schema = String(input?.schema || "");
    const hasSchema = schema.length > 0;
    if (hasSchema && schema !== SYNC_BUNDLE_SCHEMA_V2) return null;
    if (requireBundleSchema && !hasSchema) return null;
    const rawPayload = hasSchema ? input.payload : input;
    if (!rawPayload || typeof rawPayload !== "object") return null;
    return {
      accounts: Array.isArray(rawPayload.accounts) ? rawPayload.accounts : [],
      passkeys: Array.isArray(rawPayload.passkeys) ? rawPayload.passkeys : [],
      folders: Array.isArray(rawPayload.folders) ? rawPayload.folders : [],
      allRegularAccountIds: Array.isArray(rawPayload.allRegularAccountIds) ? rawPayload.allRegularAccountIds : [],
      allRegularOrderUpdatedAtMs: Number(rawPayload.allRegularOrderUpdatedAtMs) || 0,
      allRegularOrderUpdatedDeviceName: String(rawPayload.allRegularOrderUpdatedDeviceName || ""),
      folderOrderIds: Array.isArray(rawPayload.folderOrderIds) ? rawPayload.folderOrderIds : [],
      folderOrderUpdatedAtMs: Number(rawPayload.folderOrderUpdatedAtMs) || 0,
      folderOrderUpdatedDeviceName: String(rawPayload.folderOrderUpdatedDeviceName || ""),
      deviceName: String(rawPayload.deviceName || "")
    };
  }
  function pickJsonFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener(
        "change",
        () => {
          resolve(input.files?.[0] || null);
        },
        { once: true }
      );
      input.click();
    });
  }
  function pickCsvFile() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv,text/csv,text/plain";
      input.onchange = () => resolve(input.files?.[0] || null);
      input.click();
    });
  }
  function pickImageFiles() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff";
      input.multiple = true;
      input.onchange = () => resolve(Array.from(input.files || []));
      input.click();
    });
  }
  function normalizeBrowserExportFormat(format) {
    const value = String(format || "").trim().toLowerCase();
    if (value === "firefox") return "firefox";
    if (value === "safari") return "safari";
    return "chrome";
  }
  function browserExportLabel(format) {
    const browser = normalizeBrowserExportFormat(format);
    if (browser === "firefox") return "Firefox";
    if (browser === "safari") return "Safari";
    return "Chrome";
  }
  function countBrowserPasswordRows(accounts) {
    return (Array.isArray(accounts) ? accounts : []).filter((account) => !account?.isDeleted).reduce((count, account) => count + normalizeSites(account?.sites || []).length, 0);
  }
  function buildBrowserPasswordCsv(accounts, format) {
    const browser = normalizeBrowserExportFormat(format);
    const headers = browser === "firefox" ? ["url", "username", "password"] : ["name", "url", "username", "password", "note"];
    const rows = [headers.map(csvEscape).join(",")];
    for (const account of Array.isArray(accounts) ? accounts : []) {
      if (account?.isDeleted) continue;
      const sites = normalizeSites(account?.sites || []);
      for (const site of sites) {
        const url = `https://${site}`;
        const username = String(account?.username || "");
        const password = String(account?.password || "");
        const note = String(account?.note || "");
        const name = String(account?.canonicalSite || "").trim() || site;
        const columns = browser === "firefox" ? [url, username, password] : [name, url, username, password, note];
        rows.push(columns.map(csvEscape).join(","));
      }
    }
    return rows.join("\n");
  }
  function csvEscape(value) {
    let text = String(value || "").replaceAll("\r", " ").replaceAll("\n", " ");
    if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }
  function parseBrowserPasswordCsv(text) {
    const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!normalized) {
      throw new Error("\u6587\u4EF6\u5185\u5BB9\u4E3A\u7A7A");
    }
    const rows = parseCsvRows(normalized);
    if (!rows.length || !rows[0].length) {
      throw new Error("CSV \u7F3A\u5C11\u8868\u5934");
    }
    const headers = rows[0].map((value) => normalizeBrowserCsvHeader(value));
    const format = detectBrowserCsvFormat(headers);
    if (!format) {
      throw new Error("\u65E0\u6CD5\u8BC6\u522B\u4E3A Chrome \u6216 Firefox \u5BFC\u51FA\u7684\u5BC6\u7801 CSV");
    }
    const entries = [];
    let skippedRowCount = 0;
    for (const row of rows.slice(1)) {
      const entry = parseBrowserCsvEntry(headers, row);
      if (entry) {
        entries.push(entry);
      } else if (row.join("").trim()) {
        skippedRowCount += 1;
      }
    }
    return {
      formatLabel: format,
      entries,
      skippedRowCount
    };
  }
  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (inQuotes) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }
  function normalizeBrowserCsvHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/^\ufeff/, "").replace(/\s+/g, "").replace(/-/g, "_");
  }
  function detectBrowserCsvFormat(headers) {
    const values = new Set(headers);
    if (values.has("url") && values.has("username") && values.has("password")) {
      if (values.has("name") || values.has("note") || values.has("notes")) return "Chrome";
      if (values.has("httprealm") || values.has("formactionorigin") || values.has("guid")) return "Firefox";
      return "\u6D4F\u89C8\u5668 CSV";
    }
    if (values.has("origin") && values.has("username") && values.has("password")) return "Chrome";
    if (values.has("signon_realm") && values.has("username") && values.has("password")) return "Chrome";
    return "";
  }
  function parseBrowserCsvEntry(headers, row) {
    const values = {};
    headers.forEach((header, index) => {
      values[header] = String(row[index] || "").trim();
    });
    const sites = extractBrowserCsvSites(values);
    const username = normalizeUsername(values.username || "");
    const password = String(values.password || "");
    if (!sites.length || !username && !password) {
      return null;
    }
    const note = mergeImportedBrowserNotes([
      values.name ? `\u6765\u6E90\u540D\u79F0\uFF1A${values.name}` : "",
      values.note ? `\u5907\u6CE8\uFF1A${values.note}` : "",
      values.notes ? `\u5907\u6CE8\uFF1A${values.notes}` : "",
      values.httprealm ? `HTTP Realm\uFF1A${values.httprealm}` : ""
    ]);
    return { sites, username, password, note };
  }
  function extractBrowserCsvSites(values) {
    const rawCandidates = [
      values.url,
      values.origin,
      values.website,
      values.hostname,
      values.signon_realm,
      values.formactionorigin,
      values.action
    ];
    return [...new Set(rawCandidates.map(normalizeBrowserCsvSite).filter(Boolean))].sort();
  }
  function normalizeBrowserCsvSite(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.includes("://")) {
      try {
        return normalizeDomain(new URL(raw).hostname);
      } catch {
        return "";
      }
    }
    return normalizeDomain(raw);
  }
  function findImportedBrowserAccountIndex(accounts, entry) {
    const targetSites = new Set(normalizeSites(entry.sites || []));
    const targetCanonicalSites = new Set([...targetSites].map((site) => etldPlusOne(site)));
    const normalizedUsername = normalizeUsername(entry.username || "");
    let bestIndex = -1;
    let bestScore = -1;
    accounts.forEach((account, index) => {
      if (account?.isPermanentlyDeleted) return;
      const accountSites = new Set(
        normalizeSites([
          ...Array.isArray(account?.sites) ? account.sites : [],
          account?.canonicalSite || ""
        ])
      );
      const accountCanonicalSites = new Set([...accountSites].map((site) => etldPlusOne(site)));
      accountCanonicalSites.add(String(account?.canonicalSite || ""));
      const usernameMatches = normalizedUsername ? normalizeUsername(account?.username || "") === normalizedUsername || normalizeUsername(account?.usernameAtCreate || "") === normalizedUsername : !normalizeUsername(account?.username || "");
      const siteOverlaps = [...targetSites].some((site) => accountSites.has(site));
      const canonicalMatches = [...targetCanonicalSites].some((site) => accountCanonicalSites.has(site));
      const aliasMatches = [...targetSites].some(
        (targetSite) => [...accountSites].some((accountSite) => domainsMatch(targetSite, accountSite))
      );
      let score = -1;
      if (usernameMatches && siteOverlaps) score = account?.isDeleted ? 35 : 40;
      else if (usernameMatches && canonicalMatches) score = account?.isDeleted ? 25 : 30;
      else if (usernameMatches && aliasMatches) score = account?.isDeleted ? 15 : 20;
      else if (!normalizedUsername && siteOverlaps) score = account?.isDeleted ? 15 : 20;
      else if (!normalizedUsername && canonicalMatches) score = account?.isDeleted ? 5 : 10;
      else if (!normalizedUsername && aliasMatches) score = account?.isDeleted ? 0 : 5;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    return bestIndex;
  }
  function applyImportedBrowserEntryToAccount(account, entry, nowMs) {
    const next = normalizeAccountShape(account);
    if (next.isPermanentlyDeleted) return next;
    let changed = false;
    const mergedSites = normalizeSites([...next.sites || [], ...entry.sites || []]);
    if (JSON.stringify(mergedSites) !== JSON.stringify(next.sites || [])) {
      next.sites = mergedSites;
      changed = true;
    }
    if (entry.username && entry.username !== next.username) {
      next.username = entry.username;
      next.usernameUpdatedAtMs = nowMs;
      changed = true;
    }
    if (entry.password && entry.password !== next.password) {
      next.password = entry.password;
      next.passwordUpdatedAtMs = nowMs;
      changed = true;
    }
    const mergedNote = mergeImportedBrowserNotes([next.note || "", entry.note || ""]);
    if (mergedNote !== String(next.note || "")) {
      next.note = mergedNote;
      next.noteUpdatedAtMs = nowMs;
      changed = true;
    }
    if (next.isDeleted && !next.isPermanentlyDeleted) {
      next.isDeleted = false;
      next.deletedAtMs = null;
      next.deletedDeviceName = "";
      changed = true;
    }
    if (changed) {
      next.updatedAtMs = nowMs;
      next.lastOperatedDeviceName = currentImportDeviceName();
    }
    return next;
  }
  function mergeImportedBrowserNotes(parts) {
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    for (const rawPart of Array.isArray(parts) ? parts : []) {
      const part = String(rawPart || "").trim();
      if (!part || seen.has(part)) continue;
      seen.add(part);
      result.push(part);
    }
    return result.join("\n");
  }
  function currentImportDeviceName() {
    return normalizeDeviceName(dom.deviceName?.value);
  }
  function formatFileTimestamp(ms) {
    const date = new Date(Number(ms) || Date.now());
    const yyyy = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}${month}${day}-${hour}${minute}${second}`;
  }
  async function clearActiveAccounts() {
    if (activeAccountView === "recycle") {
      setStatus("\u5F53\u524D\u662F\u56DE\u6536\u7AD9\u89C6\u56FE\uFF0C\u8BF7\u4F7F\u7528\u201C\u6E05\u7A7A\u56DE\u6536\u7AD9\u201D");
      return;
    }
    const visibleAccounts = currentVisibleAccounts(accountsRaw).filter((item) => !item.isDeleted);
    const targetAccountIds = new Set(visibleAccounts.map((item) => String(item.accountId || "")));
    const activeCount = targetAccountIds.size;
    if (activeCount === 0) {
      setStatus("\u5F53\u524D\u9875\u9762\u6CA1\u6709\u53EF\u79FB\u5165\u56DE\u6536\u7AD9\u7684\u8D26\u53F7");
      return;
    }
    const confirmed = window.confirm(
      `\u5C06\u628A\u5F53\u524D\u9875\u9762\u4E2D\u7684 ${activeCount} \u6761\u8BB0\u5F55\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C\u662F\u5426\u7EE7\u7EED\uFF1F`
    );
    if (!confirmed) {
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    const next = cloneAccounts(accountsRaw).map((account) => {
      const accountId = String(account?.accountId || "");
      if (account.isDeleted || !targetAccountIds.has(accountId)) return account;
      return {
        ...account,
        isDeleted: true,
        deletedAtMs: now,
        updatedAtMs: now,
        lastOperatedDeviceName: deviceName
      };
    });
    editingAccountId = null;
    await setAccounts(next);
    await appendHistory(`\u6279\u91CF\u79FB\u5165\u56DE\u6536\u7AD9\uFF1A${activeCount} \u6761\u8D26\u53F7`, now);
    await refresh({ silent: true });
    setStatus(`\u5DF2\u5C06\u5F53\u524D\u9875\u9762 ${activeCount} \u6761\u8D26\u53F7\u79FB\u5165\u56DE\u6536\u7AD9`);
  }
  async function clearRecycleBin() {
    const deletedCount = accountsRaw.filter((item) => item.isDeleted && !item.isPermanentlyDeleted).length;
    if (deletedCount === 0) {
      setStatus("\u56DE\u6536\u7AD9\u4E3A\u7A7A\uFF0C\u65E0\u9700\u6E05\u7A7A");
      return;
    }
    const confirmed = window.confirm(
      `\u5C06\u6C38\u4E45\u5220\u9664\u56DE\u6536\u7AD9\u4E2D\u7684 ${deletedCount} \u6761\u8BB0\u5F55\uFF0C\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002\u662F\u5426\u7EE7\u7EED\uFF1F`
    );
    if (!confirmed) {
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    const next = cloneAccounts(accountsRaw).map((account) => account.isDeleted && !account.isPermanentlyDeleted ? {
      ...account,
      isDeleted: true,
      isPermanentlyDeleted: true,
      deletedAtMs: now,
      deletedDeviceName: deviceName,
      updatedAtMs: now,
      lastOperatedDeviceName: deviceName
    } : account);
    editingAccountId = null;
    await setAccounts(next);
    await appendHistory(`\u6E05\u7A7A\u56DE\u6536\u7AD9\uFF1A\u6C38\u4E45\u5220\u9664 ${deletedCount} \u6761\u8D26\u53F7`);
    await refresh({ silent: true });
    setStatus(`\u5DF2\u6E05\u7A7A\u56DE\u6536\u7AD9\uFF0C\u6C38\u4E45\u5220\u9664 ${deletedCount} \u6761\u8BB0\u5F55`);
  }
  async function createFolderFromPrompt() {
    const raw = window.prompt("\u65B0\u5EFA\u6587\u4EF6\u5939\n\u8BF7\u8F93\u5165\u6587\u4EF6\u5939\u540D\u79F0\uFF1A", "");
    if (raw == null) {
      setStatus("\u5DF2\u53D6\u6D88\u65B0\u5EFA\u6587\u4EF6\u5939");
      return;
    }
    const name = String(raw || "").trim();
    if (!name) {
      setStatus("\u6587\u4EF6\u5939\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
      return;
    }
    const existed = foldersRaw.some(
      (item) => String(item?.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    if (existed) {
      setStatus(`\u6587\u4EF6\u5939\u5DF2\u5B58\u5728: ${name}`);
      return;
    }
    const now = Date.now();
    const nextFolderId = (globalThis.crypto?.randomUUID?.() || stableUuidFromText(`folder|${name}|${now}`)).toLowerCase();
    const storedData = await readBusinessDataFromStore();
    const storedFolders = Array.isArray(storedData.folders) ? storedData.folders : [];
    const nextFolders = sortFoldersForDisplay([
      ...storedFolders.map(normalizeFolderShape),
      normalizeFolderShape({
        id: nextFolderId,
        name,
        createdAtMs: now,
        updatedAtMs: now
      })
    ]);
    await setFolders(nextFolders);
    await appendHistory(`\u521B\u5EFA\u6587\u4EF6\u5939\uFF1A${name}`, now);
    await refresh({ silent: true });
    setStatus(`\u5DF2\u521B\u5EFA\u6587\u4EF6\u5939: ${name}`);
  }
  function renderGoogleAuthenticatorImportFolderOptions() {
    const select = dom.importGoogleAuthFolderSelect;
    if (!select) return;
    const previousValue = String(select.value || "");
    select.innerHTML = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "\u4E0D\u653E\u5165\u6587\u4EF6\u5939";
    select.appendChild(empty);
    for (const folder of foldersRaw) {
      const option = document.createElement("option");
      option.value = normalizeFolderId(folder?.id);
      option.textContent = String(folder?.name || "\u672A\u547D\u540D\u6587\u4EF6\u5939");
      select.appendChild(option);
    }
    const hasPrevious = Array.from(select.options).some((option) => option.value === previousValue);
    select.value = hasPrevious ? previousValue : "";
  }
  function buildGoogleAuthenticatorImportFolderPlan() {
    return {
      selectedFolderId: normalizeFolderId(dom.importGoogleAuthFolderSelect?.value || ""),
      newFolderName: String(dom.importGoogleAuthNewFolderName?.value || "").trim()
    };
  }
  function resolveGoogleAuthenticatorImportFolder(folderPlan, foldersInput) {
    const folders = Array.isArray(foldersInput) ? foldersInput.map(normalizeFolderShape) : [];
    const newFolderName = String(folderPlan?.newFolderName || "").trim();
    if (newFolderName) {
      const existing2 = folders.find((folder) => String(folder?.name || "").trim().toLowerCase() === newFolderName.toLowerCase());
      if (existing2) {
        return {
          folderId: normalizeFolderId(existing2.id),
          folderName: String(existing2.name || ""),
          createdFolderName: "",
          folders
        };
      }
      const now = Date.now();
      const created = normalizeFolderShape({
        id: (globalThis.crypto?.randomUUID?.() || stableUuidFromText(`folder|${newFolderName}|${now}`)).toLowerCase(),
        name: newFolderName,
        createdAtMs: now,
        updatedAtMs: now
      });
      return {
        folderId: normalizeFolderId(created.id),
        folderName: String(created.name || ""),
        createdFolderName: String(created.name || ""),
        folders: sortFoldersForDisplay([...folders, created])
      };
    }
    const selectedFolderId = normalizeFolderId(folderPlan?.selectedFolderId || "");
    if (!selectedFolderId) {
      return { folderId: "", folderName: "", createdFolderName: "", folders };
    }
    const existing = folders.find((folder) => normalizeFolderId(folder?.id) === selectedFolderId);
    if (!existing) {
      setStatus("\u76EE\u6807\u6587\u4EF6\u5939\u4E0D\u5B58\u5728");
      return { folderId: "", folderName: "", createdFolderName: "", folders };
    }
    return {
      folderId: selectedFolderId,
      folderName: String(existing.name || ""),
      createdFolderName: "",
      folders
    };
  }
  async function deleteFolder(folderId) {
    const normalizedFolderId = normalizeFolderId(folderId);
    if (!normalizedFolderId) {
      setStatus("\u76EE\u6807\u6587\u4EF6\u5939\u4E0D\u5B58\u5728");
      return;
    }
    if (normalizedFolderId === FIXED_NEW_ACCOUNT_FOLDER_ID) {
      setStatus("\u56FA\u5B9A\u6587\u4EF6\u5939\u4E0D\u53EF\u5220\u9664");
      return;
    }
    const folder = foldersRaw.find((item) => normalizeFolderId(item?.id) === normalizedFolderId);
    if (!folder) {
      setStatus("\u76EE\u6807\u6587\u4EF6\u5939\u4E0D\u5B58\u5728");
      return;
    }
    const confirmed = window.confirm(`\u5C06\u5220\u9664\u6587\u4EF6\u5939\uFF1A${folder.name}
\u5E76\u4ECE\u76F8\u5173\u8D26\u53F7\u4E2D\u79FB\u9664\u8BE5\u6587\u4EF6\u5939\u3002\u662F\u5426\u7EE7\u7EED\uFF1F`);
    if (!confirmed) return;
    const now = Date.now();
    const deviceName = await getDeviceName();
    const storedData = await readBusinessDataFromStore();
    const storedFolders = Array.isArray(storedData.folders) ? storedData.folders : [];
    let removedFromAccountCount = 0;
    const nextAccounts = cloneAccounts(accountsRaw).map((account) => {
      const currentFolderIds = normalizeFolderIdList(extractAccountFolderIds(account));
      if (!currentFolderIds.includes(normalizedFolderId)) {
        return account;
      }
      const nextFolderIds = currentFolderIds.filter((id) => id !== normalizedFolderId);
      const nextAccount = {
        ...account,
        folderId: nextFolderIds[0] || null,
        folderIds: nextFolderIds,
        folderMembershipStates: {
          ...account.folderMembershipStates || {},
          [normalizedFolderId]: { isDeleted: true, updatedAtMs: now, deviceName }
        },
        updatedAtMs: now,
        lastOperatedDeviceName: deviceName
      };
      removedFromAccountCount += 1;
      return nextAccount;
    });
    const nextFolders = sortFoldersForDisplay(
      storedFolders.map((item) => {
        const normalized = normalizeFolderShape(item);
        if (normalizeFolderId(normalized.id) !== normalizedFolderId) return normalized;
        return {
          ...normalized,
          isDeleted: true,
          isPermanentlyDeleted: true,
          deletedAtMs: now,
          deletedDeviceName: deviceName,
          updatedAtMs: now
        };
      })
    );
    await writeBusinessDataToStore({
      accounts: nextAccounts,
      passkeys: passkeysRaw,
      folders: nextFolders
    });
    await appendHistory(
      removedFromAccountCount > 0 ? `\u5220\u9664\u6587\u4EF6\u5939\uFF1A${folder.name}\uFF0C\u5E76\u4ECE ${removedFromAccountCount} \u4E2A\u8D26\u53F7\u4E2D\u79FB\u9664` : `\u5220\u9664\u6587\u4EF6\u5939\uFF1A${folder.name}`
    );
    if (activeAccountView === `folder:${normalizedFolderId}`) {
      activeAccountView = "all";
    }
    await refresh({ silent: true });
    if (removedFromAccountCount > 0) {
      setStatus(`\u5DF2\u5220\u9664\u6587\u4EF6\u5939: ${folder.name}\uFF0C\u5E76\u4ECE ${removedFromAccountCount} \u4E2A\u8D26\u53F7\u4E2D\u79FB\u9664`);
    } else {
      setStatus(`\u5DF2\u5220\u9664\u6587\u4EF6\u5939: ${folder.name}`);
    }
  }
  async function toggleAccountFolderMembership(accountId, folderId) {
    const normalizedFolderId = normalizeFolderId(folderId);
    if (!normalizedFolderId) return;
    if (!foldersRaw.some((item) => normalizeFolderId(item?.id) === normalizedFolderId)) {
      setStatus("\u76EE\u6807\u6587\u4EF6\u5939\u4E0D\u5B58\u5728");
      return;
    }
    const next = cloneAccounts(accountsRaw);
    const target = next.find((item) => String(item?.accountId || "") === String(accountId));
    if (!target) {
      setStatus("\u76EE\u6807\u8D26\u53F7\u4E0D\u5B58\u5728");
      return;
    }
    if (target.isDeleted) {
      setStatus("\u56DE\u6536\u7AD9\u8D26\u53F7\u4E0D\u652F\u6301\u653E\u5165\u6587\u4EF6\u5939");
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    const current = normalizeFolderIdList(extractAccountFolderIds(target));
    const exists = current.includes(normalizedFolderId);
    const nextFolderIds = exists ? current.filter((id) => id !== normalizedFolderId) : normalizeFolderIdList([...current, normalizedFolderId]);
    target.folderId = nextFolderIds[0] || null;
    target.folderIds = nextFolderIds;
    target.folderMembershipStates = {
      ...target.folderMembershipStates || {},
      [normalizedFolderId]: { isDeleted: exists, updatedAtMs: now, deviceName }
    };
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    await setAccounts(next);
    const folderName = folderDisplayNameById(normalizedFolderId);
    await appendHistory(
      exists ? `${target.accountId}\uFF1A\u4ECE\u6587\u4EF6\u5939\u79FB\u9664 ${folderName}` : `${target.accountId}\uFF1A\u653E\u5165\u6587\u4EF6\u5939 ${folderName}`,
      now
    );
    await refresh({ silent: true });
    setStatus(exists ? `\u5DF2\u4ECE\u6587\u4EF6\u5939\u79FB\u9664: ${folderName}` : `\u5DF2\u653E\u5165\u6587\u4EF6\u5939: ${folderName}`);
  }
  function renderSidebar(inputAccounts) {
    const accounts = (Array.isArray(inputAccounts) ? inputAccounts : []).map(normalizeAccountShape);
    const active = accounts.filter((item) => !item.isDeleted && !item.isPermanentlyDeleted);
    const recycle = accounts.filter((item) => item.isDeleted && !item.isPermanentlyDeleted);
    const passkeys = active.filter((item) => (item.passkeyCredentialIds || []).length > 0);
    const totp = active.filter((item) => hasTotpSecret(item.totpSecret));
    dom.allAccountsCount.textContent = `(${active.length})`;
    dom.passkeyAccountsCount.textContent = `(${passkeys.length})`;
    dom.totpAccountsCount.textContent = `(${totp.length})`;
    dom.recycleAccountsCount.textContent = `(${recycle.length})`;
    const folderCountMap = /* @__PURE__ */ new Map();
    for (const account of active) {
      for (const id of extractAccountFolderIds(account)) {
        const key = normalizeFolderId(id);
        if (!key) continue;
        const prev = folderCountMap.get(key) || 0;
        folderCountMap.set(key, prev + 1);
      }
    }
    const folderById = new Map(foldersRaw.map((folder) => [normalizeFolderId(folder.id), folder]));
    if (!folderById.has(FIXED_NEW_ACCOUNT_FOLDER_ID)) {
      folderById.set(FIXED_NEW_ACCOUNT_FOLDER_ID, normalizeFolderShape({
        id: FIXED_NEW_ACCOUNT_FOLDER_ID,
        name: FIXED_NEW_ACCOUNT_FOLDER_NAME,
        createdAtMs: 0
      }));
    }
    const knownFolders = sortFoldersForDisplay(Array.from(folderById.values()));
    const unknownFolderEntries = Array.from(folderCountMap.entries()).filter(([id]) => !folderById.has(id)).map(([id, count]) => ({
      id,
      name: `\u672A\u547D\u540D\u6587\u4EF6\u5939 ${id.slice(0, 8)}`,
      createdAtMs: 0,
      count
    })).sort((a, b) => a.id.localeCompare(b.id));
    const folderEntries = [
      ...knownFolders.map((folder) => ({
        id: normalizeFolderId(folder.id),
        name: String(folder.name || FIXED_NEW_ACCOUNT_FOLDER_NAME),
        createdAtMs: Number(folder.createdAtMs || 0),
        count: folderCountMap.get(normalizeFolderId(folder.id)) || 0
      })),
      ...unknownFolderEntries
    ];
    dom.accountsFolderList.innerHTML = "";
    for (const folder of folderEntries) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "account-view-tab";
      button.dataset.view = `folder:${folder.id}`;
      button.dataset.folderId = folder.id;
      button.textContent = `${folder.name} (${folder.count})`;
      button.addEventListener("click", () => setAccountView(`folder:${folder.id}`));
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openFolderContextMenu({
          folderId: folder.id,
          x: event.clientX,
          y: event.clientY
        });
      });
      dom.accountsFolderList.appendChild(button);
    }
  }
  function currentViewAccounts(inputAccounts) {
    const accounts = (Array.isArray(inputAccounts) ? inputAccounts : []).map(normalizeAccountShape);
    const active = accounts.filter((item) => !item.isDeleted && !item.isPermanentlyDeleted);
    const recycle = accounts.filter((item) => item.isDeleted && !item.isPermanentlyDeleted);
    if (activeAccountView === "recycle") {
      return recycle;
    }
    if (activeAccountView === "passkeys") {
      return active.filter((item) => (item.passkeyCredentialIds || []).length > 0);
    }
    if (activeAccountView === "totp") {
      return active.filter((item) => hasTotpSecret(item.totpSecret));
    }
    if (String(activeAccountView).startsWith("folder:")) {
      const folderId = normalizeFolderId(String(activeAccountView).slice("folder:".length));
      return active.filter((item) => {
        const ids = extractAccountFolderIds(item).map(normalizeFolderId);
        return ids.includes(folderId);
      });
    }
    return active;
  }
  function currentVisibleAccounts(inputAccounts) {
    let accounts = currentViewAccounts(inputAccounts);
    const query = String(dom.allAccountsSearch.value || "").trim().toLowerCase();
    if (query) {
      accounts = accounts.filter((account) => isAccountMatchSearch(account, query));
    }
    return accounts;
  }
  function isSortModalSupportedView() {
    return activeAccountView !== "recycle";
  }
  function getSortableAccountsForCurrentView() {
    if (!isSortModalSupportedView()) return [];
    const visible = currentVisibleAccounts(accountsRaw).filter((account) => !account.isDeleted);
    return sortAccountsForScope(visible);
  }
  function openSortModal() {
    if (!isSortModalSupportedView()) {
      setStatus("\u56DE\u6536\u7AD9\u4E0D\u652F\u6301\u6392\u5E8F");
      return;
    }
    const visibleAccounts = getSortableAccountsForCurrentView();
    if (visibleAccounts.length === 0) {
      setStatus("\u5F53\u524D\u5217\u8868\u6CA1\u6709\u53EF\u6392\u5E8F\u8D26\u53F7");
      return;
    }
    sortModalOrderIds = visibleAccounts.map((account) => String(account.accountId || ""));
    sortModalDraggingAccountId = "";
    renderSortModalList();
    dom.sortModal.classList.remove("hidden");
    dom.sortModal.setAttribute("aria-hidden", "false");
  }
  function closeSortModal() {
    sortModalDraggingAccountId = "";
    sortModalOrderIds = [];
    dom.sortModal.classList.add("hidden");
    dom.sortModal.setAttribute("aria-hidden", "true");
    dom.sortModalList.innerHTML = "";
  }
  async function openHistoryModal() {
    await loadHistory();
    renderHistoryModalList();
    dom.historyModal.classList.remove("hidden");
    dom.historyModal.setAttribute("aria-hidden", "false");
  }
  function closeHistoryModal() {
    dom.historyModal.classList.add("hidden");
    dom.historyModal.setAttribute("aria-hidden", "true");
    dom.historyModalList.innerHTML = "";
  }
  function renderHistoryModalList() {
    dom.historyModalList.innerHTML = "";
    if (historyEntries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "\u6682\u65E0\u5386\u53F2\u8BB0\u5F55";
      dom.historyModalList.appendChild(empty);
      return;
    }
    for (const entry of historyEntries) {
      const item = document.createElement("div");
      item.className = "history-modal-item";
      const time = document.createElement("div");
      time.className = "history-modal-item-time";
      time.textContent = formatTime(entry.timestampMs);
      item.appendChild(time);
      const action = document.createElement("div");
      action.className = "history-modal-item-action";
      action.textContent = entry.action;
      item.appendChild(action);
      dom.historyModalList.appendChild(item);
    }
  }
  function renderSortModalList() {
    dom.sortModalList.innerHTML = "";
    const accountById = new Map(
      accountsRaw.map(normalizeAccountShape).filter((account) => !account.isDeleted).map((account) => [String(account.accountId || ""), account])
    );
    const normalizedOrder = sortModalOrderIds.map((accountId) => String(accountId || "")).filter((accountId) => accountById.has(accountId));
    sortModalOrderIds = normalizedOrder;
    if (normalizedOrder.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "\u5F53\u524D\u5217\u8868\u6CA1\u6709\u53EF\u6392\u5E8F\u8D26\u53F7";
      dom.sortModalList.appendChild(empty);
      return;
    }
    for (const accountId of normalizedOrder) {
      const account = accountById.get(accountId);
      if (!account) continue;
      const item = document.createElement("div");
      item.className = "sort-modal-item";
      item.draggable = true;
      item.dataset.accountId = accountId;
      const row = document.createElement("div");
      row.className = "sort-modal-item-row";
      const label = document.createElement("span");
      label.className = "sort-modal-item-label";
      label.textContent = formatSortableAccountLabel(account);
      row.appendChild(label);
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "pin-btn sort-modal-pin-btn";
      const pinned = isPinnedAccount(account);
      pinBtn.textContent = pinned ? "\u53D6\u6D88\u7F6E\u9876" : "\u7F6E\u9876";
      pinBtn.classList.toggle("is-unpin", pinned);
      pinBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void togglePin(accountId, { fromSortModal: true });
      });
      row.appendChild(pinBtn);
      item.appendChild(row);
      item.addEventListener("dragstart", (event) => {
        sortModalDraggingAccountId = accountId;
        if (event.dataTransfer) {
          event.dataTransfer.setData("text/plain", accountId);
          event.dataTransfer.effectAllowed = "move";
        }
      });
      item.addEventListener("dragover", (event) => {
        if (!sortModalDraggingAccountId || sortModalDraggingAccountId === accountId) return;
        if (!isSamePinnedGroupForSort(accountById, sortModalDraggingAccountId, accountId)) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        item.classList.add("sort-modal-item-target");
      });
      item.addEventListener("dragleave", () => {
        item.classList.remove("sort-modal-item-target");
      });
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        item.classList.remove("sort-modal-item-target");
        const sourceId = sortModalDraggingAccountId;
        sortModalDraggingAccountId = "";
        if (!sourceId || sourceId === accountId) return;
        if (!isSamePinnedGroupForSort(accountById, sourceId, accountId)) {
          setStatus("\u4EC5\u652F\u6301\u7F6E\u9876\u9879\u4E4B\u95F4\u3001\u975E\u7F6E\u9876\u9879\u4E4B\u95F4\u6392\u5E8F");
          return;
        }
        const from = sortModalOrderIds.indexOf(sourceId);
        const to = sortModalOrderIds.indexOf(accountId);
        if (from < 0 || to < 0) return;
        sortModalOrderIds.splice(from, 1);
        sortModalOrderIds.splice(to, 0, sourceId);
        renderSortModalList();
        void persistSortOrderFromModal(sortModalOrderIds);
      });
      item.addEventListener("dragend", () => {
        sortModalDraggingAccountId = "";
        const highlighted = dom.sortModalList.querySelectorAll(".sort-modal-item-target");
        highlighted.forEach((node) => node.classList.remove("sort-modal-item-target"));
      });
      dom.sortModalList.appendChild(item);
    }
  }
  function isSamePinnedGroupForSort(accountById, sourceId, targetId) {
    const source = accountById.get(String(sourceId || ""));
    const target = accountById.get(String(targetId || ""));
    if (!source || !target) return false;
    return isPinnedInCurrentScope(source) === isPinnedInCurrentScope(target);
  }
  function formatSortableAccountLabel(account) {
    const site = etldPlusOne(account?.canonicalSite || account?.sites?.[0] || "") || "-";
    const createdText = formatYYMMDDHHmmss(Number(account?.createdAtMs || 0));
    const username = String(account?.username || "");
    return `${site}-${createdText}-${username}`;
  }
  async function persistSortOrderFromModal(orderedIds) {
    const normalizedOrderedIds = [...new Set((Array.isArray(orderedIds) ? orderedIds : []).map((value) => String(value || "")).filter(Boolean))];
    if (normalizedOrderedIds.length === 0) return;
    const next = cloneAccounts(accountsRaw).map(normalizeAccountShape);
    const scopeKey = getActivePinScopeKey();
    const now = Date.now();
    const deviceName = await getDeviceName();
    let changed = false;
    const pinnedSubset = [];
    const regularSubset = [];
    for (const accountId of normalizedOrderedIds) {
      const target = next.find((item) => String(item.accountId || "") === accountId);
      if (!target || target.isDeleted) continue;
      if (getPinnedViewState(target, scopeKey).pinned) {
        pinnedSubset.push(accountId);
      } else {
        regularSubset.push(accountId);
      }
    }
    const visibleIds = new Set(
      currentVisibleAccounts(next).filter((item) => !item.isDeleted).map((item) => String(item.accountId || ""))
    );
    const allPinnedIds = sortAccountsForScope(
      next.filter((item) => !item.isDeleted && visibleIds.has(String(item.accountId || "")) && getPinnedViewState(item, scopeKey).pinned),
      scopeKey
    ).map((item) => String(item.accountId || ""));
    const allRegularIds = sortAccountsForScope(
      next.filter((item) => !item.isDeleted && visibleIds.has(String(item.accountId || "")) && !getPinnedViewState(item, scopeKey).pinned),
      scopeKey
    ).map((item) => String(item.accountId || ""));
    const mergedPinnedIds = buildMergedOrderIds(allPinnedIds, pinnedSubset);
    const mergedRegularIds = buildMergedOrderIds(allRegularIds, regularSubset);
    for (let i = 0; i < mergedPinnedIds.length; i += 1) {
      const id = mergedPinnedIds[i];
      const item = next.find((entry) => String(entry.accountId || "") === id);
      if (!item) continue;
      item.pinnedViews = normalizePinnedViewsMap(item.pinnedViews, item);
      const currentState = getPinnedViewState(item, scopeKey);
      const currentOrder = currentState.pinnedSortOrder == null ? null : Number(currentState.pinnedSortOrder);
      if (currentOrder === i) continue;
      item.pinnedViews[scopeKey] = {
        ...currentState,
        pinned: true,
        pinnedSortOrder: i
      };
      item.updatedAtMs = now;
      item.lastOperatedDeviceName = deviceName;
      changed = true;
    }
    for (let i = 0; i < mergedRegularIds.length; i += 1) {
      const id = mergedRegularIds[i];
      const item = next.find((entry) => String(entry.accountId || "") === id);
      if (!item) continue;
      item.pinnedViews = normalizePinnedViewsMap(item.pinnedViews, item);
      const currentState = getPinnedViewState(item, scopeKey);
      const currentOrder = currentState.regularSortOrder == null ? null : Number(currentState.regularSortOrder);
      if (currentOrder === i) continue;
      item.pinnedViews[scopeKey] = {
        ...currentState,
        regularSortOrder: i
      };
      item.updatedAtMs = now;
      item.lastOperatedDeviceName = deviceName;
      changed = true;
    }
    if (!changed) return;
    accountsRaw = cloneAccounts(next);
    await setAccounts(next);
    renderSidebar(accountsRaw);
    renderCurrentView(accountsRaw);
  }
  function buildMergedOrderIds(allIds, subsetIds) {
    const fullOrder = (Array.isArray(allIds) ? allIds : []).map((value) => String(value || "")).filter(Boolean);
    const fullSet = new Set(fullOrder);
    const requestedSubset = (Array.isArray(subsetIds) ? subsetIds : []).map((value) => String(value || "")).filter((value, index, values) => Boolean(value) && values.indexOf(value) === index).filter((value) => fullSet.has(value));
    if (requestedSubset.length === 0) {
      return fullOrder;
    }
    const subsetSet = new Set(requestedSubset);
    const merged = [];
    let cursor = 0;
    for (const id of fullOrder) {
      if (subsetSet.has(id)) {
        merged.push(requestedSubset[cursor]);
        cursor += 1;
      } else {
        merged.push(id);
      }
    }
    return merged;
  }
  function renderCurrentView(inputAccounts) {
    let accounts = sortAccountsForScope(currentVisibleAccounts(inputAccounts));
    dom.allAccountsList.innerHTML = "";
    if (accounts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "\u6682\u65E0\u8D26\u53F7";
      dom.allAccountsList.appendChild(empty);
      return;
    }
    const isRecycle = activeAccountView === "recycle";
    for (const account of accounts) {
      const card = document.createElement("article");
      card.className = "account";
      if (!isRecycle && isPinnedInCurrentScope(account)) {
        card.classList.add("account-pinned");
      }
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openAccountContextMenu({
          account,
          x: event.clientX,
          y: event.clientY
        });
      });
      const titleRow = document.createElement("div");
      titleRow.className = "account-title-row";
      const title = document.createElement("strong");
      title.textContent = account.accountId;
      titleRow.appendChild(title);
      card.appendChild(titleRow);
      const meta = document.createElement("div");
      meta.className = "meta";
      const sitesMultilineHtml = toMultilineHtml(account.sites.join("\n"));
      meta.innerHTML = `\u7528\u6237\u540D: ${escapeHtml(account.username || "-")}<br/>\u7AD9\u70B9\u522B\u540D:<div class="meta-multiline">${sitesMultilineHtml}</div>\u901A\u884C\u5BC6\u94A5: ${account.passkeyCredentialIds.length} \u4E2A<br/>`;
      card.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "account-actions";
      const totpCopyBtn = hasTotpSecret(account.totpSecret) ? createTotpCopyButton({
        accountId: account.accountId,
        username: account.username,
        totpSecret: account.totpSecret
      }) : null;
      if (!isRecycle) {
        const editBtn = document.createElement("button");
        editBtn.textContent = editingAccountId === account.accountId ? "\u6536\u8D77\u7F16\u8F91" : "\u7F16\u8F91";
        editBtn.addEventListener("click", () => {
          editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
          renderCurrentView(accountsRaw);
        });
        actions.appendChild(editBtn);
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "button-danger";
        deleteBtn.textContent = "\u5220\u9664";
        deleteBtn.addEventListener("click", async () => {
          await deleteAccountFromAll(account.accountId);
        });
        actions.appendChild(deleteBtn);
        if (totpCopyBtn) actions.appendChild(totpCopyBtn);
        card.appendChild(actions);
        if (editingAccountId === account.accountId) {
          card.appendChild(buildAccountEditor(account));
        }
      } else {
        const restoreBtn = document.createElement("button");
        restoreBtn.textContent = "\u6062\u590D";
        restoreBtn.addEventListener("click", async () => {
          await restoreDeletedAccount(account.accountId);
        });
        actions.appendChild(restoreBtn);
        const permanentDeleteBtn = document.createElement("button");
        permanentDeleteBtn.className = "button-danger";
        permanentDeleteBtn.textContent = "\u6C38\u4E45\u5220\u9664";
        permanentDeleteBtn.addEventListener("click", async () => {
          await permanentlyDeleteAccount(account.accountId);
        });
        actions.appendChild(permanentDeleteBtn);
        if (totpCopyBtn) actions.appendChild(totpCopyBtn);
        card.appendChild(actions);
      }
      dom.allAccountsList.appendChild(card);
    }
    void refreshVisibleTotpButtons();
  }
  function setAccountView(nextView) {
    closeContextMenu();
    activeAccountView = String(nextView || "all");
    const isRecycle = activeAccountView === "recycle";
    dom.accountsTabAll.classList.toggle("is-active", activeAccountView === "all");
    dom.accountsTabPasskey.classList.toggle("is-active", activeAccountView === "passkeys");
    dom.accountsTabTotp.classList.toggle("is-active", activeAccountView === "totp");
    dom.accountsTabRecycle.classList.toggle("is-active", isRecycle);
    const folderButtons = dom.accountsFolderList.querySelectorAll(".account-view-tab[data-view]");
    folderButtons.forEach((button) => {
      const matched = button.getAttribute("data-view") === activeAccountView;
      button.classList.toggle("is-active", matched);
    });
    dom.clearActiveAccountsBtn.classList.toggle("hidden", isRecycle);
    dom.clearRecycleBinBtn.classList.toggle("hidden", !isRecycle);
    dom.openSortModalBtn.classList.toggle("hidden", isRecycle);
    if (isRecycle) {
      closeAllAccountsSearchFieldsPanel();
      closeSortModal();
    }
    renderCurrentView(accountsRaw);
  }
  function closeContextMenuIfNeeded(event) {
    if (!contextMenuElement) return;
    if (contextMenuElement.contains(event.target)) return;
    closeContextMenu();
  }
  function closeContextMenu() {
    if (contextMenuElement) {
      contextMenuElement.remove();
      contextMenuElement = null;
    }
    if (contextMenuOutsideHandler) {
      window.removeEventListener("mousedown", contextMenuOutsideHandler, true);
      contextMenuOutsideHandler = null;
    }
    if (contextMenuEscapeHandler) {
      window.removeEventListener("keydown", contextMenuEscapeHandler, true);
      contextMenuEscapeHandler = null;
    }
  }
  function openContextMenu({ x, y, items }) {
    closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "context-menu";
    for (const item of items) {
      if (item.type === "separator") {
        const separator = document.createElement("div");
        separator.className = "context-menu-separator";
        menu.appendChild(separator);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-menu-item";
      if (item.danger) {
        button.classList.add("context-danger");
      }
      button.textContent = item.label;
      button.disabled = Boolean(item.disabled);
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (button.disabled) return;
        closeContextMenu();
        await item.onSelect?.();
      });
      menu.appendChild(button);
    }
    document.body.appendChild(menu);
    contextMenuElement = menu;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(8, viewportWidth - rect.width - 8);
    const maxTop = Math.max(8, viewportHeight - rect.height - 8);
    menu.style.left = `${Math.min(Math.max(8, x), maxLeft)}px`;
    menu.style.top = `${Math.min(Math.max(8, y), maxTop)}px`;
    contextMenuOutsideHandler = (event) => {
      if (!menu.contains(event.target)) {
        closeContextMenu();
      }
    };
    contextMenuEscapeHandler = (event) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };
    window.addEventListener("mousedown", contextMenuOutsideHandler, true);
    window.addEventListener("keydown", contextMenuEscapeHandler, true);
  }
  function openAccountContextMenu({ account, x, y }) {
    if (!account) return;
    if (account.isDeleted) {
      openContextMenu({
        x,
        y,
        items: [
          {
            label: "\u6062\u590D\u8D26\u53F7",
            onSelect: async () => restoreDeletedAccount(account.accountId)
          },
          {
            label: "\u6C38\u4E45\u5220\u9664",
            danger: true,
            onSelect: async () => permanentlyDeleteAccount(account.accountId)
          }
        ]
      });
      return;
    }
    openContextMenu({
      x,
      y,
      items: [
        {
          label: isPinnedInCurrentScope(account) ? "\u53D6\u6D88\u7F6E\u9876" : "\u7F6E\u9876",
          onSelect: async () => togglePin(account.accountId)
        },
        { type: "separator" },
        {
          label: "\u7F16\u8F91",
          onSelect: async () => {
            editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
            renderCurrentView(accountsRaw);
          }
        },
        { type: "separator" },
        {
          label: "\u653E\u5165\u6587\u4EF6\u5939",
          disabled: foldersRaw.length === 0,
          onSelect: async () => openAccountFolderContextMenu(account, { x: x + 16, y: y + 12 })
        },
        { type: "separator" },
        {
          label: "\u5220\u9664",
          danger: true,
          onSelect: async () => deleteAccountFromAll(account.accountId)
        }
      ]
    });
  }
  function openFolderContextMenu({ folderId, x, y }) {
    const normalizedFolderId = normalizeFolderId(folderId);
    const folder = foldersRaw.find((item) => normalizeFolderId(item?.id) === normalizedFolderId);
    if (!folder) return;
    if (normalizedFolderId === FIXED_NEW_ACCOUNT_FOLDER_ID) {
      openContextMenu({
        x,
        y,
        items: [
          {
            label: "\u6307\u5B9A\u7F51\u7AD9\u5168\u90E8\u8D26\u53F7",
            onSelect: async () => openAddSitesToFolderModal(normalizedFolderId)
          },
          { type: "separator" },
          {
            label: "\u56FA\u5B9A\u6587\u4EF6\u5939\u4E0D\u53EF\u5220\u9664",
            disabled: true,
            onSelect: async () => {
            }
          }
        ]
      });
      return;
    }
    openContextMenu({
      x,
      y,
      items: [
        {
          label: "\u6307\u5B9A\u7F51\u7AD9\u5168\u90E8\u8D26\u53F7",
          onSelect: async () => openAddSitesToFolderModal(normalizedFolderId)
        },
        { type: "separator" },
        {
          label: "\u5220\u9664\u6587\u4EF6\u5939",
          danger: true,
          onSelect: async () => deleteFolder(normalizedFolderId)
        }
      ]
    });
  }
  function openAddSitesToFolderModal(folderId) {
    addSitesTargetFolderId = normalizeFolderId(folderId);
    const folder = foldersRaw.find((item) => normalizeFolderId(item?.id) === addSitesTargetFolderId);
    dom.addSitesToFolderInput.value = Array.isArray(folder?.matchedSites) ? folder.matchedSites.join("\n") : "";
    dom.addSitesToFolderAutoAdd.checked = Boolean(folder?.autoAddMatchingSites);
    dom.addSitesToFolderModal.classList.remove("hidden");
    dom.addSitesToFolderModal.setAttribute("aria-hidden", "false");
    setTimeout(() => {
      dom.addSitesToFolderInput.focus();
    }, 0);
  }
  function closeAddSitesToFolderModal() {
    addSitesTargetFolderId = null;
    dom.addSitesToFolderInput.value = "";
    dom.addSitesToFolderAutoAdd.checked = true;
    dom.addSitesToFolderModal.classList.add("hidden");
    dom.addSitesToFolderModal.setAttribute("aria-hidden", "true");
  }
  async function addAccountsMatchingSitesToFolderFromModal() {
    const folderId = normalizeFolderId(addSitesTargetFolderId);
    if (!folderId) {
      closeAddSitesToFolderModal();
      setStatus("\u76EE\u6807\u6587\u4EF6\u5939\u4E0D\u5B58\u5728");
      return;
    }
    const sites = parseSites(dom.addSitesToFolderInput.value || "");
    const autoAddMatchingSites = Boolean(dom.addSitesToFolderAutoAdd.checked);
    const storedData = await readBusinessDataFromStore();
    const storedFolders = Array.isArray(storedData.folders) ? storedData.folders : [];
    const targetIds = accountsRaw.map(normalizeAccountShape).filter((account) => !account.isDeleted).filter((account) => {
      const accountSites = normalizeSites([...account.sites || [], account.canonicalSite || ""]);
      return sites.some((site) => accountSites.some((accountSite) => domainsMatch(site, accountSite)));
    }).map((account) => account.accountId);
    const next = cloneAccounts(accountsRaw).map(normalizeAccountShape);
    const nextFolders = storedFolders.map((item) => {
      const folder = normalizeFolderShape(item);
      if (normalizeFolderId(folder.id) !== folderId) return folder;
      return {
        ...folder,
        matchedSites: sites,
        autoAddMatchingSites,
        updatedAtMs: Date.now()
      };
    });
    const now = Date.now();
    const deviceName = await getDeviceName();
    let changedCount = 0;
    for (const accountId of targetIds) {
      const target = next.find((item) => String(item.accountId || "") === String(accountId));
      if (!target || target.isDeleted) continue;
      const currentFolderIds = normalizeFolderIdList(extractAccountFolderIds(target));
      if (currentFolderIds.includes(folderId)) continue;
      const nextFolderIds = normalizeFolderIdList([...currentFolderIds, folderId]);
      target.folderId = nextFolderIds[0] || null;
      target.folderIds = nextFolderIds;
      target.updatedAtMs = now;
      target.lastOperatedDeviceName = deviceName;
      changedCount += 1;
    }
    closeAddSitesToFolderModal();
    accountsRaw = cloneAccounts(next);
    foldersRaw = sortFoldersForDisplay(withFixedFolder(nextFolders));
    await writeBusinessDataToStore({ accounts: next, passkeys: passkeysRaw, folders: nextFolders });
    await appendHistory(
      `\u66F4\u65B0\u6587\u4EF6\u5939\u7AD9\u70B9\u89C4\u5219\uFF1A${folderDisplayNameById(folderId)}\uFF08${sites.length} \u4E2A\u7AD9\u70B9\uFF0C\u81EA\u52A8\u52A0\u5165${autoAddMatchingSites ? "\u5F00" : "\u5173"}\uFF09`,
      now
    );
    if (changedCount > 0) {
      await appendHistory(`\u6309\u7AD9\u70B9\u6279\u91CF\u52A0\u5165\u6587\u4EF6\u5939\uFF1A${folderDisplayNameById(folderId)}\uFF08${changedCount} \u4E2A\u8D26\u53F7\uFF09`, now);
    }
    await refresh({ silent: true });
    setStatus(
      changedCount > 0 ? `\u5DF2\u4FDD\u5B58\u89C4\u5219\uFF0C\u5E76\u5C06 ${changedCount} \u4E2A\u8D26\u53F7\u52A0\u5165\u6587\u4EF6\u5939: ${folderDisplayNameById(folderId)}` : `\u5DF2\u4FDD\u5B58\u6587\u4EF6\u5939\u7AD9\u70B9\u89C4\u5219: ${folderDisplayNameById(folderId)}`
    );
  }
  function openAccountFolderContextMenu(account, position) {
    const normalizedAccount = normalizeAccountShape(account);
    const checked = new Set(
      normalizeFolderIdList(extractAccountFolderIds(normalizedAccount))
    );
    const folders = sortFoldersForDisplay(foldersRaw.map(normalizeFolderShape));
    if (folders.length === 0) {
      setStatus("\u8BF7\u5148\u521B\u5EFA\u6587\u4EF6\u5939");
      return;
    }
    openContextMenu({
      x: position?.x ?? 100,
      y: position?.y ?? 100,
      items: folders.map((folder) => {
        const id = normalizeFolderId(folder.id);
        const isChecked = checked.has(id);
        return {
          label: `${isChecked ? "\u2611" : "\u2610"} ${folder.name}`,
          onSelect: async () => {
            await toggleAccountFolderMembership(normalizedAccount.accountId, id);
          }
        };
      })
    });
  }
  function applyAutoFolderRulesToAccount(account, folders = foldersRaw) {
    if (!account || account.isDeleted) return account;
    const accountSites = normalizeSites([
      ...Array.isArray(account?.sites) ? account.sites : [],
      account?.canonicalSite || ""
    ]);
    if (accountSites.length === 0) return account;
    const matchedFolderIds = (Array.isArray(folders) ? folders : []).map(normalizeFolderShape).filter((folder) => folder.autoAddMatchingSites).filter((folder) => folder.matchedSites.some(
      (folderSite) => accountSites.some((accountSite) => domainsMatch(accountSite, folderSite))
    )).map((folder) => normalizeFolderId(folder.id)).filter(Boolean);
    if (matchedFolderIds.length === 0) return account;
    const nextFolderIds = normalizeFolderIdList([
      ...extractAccountFolderIds(account),
      ...matchedFolderIds
    ]);
    return {
      ...account,
      folderId: nextFolderIds[0] || null,
      folderIds: nextFolderIds
    };
  }
  function getActivePinScopeKey() {
    return String(activeAccountView || "all");
  }
  function getPinScopeLabel(scopeKey = getActivePinScopeKey()) {
    if (scopeKey === "all") return "\u5168\u90E8";
    if (scopeKey === "passkeys") return "\u901A\u884C\u5BC6\u94A5";
    if (scopeKey === "totp") return "\u9A8C\u8BC1\u7801";
    if (scopeKey === "recycle") return "\u56DE\u6536\u7AD9";
    if (String(scopeKey).startsWith("folder:")) {
      const folderId = normalizeFolderId(String(scopeKey).slice("folder:".length));
      return folderDisplayNameById(folderId);
    }
    return String(scopeKey);
  }
  function normalizePinnedViewsMap(input, legacyAccount = null) {
    const result = {};
    const source = input && typeof input === "object" ? input : {};
    for (const [scopeKey, rawValue] of Object.entries(source)) {
      const normalizedScopeKey = String(scopeKey || "").trim();
      if (!normalizedScopeKey || !rawValue || typeof rawValue !== "object") continue;
      const pinned = Boolean(rawValue.pinned);
      const pinnedSortOrder = rawValue.pinnedSortOrder == null ? null : Number(rawValue.pinnedSortOrder);
      const regularSortOrder = rawValue.regularSortOrder == null ? null : Number(rawValue.regularSortOrder);
      result[normalizedScopeKey] = {
        pinned,
        pinnedSortOrder: Number.isFinite(pinnedSortOrder) ? pinnedSortOrder : null,
        regularSortOrder: Number.isFinite(regularSortOrder) ? regularSortOrder : null
      };
    }
    if (legacyAccount && !result.all) {
      result.all = {
        pinned: Boolean(legacyAccount?.isPinned),
        pinnedSortOrder: legacyAccount?.pinnedSortOrder == null ? null : Number(legacyAccount.pinnedSortOrder),
        regularSortOrder: legacyAccount?.regularSortOrder == null ? null : Number(legacyAccount.regularSortOrder)
      };
    }
    return result;
  }
  function getPinnedViewState(account, scopeKey = getActivePinScopeKey()) {
    const pinnedViews = normalizePinnedViewsMap(account?.pinnedViews, account);
    return pinnedViews[scopeKey] || {
      pinned: false,
      pinnedSortOrder: null,
      regularSortOrder: null
    };
  }
  function isPinnedInCurrentScope(account) {
    return Boolean(getPinnedViewState(account).pinned);
  }
  function isPinnedAccount(account) {
    return isPinnedInCurrentScope(account);
  }
  function compareAccountsForScope(lhs, rhs, scopeKey = getActivePinScopeKey()) {
    const lhsState = getPinnedViewState(lhs, scopeKey);
    const rhsState = getPinnedViewState(rhs, scopeKey);
    if (lhsState.pinned !== rhsState.pinned) {
      return lhsState.pinned ? -1 : 1;
    }
    const lhsUpdatedAt = Number(lhs?.updatedAtMs || 0);
    const rhsUpdatedAt = Number(rhs?.updatedAtMs || 0);
    if (lhsUpdatedAt !== rhsUpdatedAt) return rhsUpdatedAt - lhsUpdatedAt;
    if (lhsState.pinned && rhsState.pinned) {
      if (lhsState.pinnedSortOrder != null && rhsState.pinnedSortOrder != null && lhsState.pinnedSortOrder !== rhsState.pinnedSortOrder) {
        return lhsState.pinnedSortOrder - rhsState.pinnedSortOrder;
      }
      if (lhsState.pinnedSortOrder != null && rhsState.pinnedSortOrder == null) return -1;
      if (lhsState.pinnedSortOrder == null && rhsState.pinnedSortOrder != null) return 1;
    } else {
      if (lhsState.regularSortOrder != null && rhsState.regularSortOrder != null && lhsState.regularSortOrder !== rhsState.regularSortOrder) {
        return lhsState.regularSortOrder - rhsState.regularSortOrder;
      }
      if (lhsState.regularSortOrder != null && rhsState.regularSortOrder == null) return -1;
      if (lhsState.regularSortOrder == null && rhsState.regularSortOrder != null) return 1;
    }
    const lhsCreatedAt = Number(lhs?.createdAtMs || 0);
    const rhsCreatedAt = Number(rhs?.createdAtMs || 0);
    if (lhsCreatedAt !== rhsCreatedAt) return rhsCreatedAt - lhsCreatedAt;
    return String(lhs?.accountId || "").localeCompare(String(rhs?.accountId || ""));
  }
  function sortAccountsForScope(inputAccounts, scopeKey = getActivePinScopeKey()) {
    return [...Array.isArray(inputAccounts) ? inputAccounts : []].sort(
      (lhs, rhs) => compareAccountsForScope(lhs, rhs, scopeKey)
    );
  }
  function isAccountMatchSearch(account, query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return true;
    const haystacks = [];
    const useAll = accountSearchUseAll;
    if (useAll || accountSearchFields.has("username")) {
      haystacks.push(account.username, account.usernameAtCreate);
    }
    if (useAll || accountSearchFields.has("sites")) {
      haystacks.push(account.sites.join(" "), account.canonicalSite);
    }
    if (useAll || accountSearchFields.has("note")) {
      haystacks.push(account.note);
    }
    if (useAll || accountSearchFields.has("password")) {
      haystacks.push(account.password);
    }
    if (haystacks.length === 0) return false;
    return haystacks.some((value) => String(value || "").toLowerCase().includes(needle));
  }
  function closeAllAccountsSearchFieldsPanel() {
    dom.allAccountsSearchFieldsPanel.classList.add("hidden");
  }
  function isMultilineInputTarget(target) {
    return target instanceof HTMLTextAreaElement || target?.isContentEditable;
  }
  function findDefaultActionButtonForOptions(target) {
    if (!dom.addSitesToFolderModal.classList.contains("hidden")) {
      return dom.confirmAddSitesToFolderBtn;
    }
    return null;
  }
  function onAllAccountSearchFieldAllChanged() {
    if (dom.allAccountsSearchFieldAll.checked) {
      accountSearchUseAll = true;
      accountSearchFields = /* @__PURE__ */ new Set();
    } else {
      accountSearchUseAll = false;
    }
    syncAllAccountSearchFieldCheckboxes();
    renderCurrentView(accountsRaw);
  }
  function onAllAccountSearchFieldChanged() {
    const next = /* @__PURE__ */ new Set();
    if (dom.allAccountsSearchFieldUsername.checked) next.add("username");
    if (dom.allAccountsSearchFieldSites.checked) next.add("sites");
    if (dom.allAccountsSearchFieldNote.checked) next.add("note");
    if (dom.allAccountsSearchFieldPassword.checked) next.add("password");
    accountSearchUseAll = false;
    accountSearchFields = next;
    syncAllAccountSearchFieldCheckboxes();
    renderCurrentView(accountsRaw);
  }
  function syncAllAccountSearchFieldCheckboxes() {
    dom.allAccountsSearchFieldUsername.checked = accountSearchFields.has("username");
    dom.allAccountsSearchFieldSites.checked = accountSearchFields.has("sites");
    dom.allAccountsSearchFieldNote.checked = accountSearchFields.has("note");
    dom.allAccountsSearchFieldPassword.checked = accountSearchFields.has("password");
    dom.allAccountsSearchFieldAll.checked = accountSearchUseAll;
  }
  function buildAccountEditor(account) {
    const editor = document.createElement("div");
    editor.className = "editor";
    const sitesInput = createEditorTextarea(editor, "\u7AD9\u70B9\u522B\u540D\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09", account.sites.join("\n"), {
      className: "editor-textarea editor-textarea-sites"
    });
    const usernameInput = createEditorField(editor, "\u7528\u6237\u540D", account.username);
    const passwordInput = createEditorField(editor, "\u5BC6\u7801", account.password);
    const totpInput = createEditorField(editor, "TOTP", account.totpSecret || "");
    appendTotpImportActions(editor, {
      totpInput,
      sitesInput,
      usernameInput
    });
    const recoveryInput = createEditorTextarea(editor, "\u6062\u590D\u7801\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09", account.recoveryCodes || "", {
      className: "editor-textarea editor-textarea-recovery"
    });
    const noteInput = createEditorTextarea(editor, "\u5907\u6CE8", account.note || "", {
      className: "editor-textarea"
    });
    const details = document.createElement("div");
    details.className = "meta";
    details.innerHTML = `\u521B\u5EFA: ${formatTime(account.createdAtMs)} | \u66F4\u65B0: ${formatTime(account.updatedAtMs)}<br/>\u6700\u540E\u64CD\u4F5C\u8BBE\u5907: ${escapeHtml(String(account.lastOperatedDeviceName || "").trim() || "-")}<br/>\u5220\u9664: ${formatTime(account.deletedAtMs)}<br/>\u7528\u6237\u540D\uFF1A${formatTime(account.usernameUpdatedAtMs)} | ${escapeHtml(String(account.usernameUpdatedDeviceName || "").trim() || "-")}<br/>\u5BC6\u7801\uFF1A${formatTime(account.passwordUpdatedAtMs)} | ${escapeHtml(String(account.passwordUpdatedDeviceName || "").trim() || "-")}<br/>TOTP\uFF1A${formatTime(account.totpUpdatedAtMs)} | ${escapeHtml(String(account.totpUpdatedDeviceName || "").trim() || "-")}<br/>\u6062\u590D\u7801\uFF1A${formatTime(account.recoveryCodesUpdatedAtMs)} | ${escapeHtml(String(account.recoveryCodesUpdatedDeviceName || "").trim() || "-")}<br/>\u5907\u6CE8\uFF1A${formatTime(account.noteUpdatedAtMs)} | ${escapeHtml(String(account.noteUpdatedDeviceName || "").trim() || "-")}<br/>\u901A\u884C\u5BC6\u94A5\uFF1A${formatTime(account.passkeyUpdatedAtMs)} | ${escapeHtml(String(account.passkeyUpdatedDeviceName || "").trim() || "-")}<br/>`;
    editor.appendChild(details);
    const actions = document.createElement("div");
    actions.className = "account-actions";
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "\u4FDD\u5B58\u7F16\u8F91";
    saveBtn.addEventListener("click", async () => {
      await saveAccountEdit(account.accountId, {
        sitesText: sitesInput.value,
        username: usernameInput.value,
        password: passwordInput.value,
        totpSecret: totpInput.value,
        recoveryCodes: recoveryInput.value,
        note: noteInput.value
      });
    });
    actions.appendChild(saveBtn);
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "\u53D6\u6D88";
    cancelBtn.addEventListener("click", () => {
      editingAccountId = null;
      renderCurrentView(accountsRaw);
    });
    actions.appendChild(cancelBtn);
    editor.appendChild(actions);
    return editor;
  }
  async function saveAccountEdit(accountId, draft) {
    const next = cloneAccounts(accountsRaw);
    const target = next.find((item) => String(item.accountId || "") === String(accountId));
    if (!target) {
      setStatus("\u672A\u627E\u5230\u7F16\u8F91\u8D26\u53F7");
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    let changed = false;
    const historyMessages = [];
    const nextSites = parseSites(draft.sitesText);
    const prevSites = normalizeSites(target.sites || []);
    if (nextSites.length > 0 && JSON.stringify(nextSites) !== JSON.stringify(prevSites)) {
      target.sites = nextSites;
      const nextSiteSet = new Set(nextSites.map((site) => String(site).toLowerCase()));
      const previousSiteSet = new Set(prevSites.map((site) => String(site).toLowerCase()));
      const states = { ...target.siteAliasStates || {} };
      for (const site of previousSiteSet) {
        if (!nextSiteSet.has(site)) states[site] = { isDeleted: true, updatedAtMs: now, deviceName };
      }
      for (const site of nextSiteSet) states[site] = { isDeleted: false, updatedAtMs: now, deviceName };
      target.siteAliasStates = states;
      changed = true;
      historyMessages.push(`\u7AD9\u70B9\u522B\u540D\u6539\u4E3A${historyValueSnippet(nextSites.join(", "))}`);
    }
    const nextUsername = normalizeUsername(draft.username);
    if (nextUsername && nextUsername !== String(target.username || "")) {
      target.username = nextUsername;
      target.usernameUpdatedAtMs = now;
      target.usernameUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push(`\u7528\u6237\u540D\u6539\u4E3A${historyValueSnippet(nextUsername)}`);
    }
    if (String(draft.password || "") !== String(target.password || "")) {
      target.password = String(draft.password || "");
      target.passwordUpdatedAtMs = now;
      target.passwordUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push("\u5BC6\u7801\u5DF2\u4FEE\u6539");
    }
    const nextTotpSecret = normalizeTotpSecret(String(draft.totpSecret || ""));
    if (nextTotpSecret && !isValidTotpSecret(nextTotpSecret)) {
      setStatus("TOTP \u5BC6\u94A5\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5\u540E\u518D\u4FDD\u5B58");
      return;
    }
    if (nextTotpSecret !== normalizeTotpSecret(String(target.totpSecret || ""))) {
      target.totpSecret = nextTotpSecret;
      target.totpUpdatedAtMs = now;
      target.totpUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push("TOTP \u5DF2\u4FEE\u6539");
    }
    if (String(draft.recoveryCodes || "") !== String(target.recoveryCodes || "")) {
      target.recoveryCodes = String(draft.recoveryCodes || "");
      target.recoveryCodesUpdatedAtMs = now;
      target.recoveryCodesUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push("\u6062\u590D\u7801\u5DF2\u4FEE\u6539");
    }
    if (String(draft.note || "") !== String(target.note || "")) {
      target.note = String(draft.note || "");
      target.noteUpdatedAtMs = now;
      target.noteUpdatedDeviceName = deviceName;
      changed = true;
      historyMessages.push("\u5907\u6CE8\u5DF2\u4FEE\u6539");
    }
    if (!changed) {
      setStatus("\u6CA1\u6709\u53EF\u4FDD\u5B58\u7684\u53D8\u66F4");
      return;
    }
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    const withAutoFolders = next.map(
      (item) => item === target ? applyAutoFolderRulesToAccount(item) : item
    );
    const synced = syncAliasGroups2(withAutoFolders);
    await setAccounts(synced);
    for (const message of historyMessages) {
      await appendHistory(`${target.accountId}\uFF1A${message}`, now);
    }
    editingAccountId = null;
    await refresh({ silent: true });
    setStatus("\u8D26\u53F7\u7F16\u8F91\u5DF2\u4FDD\u5B58");
  }
  async function deleteAccountFromAll(accountId) {
    const next = cloneAccounts(accountsRaw);
    const index = next.findIndex((item) => String(item.accountId || "") === String(accountId));
    if (index < 0) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u8D26\u53F7");
      return;
    }
    const target = next[index];
    if (target.isDeleted) {
      if (target.isPermanentlyDeleted) {
        setStatus("\u8BE5\u8D26\u53F7\u5DF2\u6C38\u4E45\u5220\u9664");
        return;
      }
      const now2 = Date.now();
      const deviceName2 = await getDeviceName();
      next[index] = {
        ...target,
        isDeleted: true,
        isPermanentlyDeleted: true,
        deletedAtMs: now2,
        deletedDeviceName: deviceName2,
        updatedAtMs: now2,
        lastOperatedDeviceName: deviceName2
      };
      if (editingAccountId === target.accountId) {
        editingAccountId = null;
      }
      await setAccounts(next);
      await appendHistory(`${target.accountId}\uFF1A\u6C38\u4E45\u5220\u9664`);
      await refresh({ silent: true });
      setStatus(`\u5DF2\u6C38\u4E45\u5220\u9664\u8D26\u53F7: ${target.accountId}`);
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    target.isDeleted = true;
    target.deletedAtMs = now;
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    if (editingAccountId === target.accountId) {
      editingAccountId = null;
    }
    await setAccounts(next);
    await appendHistory(`${target.accountId}\uFF1A\u79FB\u5165\u56DE\u6536\u7AD9`, now);
    await refresh({ silent: true });
    setStatus(`\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9: ${target.accountId}`);
  }
  async function restoreDeletedAccount(accountId) {
    const next = cloneAccounts(accountsRaw);
    const target = next.find((item) => String(item.accountId || "") === String(accountId));
    if (!target) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u8D26\u53F7");
      return;
    }
    if (!target.isDeleted) {
      setStatus("\u8BE5\u8D26\u53F7\u4E0D\u5728\u56DE\u6536\u7AD9");
      return;
    }
    if (target.isPermanentlyDeleted) {
      setStatus("\u8BE5\u8D26\u53F7\u5DF2\u6C38\u4E45\u5220\u9664\uFF0C\u4E0D\u80FD\u6062\u590D");
      return;
    }
    const confirmed = window.confirm(`\u5C06\u6062\u590D\u8D26\u53F7\uFF1A${target.accountId}
\u662F\u5426\u7EE7\u7EED\uFF1F`);
    if (!confirmed) return;
    const now = Date.now();
    const deviceName = await getDeviceName();
    target.isDeleted = false;
    target.deletedAtMs = null;
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    if (editingAccountId === target.accountId) {
      editingAccountId = null;
    }
    await setAccounts(next);
    await appendHistory(`${target.accountId}\uFF1A\u4ECE\u56DE\u6536\u7AD9\u6062\u590D`, now);
    await refresh({ silent: true });
    setStatus(`\u5DF2\u6062\u590D\u8D26\u53F7: ${target.accountId}`);
  }
  async function permanentlyDeleteAccount(accountId) {
    const next = cloneAccounts(accountsRaw);
    const index = next.findIndex((item) => String(item.accountId || "") === String(accountId));
    if (index < 0) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u8D26\u53F7");
      return;
    }
    const target = next[index];
    if (!target.isDeleted) {
      setStatus("\u4EC5\u652F\u6301\u5728\u56DE\u6536\u7AD9\u4E2D\u6C38\u4E45\u5220\u9664");
      return;
    }
    if (target.isPermanentlyDeleted) {
      setStatus("\u8BE5\u8D26\u53F7\u5DF2\u6C38\u4E45\u5220\u9664");
      return;
    }
    const now = Date.now();
    const deviceName = await getDeviceName();
    next[index] = {
      ...target,
      isDeleted: true,
      isPermanentlyDeleted: true,
      deletedAtMs: now,
      deletedDeviceName: deviceName,
      updatedAtMs: now,
      lastOperatedDeviceName: deviceName
    };
    if (editingAccountId === target.accountId) {
      editingAccountId = null;
    }
    await setAccounts(next);
    await appendHistory(`${target.accountId}\uFF1A\u6C38\u4E45\u5220\u9664`);
    await refresh({ silent: true });
    setStatus(`\u5DF2\u6C38\u4E45\u5220\u9664\u8D26\u53F7: ${target.accountId}`);
  }
  async function togglePin(accountId, { fromSortModal = false } = {}) {
    const next = cloneAccounts(accountsRaw);
    const target = next.find((item) => String(item.accountId || "") === String(accountId));
    if (!target) {
      setStatus("\u672A\u627E\u5230\u76EE\u6807\u8D26\u53F7");
      return;
    }
    if (target.isDeleted) {
      setStatus("\u56DE\u6536\u7AD9\u8D26\u53F7\u4E0D\u652F\u6301\u7F6E\u9876");
      return;
    }
    const scopeKey = getActivePinScopeKey();
    const scopeLabel = getPinScopeLabel(scopeKey);
    const now = Date.now();
    const deviceName = await getDeviceName();
    target.pinnedViews = normalizePinnedViewsMap(target.pinnedViews, target);
    const currentState = getPinnedViewState(target, scopeKey);
    const nextPinned = !currentState.pinned;
    if (nextPinned) {
      const maxOrder = next.filter((item) => !item.isDeleted && getPinnedViewState(item, scopeKey).pinned).reduce((maxValue, item) => Math.max(maxValue, Number(getPinnedViewState(item, scopeKey).pinnedSortOrder ?? -1)), -1);
      target.pinnedViews[scopeKey] = {
        ...currentState,
        pinned: true,
        pinnedSortOrder: maxOrder + 1
      };
    } else {
      target.pinnedViews[scopeKey] = {
        ...currentState,
        pinned: false,
        pinnedSortOrder: null,
        regularSortOrder: null
      };
    }
    target.updatedAtMs = now;
    target.lastOperatedDeviceName = deviceName;
    await setAccounts(next);
    await appendHistory(
      nextPinned ? `${target.accountId}\uFF1A\u5728${scopeLabel}\u7F6E\u9876` : `${target.accountId}\uFF1A\u53D6\u6D88${scopeLabel}\u7F6E\u9876`,
      now
    );
    await refresh({ silent: true });
    setStatus(
      nextPinned ? `\u8D26\u53F7\u5DF2\u5728${scopeLabel}\u7F6E\u9876: ${target.accountId}` : `\u5DF2\u53D6\u6D88${scopeLabel}\u7F6E\u9876: ${target.accountId}`
    );
    if (fromSortModal && !dom.sortModal.classList.contains("hidden")) {
      sortModalOrderIds = getSortableAccountsForCurrentView().map((account) => String(account.accountId || ""));
      renderSortModalList();
    }
  }
  function appendTotpImportActions(parent, { totpInput, sitesInput, usernameInput }) {
    const wrap = document.createElement("div");
    wrap.className = "editor-row editor-row-multiline totp-import-row";
    const label = document.createElement("span");
    label.textContent = "TOTP\u5BFC\u5165";
    wrap.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "totp-import-actions";
    wrap.appendChild(actions);
    const rawBtn = document.createElement("button");
    rawBtn.type = "button";
    rawBtn.textContent = "\u7C98\u8D34\u539F\u59CB\u5BC6\u94A5";
    rawBtn.addEventListener("click", () => {
      void pasteRawTotpSecretFromClipboard({
        totpInput
      });
    });
    actions.appendChild(rawBtn);
    const uriBtn = document.createElement("button");
    uriBtn.type = "button";
    uriBtn.textContent = "\u7C98\u8D34 otpauth URI";
    uriBtn.addEventListener("click", () => {
      void pasteOtpAuthUriFromClipboard({
        totpInput,
        sitesInput,
        usernameInput
      });
    });
    actions.appendChild(uriBtn);
    const qrBtn = document.createElement("button");
    qrBtn.type = "button";
    qrBtn.textContent = "\u8BC6\u522B\u526A\u8D34\u677F\u4E8C\u7EF4\u7801";
    qrBtn.addEventListener("click", () => {
      void pasteOtpAuthQrFromClipboard({
        totpInput,
        sitesInput,
        usernameInput
      });
    });
    actions.appendChild(qrBtn);
    parent.appendChild(wrap);
  }
  function createEditorField(parent, labelText, value) {
    const wrap = document.createElement("label");
    wrap.className = "editor-row editor-row-inline";
    const label = document.createElement("span");
    label.textContent = labelText;
    wrap.appendChild(label);
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
  }
  function createEditorTextarea(parent, labelText, value, { className = "" } = {}) {
    const wrap = document.createElement("label");
    wrap.className = "editor-row editor-row-multiline";
    const label = document.createElement("span");
    label.textContent = labelText;
    wrap.appendChild(label);
    const input = document.createElement("textarea");
    input.value = value || "";
    if (className) {
      input.className = className;
    }
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return input;
  }
  function cloneAccounts(inputAccounts) {
    const values = Array.isArray(inputAccounts) ? inputAccounts : [];
    return values.map((account) => ({
      ...account,
      folderIds: Array.isArray(account?.folderIds) ? [...account.folderIds] : [],
      sites: Array.isArray(account?.sites) ? [...account.sites] : [],
      passkeyCredentialIds: Array.isArray(account?.passkeyCredentialIds) ? [...account.passkeyCredentialIds] : [],
      pinnedViews: normalizePinnedViewsMap(account?.pinnedViews, account)
    }));
  }
  async function getDeviceName() {
    const result = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
    const value = String(result[STORAGE_KEY_DEVICE_NAME] || "").trim();
    return normalizeDeviceName(value);
  }
  async function getOrCreateSyncDeviceId() {
    const result = await chrome.storage.local.get([STORAGE_KEY_SYNC_DEVICE_ID]);
    const existing = String(result[STORAGE_KEY_SYNC_DEVICE_ID] || "").trim().toLowerCase();
    if (existing) return existing;
    const generated = secureRandomUuid().toLowerCase();
    await chrome.storage.local.set({ [STORAGE_KEY_SYNC_DEVICE_ID]: generated });
    return generated;
  }
  function normalizeAccountShape(account) {
    const now = Date.now();
    const sites = normalizeSites(account?.sites || []);
    const canonical = account?.canonicalSite || etldPlusOne(sites[0] || "");
    const createdAtMs = Number(account?.createdAtMs || account?.updatedAtMs || now);
    const username = String(account?.username || "");
    const accountId = String(account?.accountId || buildAccountId(canonical, username, createdAtMs));
    const recordId = normalizeRecordId(account, accountId, createdAtMs);
    const passkeyCredentialIds = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
    return {
      recordId,
      accountId,
      canonicalSite: canonical,
      usernameAtCreate: String(account?.usernameAtCreate || username),
      isPinned: Boolean(account?.isPinned),
      pinnedSortOrder: account?.pinnedSortOrder == null ? null : Number(account.pinnedSortOrder),
      regularSortOrder: account?.regularSortOrder == null ? null : Number(account.regularSortOrder),
      pinnedViews: normalizePinnedViewsMap(account?.pinnedViews, account),
      folderId: account?.folderId == null ? null : String(account.folderId),
      folderIds: Array.isArray(account?.folderIds) ? account.folderIds.map((id) => String(id)) : account?.folderId == null ? [] : [String(account.folderId)],
      folderMembershipStates: account?.folderMembershipStates && typeof account.folderMembershipStates === "object" ? account.folderMembershipStates : {},
      sites,
      siteAliasStates: account?.siteAliasStates && typeof account.siteAliasStates === "object" ? account.siteAliasStates : {},
      username,
      password: String(account?.password || ""),
      totpSecret: String(account?.totpSecret || ""),
      recoveryCodes: String(account?.recoveryCodes || ""),
      note: String(account?.note || ""),
      passkeyCredentialIds,
      passkeyLinkStates: account?.passkeyLinkStates && typeof account.passkeyLinkStates === "object" ? account.passkeyLinkStates : {},
      usernameUpdatedAtMs: Number(account?.usernameUpdatedAtMs || createdAtMs),
      usernameUpdatedDeviceName: String(account?.usernameUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      passwordUpdatedAtMs: Number(account?.passwordUpdatedAtMs || createdAtMs),
      passwordUpdatedDeviceName: String(account?.passwordUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      totpUpdatedAtMs: Number(account?.totpUpdatedAtMs || createdAtMs),
      totpUpdatedDeviceName: String(account?.totpUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      recoveryCodesUpdatedAtMs: Number(account?.recoveryCodesUpdatedAtMs || createdAtMs),
      recoveryCodesUpdatedDeviceName: String(account?.recoveryCodesUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      noteUpdatedAtMs: Number(account?.noteUpdatedAtMs || createdAtMs),
      noteUpdatedDeviceName: String(account?.noteUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      passkeyUpdatedAtMs: Number(account?.passkeyUpdatedAtMs || createdAtMs),
      passkeyUpdatedDeviceName: String(account?.passkeyUpdatedDeviceName || account?.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      isDeleted: Boolean(account?.isDeleted),
      isPermanentlyDeleted: Boolean(account?.isPermanentlyDeleted),
      deletedAtMs: account?.deletedAtMs == null ? null : Number(account.deletedAtMs),
      deletedDeviceName: String(account?.deletedDeviceName || "").trim(),
      lastOperatedDeviceName: String(account?.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      createdDeviceName: String(account?.createdDeviceName || account?.lastOperatedDeviceName || "").trim() || DEFAULT_DEVICE_NAME,
      createdAtMs,
      updatedAtMs: Number(account?.updatedAtMs || createdAtMs)
    };
  }
  function normalizePasskeyShape(item) {
    const now = Date.now();
    const normalizedCompat = normalizePasskeyCreateCompatMethod(item?.createCompatMethod, item?.alg);
    return {
      credentialIdB64u: String(item?.credentialIdB64u || item?.id || "").trim(),
      rpId: normalizeDomain(item?.rpId || ""),
      userName: normalizeUsername(item?.userName || item?.username || ""),
      displayName: String(item?.displayName || "").trim(),
      userHandleB64u: String(item?.userHandleB64u || ""),
      alg: Number(item?.alg || -7),
      signCount: Number(item?.signCount || 0),
      privateJwk: item?.privateJwk || null,
      publicJwk: item?.publicJwk || null,
      createdAtMs: Number(item?.createdAtMs || now),
      updatedAtMs: Number(item?.updatedAtMs || item?.createdAtMs || now),
      lastUsedAtMs: item?.lastUsedAtMs == null ? null : Number(item.lastUsedAtMs),
      mode: String(item?.mode || "managed"),
      createCompatMethod: normalizedCompat,
      isDeleted: Boolean(item?.isDeleted),
      isPermanentlyDeleted: Boolean(item?.isPermanentlyDeleted),
      deletedAtMs: item?.deletedAtMs == null ? null : Number(item.deletedAtMs),
      deletedDeviceName: String(item?.deletedDeviceName || "").trim()
    };
  }
  function normalizePasskeyCreateCompatMethod(input, alg) {
    const value = String(input || "").trim().toLowerCase();
    if (value === "standard" || value === "user_name_fallback" || value === "rs256" || value === "user_name_fallback+rs256" || value === "unknown_linked") {
      return value;
    }
    return Number(alg) === -257 ? "rs256" : "standard";
  }
  function normalizeFolderShape(item) {
    const now = Date.now();
    const id = normalizeFolderId(item?.id || "");
    const fixedId = FIXED_NEW_ACCOUNT_FOLDER_ID;
    const rawName = String(item?.name || "").trim();
    const safeId = id || (globalThis.crypto?.randomUUID?.() || stableUuidFromText(`folder|${rawName}|${now}`)).toLowerCase();
    const createdAtMsRaw = Number(item?.createdAtMs ?? now);
    const createdAtMs = Number.isFinite(createdAtMsRaw) ? createdAtMsRaw : now;
    const updatedAtMsRaw = Number(item?.updatedAtMs ?? createdAtMs);
    const updatedAtMs = Number.isFinite(updatedAtMsRaw) ? updatedAtMsRaw : createdAtMs;
    const safeName = safeId === fixedId ? FIXED_NEW_ACCOUNT_FOLDER_NAME : rawName || `\u672A\u547D\u540D\u6587\u4EF6\u5939 ${safeId.slice(0, 8)}`;
    return {
      id: safeId,
      name: safeName,
      matchedSites: normalizeSites(item?.matchedSites || []),
      autoAddMatchingSites: Boolean(item?.autoAddMatchingSites),
      isDeleted: Boolean(item?.isDeleted),
      isPermanentlyDeleted: Boolean(item?.isPermanentlyDeleted),
      deletedAtMs: item?.deletedAtMs == null ? null : Number(item.deletedAtMs),
      deletedDeviceName: String(item?.deletedDeviceName || "").trim(),
      createdAtMs,
      updatedAtMs
    };
  }
  function parseSites(raw) {
    return normalizeSites(
      String(raw || "").split(/[\s,;\n\t]+/g).map((value) => value.trim()).filter(Boolean)
    );
  }
  function normalizePasskeyCredentialIds(input) {
    const values = Array.isArray(input) ? input : [];
    return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].sort();
  }
  function buildUnifiedPasskeys(accountsInput, passkeysInput) {
    const now = Date.now();
    const accounts = Array.isArray(accountsInput) ? accountsInput.map(normalizeAccountShape) : [];
    const storedPasskeys = Array.isArray(passkeysInput) ? passkeysInput.map(normalizePasskeyShape) : [];
    const linkedById = /* @__PURE__ */ new Map();
    for (const account of accounts) {
      const ids = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
      if (ids.length === 0) continue;
      const rpId = normalizeDomain(account?.sites && account.sites[0] || account?.canonicalSite || "");
      const userName = normalizeUsername(account?.username || account?.usernameAtCreate || "");
      const createdAtMs = Number(account?.createdAtMs || now);
      for (const rawId of ids) {
        const credentialIdB64u = String(rawId || "").trim();
        if (!credentialIdB64u) continue;
        const existing = linkedById.get(credentialIdB64u);
        if (existing) {
          if (!existing.rpId && rpId) {
            existing.rpId = rpId;
          }
          if (!existing.userName && userName) {
            existing.userName = userName;
          }
          continue;
        }
        linkedById.set(credentialIdB64u, {
          credentialIdB64u,
          rpId,
          userName,
          displayName: "",
          userHandleB64u: "",
          alg: -7,
          signCount: 0,
          privateJwk: null,
          publicJwk: null,
          createdAtMs,
          updatedAtMs: 0,
          lastUsedAtMs: null,
          mode: "linked-account",
          createCompatMethod: "unknown_linked"
        });
      }
    }
    const linkedPasskeys = Array.from(linkedById.values()).filter((item) => String(item.rpId || "").trim().length > 0);
    return mergePasskeyCollections2(storedPasskeys, linkedPasskeys);
  }
  function normalizeFolderId(value) {
    return String(value || "").trim().toLowerCase();
  }
  function isUuidLower(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(value || ""));
  }
  function stableUuidFromText(input) {
    const raw = String(input || "");
    const seedParts = [2654435769, 2246822507, 3266489909, 668265263];
    for (let i = 0; i < raw.length; i += 1) {
      const code = raw.charCodeAt(i);
      const idx = i % 4;
      seedParts[idx] = Math.imul(seedParts[idx] ^ code, 73244475) >>> 0;
      seedParts[idx] = (seedParts[idx] ^ seedParts[idx] >>> 16) >>> 0;
    }
    const hex = seedParts.map((value) => value.toString(16).padStart(8, "0")).join("").slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }
  function normalizeRecordId(account, accountId, createdAtMs) {
    const direct = normalizeFolderId(account?.recordId || account?.id || "");
    if (isUuidLower(direct)) return direct;
    const usernameSeed = String(account?.usernameAtCreate || account?.username || "").trim();
    const stableSeed = `${String(accountId || "").trim()}|${Number(createdAtMs || 0)}|${usernameSeed}`;
    return stableUuidFromText(stableSeed);
  }
  function normalizeFolderIdList(values) {
    const source = Array.isArray(values) ? values : [];
    return [...new Set(source.map(normalizeFolderId).filter(Boolean))].sort();
  }
  function withFixedFolder(inputFolders) {
    const folders = Array.isArray(inputFolders) ? [...inputFolders] : [];
    const exists = folders.some((item) => normalizeFolderId(item?.id) === FIXED_NEW_ACCOUNT_FOLDER_ID);
    if (!exists) {
      folders.push(
        normalizeFolderShape({
          id: FIXED_NEW_ACCOUNT_FOLDER_ID,
          name: FIXED_NEW_ACCOUNT_FOLDER_NAME,
          createdAtMs: 0
        })
      );
    }
    return folders.map((folder) => {
      if (normalizeFolderId(folder?.id) !== FIXED_NEW_ACCOUNT_FOLDER_ID) return folder;
      return {
        ...folder,
        id: FIXED_NEW_ACCOUNT_FOLDER_ID,
        name: FIXED_NEW_ACCOUNT_FOLDER_NAME
      };
    });
  }
  function folderDisplayNameById(folderId) {
    const normalizedFolderId = normalizeFolderId(folderId);
    const matched = foldersRaw.find((item) => normalizeFolderId(item?.id) === normalizedFolderId);
    if (!matched) {
      return `\u672A\u547D\u540D\u6587\u4EF6\u5939 ${normalizedFolderId.slice(0, 8)}`;
    }
    return String(matched?.name || `\u672A\u547D\u540D\u6587\u4EF6\u5939 ${normalizedFolderId.slice(0, 8)}`);
  }
  function extractAccountFolderIds(account) {
    if (Array.isArray(account?.folderIds) && account.folderIds.length > 0) {
      return account.folderIds.map((id) => String(id || ""));
    }
    if (account?.folderId != null) {
      return [String(account.folderId)];
    }
    return [];
  }
  function sortFoldersForDisplay(inputFolders) {
    const folders = Array.isArray(inputFolders) ? inputFolders : [];
    return [...folders].sort((lhs, rhs) => {
      const lhsId = normalizeFolderId(lhs?.id);
      const rhsId = normalizeFolderId(rhs?.id);
      if (lhsId === FIXED_NEW_ACCOUNT_FOLDER_ID && rhsId !== FIXED_NEW_ACCOUNT_FOLDER_ID) return -1;
      if (rhsId === FIXED_NEW_ACCOUNT_FOLDER_ID && lhsId !== FIXED_NEW_ACCOUNT_FOLDER_ID) return 1;
      const lhsCreated = Number(lhs?.createdAtMs || 0);
      const rhsCreated = Number(rhs?.createdAtMs || 0);
      if (lhsCreated !== rhsCreated) return lhsCreated - rhsCreated;
      return String(lhs?.name || "").localeCompare(String(rhs?.name || ""));
    });
  }
  function mergeSyncPayloads2(local, remote) {
    const merged = mergeSyncPayloads(
      normalizeSyncPayloadShape(local),
      normalizeSyncPayloadShape(remote),
      syncMergeHelpers()
    );
    merged.accounts = syncAliasGroups2(merged.accounts);
    merged.passkeys = buildUnifiedPasskeys(merged.accounts, merged.passkeys);
    return normalizeSyncPayloadShape(merged);
  }
  function mergePasskeyCollections2(local, remote) {
    return mergePasskeyCollections(local, remote, syncMergeHelpers());
  }
  function reconcileAccountFolders2(accounts, folders) {
    return reconcileAccountFolders(accounts, folders, syncMergeHelpers());
  }
  function syncMergeHelpers() {
    return {
      normalizeAccountShape,
      normalizeFolderIdList,
      normalizeFolderId,
      extractAccountFolderIds,
      normalizeSites,
      etldPlusOne,
      normalizePasskeyCredentialIds,
      stableUuidFromText,
      normalizePasskeyShape,
      normalizePasskeyCreateCompatMethod,
      normalizeFolderShape,
      sortFoldersForDisplay,
      fixedNewAccountFolderId: FIXED_NEW_ACCOUNT_FOLDER_ID,
      fixedNewAccountFolderName: FIXED_NEW_ACCOUNT_FOLDER_NAME
    };
  }
  function validateSyncSafety(local, remote, merged, mode = SYNC_MODE_MERGE) {
    return evaluateSyncSafety({ local, remote, merged, mode }, syncMergeHelpers());
  }
  function formatTime(ms) {
    if (ms == null) return "-";
    const date = new Date(Number(ms));
    if (Number.isNaN(date.getTime())) return "-";
    const yy = String(date.getFullYear() % 100);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = date.getSeconds();
    return `${yy}-${month}-${day} ${hour}:${minute}:${second}`;
  }
  function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
  function toMultilineHtml(value) {
    const text = String(value || "").replace(/\r\n?/g, "\n").trim();
    if (!text) return "-";
    return escapeHtml(text).replaceAll("\n", "<br/>");
  }
  function classifyToastTone(message) {
    const text = String(message || "").trim();
    const lower = text.toLowerCase();
    const errorTokens = [
      "\u5931\u8D25",
      "\u9519\u8BEF",
      "\u65E0\u6CD5",
      "\u4E0D\u80FD",
      "\u62D2\u7EDD",
      "\u65E0\u6548",
      "\u7981\u6B62",
      "\u4E0D\u5339\u914D",
      "\u5DF2\u505C\u6B62",
      "\u7F3A\u5931",
      "\u4E0D\u5B58\u5728",
      "\u8D85\u65F6",
      "\u5F02\u5E38",
      "\u672A\u627E\u5230",
      "\u4E0D\u6B63\u786E",
      "error",
      "failed",
      "fail"
    ];
    if (errorTokens.some((token) => text.includes(token) || lower.includes(token))) return "error";
    const warningTokens = [
      "\u8B66\u544A",
      "\u8BF7\u5148",
      "\u8BF7\u786E\u8BA4",
      "\u5DF2\u53D6\u6D88",
      "\u53D6\u6D88",
      "\u6682\u65E0",
      "\u672A\u542F\u7528",
      "\u672A\u914D\u7F6E",
      "\u6CE8\u610F",
      "\u8DF3\u8FC7",
      "\u672A\u9009\u62E9",
      "\u4E0D\u5B8C\u6574",
      "warning",
      "warn",
      "cancel"
    ];
    if (warningTokens.some((token) => text.includes(token) || lower.includes(token))) return "warning";
    return "success";
  }
  function setStatus(message) {
    const text = String(message || "").trim();
    if (!text) return;
    dom.status.textContent = text;
    showOptionsToast(text);
  }
  function setDeviceStatus(message) {
    dom.deviceStatus.textContent = message;
  }
  function showOptionsToast(message) {
    let toast = document.getElementById("optionsToast");
    if (!(toast instanceof HTMLDivElement)) {
      toast = document.createElement("div");
      toast.id = "optionsToast";
      toast.className = "options-toast";
      document.body.appendChild(toast);
    }
    const text = String(message || "");
    const tone = classifyToastTone(text);
    toast.textContent = text;
    toast.classList.remove("options-toast-success", "options-toast-error", "options-toast-warning");
    toast.classList.add(`options-toast-${tone}`);
    toast.classList.add("options-toast-show");
    if (optionsToastTimer != null) {
      clearTimeout(optionsToastTimer);
    }
    optionsToastTimer = window.setTimeout(() => {
      const current = document.getElementById("optionsToast");
      if (!(current instanceof HTMLDivElement)) return;
      current.classList.remove("options-toast-show");
    }, OPTIONS_TOAST_DURATION_MS);
  }
  function hasTotpSecret(value) {
    return String(value || "").trim().length > 0;
  }
  function isValidTotpSecret(secret) {
    const normalized = normalizeTotpSecret(secret);
    if (!normalized) return false;
    return decodeBase32(normalized).length > 0;
  }
  async function pasteRawTotpSecretFromClipboard({ totpInput }) {
    try {
      const raw = String(await navigator.clipboard.readText() || "");
      const secret = normalizeTotpSecret(raw);
      if (!secret) {
        setStatus("\u526A\u8D34\u677F\u6587\u672C\u4E3A\u7A7A");
        return;
      }
      if (!isValidTotpSecret(secret)) {
        setStatus("\u7C98\u8D34\u5931\u8D25\uFF1A\u539F\u59CB\u5BC6\u94A5\u4E0D\u662F\u6709\u6548 TOTP");
        return;
      }
      totpInput.value = secret;
      setStatus("\u5DF2\u586B\u5145 TOTP \u539F\u59CB\u5BC6\u94A5");
    } catch (error) {
      setStatus(`\u8BFB\u53D6\u526A\u8D34\u677F\u5931\u8D25: ${error.message}`);
    }
  }
  async function pasteOtpAuthUriFromClipboard({ totpInput, sitesInput, usernameInput }) {
    try {
      const raw = String(await navigator.clipboard.readText() || "");
      const payload = parseOtpAuthUriPayload(raw);
      if (!payload) {
        setStatus("\u7C98\u8D34\u5931\u8D25\uFF1A\u4E0D\u662F\u6709\u6548\u7684 otpauth://totp URI");
        return;
      }
      applyOtpAuthPayloadToInputs(payload, {
        totpInput,
        sitesInput,
        usernameInput,
        includeSiteAndUsername: true
      });
      setStatus("\u5DF2\u89E3\u6790 otpauth URI\uFF0C\u5E76\u586B\u5145 TOTP/\u7AD9\u70B9\u522B\u540D/\u7528\u6237\u540D");
    } catch (error) {
      setStatus(`\u8BFB\u53D6\u526A\u8D34\u677F\u5931\u8D25: ${error.message}`);
    }
  }
  async function pasteOtpAuthQrFromClipboard({ totpInput, sitesInput, usernameInput }) {
    try {
      const payloadText = await parseQrPayloadFromClipboard();
      if (!payloadText) {
        setStatus("\u7C98\u8D34\u5931\u8D25\uFF1A\u526A\u8D34\u677F\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u4E8C\u7EF4\u7801\u56FE\u7247");
        return;
      }
      const payload = parseOtpAuthUriPayload(payloadText);
      if (!payload) {
        setStatus("\u7C98\u8D34\u5931\u8D25\uFF1A\u4E8C\u7EF4\u7801\u5185\u5BB9\u4E0D\u662F\u6709\u6548\u7684 otpauth://totp URI");
        return;
      }
      applyOtpAuthPayloadToInputs(payload, {
        totpInput,
        sitesInput,
        usernameInput,
        includeSiteAndUsername: true
      });
      setStatus("\u5DF2\u89E3\u6790\u4E8C\u7EF4\u7801\uFF0C\u5E76\u586B\u5145 TOTP/\u7AD9\u70B9\u522B\u540D/\u7528\u6237\u540D");
    } catch (error) {
      setStatus(`\u8BC6\u522B\u4E8C\u7EF4\u7801\u5931\u8D25: ${error.message}`);
    }
  }
  function applyOtpAuthPayloadToInputs(payload, { totpInput, sitesInput, usernameInput, includeSiteAndUsername }) {
    totpInput.value = payload.secret;
    if (!includeSiteAndUsername) return;
    if (sitesInput && payload.siteAlias) {
      sitesInput.value = payload.siteAlias;
    }
    if (usernameInput && payload.username) {
      usernameInput.value = payload.username;
    }
  }
  function parseOtpAuthUriPayload(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return null;
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (String(parsed.protocol || "").toLowerCase() !== "otpauth:") return null;
    if (String(parsed.hostname || "").toLowerCase() !== "totp") return null;
    let secretRaw = "";
    let issuerFromQuery = "";
    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = String(key || "").toLowerCase();
      if (normalizedKey === "secret" && !secretRaw) {
        secretRaw = String(value || "");
      } else if (normalizedKey === "issuer" && !issuerFromQuery) {
        issuerFromQuery = String(value || "").trim();
      }
    }
    const secret = normalizeTotpSecret(secretRaw);
    if (!isValidTotpSecret(secret)) return null;
    let decodedPath = String(parsed.pathname || "");
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch {
    }
    const label = decodedPath.replace(/^\/+/g, "").trim();
    let labelIssuer = "";
    let labelUsername = "";
    const colonIndex = label.indexOf(":");
    if (colonIndex >= 0) {
      labelIssuer = label.slice(0, colonIndex).trim();
      labelUsername = label.slice(colonIndex + 1).trim();
    } else {
      labelUsername = label.trim();
    }
    const issuer = issuerFromQuery || labelIssuer;
    return {
      secret,
      siteAlias: resolveImportedSiteAlias({ issuer, username: labelUsername }),
      username: labelUsername || ""
    };
  }
  function siteAliasFromIssuer(issuer) {
    const compactIssuer = String(issuer || "").trim().replaceAll(" ", "");
    if (!compactIssuer) return "";
    const normalized = normalizeDomain(compactIssuer);
    if (!normalized) return "";
    if (normalized.includes(".")) {
      return normalized;
    }
    return `${normalized}.com`;
  }
  function resolveImportedSiteAlias({ issuer, username }) {
    const byIssuer = siteAliasFromIssuer(issuer);
    if (byIssuer) return byIssuer;
    const byUsername = siteAliasFromUsername(username);
    if (byUsername) return byUsername;
    return "";
  }
  function siteAliasFromUsername(username) {
    const raw = String(username || "").trim();
    if (!raw) return "";
    const atIndex = raw.lastIndexOf("@");
    if (atIndex >= 0 && atIndex < raw.length - 1) {
      return normalizeDomain(raw.slice(atIndex + 1));
    }
    return normalizeDomain(raw);
  }
  async function readGoogleAuthenticatorMigrationFromClipboard() {
    let rawText = "";
    if (typeof navigator?.clipboard?.readText === "function") {
      try {
        rawText = String(await navigator.clipboard.readText() || "").trim();
      } catch {
        rawText = "";
      }
    }
    let parsed = parseGoogleAuthenticatorMigrationUriPayload(rawText);
    if (parsed) return parsed;
    const qrPayload = await parseQrPayloadFromClipboard();
    if (!qrPayload) {
      return null;
    }
    parsed = parseGoogleAuthenticatorMigrationUriPayload(qrPayload);
    if (parsed) return parsed;
    throw new Error("\u4E8C\u7EF4\u7801\u5185\u5BB9\u4E0D\u662F\u6709\u6548\u7684\u8C37\u6B4C\u9A8C\u8BC1\u5668\u5BFC\u51FA\u6570\u636E");
  }
  async function readGoogleAuthenticatorMigrationFromFiles(files) {
    if (typeof BarcodeDetector === "undefined") {
      throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u4E8C\u7EF4\u7801\u8BC6\u522B");
    }
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const migrations = [];
    for (const file of Array.isArray(files) ? files : []) {
      const payloadText = await parseQrPayloadFromBlob(file, detector);
      if (!payloadText) continue;
      const parsed = parseGoogleAuthenticatorMigrationUriPayload(payloadText);
      if (parsed) {
        migrations.push(parsed);
      }
    }
    if (migrations.length === 0) return null;
    return mergeGoogleAuthenticatorMigrations(migrations);
  }
  function parseGoogleAuthenticatorMigrationUriPayload(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return null;
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (String(parsed.protocol || "").toLowerCase() !== "otpauth-migration:") return null;
    if (String(parsed.hostname || "").toLowerCase() !== "offline") return null;
    const payloadB64 = String(parsed.searchParams.get("data") || "").trim();
    if (!payloadB64) return null;
    const bytes = decodeBase64ToBytes(payloadB64);
    if (!bytes || bytes.length === 0) return null;
    return decodeGoogleAuthenticatorMigrationPayload(bytes);
  }
  function decodeGoogleAuthenticatorMigrationPayload(bytes) {
    const payload = {
      entries: [],
      skippedCount: 0,
      batchSize: 0,
      batchIndex: 0
    };
    let offset = 0;
    while (offset < bytes.length) {
      const tag = readProtoVarint(bytes, offset);
      if (!tag) break;
      offset = tag.nextOffset;
      const fieldNumber = tag.value >>> 3;
      const wireType = tag.value & 7;
      if (fieldNumber === 1 && wireType === 2) {
        const chunk = readProtoLengthDelimited(bytes, offset);
        if (!chunk) break;
        offset = chunk.nextOffset;
        const entry = decodeGoogleAuthenticatorOtpParameters(chunk.value);
        if (entry) {
          payload.entries.push(entry);
        } else {
          payload.skippedCount += 1;
        }
        continue;
      }
      if (fieldNumber === 3 && wireType === 0) {
        const value = readProtoVarint(bytes, offset);
        if (!value) break;
        payload.batchSize = value.value;
        offset = value.nextOffset;
        continue;
      }
      if (fieldNumber === 4 && wireType === 0) {
        const value = readProtoVarint(bytes, offset);
        if (!value) break;
        payload.batchIndex = value.value;
        offset = value.nextOffset;
        continue;
      }
      offset = skipProtoField(bytes, offset, wireType);
      if (offset < 0) break;
    }
    return payload;
  }
  function decodeGoogleAuthenticatorOtpParameters(bytes) {
    let secretBytes = null;
    let name = "";
    let issuer = "";
    let algorithm = 1;
    let digits = 1;
    let type = 2;
    let offset = 0;
    while (offset < bytes.length) {
      const tag = readProtoVarint(bytes, offset);
      if (!tag) break;
      offset = tag.nextOffset;
      const fieldNumber = tag.value >>> 3;
      const wireType = tag.value & 7;
      if (fieldNumber === 1 && wireType === 2) {
        const chunk = readProtoLengthDelimited(bytes, offset);
        if (!chunk) return null;
        secretBytes = chunk.value;
        offset = chunk.nextOffset;
        continue;
      }
      if (fieldNumber === 2 && wireType === 2) {
        const chunk = readProtoLengthDelimited(bytes, offset);
        if (!chunk) return null;
        name = decodeProtoUtf8(chunk.value);
        offset = chunk.nextOffset;
        continue;
      }
      if (fieldNumber === 3 && wireType === 2) {
        const chunk = readProtoLengthDelimited(bytes, offset);
        if (!chunk) return null;
        issuer = decodeProtoUtf8(chunk.value);
        offset = chunk.nextOffset;
        continue;
      }
      if ((fieldNumber === 4 || fieldNumber === 5 || fieldNumber === 6) && wireType === 0) {
        const value = readProtoVarint(bytes, offset);
        if (!value) return null;
        if (fieldNumber === 4) algorithm = value.value;
        if (fieldNumber === 5) digits = value.value;
        if (fieldNumber === 6) type = value.value;
        offset = value.nextOffset;
        continue;
      }
      offset = skipProtoField(bytes, offset, wireType);
      if (offset < 0) return null;
    }
    if (!secretBytes || secretBytes.length === 0) return null;
    if (type !== 2 || algorithm !== 1 || digits !== 1) return null;
    const labelParts = parseImportedOtpLabel(name);
    const effectiveIssuer = String(issuer || "").trim() || labelParts.issuer;
    const username = labelParts.username || String(name || "").trim();
    const siteAlias = resolveImportedSiteAlias({ issuer: effectiveIssuer, username });
    const secret = bytesToBase32(secretBytes);
    if (!secret || !siteAlias || !isValidTotpSecret(secret)) return null;
    return {
      secret,
      siteAlias,
      username
    };
  }
  function parseImportedOtpLabel(label) {
    const text = String(label || "").trim();
    if (!text) {
      return { issuer: "", username: "" };
    }
    const colonIndex = text.indexOf(":");
    if (colonIndex < 0) {
      return { issuer: "", username: text };
    }
    return {
      issuer: text.slice(0, colonIndex).trim(),
      username: text.slice(colonIndex + 1).trim()
    };
  }
  function readProtoVarint(bytes, startOffset) {
    let result = 0;
    let shift = 0;
    let offset = startOffset;
    while (offset < bytes.length && shift <= 35) {
      const byte = bytes[offset];
      result |= (byte & 127) << shift;
      offset += 1;
      if ((byte & 128) === 0) {
        return { value: result >>> 0, nextOffset: offset };
      }
      shift += 7;
    }
    return null;
  }
  function readProtoLengthDelimited(bytes, startOffset) {
    const lengthValue = readProtoVarint(bytes, startOffset);
    if (!lengthValue) return null;
    const start = lengthValue.nextOffset;
    const end = start + lengthValue.value;
    if (end > bytes.length) return null;
    return {
      value: bytes.slice(start, end),
      nextOffset: end
    };
  }
  function skipProtoField(bytes, startOffset, wireType) {
    if (wireType === 0) {
      const value = readProtoVarint(bytes, startOffset);
      return value ? value.nextOffset : -1;
    }
    if (wireType === 1) {
      return startOffset + 8 <= bytes.length ? startOffset + 8 : -1;
    }
    if (wireType === 2) {
      const chunk = readProtoLengthDelimited(bytes, startOffset);
      return chunk ? chunk.nextOffset : -1;
    }
    if (wireType === 5) {
      return startOffset + 4 <= bytes.length ? startOffset + 4 : -1;
    }
    return -1;
  }
  function decodeBase64ToBytes(input) {
    const normalized = String(input || "").trim().replace(/-/g, "+").replace(/_/g, "/");
    if (!normalized) return new Uint8Array();
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let index = 0; index < bin.length; index += 1) {
      out[index] = bin.charCodeAt(index);
    }
    return out;
  }
  function decodeProtoUtf8(bytes) {
    return new TextDecoder().decode(bytes).trim();
  }
  function bytesToBase32(bytes) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let output = "";
    let buffer = 0;
    let bitsInBuffer = 0;
    for (const byte of bytes) {
      buffer = buffer << 8 | byte;
      bitsInBuffer += 8;
      while (bitsInBuffer >= 5) {
        output += alphabet[buffer >> bitsInBuffer - 5 & 31];
        bitsInBuffer -= 5;
      }
    }
    if (bitsInBuffer > 0) {
      output += alphabet[buffer << 5 - bitsInBuffer & 31];
    }
    return output;
  }
  function findImportedTotpAccountIndex(accounts, entry) {
    return findImportedBrowserAccountIndex(accounts, {
      sites: [entry.siteAlias],
      username: entry.username || ""
    });
  }
  function applyImportedTotpEntryToAccount(account, entry, nowMs, targetFolderId = "") {
    const next = normalizeAccountShape(account);
    if (next.isPermanentlyDeleted) return next;
    let changed = false;
    const mergedSites = normalizeSites([...next.sites || [], entry.siteAlias || ""]);
    if (JSON.stringify(mergedSites) !== JSON.stringify(next.sites || [])) {
      next.sites = mergedSites;
      changed = true;
    }
    if (entry.username && entry.username !== next.username) {
      next.username = entry.username;
      next.usernameUpdatedAtMs = nowMs;
      changed = true;
    }
    if (entry.secret && entry.secret !== next.totpSecret) {
      next.totpSecret = entry.secret;
      next.totpUpdatedAtMs = nowMs;
      changed = true;
    }
    if (targetFolderId) {
      const mergedFolderIds = normalizeFolderIdList([...next.folderIds || [], targetFolderId]);
      if (JSON.stringify(mergedFolderIds) !== JSON.stringify(normalizeFolderIdList(next.folderIds || []))) {
        next.folderIds = mergedFolderIds;
        next.folderId = mergedFolderIds[0] || null;
        changed = true;
      }
    }
    if (next.isDeleted && !next.isPermanentlyDeleted) {
      next.isDeleted = false;
      next.deletedAtMs = null;
      next.deletedDeviceName = "";
      changed = true;
    }
    if (changed) {
      next.updatedAtMs = nowMs;
      next.lastOperatedDeviceName = currentImportDeviceName();
    }
    return next;
  }
  function buildGoogleAuthenticatorImportSuffix({ importedCount, skippedCount, unchangedCount, batchSize, batchIndex }) {
    let suffix = `\uFF0C\u89E3\u6790 ${Number(importedCount || 0)} \u6761`;
    if (Number(skippedCount || 0) > 0) {
      suffix += `\uFF0C\u8DF3\u8FC7 ${Number(skippedCount)} \u6761`;
    }
    if (Number(unchangedCount || 0) > 0) {
      suffix += `\uFF0C\u672A\u53D8\u5316 ${Number(unchangedCount)} \u6761`;
    }
    if (Number(batchSize || 0) > 1) {
      suffix += `\uFF0C\u5F53\u524D\u6279\u6B21 ${Number(batchIndex || 0) + 1}/${Number(batchSize)}`;
    }
    return suffix;
  }
  function mergeGoogleAuthenticatorMigrations(migrations) {
    const merged = {
      entries: [],
      skippedCount: 0,
      batchSize: 0,
      batchIndex: 0
    };
    const seen = /* @__PURE__ */ new Set();
    for (const migration of Array.isArray(migrations) ? migrations : []) {
      merged.skippedCount += Number(migration?.skippedCount || 0);
      merged.batchSize += Math.max(Number(migration?.batchSize || 0), migration?.entries?.length ? 1 : 0);
      for (const entry of Array.isArray(migration?.entries) ? migration.entries : []) {
        const key = [
          String(entry?.siteAlias || ""),
          String(entry?.username || ""),
          String(entry?.secret || "")
        ].join("|");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.entries.push(entry);
      }
    }
    merged.batchSize = Math.max(merged.batchSize, Array.isArray(migrations) ? migrations.length : 0);
    return merged;
  }
  async function parseQrPayloadFromClipboard() {
    if (typeof navigator?.clipboard?.read !== "function") {
      throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u8BFB\u53D6\u526A\u8D34\u677F\u56FE\u7247");
    }
    if (typeof BarcodeDetector === "undefined") {
      throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u4E8C\u7EF4\u7801\u8BC6\u522B");
    }
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => String(type).startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const payload = await parseQrPayloadFromBlob(blob, detector);
      if (payload) return payload;
    }
    return "";
  }
  async function parseQrPayloadFromBlob(blob, detector) {
    if (!blob) return "";
    const bitmap = await createImageBitmap(blob);
    try {
      const results = await detector.detect(bitmap);
      for (const result of results) {
        const payload = String(result?.rawValue || "").trim();
        if (payload) return payload;
      }
      return "";
    } finally {
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }
    }
  }
  function createTotpCopyButton({ accountId, username, totpSecret }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "totp-copy-button";
    button.dataset.passTotpSecret = String(totpSecret || "");
    button.dataset.passTotpAccountId = String(accountId || "");
    button.dataset.passTotpCode = "";
    button.textContent = "\u9A8C\u8BC1\u7801: \u8BA1\u7B97\u4E2D...";
    button.addEventListener("click", async () => {
      const code = String(button.dataset.passTotpCode || "");
      if (!code) {
        setStatus("\u9A8C\u8BC1\u7801\u6682\u4E0D\u53EF\u7528");
        return;
      }
      try {
        await navigator.clipboard.writeText(code);
        const label = String(username || accountId || "");
        setStatus(`\u9A8C\u8BC1\u7801\u5DF2\u590D\u5236: ${label}`);
      } catch (error) {
        setStatus(`\u590D\u5236\u9A8C\u8BC1\u7801\u5931\u8D25: ${error.message}`);
      }
    });
    return button;
  }
  function startTotpRefreshTicker() {
    if (totpRefreshTimer != null) return;
    totpRefreshTimer = window.setInterval(() => {
      void refreshVisibleTotpButtons();
    }, TOTP_REFRESH_INTERVAL_MS);
  }
  async function refreshVisibleTotpButtons() {
    const buttons = Array.from(document.querySelectorAll(".totp-copy-button[data-pass-totp-secret]"));
    if (buttons.length === 0) return;
    const bySecret = /* @__PURE__ */ new Map();
    for (const button of buttons) {
      const rawSecret = String(button.dataset.passTotpSecret || "");
      const secret = normalizeTotpSecret(rawSecret);
      const key = secret || "__invalid__";
      if (!bySecret.has(key)) {
        bySecret.set(key, []);
      }
      bySecret.get(key).push(button);
    }
    for (const [secret, group] of bySecret.entries()) {
      const result = secret === "__invalid__" ? null : await generateTotpCode(secret, Date.now());
      for (const button of group) {
        applyTotpResultToButton(button, result);
      }
    }
  }
  function applyTotpResultToButton(button, result) {
    if (!(button instanceof HTMLButtonElement)) return;
    if (!button.isConnected) return;
    if (!result) {
      button.textContent = "\u9A8C\u8BC1\u7801: TOTP \u5BC6\u94A5\u65E0\u6548";
      button.dataset.passTotpCode = "";
      button.disabled = true;
      button.classList.add("totp-invalid");
      return;
    }
    button.textContent = `\u9A8C\u8BC1\u7801: ${result.code} (${result.remainingSeconds}s)`;
    button.dataset.passTotpCode = result.code;
    button.disabled = false;
    button.classList.remove("totp-invalid");
  }
  function normalizeTotpSecret(input) {
    return String(input || "").trim().toUpperCase().replaceAll(" ", "").replaceAll("-", "").replace(/=+$/g, "");
  }
  function decodeBase32(secret) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    const output = [];
    for (const char of secret) {
      const index = alphabet.indexOf(char);
      if (index < 0) {
        return new Uint8Array();
      }
      value = value << 5 | index;
      bits += 5;
      if (bits >= 8) {
        output.push(value >>> bits - 8 & 255);
        bits -= 8;
      }
    }
    return new Uint8Array(output);
  }
  async function generateTotpCode(secret, nowMs) {
    const normalized = normalizeTotpSecret(secret);
    if (!normalized) return null;
    const keyBytes = decodeBase32(normalized);
    if (keyBytes.length === 0) return null;
    const counter = BigInt(Math.floor(nowMs / 1e3 / TOTP_PERIOD_SECONDS));
    const counterBytes = new Uint8Array(8);
    let tempCounter = counter;
    for (let i = 7; i >= 0; i -= 1) {
      counterBytes[i] = Number(tempCounter & 0xffn);
      tempCounter >>= 8n;
    }
    let cryptoKey;
    try {
      cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    } catch {
      return null;
    }
    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBytes));
    if (signature.length < 20) return null;
    const offset = signature[signature.length - 1] & 15;
    if (offset + 3 >= signature.length) return null;
    const binary = (signature[offset] & 127) << 24 | (signature[offset + 1] & 255) << 16 | (signature[offset + 2] & 255) << 8 | signature[offset + 3] & 255;
    const code = String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
    const remainingSeconds = TOTP_PERIOD_SECONDS - Math.floor(nowMs / 1e3) % TOTP_PERIOD_SECONDS;
    return { code, remainingSeconds };
  }
})();
