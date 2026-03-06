const STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
const STORAGE_KEY_ACCOUNTS = "pass.accounts";
const STORAGE_KEY_PASSKEYS = "pass.passkeys";
const STORAGE_KEY_FOLDERS = "pass.folders";
const FIXED_NEW_ACCOUNT_FOLDER_ID = "f16a2c4e-4a2a-43d5-a670-3f1767d41001";
const FIXED_NEW_ACCOUNT_FOLDER_NAME = "新账号";
const SYNC_BUNDLE_SCHEMA = "pass.sync.bundle.v1";

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
  exportSyncBundleBtn: document.getElementById("exportSyncBundleBtn"),
  importSyncBundleBtn: document.getElementById("importSyncBundleBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  clearBtn: document.getElementById("clearBtn"),
  status: document.getElementById("status"),
};

let accountsRaw = [];
let passkeysRaw = [];
let foldersRaw = [];
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
  dom.exportSyncBundleBtn.addEventListener("click", exportSyncBundle);
  dom.importSyncBundleBtn.addEventListener("click", importSyncBundleAndMerge);
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
  const result = await chrome.storage.local.get([
    STORAGE_KEY_ACCOUNTS,
    STORAGE_KEY_PASSKEYS,
    STORAGE_KEY_FOLDERS,
  ]);
  const accounts = Array.isArray(result[STORAGE_KEY_ACCOUNTS]) ? result[STORAGE_KEY_ACCOUNTS] : [];
  const passkeys = Array.isArray(result[STORAGE_KEY_PASSKEYS]) ? result[STORAGE_KEY_PASSKEYS] : [];
  const folders = Array.isArray(result[STORAGE_KEY_FOLDERS]) ? result[STORAGE_KEY_FOLDERS] : [];

  accountsRaw = cloneAccounts(accounts);
  passkeysRaw = passkeys.map(normalizePasskeyShape);
  foldersRaw = folders.map(normalizeFolderShape);

  dom.payload.value = JSON.stringify(
    { accounts: accountsRaw, passkeys: passkeysRaw, folders: foldersRaw },
    null,
    2
  );
  renderSidebar(accountsRaw);
  renderCurrentView(accountsRaw);
  setAccountView(activeAccountView);

  if (!silent) {
    setStatus(`已加载 ${accountsRaw.length} 条账号，${passkeysRaw.length} 条通行秘钥，${foldersRaw.length} 个文件夹`);
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

  const payload = parsed?.schema === SYNC_BUNDLE_SCHEMA && parsed?.payload && typeof parsed.payload === "object"
    ? parsed.payload
    : parsed;
  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
  const passkeys = Array.isArray(payload?.passkeys) ? payload.passkeys : [];
  const folders = Array.isArray(payload?.folders) ? payload.folders : [];
  await chrome.storage.local.set({
    [STORAGE_KEY_ACCOUNTS]: accounts,
    [STORAGE_KEY_PASSKEYS]: passkeys,
    [STORAGE_KEY_FOLDERS]: folders,
  });

  editingAccountId = null;
  await refresh({ silent: true });
  setStatus(`导入完成，共 ${accounts.length} 条账号，${passkeys.length} 条通行秘钥，${folders.length} 个文件夹`);
}

async function clearAll() {
  await chrome.storage.local.set({
    [STORAGE_KEY_ACCOUNTS]: [],
    [STORAGE_KEY_PASSKEYS]: [],
    [STORAGE_KEY_FOLDERS]: [],
  });
  editingAccountId = null;
  await refresh({ silent: true });
  setStatus("账号、通行秘钥与文件夹已清空");
}

async function exportSyncBundle() {
  const bundle = await buildSyncBundle();
  const fileName = `pass-sync-bundle-${formatFileTimestamp(bundle.exportedAtMs)}.json`;
  const text = JSON.stringify(bundle, null, 2);
  downloadTextFile(fileName, text, "application/json");
  setStatus(
    `同步包已导出：${bundle.payload.accounts.length} 条账号，` +
      `${bundle.payload.passkeys.length} 条通行秘钥，${bundle.payload.folders.length} 个文件夹`
  );
}

