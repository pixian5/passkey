const STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
const STORAGE_KEY_ACCOUNTS = "pass.accounts";
const STORAGE_KEY_PASSKEYS = "pass.passkeys";

const ETLD2_SUFFIXES = new Set([
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "co.uk",
  "org.uk",
]);
const ACCOUNT_SEARCH_FIELD_KEYS = ["username", "sites", "note", "password"];
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_REFRESH_INTERVAL_MS = 1000;

const dom = {
  openCreateModalBtn: document.getElementById("openCreateModal"),
  modeActiveBtn: document.getElementById("modeActive"),
  modeAllBtn: document.getElementById("modeAll"),
  modeRecycleBtn: document.getElementById("modeRecycle"),
  modePasskeyBtn: document.getElementById("modePasskey"),
  accountSearchSection: document.getElementById("accountSearchSection"),
  accountSearchFieldsBtn: document.getElementById("accountSearchFieldsBtn"),
  accountSearchFieldsPanel: document.getElementById("accountSearchFieldsPanel"),
  accountSearchFieldAll: document.getElementById("accountSearchFieldAll"),
  accountSearchFieldUsername: document.getElementById("accountSearchFieldUsername"),
  accountSearchFieldSites: document.getElementById("accountSearchFieldSites"),
  accountSearchFieldNote: document.getElementById("accountSearchFieldNote"),
  accountSearchFieldPassword: document.getElementById("accountSearchFieldPassword"),
  accountSearch: document.getElementById("accountSearch"),
  createSiteInput: document.getElementById("createSite"),
  createUsernameInput: document.getElementById("createUsername"),
  createPasswordInput: document.getElementById("createPassword"),
  createAccountBtn: document.getElementById("createAccount"),
  closeCreateModalBtn: document.getElementById("closeCreateModal"),
  createModal: document.getElementById("createModal"),
  passkeySection: document.getElementById("passkeySection"),
  passkeyCurrentSiteOnly: document.getElementById("passkeyCurrentSiteOnly"),
  passkeySearch: document.getElementById("passkeySearch"),
  passkeyList: document.getElementById("passkeyList"),
  accountList: document.getElementById("accountList"),
  status: document.getElementById("popupStatus"),
};

let currentDomain = "";
let accounts = [];
let passkeys = [];
let editingAccountId = null;
let viewMode = "accounts";
let totpRefreshTimer = null;
let accountSearchUseAll = true;
let accountSearchFields = new Set();
let draggingAccountId = "";

init().catch((error) => {
  setStatus(`初始化失败: ${error.message}`);
});

async function init() {
  await resolveCurrentDomain();
  await loadAccounts();
  await loadPasskeys();
  renderAccounts();
  bindEvents();
  startTotpRefreshTicker();
  chrome.storage.onChanged.addListener(handleStorageChanged);
}

function handleStorageChanged(changes, areaName) {
  if (areaName !== "local") return;
  let shouldRender = false;

  if (changes[STORAGE_KEY_ACCOUNTS]) {
    const next = Array.isArray(changes[STORAGE_KEY_ACCOUNTS].newValue) ? changes[STORAGE_KEY_ACCOUNTS].newValue : [];
    accounts = next.map(normalizeAccountShape);
    shouldRender = true;
  }
  if (changes[STORAGE_KEY_PASSKEYS]) {
    const next = Array.isArray(changes[STORAGE_KEY_PASSKEYS].newValue) ? changes[STORAGE_KEY_PASSKEYS].newValue : [];
    passkeys = next.map(normalizePasskeyShape);
    shouldRender = true;
  }

  if (shouldRender) {
    renderAccounts();
  }
}

function bindEvents() {
  dom.openCreateModalBtn.addEventListener("click", openCreateModal);
  dom.createAccountBtn.addEventListener("click", createAccountFromInputs);
  dom.closeCreateModalBtn.addEventListener("click", closeCreateModal);
  dom.createModal.addEventListener("click", (event) => {
    if (event.target === dom.createModal) {
      closeCreateModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.createModal.classList.contains("modal-hidden")) {
      closeCreateModal();
      return;
    }
    if (event.key === "Escape" && !dom.accountSearchFieldsPanel.classList.contains("hidden")) {
      closeAccountSearchFieldsPanel();
    }
  });
  dom.accountSearchFieldsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    dom.accountSearchFieldsPanel.classList.toggle("hidden");
    syncAccountSearchFieldCheckboxes();
  });
  dom.accountSearchFieldAll.addEventListener("change", onAccountSearchFieldAllChanged);
  dom.accountSearchFieldUsername.addEventListener("change", onAccountSearchFieldChanged);
  dom.accountSearchFieldSites.addEventListener("change", onAccountSearchFieldChanged);
  dom.accountSearchFieldNote.addEventListener("change", onAccountSearchFieldChanged);
  dom.accountSearchFieldPassword.addEventListener("change", onAccountSearchFieldChanged);
  dom.accountSearchFieldsPanel.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  document.addEventListener("click", (event) => {
    if (dom.accountSearchFieldsPanel.classList.contains("hidden")) return;
    if (dom.accountSearchSection.contains(event.target)) return;
    closeAccountSearchFieldsPanel();
  });
  dom.modeActiveBtn.addEventListener("click", () => setViewMode("accounts"));
  dom.modeAllBtn.addEventListener("click", () => setViewMode("all"));
  dom.modeRecycleBtn.addEventListener("click", () => setViewMode("recycle"));
  dom.modePasskeyBtn.addEventListener("click", () => setViewMode("passkeys"));
  dom.accountSearch.addEventListener("input", renderAccounts);
  dom.passkeyCurrentSiteOnly.addEventListener("change", renderAccounts);
  dom.passkeySearch.addEventListener("input", renderAccounts);
}

