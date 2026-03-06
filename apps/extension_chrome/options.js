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
  deviceName: document.getElementById("deviceName"),
  saveDeviceNameBtn: document.getElementById("saveDeviceName"),
  deviceStatus: document.getElementById("deviceStatus"),
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
  allAccountsSearchWrap: document.getElementById("allAccountsSearchWrap"),
  allAccountsSearchFieldsBtn: document.getElementById("allAccountsSearchFieldsBtn"),
  allAccountsSearchFieldsPanel: document.getElementById("allAccountsSearchFieldsPanel"),
  allAccountsSearchFieldAll: document.getElementById("allAccountsSearchFieldAll"),
  allAccountsSearchFieldUsername: document.getElementById("allAccountsSearchFieldUsername"),
  allAccountsSearchFieldSites: document.getElementById("allAccountsSearchFieldSites"),
  allAccountsSearchFieldNote: document.getElementById("allAccountsSearchFieldNote"),
  allAccountsSearchFieldPassword: document.getElementById("allAccountsSearchFieldPassword"),
  allAccountsSearch: document.getElementById("allAccountsSearch"),
  clearActiveAccountsBtn: document.getElementById("clearActiveAccounts"),
  clearRecycleBinBtn: document.getElementById("clearRecycleBin"),
  payload: document.getElementById("payload"),
  refreshBtn: document.getElementById("refreshBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  clearBtn: document.getElementById("clearBtn"),
  status: document.getElementById("status"),
};

let accountsRaw = [];
let passkeysRaw = [];
let editingAccountId = null;
let totpRefreshTimer = null;
let accountSearchUseAll = true;
let accountSearchFields = new Set();
let activeAccountView = "all";
let draggingAccountId = "";

init().catch((error) => {
  setStatus(`初始化失败: ${error.message}`);
});

async function init() {
  await loadDeviceName();
  await refresh();
  startTotpRefreshTicker();

  dom.saveDeviceNameBtn.addEventListener("click", saveDeviceName);
  dom.accountsTabAll.addEventListener("click", () => setAccountView("all"));
  dom.accountsTabPasskey.addEventListener("click", () => setAccountView("passkeys"));
  dom.accountsTabTotp.addEventListener("click", () => setAccountView("totp"));
  dom.accountsTabRecycle.addEventListener("click", () => setAccountView("recycle"));
  dom.allAccountsSearch.addEventListener("input", () => renderCurrentView(accountsRaw));
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
    if (dom.allAccountsSearchFieldsPanel.classList.contains("hidden")) return;
    const wrap = dom.allAccountsSearchFieldsPanel.closest(".search-filter-wrap");
    if (wrap && wrap.contains(event.target)) return;
    closeAllAccountsSearchFieldsPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dom.allAccountsSearchFieldsPanel.classList.contains("hidden")) {
      closeAllAccountsSearchFieldsPanel();
    }
  });
  dom.clearActiveAccountsBtn.addEventListener("click", clearActiveAccounts);
  dom.clearRecycleBinBtn.addEventListener("click", clearRecycleBin);
  dom.refreshBtn.addEventListener("click", () => refresh());
  dom.exportBtn.addEventListener("click", exportJson);
  dom.importBtn.addEventListener("click", importJson);
  dom.clearBtn.addEventListener("click", clearAll);
}

async function loadDeviceName() {
  const result = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  dom.deviceName.value = String(result[STORAGE_KEY_DEVICE_NAME] || "ChromeMac");
}

async function saveDeviceName() {
  const next = String(dom.deviceName.value || "").trim();
  if (!next) {
    setDeviceStatus("设备名称不能为空");
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: next });
  setDeviceStatus(`设备名称已保存为 ${next}`);
}