async function importSyncBundleAndMerge() {
  const file = await pickJsonFile();
  if (!file) {
    setStatus("已取消导入同步包");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    setStatus(`同步包 JSON 解析失败: ${error.message}`);
    return;
  }

  const incomingPayload = parseSyncBundlePayload(parsed);
  if (!incomingPayload) {
    setStatus("同步包格式错误，缺少 payload/accounts 字段");
    return;
  }

  const localStored = await chrome.storage.local.get([
    STORAGE_KEY_ACCOUNTS,
    STORAGE_KEY_PASSKEYS,
    STORAGE_KEY_FOLDERS,
  ]);
  const localAccounts = Array.isArray(localStored[STORAGE_KEY_ACCOUNTS])
    ? localStored[STORAGE_KEY_ACCOUNTS].map(normalizeAccountShape)
    : [];
  const localPasskeys = Array.isArray(localStored[STORAGE_KEY_PASSKEYS])
    ? localStored[STORAGE_KEY_PASSKEYS].map(normalizePasskeyShape)
    : [];
  const localFolders = Array.isArray(localStored[STORAGE_KEY_FOLDERS])
    ? localStored[STORAGE_KEY_FOLDERS].map(normalizeFolderShape)
    : [];

  const remoteAccounts = incomingPayload.accounts.map(normalizeAccountShape);
  const remotePasskeys = incomingPayload.passkeys.map(normalizePasskeyShape);
  const remoteFolders = incomingPayload.folders.map(normalizeFolderShape);

  const mergedFolders = mergeFolderCollections(localFolders, remoteFolders);
  let mergedAccounts = mergeAccountCollections(localAccounts, remoteAccounts);
  mergedAccounts = syncAliasGroups(mergedAccounts);
  mergedAccounts = reconcileAccountFolders(mergedAccounts, mergedFolders);
  const mergedPasskeys = mergePasskeyCollections(localPasskeys, remotePasskeys);

  await chrome.storage.local.set({
    [STORAGE_KEY_ACCOUNTS]: mergedAccounts,
    [STORAGE_KEY_PASSKEYS]: mergedPasskeys,
    [STORAGE_KEY_FOLDERS]: mergedFolders,
  });

  editingAccountId = null;
  await refresh({ silent: true });
  setStatus(
    `同步包合并完成：账号 ${localAccounts.length}+${remoteAccounts.length}->${mergedAccounts.length}，` +
      `通行秘钥 ${localPasskeys.length}+${remotePasskeys.length}->${mergedPasskeys.length}，` +
      `文件夹 ${localFolders.length}+${remoteFolders.length}->${mergedFolders.length}`
  );
}

async function buildSyncBundle() {
  const [deviceName, stored] = await Promise.all([
    getDeviceName(),
    chrome.storage.local.get([STORAGE_KEY_ACCOUNTS, STORAGE_KEY_PASSKEYS, STORAGE_KEY_FOLDERS]),
  ]);

  const accounts = Array.isArray(stored[STORAGE_KEY_ACCOUNTS])
    ? stored[STORAGE_KEY_ACCOUNTS].map(normalizeAccountShape)
    : [];
  const passkeys = Array.isArray(stored[STORAGE_KEY_PASSKEYS])
    ? stored[STORAGE_KEY_PASSKEYS].map(normalizePasskeyShape)
    : [];
  const folders = Array.isArray(stored[STORAGE_KEY_FOLDERS])
    ? stored[STORAGE_KEY_FOLDERS].map(normalizeFolderShape)
    : [];

  return {
    schema: SYNC_BUNDLE_SCHEMA,
    exportedAtMs: Date.now(),
    source: {
      app: "pass-extension",
      platform: "chrome-extension",
      deviceName,
      formatVersion: 1,
    },
    payload: {
      accounts,
      passkeys,
      folders,
    },
  };
}