function setViewMode(nextMode) {
  viewMode = nextMode;
  if (viewMode !== "accounts" && viewMode !== "all") {
    editingAccountId = null;
    closeCreateModal();
  }
  if (viewMode === "passkeys") {
    closeAccountSearchFieldsPanel();
  }
  renderAccounts();
}

function openCreateModal() {
  if (viewMode !== "accounts" && viewMode !== "all") return;
  const suggestedSite = getSuggestedCreateSite();
  dom.createSiteInput.value = suggestedSite;
  dom.createModal.classList.remove("modal-hidden");
  dom.createModal.setAttribute("aria-hidden", "false");
  dom.createSiteInput.focus();
}

function closeCreateModal() {
  dom.createModal.classList.add("modal-hidden");
  dom.createModal.setAttribute("aria-hidden", "true");
}

function closeAccountSearchFieldsPanel() {
  dom.accountSearchFieldsPanel.classList.add("hidden");
}

function getSuggestedCreateSite() {
  if (!currentDomain) return "";
  return etldPlusOne(currentDomain) || currentDomain;
}

async function resolveCurrentDomain() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = activeTab?.url || "";
  currentDomain = normalizeDomain(url);
}

async function getDeviceName() {
  const stored = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  const value = String(stored[STORAGE_KEY_DEVICE_NAME] || "").trim();
  return value || "ChromeMac";
}

async function loadAccounts() {
  const stored = await chrome.storage.local.get([STORAGE_KEY_ACCOUNTS]);
  const raw = Array.isArray(stored[STORAGE_KEY_ACCOUNTS]) ? stored[STORAGE_KEY_ACCOUNTS] : [];
  accounts = raw.map(normalizeAccountShape);
}

async function loadPasskeys() {
  const stored = await chrome.storage.local.get([STORAGE_KEY_PASSKEYS]);
  const raw = Array.isArray(stored[STORAGE_KEY_PASSKEYS]) ? stored[STORAGE_KEY_PASSKEYS] : [];
  passkeys = raw.map(normalizePasskeyShape);
}

async function persistAccounts(nextAccounts) {
  accounts = nextAccounts.map(normalizeAccountShape);
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });
}

async function persistPasskeys(nextPasskeys) {
  passkeys = nextPasskeys.map(normalizePasskeyShape);
  await chrome.storage.local.set({ [STORAGE_KEY_PASSKEYS]: passkeys });
}

function normalizeAccountShape(account) {
  const now = Date.now();
  const sites = normalizeSites(account.sites || []);
  const passkeyCredentialIds = normalizePasskeyCredentialIds(account.passkeyCredentialIds || []);
  const canonical = account.canonicalSite || etldPlusOne(sites[0] || "");
  const createdAtMs = Number(account.createdAtMs || account.updatedAtMs || now);
  const username = account.username || "";
  return {
    accountId: account.accountId || buildAccountId(canonical, username, createdAtMs),
    canonicalSite: canonical,
    usernameAtCreate: account.usernameAtCreate || username,
    isPinned: Boolean(account.isPinned),
    pinnedSortOrder: account.pinnedSortOrder == null ? null : Number(account.pinnedSortOrder),
    regularSortOrder: account.regularSortOrder == null ? null : Number(account.regularSortOrder),
    folderId: account.folderId == null ? null : String(account.folderId),
    folderIds: Array.isArray(account.folderIds)
      ? account.folderIds.map((id) => String(id))
      : (account.folderId == null ? [] : [String(account.folderId)]),
    sites,
    username,
    password: account.password || "",
    totpSecret: account.totpSecret || "",
    recoveryCodes: account.recoveryCodes || "",
    note: account.note || "",
    passkeyCredentialIds,
    usernameUpdatedAtMs: Number(account.usernameUpdatedAtMs || createdAtMs),
    passwordUpdatedAtMs: Number(account.passwordUpdatedAtMs || createdAtMs),
    totpUpdatedAtMs: Number(account.totpUpdatedAtMs || createdAtMs),
    recoveryCodesUpdatedAtMs: Number(account.recoveryCodesUpdatedAtMs || createdAtMs),
    noteUpdatedAtMs: Number(account.noteUpdatedAtMs || createdAtMs),
    passkeyUpdatedAtMs: Number(account.passkeyUpdatedAtMs || createdAtMs),
    isDeleted: Boolean(account.isDeleted),
    deletedAtMs: account.deletedAtMs == null ? null : Number(account.deletedAtMs),
    lastOperatedDeviceName: account.lastOperatedDeviceName || "ChromeMac",
    createdAtMs,
    updatedAtMs: Number(account.updatedAtMs || createdAtMs),
  };
}

