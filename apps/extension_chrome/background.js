import { ensurePasskeyStorageShape, handlePasskeyBridgeOperation } from "./passkey_store.js";

const STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
const STORAGE_KEY_ACCOUNTS = "pass.accounts";
const CONTEXT_MENU_ID_ALL_ACCOUNTS = "pass.context.all_accounts";

const ETLD2_SUFFIXES = new Set([
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "co.uk",
  "org.uk",
]);

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME, STORAGE_KEY_ACCOUNTS]);

  if (!stored[STORAGE_KEY_DEVICE_NAME]) {
    await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: "ChromeMac" });
  }

  if (!Array.isArray(stored[STORAGE_KEY_ACCOUNTS])) {
    await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: [] });
  }

  await ensurePasskeyStorageShape();
  ensureActionContextMenu();
});

void ensurePasskeyStorageShape();
ensureActionContextMenu();

chrome.runtime.onStartup.addListener(() => {
  ensureActionContextMenu();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID_ALL_ACCOUNTS) {
    return;
  }
  void chrome.runtime.openOptionsPage();
});

function ensureActionContextMenu() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      return;
    }
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID_ALL_ACCOUNTS,
      title: "pass设置",
      contexts: ["action"],
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "PASS_FILL_ACTIVE_TAB":
        sendResponse(await handleFillActiveTab(message.payload));
        return;
      case "PASS_LOGIN_DETECTED":
        sendResponse(await handleLoginDetected(message.payload));
        return;
      case "PASS_SAVE_FROM_LOGIN":
        sendResponse(await handleSaveFromLogin(message.payload));
        return;
      case "PASS_PASSKEY_OPERATION":
        sendResponse(await handlePasskeyOperationAndSyncAccount(message.payload));
        return;
      default:
        return;
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error) });
  });

  return true;
});

async function handlePasskeyOperationAndSyncAccount(payload) {
  const response = await handlePasskeyBridgeOperation(payload);
  if (!response?.ok) {
    return response;
  }

  if (payload?.operation === "create") {
    await upsertAccountForPasskey(response.result?.accountHint);
  }
  return response;
}

async function handleFillActiveTab(payload) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    return { ok: false, error: "找不到活动标签页" };
  }

  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    func: fillCredentialInPage,
    args: [payload?.username || "", payload?.password || ""],
  });

  return { ok: true };
}

async function handleLoginDetected(payload) {
  const domain = normalizeDomain(payload?.domain || "");
  const username = (payload?.username || "").trim();
  const password = payload?.password || "";

  if (!domain || !username || !password) {
    return { shouldPrompt: false };
  }

  const accounts = await getAccounts();
  const active = accounts.filter((item) => !item.isDeleted);

  const exact = active.some((account) => {
    return accountMatchesDomain(account, domain) && account.username === username && account.password === password;
  });
  if (exact) {
    return { shouldPrompt: false };
  }

  const updateCandidate = active.some((account) => {
    return accountMatchesDomain(account, domain) && account.username === username && account.password !== password;
  });

  return { shouldPrompt: true, mode: updateCandidate ? "update" : "create" };
}

async function handleSaveFromLogin(payload) {
  const domain = normalizeDomain(payload?.domain || "");
  const username = (payload?.username || "").trim();
  const password = payload?.password || "";

  if (!domain || !username || !password) {
    return { ok: false, error: "缺少保存所需参数" };
  }

  const now = Date.now();
  const { [STORAGE_KEY_DEVICE_NAME]: deviceNameStored } = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  const deviceName = (deviceNameStored || "ChromeMac").trim() || "ChromeMac";

  const next = await getAccounts();
  const existing = next.find((account) => {
    return !account.isDeleted && accountMatchesDomain(account, domain) && account.username === username;
  });

  if (existing) {
    let changed = false;

    if (existing.password !== password) {
      existing.password = password;
      existing.passwordUpdatedAtMs = now;
      changed = true;
    }

    if (!existing.sites.includes(domain)) {
      existing.sites.push(domain);
      existing.sites = normalizeSites(existing.sites);
      changed = true;
    }

    if (existing.isDeleted) {
      existing.isDeleted = false;
      existing.deletedAtMs = null;
      changed = true;
    }

    if (changed) {
      existing.updatedAtMs = now;
      existing.lastOperatedDeviceName = deviceName;
      const synced = syncAliasGroups(next);
      await setAccounts(synced);
      return { ok: true, mode: "updated" };
    }

    return { ok: true, mode: "noop" };
  }

  next.push(
    createAccount({
      site: domain,
      username,
      password,
      createdAtMs: now,
      deviceName,
    })
  );
  const synced = syncAliasGroups(next);
  await setAccounts(synced);
  return { ok: true, mode: "created" };
}