function parseSyncBundlePayload(input) {
  if (!input || typeof input !== "object") return null;
  const rawPayload = input.schema === SYNC_BUNDLE_SCHEMA
    ? input.payload
    : input;
  if (!rawPayload || typeof rawPayload !== "object") return null;
  return {
    accounts: Array.isArray(rawPayload.accounts) ? rawPayload.accounts : [],
    passkeys: Array.isArray(rawPayload.passkeys) ? rawPayload.passkeys : [],
    folders: Array.isArray(rawPayload.folders) ? rawPayload.folders : [],
  };
}

function downloadTextFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
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

  const folderCountMap = new Map();
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
      createdAtMs: 0,
    }));
  }

  const knownFolders = sortFoldersForDisplay(Array.from(folderById.values()));
  const unknownFolderEntries = Array.from(folderCountMap.entries())
    .filter(([id]) => !folderById.has(id))
    .map(([id, count]) => ({
      id,
      name: `未命名文件夹 ${id.slice(0, 8)}`,
      createdAtMs: 0,
      count,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const folderEntries = [
    ...knownFolders.map((folder) => ({
      id: normalizeFolderId(folder.id),
      name: String(folder.name || FIXED_NEW_ACCOUNT_FOLDER_NAME),
      createdAtMs: Number(folder.createdAtMs || 0),
      count: folderCountMap.get(normalizeFolderId(folder.id)) || 0,
    })),
    ...unknownFolderEntries,
  ];

  dom.accountsFolderList.innerHTML = "";
  for (const folder of folderEntries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-view-tab";
    button.dataset.view = `folder:${folder.id}`;
    button.textContent = `${folder.name} (${folder.count})`;
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
    const folderId = normalizeFolderId(String(activeAccountView).slice("folder:".length));
    return active.filter((item) => {
      const ids = extractAccountFolderIds(item).map(normalizeFolderId);
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
    folderIds: Array.isArray(account?.folderIds) ? [...account.folderIds] : [],
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
    passkeyUpdatedAtMs: Number(account?.passkeyUpdatedAtMs || createdAtMs),
    isDeleted: Boolean(account?.isDeleted),
    deletedAtMs: account?.deletedAtMs == null ? null : Number(account.deletedAtMs),
    lastOperatedDeviceName: String(account?.lastOperatedDeviceName || "").trim() || "ChromeMac",
    createdAtMs,
    updatedAtMs: Number(account?.updatedAtMs || createdAtMs),
  };
}

function normalizePasskeyShape(item) {
  const now = Date.now();
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
  };
}

function normalizeFolderShape(item) {
  const now = Date.now();
  const id = normalizeFolderId(item?.id || "");
  const fixedId = FIXED_NEW_ACCOUNT_FOLDER_ID;
  const safeId = id || (globalThis.crypto?.randomUUID?.() || `folder-${now}-${Math.random().toString(16).slice(2)}`);
  const rawName = String(item?.name || "").trim();
  const safeName = safeId === fixedId
    ? FIXED_NEW_ACCOUNT_FOLDER_NAME
    : (rawName || `未命名文件夹 ${safeId.slice(0, 8)}`);
  return {
    id: safeId,
    name: safeName,
    createdAtMs: Number(item?.createdAtMs || now),
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

function normalizeFolderId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeFolderIdList(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map(normalizeFolderId).filter(Boolean))].sort();
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

function mergeAccountCollections(local, remote) {
  const mergedById = new Map();
  const order = [];

  for (const account of [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])]) {
    const normalized = normalizeAccountShape(account);
    const id = String(normalized.accountId || "").trim();
    if (!id) continue;
    if (mergedById.has(id)) {
      mergedById.set(id, mergeSameAccount(mergedById.get(id), normalized));
    } else {
      mergedById.set(id, normalized);
      order.push(id);
    }
  }

  return order.map((id) => mergedById.get(id)).filter(Boolean);
}

function mergeSameAccount(lhs, rhs) {
  const left = normalizeAccountShape(lhs);
  const right = normalizeAccountShape(rhs);
  const primary = Number(left.createdAtMs || 0) <= Number(right.createdAtMs || 0) ? left : right;
  const secondary = primary === left ? right : left;

  const mergedSites = normalizeSites([...(left.sites || []), ...(right.sites || [])]);
  const canonicalBySites = etldPlusOne(mergedSites[0] || "");
  const canonicalSite = canonicalBySites || primary.canonicalSite || secondary.canonicalSite || "";
  const mergedFolderIds = normalizeFolderIdList([
    ...extractAccountFolderIds(left),
    ...extractAccountFolderIds(right),
  ]);

  const usernameField = newerField(
    left.username,
    left.usernameUpdatedAtMs,
    left.updatedAtMs,
    right.username,
    right.usernameUpdatedAtMs,
    right.updatedAtMs
  );
  const passwordField = newerField(
    left.password,
    left.passwordUpdatedAtMs,
    left.updatedAtMs,
    right.password,
    right.passwordUpdatedAtMs,
    right.updatedAtMs
  );
  const totpField = newerField(
    left.totpSecret,
    left.totpUpdatedAtMs,
    left.updatedAtMs,
    right.totpSecret,
    right.totpUpdatedAtMs,
    right.updatedAtMs
  );
  const recoveryField = newerField(
    left.recoveryCodes,
    left.recoveryCodesUpdatedAtMs,
    left.updatedAtMs,
    right.recoveryCodes,
    right.recoveryCodesUpdatedAtMs,
    right.updatedAtMs
  );
  const noteField = newerField(
    left.note,
    left.noteUpdatedAtMs,
    left.updatedAtMs,
    right.note,
    right.noteUpdatedAtMs,
    right.updatedAtMs
  );

  const leftPasskeyIds = normalizePasskeyCredentialIds(left.passkeyCredentialIds || []);
  const rightPasskeyIds = normalizePasskeyCredentialIds(right.passkeyCredentialIds || []);
  const mergedPasskeyIds = normalizePasskeyCredentialIds([...leftPasskeyIds, ...rightPasskeyIds]);
  const passkeyUpdatedAtMs = Math.max(
    Number(left.passkeyUpdatedAtMs || left.updatedAtMs || left.createdAtMs || 0),
    Number(right.passkeyUpdatedAtMs || right.updatedAtMs || right.createdAtMs || 0)
  );

  const latestContentUpdatedAt = Math.max(
    usernameField.updatedAtMs,
    passwordField.updatedAtMs,
    totpField.updatedAtMs,
    recoveryField.updatedAtMs,
    noteField.updatedAtMs,
    passkeyUpdatedAtMs
  );

  const leftDeletedAt = left.isDeleted ? Number(left.deletedAtMs || 0) : 0;
  const rightDeletedAt = right.isDeleted ? Number(right.deletedAtMs || 0) : 0;
  const latestDeletedAt = Math.max(leftDeletedAt, rightDeletedAt);
  const keepDeleted = latestDeletedAt > 0 && latestDeletedAt >= latestContentUpdatedAt;

  const leftUpdatedAt = Number(left.updatedAtMs || 0);
  const rightUpdatedAt = Number(right.updatedAtMs || 0);
  const newerAccount = leftUpdatedAt >= rightUpdatedAt ? left : right;
  const olderAccount = newerAccount === left ? right : left;

  const createdAtMs = Math.min(Number(left.createdAtMs || 0), Number(right.createdAtMs || 0));
  const updatedAtMs = Math.max(
    leftUpdatedAt,
    rightUpdatedAt,
    latestContentUpdatedAt,
    latestDeletedAt,
    createdAtMs
  );

  const usernameAtCreate = String(primary.usernameAtCreate || "").trim()
    || String(secondary.usernameAtCreate || "").trim()
    || String(primary.username || "").trim()
    || String(secondary.username || "").trim();
  const lastOperatedDeviceName = String(newerAccount.lastOperatedDeviceName || "").trim()
    || String(olderAccount.lastOperatedDeviceName || "").trim()
    || "ChromeMac";

  return {
    accountId: primary.accountId,
    canonicalSite,
    usernameAtCreate,
    isPinned: Boolean(newerAccount.isPinned),
    pinnedSortOrder: newerAccount.pinnedSortOrder == null ? null : Number(newerAccount.pinnedSortOrder),
    regularSortOrder: newerAccount.regularSortOrder == null ? null : Number(newerAccount.regularSortOrder),
    folderId: mergedFolderIds[0] || (newerAccount.folderId == null ? null : normalizeFolderId(newerAccount.folderId)),
    folderIds: mergedFolderIds,
    sites: mergedSites.length > 0 ? mergedSites : primary.sites,
    username: usernameField.value,
    password: passwordField.value,
    totpSecret: totpField.value,
    recoveryCodes: recoveryField.value,
    note: noteField.value,
    passkeyCredentialIds: mergedPasskeyIds,
    usernameUpdatedAtMs: usernameField.updatedAtMs,
    passwordUpdatedAtMs: passwordField.updatedAtMs,
    totpUpdatedAtMs: totpField.updatedAtMs,
    recoveryCodesUpdatedAtMs: recoveryField.updatedAtMs,
    noteUpdatedAtMs: noteField.updatedAtMs,
    passkeyUpdatedAtMs,
    isDeleted: keepDeleted,
    deletedAtMs: keepDeleted ? latestDeletedAt : null,
    createdAtMs,
    updatedAtMs,
    lastOperatedDeviceName,
  };
}

function newerField(
  lhsValue,
  lhsUpdatedAt,
  lhsAccountUpdatedAt,
  rhsValue,
  rhsUpdatedAt,
  rhsAccountUpdatedAt
) {
  const leftUpdated = Number(lhsUpdatedAt || 0);
  const rightUpdated = Number(rhsUpdatedAt || 0);
  if (leftUpdated > rightUpdated) return { value: String(lhsValue || ""), updatedAtMs: leftUpdated };
  if (rightUpdated > leftUpdated) return { value: String(rhsValue || ""), updatedAtMs: rightUpdated };

  const leftValue = String(lhsValue || "");
  const rightValue = String(rhsValue || "");
  if (leftValue === rightValue) {
    return { value: leftValue, updatedAtMs: leftUpdated };
  }

  const leftAccountUpdated = Number(lhsAccountUpdatedAt || 0);
  const rightAccountUpdated = Number(rhsAccountUpdatedAt || 0);
  if (leftAccountUpdated > rightAccountUpdated) {
    return { value: leftValue, updatedAtMs: leftUpdated };
  }
  if (rightAccountUpdated > leftAccountUpdated) {
    return { value: rightValue, updatedAtMs: rightUpdated };
  }

  if (!leftValue && rightValue) {
    return { value: rightValue, updatedAtMs: rightUpdated };
  }
  return { value: leftValue, updatedAtMs: leftUpdated };
}

function mergePasskeyCollections(local, remote) {
  const mergedById = new Map();
  const source = [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])];

  for (const passkey of source) {
    const normalized = normalizePasskeyShape(passkey);
    const id = String(normalized.credentialIdB64u || "").trim();
    if (!id) continue;

    if (mergedById.has(id)) {
      mergedById.set(id, mergeSamePasskey(mergedById.get(id), normalized));
    } else {
      mergedById.set(id, normalized);
    }
  }

  return Array.from(mergedById.values()).sort((a, b) => {
    const left = Number(a?.updatedAtMs || a?.createdAtMs || 0);
    const right = Number(b?.updatedAtMs || b?.createdAtMs || 0);
    if (left !== right) return right - left;
    return String(a?.credentialIdB64u || "").localeCompare(String(b?.credentialIdB64u || ""));
  });
}