function normalizePasskeyShape(item) {
  const now = Date.now();
  return {
    credentialIdB64u: String(item?.credentialIdB64u || item?.id || ""),
    rpId: normalizeDomain(item?.rpId || ""),
    userName: String(item?.userName || item?.username || "").trim(),
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
  };
}

function renderAccounts() {
  const showPasskeyMode = viewMode === "passkeys";
  const showRecycleBinMode = viewMode === "recycle";
  const showAllAccountsMode = viewMode === "all";
  const showAccountMode = viewMode === "accounts";

  dom.modeActiveBtn.classList.toggle("mode-btn-active", showAccountMode);
  dom.modeAllBtn.classList.toggle("mode-btn-active", showAllAccountsMode);
  dom.modeRecycleBtn.classList.toggle("mode-btn-active", showRecycleBinMode);
  dom.modePasskeyBtn.classList.toggle("mode-btn-active", showPasskeyMode);

  dom.openCreateModalBtn.classList.toggle("hidden", !(showAccountMode || showAllAccountsMode));
  dom.accountSearchSection.classList.toggle("hidden", showPasskeyMode);
  dom.passkeySection.classList.toggle("passkey-hidden", !showPasskeyMode);
  dom.accountList.style.display = showPasskeyMode ? "none" : "grid";

  if (showPasskeyMode) {
    renderPasskeyList();
    return;
  }

  dom.accountList.innerHTML = "";

  let visibleAccountsByMode = showRecycleBinMode
    ? accounts.filter((account) => account.isDeleted)
    : accounts.filter((account) => !account.isDeleted);
  const accountQuery = String(dom.accountSearch.value || "").trim().toLowerCase();
  let visibleAccounts = visibleAccountsByMode;
  if (!showAllAccountsMode) {
    visibleAccounts = visibleAccounts.filter((account) =>
      isAccountMatchCurrentDomain(account, currentDomain)
    );
  }
  if (accountQuery) {
    visibleAccounts = visibleAccounts.filter((account) =>
      isAccountMatchSearch(account, accountQuery)
    );
  }
  visibleAccounts = sortAccountsForDisplay(visibleAccounts);

  if (visibleAccounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    if (showAllAccountsMode) {
      empty.textContent = "暂无账号。";
    } else if (!currentDomain) {
      empty.textContent = "当前页面无站点信息，无法匹配账号。";
    } else if (showRecycleBinMode) {
      empty.textContent = "当前站点在回收站中没有匹配账号。";
    } else {
      empty.textContent = "当前站点没有匹配账号。";
    }
    dom.accountList.appendChild(empty);
    return;
  }

  for (const account of visibleAccounts) {
    const card = document.createElement("article");
    card.className = "account";
    card.draggable = !showRecycleBinMode;

    const titleRow = document.createElement("div");
    titleRow.className = "account-title-row";

    const title = document.createElement("strong");
    title.textContent = account.accountId;
    titleRow.appendChild(title);

    if (!showRecycleBinMode) {
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "pin-btn";
      const pinned = isPinnedAccount(account);
      pinBtn.textContent = pinned ? "取消置顶" : "置顶";
      pinBtn.classList.toggle("is-unpin", pinned);
      pinBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await togglePin(account.accountId);
      });
      titleRow.appendChild(pinBtn);
    }
    card.appendChild(titleRow);

    card.addEventListener("dragstart", (event) => {
      if (showRecycleBinMode) return;
      draggingAccountId = account.accountId;
      event.dataTransfer?.setData("text/plain", account.accountId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
    });
    card.addEventListener("dragover", (event) => {
      if (showRecycleBinMode) return;
      const source = accounts.find((item) => item.accountId === draggingAccountId);
      if (!source) return;
      if (isPinnedAccount(source) !== isPinnedAccount(account)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });
    card.addEventListener("drop", async (event) => {
      if (showRecycleBinMode) return;
      event.preventDefault();
      const sourceId = draggingAccountId;
      draggingAccountId = "";
      if (!sourceId || sourceId === account.accountId) return;
      await reorderAccount(sourceId, account.accountId);
    });
    card.addEventListener("dragend", () => {
      draggingAccountId = "";
    });

    const meta = document.createElement("div");
    meta.className = "meta";
    const sitesMultilineHtml = toMultilineHtml((account.sites || []).join("\n"));
    meta.innerHTML =
      `用户名: ${escapeHtml(account.username || "-")}<br/>` +
      `站点别名:<div class="meta-multiline">${sitesMultilineHtml}</div>`;
    card.appendChild(meta);

    const totpCopyBtn = hasTotpSecret(account.totpSecret)
      ? createTotpCopyButton({
        accountId: account.accountId,
        username: account.username,
        totpSecret: account.totpSecret,
      })
      : null;

    const actions = document.createElement("div");
    actions.className = "actions";

    if (!showRecycleBinMode) {
      const aliasBtn = document.createElement("button");
      aliasBtn.textContent = "加入当前域名";
      aliasBtn.addEventListener("click", () => addCurrentDomainToAccount(account.accountId));
      actions.appendChild(aliasBtn);

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "复制密码";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(account.password || "");
          setStatus(`已复制 ${account.username} 的密码`);
        } catch (error) {
          setStatus(`复制失败: ${error.message}`);
        }
      });
      actions.appendChild(copyBtn);

      const fillBtn = document.createElement("button");
      fillBtn.textContent = "填充当前页";
      fillBtn.disabled = !(account.username && account.password);
      fillBtn.addEventListener("click", () => fillCurrentPage(account));
      actions.appendChild(fillBtn);

      const editBtn = document.createElement("button");
      editBtn.textContent = editingAccountId === account.accountId ? "收起编辑" : "编辑";
      editBtn.addEventListener("click", () => {
        editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
        renderAccounts();
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "删除账号";
      deleteBtn.addEventListener("click", () => moveToRecycleBin(account.accountId));
      actions.appendChild(deleteBtn);

      if (totpCopyBtn) {
        actions.appendChild(totpCopyBtn);
      }
    } else {
      const restoreBtn = document.createElement("button");
      restoreBtn.textContent = "恢复账号";
      restoreBtn.addEventListener("click", () => restoreFromRecycleBin(account.accountId));
      actions.appendChild(restoreBtn);

      const permanentDeleteBtn = document.createElement("button");
      permanentDeleteBtn.textContent = "永久删除";
      permanentDeleteBtn.addEventListener("click", () => permanentlyDelete(account.accountId));
      actions.appendChild(permanentDeleteBtn);

      if (totpCopyBtn) {
        actions.appendChild(totpCopyBtn);
      }
    }

    card.appendChild(actions);

    if (!showRecycleBinMode && editingAccountId === account.accountId) {
      card.appendChild(buildEditor(account));
    }

    dom.accountList.appendChild(card);
  }

  void refreshVisibleTotpButtons();
}

