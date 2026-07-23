import { ETLD2_SUFFIXES as ETLD2_SUFFIX_LIST } from "../../core/pass_core/js/sync_policy.js";
import { syncAliasGroups as syncAliasGroupsCore } from "../../core/pass_core/js/sync_alias_core.js";

const ETLD2_SUFFIXES = new Set(ETLD2_SUFFIX_LIST);

// Cross-domain login surfaces that belong to one provider. These are explicit
// security rules: unrelated domains are never associated by name similarity.
export const DOMAIN_ALIAS_GROUPS = Object.freeze([
  Object.freeze({
    id: "apple",
    domains: Object.freeze(["apple.com", "apple.com.cn", "icloud.com", "icloud.com.cn"]),
  }),
  Object.freeze({
    id: "qq",
    domains: Object.freeze(["qq.com", "wx.qq.com"]),
  }),
  Object.freeze({
    id: "baidu",
    domains: Object.freeze(["baidu.com", "passport.baidu.com", "pan.baidu.com"]),
  }),
  Object.freeze({
    id: "sina",
    domains: Object.freeze(["sina.com", "mail.sina.com", "weibo.com"]),
  }),
  Object.freeze({
    id: "github",
    domains: Object.freeze(["github.com", "gist.github.com"]),
  }),
  Object.freeze({
    id: "gitlab",
    domains: Object.freeze(["gitlab.com", "about.gitlab.com"]),
  }),
  Object.freeze({
    id: "google",
    domains: Object.freeze(["google.com", "accounts.google.com"]),
  }),
  Object.freeze({
    id: "youtube",
    domains: Object.freeze(["youtube.com", "studio.youtube.com"]),
  }),
  Object.freeze({
    id: "x",
    domains: Object.freeze(["x.com", "twitter.com"]),
  }),
  Object.freeze({
    id: "facebook",
    domains: Object.freeze(["facebook.com", "messenger.com"]),
  }),
  Object.freeze({
    id: "amazon",
    domains: Object.freeze(["amazon.com", "smile.amazon.com"]),
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
      "msn.com",
    ]),
  }),
  Object.freeze({
    id: "paypal",
    domains: Object.freeze(["paypal.com"]),
  }),
  Object.freeze({
    id: "netflix",
    domains: Object.freeze(["netflix.com", "help.netflix.com"]),
  }),
  Object.freeze({
    id: "spotify",
    domains: Object.freeze(["spotify.com", "open.spotify.com"]),
  }),
  Object.freeze({
    id: "linkedin",
    domains: Object.freeze(["linkedin.com"]),
  }),
  Object.freeze({
    id: "dropbox",
    domains: Object.freeze(["dropbox.com"]),
  }),
]);

export function normalizeDomain(input) {
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

export function isIpHost(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  // IPv4
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    return normalized.split(".").every((part) => {
      const value = Number(part);
      return Number.isInteger(value) && value >= 0 && value <= 255;
    });
  }
  // IPv6 (including bracket-stripped forms and compressed variants)
  if (normalized.includes(":")) {
    return /^[0-9a-f:]+$/i.test(normalized);
  }
  return false;
}

export function etldPlusOne(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return "";
  // Never collapse IP addresses to a shared tail (e.g. 192.168.1.1 / 10.0.1.1 → 1.1).
  if (isIpHost(normalized)) return normalized;
  const labels = normalized.split(".");
  if (labels.length < 2) return normalized;

  const tail2 = labels.slice(-2).join(".");
  if (ETLD2_SUFFIXES.has(tail2) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return tail2;
}

export function domainAliasGroupKey(domain) {
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

export function domainsMatch(left, right) {
  const normalizedLeft = normalizeDomain(left);
  const normalizedRight = normalizeDomain(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (etldPlusOne(normalizedLeft) === etldPlusOne(normalizedRight)) return true;
  const leftGroup = domainAliasGroupKey(normalizedLeft);
  return Boolean(leftGroup && leftGroup === domainAliasGroupKey(normalizedRight));
}

export function normalizeSites(sites) {
  const values = Array.isArray(sites) ? sites : [];
  return [...new Set(values.map(normalizeDomain).filter(Boolean))].sort();
}

export function normalizeUsername(value) {
  return String(value || "").trim();
}

export function formatYYMMDDHHmmss(ms) {
  const date = new Date(ms);
  const yy = String(date.getUTCFullYear() % 100).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yy}${month}${day}${hour}${minute}${second}`;
}

export function buildAccountId(canonicalSite, username, createdAtMs) {
  return `${canonicalSite}-${formatYYMMDDHHmmss(createdAtMs)}-${username}`;
}

export function isPinnedAccount(account) {
  return Boolean(account?.isPinned);
}

export function compareAccountsForDisplay(lhs, rhs) {
  const lhsPinned = isPinnedAccount(lhs);
  const rhsPinned = isPinnedAccount(rhs);
  if (lhsPinned !== rhsPinned) {
    return lhsPinned ? -1 : 1;
  }

  const lhsUpdatedAt = Number(lhs?.updatedAtMs || 0);
  const rhsUpdatedAt = Number(rhs?.updatedAtMs || 0);
  if (lhsUpdatedAt !== rhsUpdatedAt) return rhsUpdatedAt - lhsUpdatedAt;

  // Keep App behavior: within the same group, recency wins before manual order.
  if (lhsPinned && rhsPinned) {
    const lo = lhs?.pinnedSortOrder;
    const ro = rhs?.pinnedSortOrder;
    if (lo != null && ro != null && lo !== ro) return lo - ro;
    if (lo != null && ro == null) return -1;
    if (lo == null && ro != null) return 1;
  } else {
    const lo = lhs?.regularSortOrder;
    const ro = rhs?.regularSortOrder;
    if (lo != null && ro != null && lo !== ro) return lo - ro;
    if (lo != null && ro == null) return -1;
    if (lo == null && ro != null) return 1;
  }

  const lhsCreatedAt = Number(lhs?.createdAtMs || 0);
  const rhsCreatedAt = Number(rhs?.createdAtMs || 0);
  if (lhsCreatedAt !== rhsCreatedAt) return rhsCreatedAt - lhsCreatedAt;
  return String(lhs?.accountId || "").localeCompare(String(rhs?.accountId || ""));
}

export function sortAccountsForDisplay(inputAccounts) {
  return [...(Array.isArray(inputAccounts) ? inputAccounts : [])].sort(compareAccountsForDisplay);
}

export function syncAliasGroups(inputAccounts, options = {}) {
  const helpers = {
    domainAliasGroupKey,
    normalizeDomain,
    etldPlusOne,
  };
  const result = syncAliasGroupsCore(inputAccounts, helpers, {
    nowMs: options.nowMs,
    deviceName: options.deviceName || "Browser",
  });
  return result.accounts;
}