async function getAccounts() {
  const stored = await chrome.storage.local.get([STORAGE_KEY_ACCOUNTS]);
  return Array.isArray(stored[STORAGE_KEY_ACCOUNTS]) ? stored[STORAGE_KEY_ACCOUNTS] : [];
}

async function setAccounts(accounts) {
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });
}

async function upsertAccountForPasskey(accountHint) {
  const domain = normalizeDomain(accountHint?.rpId || "");
  const username = normalizeUsername(accountHint?.username || "");
  const credentialIdB64u = normalizePasskeyId(accountHint?.credentialIdB64u || accountHint?.credentialId || "");
  if (!domain || !username) {
    return;
  }

  const now = Date.now();
  const { [STORAGE_KEY_DEVICE_NAME]: deviceNameStored } = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  const deviceName = (deviceNameStored || "ChromeMac").trim() || "ChromeMac";

  const allAccounts = await getAccounts();
  let matchIndexes = [];
  for (let i = 0; i < allAccounts.length; i += 1) {
    const account = allAccounts[i];
    if (accountMatchesDomain(account, domain) && normalizeUsername(account.username) === username) {
      matchIndexes.push(i);
    }
  }

  // Some RPs may register passkey with an internal username that differs from the saved login username.
  // If there is only one active account under this domain/alias group, reuse it as a safe fallback.
  if (matchIndexes.length === 0) {
    const fallbackIndexes = [];
    for (let i = 0; i < allAccounts.length; i += 1) {
      const account = allAccounts[i];
      if (!account.isDeleted && accountMatchesDomain(account, domain)) {
        fallbackIndexes.push(i);
      }
    }
    if (fallbackIndexes.length === 1) {
      matchIndexes = fallbackIndexes;
    }
  }

  if (matchIndexes.length === 0) {
    const created = createAccount({
      site: domain,
      username,
      password: "",
      createdAtMs: now,
      deviceName,
    });
    if (credentialIdB64u) {
      created.passkeyCredentialIds = normalizePasskeyCredentialIds([credentialIdB64u]);
      created.passkeyUpdatedAtMs = now;
    }
    allAccounts.push(created);
    await setAccounts(syncAliasGroups(allAccounts));
    return;
  }

  const matchedAccounts = matchIndexes.map((index) => allAccounts[index]);
  const primary = pickPrimaryAccountForMerge(matchedAccounts, now);
  const mergedAccount = mergeMatchedAccountsForPasskey({
    primary,
    matchedAccounts,
    domain,
    username,
    credentialIdB64u,
    now,
    deviceName,
  });

  const removeIndexSet = new Set(matchIndexes);
  const next = allAccounts.filter((_, index) => !removeIndexSet.has(index));
  next.push(mergedAccount);
  await setAccounts(syncAliasGroups(next));
}

function mergeMatchedAccountsForPasskey({
  primary,
  matchedAccounts,
  domain,
  username,
  credentialIdB64u,
  now,
  deviceName,
}) {
  const mergedSites = normalizeSites([
    ...matchedAccounts.flatMap((account) => account?.sites || []),
    domain,
  ]);
  const createdAtMs = matchedAccounts.reduce((minValue, account) => {
    return Math.min(minValue, asTimestamp(account?.createdAtMs, now));
  }, Number.POSITIVE_INFINITY);
  const safeCreatedAtMs = Number.isFinite(createdAtMs) ? createdAtMs : now;

  const usernameField = pickLatestTextField(matchedAccounts, "username", "usernameUpdatedAtMs", safeCreatedAtMs);
  const passwordField = pickLatestTextField(matchedAccounts, "password", "passwordUpdatedAtMs", safeCreatedAtMs);
  const totpField = pickLatestTextField(matchedAccounts, "totpSecret", "totpUpdatedAtMs", safeCreatedAtMs);
  const recoveryField = pickLatestTextField(
    matchedAccounts,
    "recoveryCodes",
    "recoveryCodesUpdatedAtMs",
    safeCreatedAtMs
  );
  const noteField = pickLatestTextField(matchedAccounts, "note", "noteUpdatedAtMs", safeCreatedAtMs);
  const existingPasskeyIds = normalizePasskeyCredentialIds(
    matchedAccounts.flatMap((account) => account?.passkeyCredentialIds || [])
  );
  const mergedPasskeyIds = normalizePasskeyCredentialIds([...existingPasskeyIds, credentialIdB64u]);
  const passkeyUpdatedAtFromData = matchedAccounts.reduce((maxValue, account) => {
    return Math.max(maxValue, asTimestamp(account?.passkeyUpdatedAtMs, account?.createdAtMs));
  }, 0);
  const passkeyChanged = mergedPasskeyIds.length !== existingPasskeyIds.length;

  const canonicalSite = primary?.canonicalSite || etldPlusOne(mergedSites[0] || domain);
  const hasExactUsernameMatch = matchedAccounts.some(
    (account) => normalizeUsername(account?.username || "") === username
  );
  const mergedUsername = hasExactUsernameMatch
    ? username
    : (usernameField.value || username || normalizeUsername(primary?.username || ""));
  const accountId = primary?.accountId || buildAccountId(canonicalSite, mergedUsername, safeCreatedAtMs);

  return {
    ...primary,
    accountId,
    canonicalSite,
    usernameAtCreate: primary?.usernameAtCreate || normalizeUsername(primary?.username || "") || mergedUsername,
    isPinned: Boolean(primary?.isPinned),
    pinnedSortOrder: primary?.pinnedSortOrder == null ? null : Number(primary.pinnedSortOrder),
    regularSortOrder: primary?.regularSortOrder == null ? null : Number(primary.regularSortOrder),
    sites: mergedSites,
    username: mergedUsername,
    password: passwordField.value,
    totpSecret: totpField.value,
    recoveryCodes: recoveryField.value,
    note: noteField.value,
    usernameUpdatedAtMs: mergedUsername === usernameField.value ? usernameField.updatedAtMs : now,
    passwordUpdatedAtMs: passwordField.updatedAtMs,
    totpUpdatedAtMs: totpField.updatedAtMs,
    recoveryCodesUpdatedAtMs: recoveryField.updatedAtMs,
    noteUpdatedAtMs: noteField.updatedAtMs,
    passkeyCredentialIds: mergedPasskeyIds,
    passkeyUpdatedAtMs: passkeyChanged ? now : asTimestamp(passkeyUpdatedAtFromData, safeCreatedAtMs),
    isDeleted: false,
    deletedAtMs: null,
    lastOperatedDeviceName: deviceName,
    createdAtMs: safeCreatedAtMs,
    updatedAtMs: now,
  };
}