function renderPasskeyList() {
  dom.passkeyList.innerHTML = "";
  const query = String(dom.passkeySearch.value || "").trim().toLowerCase();
  const currentOnly = Boolean(dom.passkeyCurrentSiteOnly.checked);
  const allPasskeys = collectUnifiedPasskeys();

  let visiblePasskeys = allPasskeys;
  if (currentOnly) {
    visiblePasskeys = visiblePasskeys.filter((item) => matchRpIdWithDomain(item.rpId, currentDomain));
  }
  if (query) {
    visiblePasskeys = visiblePasskeys.filter((item) => {
      const searchText = `${item.rpId} ${item.userName} ${item.displayName} ${item.credentialIdB64u}`.toLowerCase();
      return searchText.includes(query);
    });
  }

  if (visiblePasskeys.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = allPasskeys.length === 0
      ? "暂无通行秘钥（访问支持 passkey 的站点并注册后会出现在这里）"
      : "没有匹配的通行秘钥";
    dom.passkeyList.appendChild(empty);
    return;
  }

  visiblePasskeys.sort((a, b) => (b.lastUsedAtMs || b.updatedAtMs || 0) - (a.lastUsedAtMs || a.updatedAtMs || 0));

  for (const item of visiblePasskeys) {
    const card = document.createElement("article");
    card.className = "passkey-item";

    const title = document.createElement("strong");
    const name = item.userName || item.displayName || "-";
    title.textContent = `${item.rpId} | ${name}`;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    const currentBadge = matchRpIdWithDomain(item.rpId, currentDomain)
      ? '<span class="badge">当前站点可用</span>'
      : "";
    const linkedCount = Number(item.linkedAccountCount || 0);
    meta.innerHTML =
      `credentialId: ${escapeHtml(shortenMiddle(item.credentialIdB64u, 20))}<br/>` +
      `签名计数: ${item.signCount} | 算法: ${item.alg} | 模式: ${escapeHtml(item.mode)}<br/>` +
      `创建: ${formatTime(item.createdAtMs)} | 最近使用: ${formatTime(item.lastUsedAtMs)}<br/>` +
      `关联账号数: ${linkedCount}<br/>` +
      `${currentBadge}`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const copyIdBtn = document.createElement("button");
    copyIdBtn.textContent = "复制ID";
    copyIdBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.credentialIdB64u);
        setStatus(`已复制通行秘钥ID: ${shortenMiddle(item.credentialIdB64u, 16)}`);
      } catch (error) {
        setStatus(`复制失败: ${error.message}`);
      }
    });
    actions.appendChild(copyIdBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "删除通行秘钥";
    deleteBtn.addEventListener("click", async () => {
      await deletePasskey(item.credentialIdB64u);
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    dom.passkeyList.appendChild(card);
  }
}

function collectUnifiedPasskeys() {
  const byId = new Map();
  const now = Date.now();

  for (const item of passkeys) {
    const id = normalizePasskeyId(item?.credentialIdB64u || item?.id || "");
    if (!id) continue;
    byId.set(id, {
      ...item,
      credentialIdB64u: id,
      rpId: normalizeDomain(item?.rpId || ""),
      userName: normalizeUsername(item?.userName || item?.username || ""),
      displayName: String(item?.displayName || "").trim(),
      linkedAccountIds: [],
      linkedAccountCount: 0,
      mode: String(item?.mode || "managed"),
      createdAtMs: Number(item?.createdAtMs || now),
      updatedAtMs: Number(item?.updatedAtMs || item?.createdAtMs || now),
      lastUsedAtMs: item?.lastUsedAtMs == null ? null : Number(item.lastUsedAtMs),
    });
  }

  for (const account of accounts) {
    const ids = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);
    if (ids.length === 0) continue;
    const accountSite = normalizeDomain(
      (account?.sites && account.sites[0]) || account?.canonicalSite || ""
    );
    const accountUser = normalizeUsername(account?.username || "");
    const accountCreatedAt = Number(account?.createdAtMs || now);
    const accountUpdatedAt = Number(account?.passkeyUpdatedAtMs || account?.updatedAtMs || accountCreatedAt);
    const accountId = String(account?.accountId || "");

    for (const id of ids) {
      if (!byId.has(id)) {
        byId.set(id, {
          credentialIdB64u: id,
          rpId: accountSite,
          userName: accountUser,
          displayName: "",
          userHandleB64u: "",
          alg: -7,
          signCount: 0,
          privateJwk: null,
          publicJwk: null,
          createdAtMs: accountCreatedAt,
          updatedAtMs: accountUpdatedAt,
          lastUsedAtMs: null,
          mode: "linked-account",
          linkedAccountIds: [],
          linkedAccountCount: 0,
        });
      }

      const target = byId.get(id);
      if (accountSite && !target.rpId) {
        target.rpId = accountSite;
      }
      if (accountUser && !target.userName) {
        target.userName = accountUser;
      }
      if (accountUpdatedAt > Number(target.updatedAtMs || 0)) {
        target.updatedAtMs = accountUpdatedAt;
      }
      if (!target.linkedAccountIds.includes(accountId)) {
        target.linkedAccountIds.push(accountId);
      }
      target.linkedAccountCount = target.linkedAccountIds.length;
    }
  }

  return Array.from(byId.values()).filter((item) => item.credentialIdB64u && item.rpId);
}