function mergeSamePasskey(lhs, rhs) {
  const left = normalizePasskeyShape(lhs);
  const right = normalizePasskeyShape(rhs);
  const leftUpdated = Number(left.updatedAtMs || left.createdAtMs || 0);
  const rightUpdated = Number(right.updatedAtMs || right.createdAtMs || 0);
  const newer = leftUpdated >= rightUpdated ? left : right;
  const older = newer === left ? right : left;

  return {
    credentialIdB64u: newer.credentialIdB64u || older.credentialIdB64u,
    rpId: newer.rpId || older.rpId,
    userName: newer.userName || older.userName,
    displayName: newer.displayName || older.displayName,
    userHandleB64u: newer.userHandleB64u || older.userHandleB64u,
    alg: Number(newer.alg || older.alg || -7),
    signCount: Math.max(Number(left.signCount || 0), Number(right.signCount || 0)),
    privateJwk: newer.privateJwk || older.privateJwk || null,
    publicJwk: newer.publicJwk || older.publicJwk || null,
    createdAtMs: Math.min(Number(left.createdAtMs || 0), Number(right.createdAtMs || 0)),
    updatedAtMs: Math.max(leftUpdated, rightUpdated),
    lastUsedAtMs: Math.max(Number(left.lastUsedAtMs || 0), Number(right.lastUsedAtMs || 0)) || null,
    mode: newer.mode || older.mode || "managed",
  };
}