function pickPrimaryAccountForMerge(accounts, fallbackTs) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  const sorted = accounts
    .map((account, index) => ({
      account,
      index,
      createdAtMs: asTimestamp(account?.createdAtMs, fallbackTs),
      accountId: String(account?.accountId || ""),
    }))
    .sort((a, b) => {
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs;
      if (a.accountId !== b.accountId) return a.accountId.localeCompare(b.accountId);
      return a.index - b.index;
    });
  return sorted[0]?.account || accounts[0];
}

function pickLatestTextField(accounts, valueKey, updatedAtKey, fallbackTs) {
  let best = null;
  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    const value = String(account?.[valueKey] || "");
    const updatedAtMs = asTimestamp(account?.[updatedAtKey], account?.createdAtMs);
    const createdAtMs = asTimestamp(account?.createdAtMs, fallbackTs);
    const accountId = String(account?.accountId || "");

    if (!best) {
      best = { value, updatedAtMs, createdAtMs, accountId, index };
      continue;
    }

    if (updatedAtMs > best.updatedAtMs) {
      best = { value, updatedAtMs, createdAtMs, accountId, index };
      continue;
    }
    if (updatedAtMs < best.updatedAtMs) {
      continue;
    }

    if (createdAtMs < best.createdAtMs) {
      best = { value, updatedAtMs, createdAtMs, accountId, index };
      continue;
    }
    if (createdAtMs > best.createdAtMs) {
      continue;
    }

    if (accountId < best.accountId) {
      best = { value, updatedAtMs, createdAtMs, accountId, index };
      continue;
    }
    if (accountId > best.accountId) {
      continue;
    }

    if (index < best.index) {
      best = { value, updatedAtMs, createdAtMs, accountId, index };
    }
  }

  if (!best) {
    return { value: "", updatedAtMs: asTimestamp(fallbackTs, Date.now()) };
  }
  return {
    value: best.value,
    updatedAtMs: asTimestamp(best.updatedAtMs, fallbackTs),
  };
}

function asTimestamp(value, fallbackTs = 0) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return number;
  }
  const fallback = Number(fallbackTs);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function normalizePasskeyId(value) {
  return String(value || "").trim();
}

function normalizePasskeyCredentialIds(input) {
  const values = Array.isArray(input) ? input : [];
  return [...new Set(values.map(normalizePasskeyId).filter(Boolean))].sort();
}