async function refresh({ silent = false } = {}) {
  const result = await chrome.storage.local.get([STORAGE_KEY_ACCOUNTS, STORAGE_KEY_PASSKEYS]);
  const accounts = Array.isArray(result[STORAGE_KEY_ACCOUNTS]) ? result[STORAGE_KEY_ACCOUNTS] : [];
  const passkeys = Array.isArray(result[STORAGE_KEY_PASSKEYS]) ? result[STORAGE_KEY_PASSKEYS] : [];

  accountsRaw = cloneAccounts(accounts);
  passkeysRaw = passkeys.map((item) => ({ ...item }));

  dom.payload.value = JSON.stringify({ accounts: accountsRaw, passkeys: passkeysRaw }, null, 2);
  renderSidebar(accountsRaw);
  renderCurrentView(accountsRaw);
  setAccountView(activeAccountView);

  if (!silent) {
    setStatus(`已加载 ${accountsRaw.length} 条账号，${passkeysRaw.length} 条通行秘钥`);
  }
}

async function exportJson() {
  const text = dom.payload.value;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pass-extension-data.json";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("已导出 JSON");
}

async function importJson() {
  let parsed;
  try {
    parsed = JSON.parse(dom.payload.value);
  } catch (error) {
    setStatus(`JSON 格式错误: ${error.message}`);
    return;
  }

  const accounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
  const passkeys = Array.isArray(parsed.passkeys) ? parsed.passkeys : [];
  await chrome.storage.local.set({
    [STORAGE_KEY_ACCOUNTS]: accounts,
    [STORAGE_KEY_PASSKEYS]: passkeys,
  });

  editingAccountId = null;
  await refresh({ silent: true });
  setStatus(`导入完成，共 ${accounts.length} 条账号，${passkeys.length} 条通行秘钥`);
}

async function clearAll() {
  await chrome.storage.local.set({
    [STORAGE_KEY_ACCOUNTS]: [],
    [STORAGE_KEY_PASSKEYS]: [],
  });
  editingAccountId = null;
  await refresh({ silent: true });
  setStatus("账号与通行秘钥已清空");
}

async function clearActiveAccounts() {
  const activeCount = accountsRaw.filter((item) => !item.isDeleted).length;
  if (activeCount === 0) {
    setStatus("账号列表为空，无需删除");
    return;
  }

  const confirmed = window.confirm(
    `将把账号列表中的 ${activeCount} 条记录移入回收站，是否继续？`
  );
  if (!confirmed) {
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  const next = cloneAccounts(accountsRaw).map((account) => {
    if (account.isDeleted) return account;
    return {
      ...account,
      isDeleted: true,
      deletedAtMs: now,
      updatedAtMs: now,
      lastOperatedDeviceName: deviceName,
    };
  });

  editingAccountId = null;
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: next });
  await refresh({ silent: true });
  setStatus(`已将 ${activeCount} 条账号移入回收站`);
}

async function clearRecycleBin() {
  const deletedCount = accountsRaw.filter((item) => item.isDeleted).length;
  if (deletedCount === 0) {
    setStatus("回收站为空，无需清空");
    return;
  }

  const confirmed = window.confirm(
    `将永久删除回收站中的 ${deletedCount} 条记录，此操作不可恢复。是否继续？`
  );
  if (!confirmed) {
    return;
  }

  const next = cloneAccounts(accountsRaw).filter((account) => !account.isDeleted);
  editingAccountId = null;
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: next });
  await refresh({ silent: true });
  setStatus(`已清空回收站，永久删除 ${deletedCount} 条记录`);
}