function mergeFolderCollections(local, remote) {
  const merged = new Map();
  const source = [...(Array.isArray(local) ? local : []), ...(Array.isArray(remote) ? remote : [])];
  for (const folder of source) {
    const normalized = normalizeFolderShape(folder);
    const id = normalizeFolderId(normalized.id);
    if (!id) continue;
    if (merged.has(id)) {
      merged.set(id, mergeSameFolder(merged.get(id), normalized));
    } else {
      merged.set(id, normalized);
    }
  }

  const existingFixed = merged.get(FIXED_NEW_ACCOUNT_FOLDER_ID);
  if (!existingFixed) {
    merged.set(
      FIXED_NEW_ACCOUNT_FOLDER_ID,
      normalizeFolderShape({
        id: FIXED_NEW_ACCOUNT_FOLDER_ID,
        name: FIXED_NEW_ACCOUNT_FOLDER_NAME,
        createdAtMs: 0,
      })
    );
  } else {
    merged.set(
      FIXED_NEW_ACCOUNT_FOLDER_ID,
      {
        ...existingFixed,
        id: FIXED_NEW_ACCOUNT_FOLDER_ID,
        name: FIXED_NEW_ACCOUNT_FOLDER_NAME,
      }
    );
  }

  return sortFoldersForDisplay(Array.from(merged.values()));
}