function buildEditor(account) {
  const editor = document.createElement("div");
  editor.className = "editor";

  const sitesInput = createEditorTextarea(editor, "站点别名（每行一个）", account.sites.join("\n"), {
    className: "editor-textarea editor-textarea-sites",
  });
  const usernameInput = createEditorField(editor, "用户名", account.username);
  const passwordInput = createEditorField(editor, "密码", account.password);
  const totpInput = createEditorField(editor, "TOTP", account.totpSecret || "");
  const recoveryInput = createEditorTextarea(editor, "恢复码（每行一个）", account.recoveryCodes || "", {
    className: "editor-textarea editor-textarea-recovery",
  });
  const noteInput = createEditorTextarea(editor, "备注", account.note || "", {
    className: "editor-textarea",
  });

  const details = document.createElement("div");
  details.className = "meta editor-meta";
  const matched = isAccountMatchCurrentDomain(account, currentDomain);
  const statusBadge = matched ? '<span class="badge">当前站点可用</span>' : "";
  details.innerHTML =
    `通行秘钥: ${(account.passkeyCredentialIds || []).length} 个 | 通行秘钥更新时间：${formatTime(account.passkeyUpdatedAtMs)}<br/>` +
    `创建: ${formatTime(account.createdAtMs)} | 更新: ${formatTime(account.updatedAtMs)}<br/>` +
    `删除: ${formatTime(account.deletedAtMs)}<br/>` +
    `用户名更新时间：${formatTime(account.usernameUpdatedAtMs)} | 密码更新时间：${formatTime(account.passwordUpdatedAtMs)}<br/>` +
    `TOTP更新时间：${formatTime(account.totpUpdatedAtMs)} | 恢复码更新时间：${formatTime(account.recoveryCodesUpdatedAtMs)} | 备注更新时间：${formatTime(account.noteUpdatedAtMs)}<br/>` +
    `${statusBadge}`;
  editor.appendChild(details);

  const buttons = document.createElement("div");
  buttons.className = "actions";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "保存编辑";
  saveBtn.addEventListener("click", async () => {
    await saveAccountEdit(account.accountId, {
      sitesText: sitesInput.value,
      username: usernameInput.value,
      password: passwordInput.value,
      totpSecret: totpInput.value,
      recoveryCodes: recoveryInput.value,
      note: noteInput.value,
    });
  });
  buttons.appendChild(saveBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", () => {
    editingAccountId = null;
    renderAccounts();
  });
  buttons.appendChild(cancelBtn);

  editor.appendChild(buttons);
  return editor;
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