function renderAllAccounts(inputAccounts) {
  let accounts = sortAccountsForDisplay(
    (Array.isArray(inputAccounts) ? inputAccounts : [])
      .map(normalizeAccountShape)
      .filter((account) => !account.isDeleted)
  );
  const query = String(dom.allAccountsSearch.value || "").trim().toLowerCase();
  if (query) {
    accounts = accounts.filter((account) => isAccountMatchSearch(account, query));
  }

  dom.allAccountsCount.textContent = `(${accounts.length})`;
  dom.allAccountsList.innerHTML = "";

  if (accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无账号";
    dom.allAccountsList.appendChild(empty);
    return;
  }

  for (const account of accounts) {
    const card = document.createElement("article");
    card.className = "account";
    card.draggable = true;

    const titleRow = document.createElement("div");
    titleRow.className = "account-title-row";
    const title = document.createElement("strong");
    title.textContent = account.accountId;
    titleRow.appendChild(title);

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = "pin-btn";
    pinBtn.textContent = isPinnedAccount(account) ? "取消置顶" : "置顶";
    pinBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await togglePin(account.accountId);
    });
    titleRow.appendChild(pinBtn);
    card.appendChild(titleRow);

    card.addEventListener("dragstart", (event) => {
      draggingAccountId = account.accountId;
      event.dataTransfer?.setData("text/plain", account.accountId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
    });
    card.addEventListener("dragover", (event) => {
      const source = accountsRaw.find((item) => String(item?.accountId || "") === draggingAccountId);
      if (!source) return;
      if (isPinnedAccount(source) !== isPinnedAccount(account)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });
    card.addEventListener("drop", async (event) => {
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
    const sitesMultilineHtml = toMultilineHtml(account.sites.join("\n"));
    const recoveryMultilineHtml = toMultilineHtml(account.recoveryCodes || "-");
    meta.innerHTML =
      `用户名: ${escapeHtml(account.username || "-")}<br/>` +
      `站点别名:<div class="meta-multiline">${sitesMultilineHtml}</div>` +
      `恢复码:<div class="meta-multiline">${recoveryMultilineHtml}</div>` +
      `通行秘钥: ${account.passkeyCredentialIds.length} 个<br/>` +
      `创建: ${formatTime(account.createdAtMs)} | 更新: ${formatTime(account.updatedAtMs)}<br/>` +
      `删除: ${formatTime(account.deletedAtMs)}<br/>`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "account-actions";
    const totpCopyBtn = hasTotpSecret(account.totpSecret)
      ? createTotpCopyButton({
        accountId: account.accountId,
        username: account.username,
        totpSecret: account.totpSecret,
      })
      : null;

    const editBtn = document.createElement("button");
    editBtn.textContent = editingAccountId === account.accountId ? "收起编辑" : "编辑";
    editBtn.addEventListener("click", () => {
      editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
      renderAllAccounts(accountsRaw);
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "button-danger";
    deleteBtn.textContent = account.isDeleted ? "永久删除" : "删除";
    deleteBtn.addEventListener("click", async () => {
      await deleteAccountFromAll(account.accountId);
    });
    actions.appendChild(deleteBtn);

    if (totpCopyBtn) {
      actions.appendChild(totpCopyBtn);
    }

    card.appendChild(actions);

    if (editingAccountId === account.accountId) {
      card.appendChild(buildAccountEditor(account));
    }

    dom.allAccountsList.appendChild(card);
  }

  void refreshVisibleTotpButtons();
}

function renderRecycleAccounts(inputAccounts) {
  const accounts = (Array.isArray(inputAccounts) ? inputAccounts : [])
    .map(normalizeAccountShape)
    .filter((account) => account.isDeleted)
    .sort(
      (a, b) =>
        Number(b.deletedAtMs || b.updatedAtMs || 0) - Number(a.deletedAtMs || a.updatedAtMs || 0)
    );

  dom.recycleAccountsCount.textContent = `(${accounts.length})`;
  dom.recycleAccountsList.innerHTML = "";

  if (accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "回收站为空";
    dom.recycleAccountsList.appendChild(empty);
    void refreshVisibleTotpButtons();
    return;
  }

  for (const account of accounts) {
    const card = document.createElement("article");
    card.className = "account";

    const title = document.createElement("strong");
    title.textContent = account.accountId;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    const sitesMultilineHtml = toMultilineHtml(account.sites.join("\n"));
    const recoveryMultilineHtml = toMultilineHtml(account.recoveryCodes || "-");
    meta.innerHTML =
      `用户名: ${escapeHtml(account.username || "-")}<br/>` +
      `站点别名:<div class="meta-multiline">${sitesMultilineHtml}</div>` +
      `恢复码:<div class="meta-multiline">${recoveryMultilineHtml}</div>` +
      `通行秘钥: ${account.passkeyCredentialIds.length} 个<br/>` +
      `创建: ${formatTime(account.createdAtMs)} | 更新: ${formatTime(account.updatedAtMs)}<br/>` +
      `删除: ${formatTime(account.deletedAtMs)}<br/>`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "account-actions";

    const restoreBtn = document.createElement("button");
    restoreBtn.textContent = "恢复";
    restoreBtn.addEventListener("click", async () => {
      await restoreDeletedAccount(account.accountId);
    });
    actions.appendChild(restoreBtn);

    const permanentDeleteBtn = document.createElement("button");
    permanentDeleteBtn.className = "button-danger";
    permanentDeleteBtn.textContent = "永久删除";
    permanentDeleteBtn.addEventListener("click", async () => {
      await permanentlyDeleteAccount(account.accountId);
    });
    actions.appendChild(permanentDeleteBtn);

    card.appendChild(actions);

    if (hasTotpSecret(account.totpSecret)) {
      card.appendChild(
        createTotpCopyButton({
          accountId: account.accountId,
          username: account.username,
          totpSecret: account.totpSecret,
        })
      );
    }

    dom.recycleAccountsList.appendChild(card);
  }

  void refreshVisibleTotpButtons();
}

function renderSidebar(inputAccounts) {
  const accounts = (Array.isArray(inputAccounts) ? inputAccounts : []).map(normalizeAccountShape);
  const active = accounts.filter((item) => !item.isDeleted);
  const recycle = accounts.filter((item) => item.isDeleted);
  const passkeys = active.filter((item) => (item.passkeyCredentialIds || []).length > 0);
  const totp = active.filter((item) => hasTotpSecret(item.totpSecret));

  dom.allAccountsCount.textContent = `(${active.length})`;
  dom.passkeyAccountsCount.textContent = `(${passkeys.length})`;
  dom.totpAccountsCount.textContent = `(${totp.length})`;
  dom.recycleAccountsCount.textContent = `(${recycle.length})`;

  const folderMap = new Map();
  for (const account of active) {
    const ids = Array.isArray(account.folderIds) && account.folderIds.length > 0
      ? account.folderIds
      : (account.folderId ? [account.folderId] : []);
    for (const id of ids) {
      const key = String(id || "").trim();
      if (!key) continue;
      const prev = folderMap.get(key) || 0;
      folderMap.set(key, prev + 1);
    }
  }

  const folderEntries = Array.from(folderMap.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => a.id.localeCompare(b.id));
  dom.accountsFolderList.innerHTML = "";
  if (folderEntries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无文件夹";
    dom.accountsFolderList.appendChild(empty);
    return;
  }

  for (const folder of folderEntries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-view-tab";
    button.dataset.view = `folder:${folder.id}`;
    button.textContent = `文件夹 ${folder.id.slice(0, 8)} (${folder.count})`;
    button.addEventListener("click", () => setAccountView(`folder:${folder.id}`));
    dom.accountsFolderList.appendChild(button);
  }
}

function currentViewAccounts(inputAccounts) {
  const accounts = (Array.isArray(inputAccounts) ? inputAccounts : []).map(normalizeAccountShape);
  const active = accounts.filter((item) => !item.isDeleted);
  const recycle = accounts.filter((item) => item.isDeleted);

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
    const folderId = String(activeAccountView).slice("folder:".length);
    return active.filter((item) => {
      const ids = Array.isArray(item.folderIds) && item.folderIds.length > 0
        ? item.folderIds.map((id) => String(id || ""))
        : (item.folderId ? [String(item.folderId)] : []);
      return ids.includes(folderId);
    });
  }
  return active;
}

function renderCurrentView(inputAccounts) {
  let accounts = sortAccountsForDisplay(currentViewAccounts(inputAccounts));
  const query = String(dom.allAccountsSearch.value || "").trim().toLowerCase();
  if (query) {
    accounts = accounts.filter((account) => isAccountMatchSearch(account, query));
  }

  dom.allAccountsList.innerHTML = "";
  if (accounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "暂无账号";
    dom.allAccountsList.appendChild(empty);
    return;
  }

  const isRecycle = activeAccountView === "recycle";
  for (const account of accounts) {
    const card = document.createElement("article");
    card.className = "account";
    card.draggable = !isRecycle;

    const titleRow = document.createElement("div");
    titleRow.className = "account-title-row";
    const title = document.createElement("strong");
    title.textContent = account.accountId;
    titleRow.appendChild(title);
    if (!isRecycle) {
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "pin-btn";
      pinBtn.textContent = isPinnedAccount(account) ? "取消置顶" : "置顶";
      pinBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await togglePin(account.accountId);
      });
      titleRow.appendChild(pinBtn);
    }
    card.appendChild(titleRow);

    card.addEventListener("dragstart", (event) => {
      if (isRecycle) return;
      draggingAccountId = account.accountId;
      event.dataTransfer?.setData("text/plain", account.accountId);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
    });
    card.addEventListener("dragover", (event) => {
      if (isRecycle) return;
      const source = accountsRaw.find((item) => String(item?.accountId || "") === draggingAccountId);
      if (!source) return;
      if (isPinnedAccount(source) !== isPinnedAccount(account)) return;
      event.preventDefault();
    });
    card.addEventListener("drop", async (event) => {
      if (isRecycle) return;
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
    const sitesMultilineHtml = toMultilineHtml(account.sites.join("\n"));
    const recoveryMultilineHtml = toMultilineHtml(account.recoveryCodes || "-");
    meta.innerHTML =
      `用户名: ${escapeHtml(account.username || "-")}<br/>` +
      `站点别名:<div class="meta-multiline">${sitesMultilineHtml}</div>` +
      `恢复码:<div class="meta-multiline">${recoveryMultilineHtml}</div>` +
      `通行秘钥: ${account.passkeyCredentialIds.length} 个<br/>` +
      `创建: ${formatTime(account.createdAtMs)} | 更新: ${formatTime(account.updatedAtMs)}<br/>` +
      `删除: ${formatTime(account.deletedAtMs)}<br/>`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "account-actions";
    const totpCopyBtn = hasTotpSecret(account.totpSecret)
      ? createTotpCopyButton({
        accountId: account.accountId,
        username: account.username,
        totpSecret: account.totpSecret,
      })
      : null;

    if (!isRecycle) {
      const editBtn = document.createElement("button");
      editBtn.textContent = editingAccountId === account.accountId ? "收起编辑" : "编辑";
      editBtn.addEventListener("click", () => {
        editingAccountId = editingAccountId === account.accountId ? null : account.accountId;
        renderCurrentView(accountsRaw);
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "button-danger";
      deleteBtn.textContent = "删除";
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
      restoreBtn.textContent = "恢复";
      restoreBtn.addEventListener("click", async () => {
        await restoreDeletedAccount(account.accountId);
      });
      actions.appendChild(restoreBtn);

      const permanentDeleteBtn = document.createElement("button");
      permanentDeleteBtn.className = "button-danger";
      permanentDeleteBtn.textContent = "永久删除";
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

  if (isRecycle) {
    closeAllAccountsSearchFieldsPanel();
  }

  renderCurrentView(accountsRaw);
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

function onAllAccountSearchFieldAllChanged() {
  if (dom.allAccountsSearchFieldAll.checked) {
    accountSearchUseAll = true;
    accountSearchFields = new Set();
  } else {
    accountSearchUseAll = false;
  }
  syncAllAccountSearchFieldCheckboxes();
  renderCurrentView(accountsRaw);
}

function onAllAccountSearchFieldChanged() {
  const next = new Set();
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

  const actions = document.createElement("div");
  actions.className = "account-actions";

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
  actions.appendChild(saveBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "取消";
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
    setStatus("未找到编辑账号");
    return;
  }

  const now = Date.now();
  const deviceName = await getDeviceName();
  let changed = false;

  const nextSites = parseSites(draft.sitesText);
  const prevSites = normalizeSites(target.sites || []);
  if (nextSites.length > 0 && JSON.stringify(nextSites) !== JSON.stringify(prevSites)) {
    target.sites = nextSites;
    changed = true;
  }

  const nextUsername = normalizeUsername(draft.username);
  if (nextUsername && nextUsername !== String(target.username || "")) {
    target.username = nextUsername;
    target.usernameUpdatedAtMs = now;
    changed = true;
  }

  if (String(draft.password || "") !== String(target.password || "")) {
    target.password = String(draft.password || "");
    target.passwordUpdatedAtMs = now;
    changed = true;
  }

  if (String(draft.totpSecret || "") !== String(target.totpSecret || "")) {
    target.totpSecret = String(draft.totpSecret || "");
    target.totpUpdatedAtMs = now;
    changed = true;
  }

  if (String(draft.recoveryCodes || "") !== String(target.recoveryCodes || "")) {
    target.recoveryCodes = String(draft.recoveryCodes || "");
    target.recoveryCodesUpdatedAtMs = now;
    changed = true;
  }

  if (String(draft.note || "") !== String(target.note || "")) {
    target.note = String(draft.note || "");
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
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: synced });
  editingAccountId = null;
  await refresh({ silent: true });
  setStatus("账号编辑已保存");
}

async function deleteAccountFromAll(accountId) {
  const next = cloneAccounts(accountsRaw);
  const index = next.findIndex((item) => String(item.accountId || "") === String(accountId));
  if (index < 0) {
    setStatus("未找到目标账号");
    return;
  }

  const target = next[index];
  if (target.isDeleted) {
    const confirmed = window.confirm(`将永久删除账号：${target.accountId}\n此操作不可恢复，是否继续？`);
    if (!confirmed) return;

    next.splice(index, 1);
    if (editingAccountId === target.accountId) {
      editingAccountId = null;
    }
    await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: next });
    await refresh({ silent: true });
    setStatus(`已永久删除账号: ${target.accountId}`);
    return;
  }

  const confirmed = window.confirm(`将把账号移入回收站：${target.accountId}\n是否继续？`);
  if (!confirmed) return;

  const now = Date.now();
  const deviceName = await getDeviceName();
  target.isDeleted = true;
  target.deletedAtMs = now;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = deviceName;
  if (editingAccountId === target.accountId) {
    editingAccountId = null;
  }
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: next });
  await refresh({ silent: true });
  setStatus(`已移入回收站: ${target.accountId}`);
}

async function restoreDeletedAccount(accountId) {
  const next = cloneAccounts(accountsRaw);
  const target = next.find((item) => String(item.accountId || "") === String(accountId));
  if (!target) {
    setStatus("未找到目标账号");
    return;
  }
  if (!target.isDeleted) {
    setStatus("该账号不在回收站");
    return;
  }

  const confirmed = window.confirm(`将恢复账号：${target.accountId}\n是否继续？`);
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

  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: next });
  await refresh({ silent: true });
  setStatus(`已恢复账号: ${target.accountId}`);
}

async function permanentlyDeleteAccount(accountId) {
  const next = cloneAccounts(accountsRaw);
  const index = next.findIndex((item) => String(item.accountId || "") === String(accountId));
  if (index < 0) {
    setStatus("未找到目标账号");
    return;
  }

  const target = next[index];
  if (!target.isDeleted) {
    setStatus("仅支持在回收站中永久删除");
    return;
  }

  const confirmed = window.confirm(`将永久删除账号：${target.accountId}\n此操作不可恢复，是否继续？`);
  if (!confirmed) return;

  next.splice(index, 1);
  if (editingAccountId === target.accountId) {
    editingAccountId = null;
  }

  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: next });
  await refresh({ silent: true });
  setStatus(`已永久删除账号: ${target.accountId}`);
}