function fillCredentialInPage(username, password) {
  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (element.hasAttribute("disabled") || element.hasAttribute("readonly")) return false;
    return true;
  };

  const forms = Array.from(document.forms);
  const allInputs = Array.from(document.querySelectorAll("input"));
  const passwordInputs = allInputs.filter((input) => input.type === "password" && visible(input));
  if (passwordInputs.length === 0) return;

  const usernameCandidates = allInputs.filter((input) => {
    const type = (input.type || "").toLowerCase();
    const name = (input.name || "").toLowerCase();
    const id = (input.id || "").toLowerCase();
    const autocomplete = (input.autocomplete || "").toLowerCase();
    const typeMatch = type === "text" || type === "email" || type === "tel";
    const semanticMatch =
      name.includes("user") ||
      name.includes("email") ||
      id.includes("user") ||
      id.includes("email") ||
      autocomplete.includes("username");
    return visible(input) && (typeMatch || semanticMatch);
  });

  const passwordInput = passwordInputs[0];
  let usernameInput = usernameCandidates[0] || null;

  if (!usernameInput) {
    const form = forms.find((formItem) => formItem.contains(passwordInput));
    if (form) {
      const localCandidates = Array.from(form.querySelectorAll("input")).filter((input) => {
        const type = (input.type || "").toLowerCase();
        return visible(input) && (type === "text" || type === "email");
      });
      usernameInput = localCandidates[0] || null;
    }
  }

  const setInputValue = (input, value) => {
    if (!input) return;
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  setInputValue(usernameInput, username);
  setInputValue(passwordInput, password);
}

function createAccount({ site, username, password, createdAtMs, deviceName }) {
  const normalizedSite = normalizeDomain(site);
  const canonical = etldPlusOne(normalizedSite);
  const accountId = buildAccountId(canonical, username, createdAtMs);

  return {
    accountId,
    canonicalSite: canonical,
    usernameAtCreate: username,
    isPinned: false,
    pinnedSortOrder: null,
    regularSortOrder: null,
    folderId: null,
    folderIds: [],
    sites: normalizeSites([normalizedSite]),
    username,
    password,
    totpSecret: "",
    recoveryCodes: "",
    note: "",
    passkeyCredentialIds: [],
    usernameUpdatedAtMs: createdAtMs,
    passwordUpdatedAtMs: createdAtMs,
    totpUpdatedAtMs: createdAtMs,
    recoveryCodesUpdatedAtMs: createdAtMs,
    noteUpdatedAtMs: createdAtMs,
    passkeyUpdatedAtMs: createdAtMs,
    isDeleted: false,
    deletedAtMs: null,
    lastOperatedDeviceName: deviceName,
    createdAtMs,
    updatedAtMs: createdAtMs,
  };
}

function buildAccountId(canonicalSite, username, createdAtMs) {
  return `${canonicalSite}-${formatYYMMDDHHmmss(createdAtMs)}-${username}`;
}

function accountMatchesDomain(account, domain) {
  const normalized = normalizeDomain(domain);
  const etld1 = etldPlusOne(normalized);
  const sites = normalizeSites(account.sites || []);
  return sites.some((site) => site === normalized || etldPlusOne(site) === etld1);
}

function normalizeDomain(input) {
  if (!input) return "";
  let value = input.trim().toLowerCase();
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

function etldPlusOne(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return "";

  const labels = normalized.split(".");
  if (labels.length < 2) return normalized;
  const tail2 = labels.slice(-2).join(".");
  if (ETLD2_SUFFIXES.has(tail2) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return tail2;
}

function normalizeSites(sites) {
  return [...new Set((sites || []).map(normalizeDomain).filter(Boolean))].sort();
}

function syncAliasGroups(inputAccounts) {
  const nextAccounts = inputAccounts.map((account) => ({
    ...account,
    sites: normalizeSites(account.sites || []),
  }));

  const adjacency = new Map(nextAccounts.map((account) => [account.accountId, new Set()]));
  for (let i = 0; i < nextAccounts.length; i += 1) {
    for (let j = i + 1; j < nextAccounts.length; j += 1) {
      const a = nextAccounts[i];
      const b = nextAccounts[j];
      const hasSiteOverlap = a.sites.some((site) => b.sites.includes(site));
      const sameEtld1 = a.sites.some((siteA) => b.sites.some((siteB) => etldPlusOne(siteA) === etldPlusOne(siteB)));
      if (hasSiteOverlap || sameEtld1) {
        adjacency.get(a.accountId).add(b.accountId);
        adjacency.get(b.accountId).add(a.accountId);
      }
    }
  }

  const visited = new Set();
  for (const account of nextAccounts) {
    if (visited.has(account.accountId)) continue;

    const queue = [account.accountId];
    const component = [];
    visited.add(account.accountId);

    while (queue.length > 0) {
      const id = queue.shift();
      component.push(id);
      for (const neighbor of adjacency.get(id) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (component.length <= 1) continue;

    const mergedSites = normalizeSites(
      component.flatMap((id) => nextAccounts.find((item) => item.accountId === id)?.sites || [])
    );
    for (const id of component) {
      const target = nextAccounts.find((item) => item.accountId === id);
      if (!target) continue;
      if (JSON.stringify(target.sites) !== JSON.stringify(mergedSites)) {
        target.sites = mergedSites;
        target.updatedAtMs = Date.now();
      }
    }
  }

  return nextAccounts;
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