async function createAccountFromInputs() {
  const sites = parseSites(dom.createSiteInput.value);
  const username = dom.createUsernameInput.value.trim();
  const password = dom.createPasswordInput.value;

  if (sites.length === 0) {
    setStatus("站点别名不能为空");
    return;
  }
  if (!username) {
    setStatus("用户名不能为空");
    return;
  }
  if (!password) {
    setStatus("密码不能为空");
    return;
  }

  const createdAtMs = Date.now();
  const deviceName = await getDeviceName();
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  next.push(
    createAccount({
      site: sites[0],
      sites,
      username,
      password,
      createdAtMs,
      deviceName,
    })
  );

  const synced = syncAliasGroups(next);
  await persistAccounts(synced);
  dom.createSiteInput.value = "";
  dom.createUsernameInput.value = "";
  dom.createPasswordInput.value = "";
  closeCreateModal();
  setStatus("账号已创建");
  renderAccounts();
}

async function addCurrentDomainToAccount(accountId) {
  const domain = normalizeDomain(currentDomain);
  if (!domain) {
    setStatus("当前页面没有可用域名");
    return;
  }

  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }

  if (!target.sites.includes(domain)) {
    target.sites.push(domain);
    target.sites = normalizeSites(target.sites);
    target.updatedAtMs = Date.now();
  }

  const synced = syncAliasGroups(next);
  await persistAccounts(synced);
  setStatus(`已将 ${domain} 加入账号别名组并自动同步`);
  renderAccounts();
}

async function saveAccountEdit(accountId, draft) {
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到编辑账号");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  let changed = false;

  const nextSites = parseSites(draft.sitesText);
  if (nextSites.length > 0 && JSON.stringify(nextSites) !== JSON.stringify(target.sites)) {
    target.sites = nextSites;
    changed = true;
  }

  const nextUsername = draft.username.trim();
  if (nextUsername && nextUsername !== target.username) {
    target.username = nextUsername;
    target.usernameUpdatedAtMs = now;
    changed = true;
  }

  if (draft.password !== target.password) {
    target.password = draft.password;
    target.passwordUpdatedAtMs = now;
    changed = true;
  }

  if (draft.totpSecret !== target.totpSecret) {
    target.totpSecret = draft.totpSecret;
    target.totpUpdatedAtMs = now;
    changed = true;
  }

  if (draft.recoveryCodes !== target.recoveryCodes) {
    target.recoveryCodes = draft.recoveryCodes;
    target.recoveryCodesUpdatedAtMs = now;
    changed = true;
  }

  if (draft.note !== target.note) {
    target.note = draft.note;
    target.noteUpdatedAtMs = now;
    changed = true;
  }

  if (!changed) {
    setStatus("没有可保存的变更");
    return;
  }

  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  const synced = syncAliasGroups(next);
  await persistAccounts(synced);
  editingAccountId = null;
  setStatus("账号编辑已保存");
  renderAccounts();
}

async function moveToRecycleBin(accountId) {
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }

  if (target.isDeleted) {
    setStatus("账号已在回收站");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  target.isDeleted = true;
  target.deletedAtMs = now;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  await persistAccounts(next);
  setStatus("账号已移入回收站");
  renderAccounts();
}

async function restoreFromRecycleBin(accountId) {
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }

  if (!target.isDeleted) {
    setStatus("该账号不在回收站");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  target.isDeleted = false;
  target.deletedAtMs = null;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  await persistAccounts(next);
  setStatus("账号已从回收站恢复");
  renderAccounts();
}

async function permanentlyDelete(accountId) {
  const target = accounts.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }
  if (!target.isDeleted) {
    setStatus("仅支持在回收站中永久删除");
    return;
  }

  const next = accounts.filter((item) => item.accountId !== accountId);
  if (editingAccountId === accountId) {
    editingAccountId = null;
  }
  await persistAccounts(next);
  setStatus(`账号已永久删除: ${accountId}`);
  renderAccounts();
}