function mergeSameFolder(lhs, rhs) {
  const left = normalizeFolderShape(lhs);
  const right = normalizeFolderShape(rhs);
  const id = normalizeFolderId(left.id || right.id);
  if (id === FIXED_NEW_ACCOUNT_FOLDER_ID) {
    return {
      id,
      name: FIXED_NEW_ACCOUNT_FOLDER_NAME,
      createdAtMs: Math.min(Number(left.createdAtMs || 0), Number(right.createdAtMs || 0)),
    };
  }

  const leftName = String(left.name || "").trim();
  const rightName = String(right.name || "").trim();
  const name = leftName || rightName || `未命名文件夹 ${id.slice(0, 8)}`;

  return {
    id,
    name,
    createdAtMs: Math.min(Number(left.createdAtMs || 0), Number(right.createdAtMs || 0)),
  };
}

function reconcileAccountFolders(accounts, folders) {
  const validIds = new Set((Array.isArray(folders) ? folders : []).map((folder) => normalizeFolderId(folder?.id)));
  const values = Array.isArray(accounts) ? accounts : [];
  return values.map((account) => {
    const normalized = normalizeAccountShape(account);
    const resolved = normalizeFolderIdList(
      extractAccountFolderIds(normalized).filter((id) => validIds.has(normalizeFolderId(id)))
    );
    return {
      ...normalized,
      folderId: resolved[0] || null,
      folderIds: resolved,
    };
  });
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