async function togglePin(accountId) {
  const next = cloneAccounts(accountsRaw);
  const target = next.find((item) => String(item.accountId || "") === String(accountId));
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

  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: next });
  await refresh({ silent: true });
  setStatus(nextPinned ? `账号已置顶: ${target.accountId}` : `已取消置顶: ${target.accountId}`);
}

async function reorderAccount(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;

  const next = cloneAccounts(accountsRaw).map(normalizeAccountShape);
  const source = next.find((item) => String(item.accountId || "") === String(sourceId));
  const target = next.find((item) => String(item.accountId || "") === String(targetId));
  if (!source || !target) return;
  if (source.isDeleted || target.isDeleted) return;

  const pinned = isPinnedAccount(source);
  if (isPinnedAccount(target) !== pinned) {
    setStatus("仅支持在同一分组内排序");
    return;
  }

  const group = sortAccountsForDisplay(
    next.filter((item) => !item.isDeleted && isPinnedAccount(item) === pinned)
  );
  const ids = group.map((item) => String(item.accountId || ""));
  const from = ids.indexOf(String(sourceId));
  const to = ids.indexOf(String(targetId));
  if (from < 0 || to < 0) return;
  ids.splice(from, 1);
  ids.splice(to, 0, String(sourceId));

  const now = Date.now();
  const deviceName = await getDeviceName();
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const item = next.find((entry) => String(entry.accountId || "") === id);
    if (!item) continue;
    if (pinned) {
      item.pinnedSortOrder = i;
    } else {
      item.regularSortOrder = i;
    }
    item.updatedAtMs = now;
    item.lastOperatedDeviceName = deviceName;
  }

  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: next });
  await refresh({ silent: true });
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
    sites: Array.isArray(account?.sites) ? [...account.sites] : [],
    passkeyCredentialIds: Array.isArray(account?.passkeyCredentialIds)
      ? [...account.passkeyCredentialIds]
      : [],
  }));
}