async function deletePasskey(credentialIdB64u) {
  const targetId = normalizePasskeyId(credentialIdB64u);
  if (!targetId) {
    setStatus("通行秘钥 ID 非法");
    return;
  }

  const now = Date.now();
  const next = passkeys.filter((item) => item.credentialIdB64u !== targetId);
  let accountsChanged = false;
  const nextAccounts = accounts.map((account) => {
    const ids = normalizePasskeyCredentialIds(account.passkeyCredentialIds || []);
    if (!ids.includes(targetId)) {
      return account;
    }
    accountsChanged = true;
    return {
      ...account,
      passkeyCredentialIds: ids.filter((id) => id !== targetId),
      passkeyUpdatedAtMs: now,
      updatedAtMs: now,
    };
  });

  if (next.length === passkeys.length && !accountsChanged) {
    setStatus("未找到目标通行秘钥");
    return;
  }

  if (next.length !== passkeys.length) {
    await persistPasskeys(next);
  }
  if (accountsChanged) {
    await persistAccounts(nextAccounts);
  }
  setStatus(`通行秘钥已移除: ${shortenMiddle(targetId, 16)}`);
  renderAccounts();
}

async function fillCurrentPage(account) {
  const response = await chrome.runtime.sendMessage({
    type: "PASS_FILL_ACTIVE_TAB",
    payload: { username: account.username, password: account.password },
  });

  if (response?.ok) {
    setStatus("已向当前网页注入填充动作");
  } else {
    setStatus(`填充失败: ${response?.error || "未知错误"}`);
  }
}