async function getDeviceName() {
  const result = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  const value = String(result[STORAGE_KEY_DEVICE_NAME] || "").trim();
  return value || "ChromeMac";
}

function normalizeAccountShape(account) {
  const now = Date.now();
  const sites = normalizeSites(account?.sites || []);
  const canonical = account?.canonicalSite || etldPlusOne(sites[0] || "");
  const createdAtMs = Number(account?.createdAtMs || account?.updatedAtMs || now);
  const username = String(account?.username || "");
  const passkeyCredentialIds = normalizePasskeyCredentialIds(account?.passkeyCredentialIds || []);

  return {
    accountId: String(account?.accountId || buildAccountId(canonical, username, createdAtMs)),
    canonicalSite: canonical,
    usernameAtCreate: String(account?.usernameAtCreate || username),
    isPinned: Boolean(account?.isPinned),
    pinnedSortOrder: account?.pinnedSortOrder == null ? null : Number(account.pinnedSortOrder),
    regularSortOrder: account?.regularSortOrder == null ? null : Number(account.regularSortOrder),
    folderId: account?.folderId == null ? null : String(account.folderId),
    folderIds: Array.isArray(account?.folderIds)
      ? account.folderIds.map((id) => String(id))
      : (account?.folderId == null ? [] : [String(account.folderId)]),
    sites,
    username,
    password: String(account?.password || ""),
    totpSecret: String(account?.totpSecret || ""),
    recoveryCodes: String(account?.recoveryCodes || ""),
    note: String(account?.note || ""),
    passkeyCredentialIds,
    usernameUpdatedAtMs: Number(account?.usernameUpdatedAtMs || createdAtMs),
    passwordUpdatedAtMs: Number(account?.passwordUpdatedAtMs || createdAtMs),
    totpUpdatedAtMs: Number(account?.totpUpdatedAtMs || createdAtMs),
    recoveryCodesUpdatedAtMs: Number(account?.recoveryCodesUpdatedAtMs || createdAtMs),
    noteUpdatedAtMs: Number(account?.noteUpdatedAtMs || createdAtMs),
    isDeleted: Boolean(account?.isDeleted),
    deletedAtMs: account?.deletedAtMs == null ? null : Number(account.deletedAtMs),
    createdAtMs,
    updatedAtMs: Number(account?.updatedAtMs || createdAtMs),
  };
}

function parseSites(raw) {
  return normalizeSites(
    String(raw || "")
      .split(/[\s,;\n\t]+/g)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

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
  const values = Array.isArray(sites) ? sites : [];
  return [...new Set(values.map(normalizeDomain).filter(Boolean))].sort();
}

function normalizePasskeyCredentialIds(input) {
  const values = Array.isArray(input) ? input : [];
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))].sort();
}

function normalizeUsername(value) {
  return String(value || "").trim();
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
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toMultilineHtml(value) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text) return "-";
  return escapeHtml(text).replaceAll("\n", "<br/>");
}

function setStatus(message) {
  dom.status.textContent = message;
}

function setDeviceStatus(message) {
  dom.deviceStatus.textContent = message;
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