function createAccount({ site, sites = [], username, password, createdAtMs, deviceName }) {
  const normalizedSites = normalizeSites(Array.isArray(sites) && sites.length > 0 ? sites : [site]);
  const canonical = etldPlusOne(normalizedSites[0] || normalizeDomain(site));
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
    sites: normalizedSites,
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

function isPinnedAccount(account) {
  return Boolean(account?.isPinned);
}

function compareAccountsForDisplay(lhs, rhs) {
  const lhsPinned = isPinnedAccount(lhs);
  const rhsPinned = isPinnedAccount(rhs);
  if (lhsPinned !== rhsPinned) {
    return lhsPinned ? -1 : 1;
  }

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

  const lhsUpdatedAt = Number(lhs?.updatedAtMs || 0);
  const rhsUpdatedAt = Number(rhs?.updatedAtMs || 0);
  if (lhsUpdatedAt !== rhsUpdatedAt) return rhsUpdatedAt - lhsUpdatedAt;

  const lhsCreatedAt = Number(lhs?.createdAtMs || 0);
  const rhsCreatedAt = Number(rhs?.createdAtMs || 0);
  if (lhsCreatedAt !== rhsCreatedAt) return rhsCreatedAt - lhsCreatedAt;

  return String(lhs?.accountId || "").localeCompare(String(rhs?.accountId || ""));
}

function sortAccountsForDisplay(inputAccounts) {
  return [...(Array.isArray(inputAccounts) ? inputAccounts : [])].sort(compareAccountsForDisplay);
}

async function togglePin(accountId) {
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const target = next.find((item) => item.accountId === accountId);
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }
  if (target.isDeleted) {
    setStatus("回收站账号不支持置顶");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  const nextPinned = !isPinnedAccount(target);
  target.isPinned = nextPinned;
  if (nextPinned) {
    const maxOrder = next
      .filter((item) => !item.isDeleted && isPinnedAccount(item))
      .reduce((maxValue, item) => Math.max(maxValue, Number(item.pinnedSortOrder ?? -1)), -1);
    target.pinnedSortOrder = maxOrder + 1;
  } else {
    target.pinnedSortOrder = null;
    target.regularSortOrder = null;
  }
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  await persistAccounts(next);
  setStatus(nextPinned ? "账号已置顶" : "已取消置顶");
  renderAccounts();
}

async function reorderAccount(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;

  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  const source = next.find((item) => item.accountId === sourceId);
  const target = next.find((item) => item.accountId === targetId);
  if (!source || !target) return;
  if (source.isDeleted || target.isDeleted) return;

  const pinned = isPinnedAccount(source);
  if (isPinnedAccount(target) !== pinned) {
    setStatus("仅支持 置顶、非置顶 项目内部排序");
    return;
  }

  const group = sortAccountsForDisplay(
    next.filter((item) => !item.isDeleted && isPinnedAccount(item) === pinned)
  );
  const orderedIds = group.map((item) => item.accountId);
  const from = orderedIds.indexOf(sourceId);
  const to = orderedIds.indexOf(targetId);
  if (from < 0 || to < 0) return;
  orderedIds.splice(from, 1);
  orderedIds.splice(to, 0, sourceId);

  const now = Date.now();
  const deviceName = await getDeviceName();
  for (let i = 0; i < orderedIds.length; i += 1) {
    const id = orderedIds[i];
    const item = next.find((entry) => entry.accountId === id);
    if (!item) continue;
    if (pinned) {
      item.pinnedSortOrder = i;
    } else {
      item.regularSortOrder = i;
    }
    item.updatedAtMs = now;
    item.lastOperatedDeviceName = deviceName;
  }

  await persistAccounts(next);
  renderAccounts();
}

function parseSites(raw) {
  return normalizeSites(
    raw
      .split(/[\s,;\n\t]+/g)
      .map((value) => value.trim())
      .filter(Boolean)
  );
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

function normalizePasskeyId(value) {
  return String(value || "").trim();
}

function normalizePasskeyCredentialIds(input) {
  const values = Array.isArray(input) ? input : [];
  return [...new Set(values.map(normalizePasskeyId).filter(Boolean))].sort();
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function isAccountMatchCurrentDomain(account, domain) {
  if (!domain) return false;
  const normalizedCurrent = normalizeDomain(domain);
  const currentEtld1 = etldPlusOne(normalizedCurrent);
  const sites = normalizeSites(account.sites || []);
  return sites.some((site) => site === normalizedCurrent || etldPlusOne(site) === currentEtld1);
}

function matchRpIdWithDomain(rpId, domain) {
  const normalizedRpId = normalizeDomain(rpId);
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedRpId || !normalizedDomain) return false;
  return normalizedDomain === normalizedRpId || normalizedDomain.endsWith(`.${normalizedRpId}`);
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
    haystacks.push((account.sites || []).join(" "), account.canonicalSite);
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

function onAccountSearchFieldAllChanged() {
  if (dom.accountSearchFieldAll.checked) {
    accountSearchUseAll = true;
    accountSearchFields = new Set();
  } else {
    accountSearchUseAll = false;
  }
  syncAccountSearchFieldCheckboxes();
  renderAccounts();
}

function onAccountSearchFieldChanged() {
  const next = new Set();
  if (dom.accountSearchFieldUsername.checked) next.add("username");
  if (dom.accountSearchFieldSites.checked) next.add("sites");
  if (dom.accountSearchFieldNote.checked) next.add("note");
  if (dom.accountSearchFieldPassword.checked) next.add("password");
  accountSearchUseAll = false;
  accountSearchFields = next;
  syncAccountSearchFieldCheckboxes();
  renderAccounts();
}

function syncAccountSearchFieldCheckboxes() {
  dom.accountSearchFieldUsername.checked = accountSearchFields.has("username");
  dom.accountSearchFieldSites.checked = accountSearchFields.has("sites");
  dom.accountSearchFieldNote.checked = accountSearchFields.has("note");
  dom.accountSearchFieldPassword.checked = accountSearchFields.has("password");
  dom.accountSearchFieldAll.checked = accountSearchUseAll;
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

function buildAccountId(canonicalSite, username, createdAtMs) {
  return `${canonicalSite}-${formatYYMMDDHHmmss(createdAtMs)}-${username}`;
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
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function toMultilineHtml(value) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) return "-";
  return escapeHtml(text).replaceAll("\n", "<br/>");
}

function shortenMiddle(value, keep = 18) {
  const text = String(value || "");
  if (text.length <= keep) return text;
  const head = Math.max(4, Math.floor(keep / 2));
  const tail = Math.max(4, keep - head);
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function setStatus(message) {
  dom.status.textContent = message;
}

function hasTotpSecret(value) {
  return String(value || "").trim().length > 0;
}

function createTotpCopyButton({ accountId, username, totpSecret }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "totp-copy-button";
  button.dataset.passTotpSecret = String(totpSecret || "");
  button.dataset.passTotpAccountId = String(accountId || "");
  button.dataset.passTotpCode = "";
  button.textContent = "验证码: 计算中...";
  button.addEventListener("click", async () => {
    const code = String(button.dataset.passTotpCode || "");
    if (!code) {
      setStatus("验证码暂不可用");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      const label = String(username || accountId || "");
      setStatus(`验证码已复制: ${label}`);
    } catch (error) {
      setStatus(`复制验证码失败: ${error.message}`);
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
  if (viewMode === "passkeys") return;
  const buttons = Array.from(document.querySelectorAll(".totp-copy-button[data-pass-totp-secret]"));
  if (buttons.length === 0) return;

  const bySecret = new Map();
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
    const result = secret === "__invalid__"
      ? null
      : await generateTotpCode(secret, Date.now());
    for (const button of group) {
      applyTotpResultToButton(button, result);
    }
  }
}

function applyTotpResultToButton(button, result) {
  if (!(button instanceof HTMLButtonElement)) return;
  if (!button.isConnected) return;

  if (!result) {
    button.textContent = "验证码: TOTP 密钥无效";
    button.dataset.passTotpCode = "";
    button.disabled = true;
    button.classList.add("totp-invalid");
    return;
  }

  button.textContent = `验证码: ${result.code} (${result.remainingSeconds}s)`;
  button.dataset.passTotpCode = result.code;
  button.disabled = false;
  button.classList.remove("totp-invalid");
}

function normalizeTotpSecret(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replaceAll(" ", "")
    .replaceAll("-", "")
    .replace(/=+$/g, "");
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
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
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

  const counter = BigInt(Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS));
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

  const offset = signature[signature.length - 1] & 0x0f;
  if (offset + 3 >= signature.length) return null;

  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  const code = String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
  const remainingSeconds = TOTP_PERIOD_SECONDS - (Math.floor(nowMs / 1000) % TOTP_PERIOD_SECONDS);
  return { code, remainingSeconds };
}
