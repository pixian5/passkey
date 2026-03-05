const STORAGE_KEY_DEVICE_NAME = "pass.deviceName";
const STORAGE_KEY_ACCOUNTS = "pass.accounts";

const ETLD2_SUFFIXES = new Set([
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "co.uk",
  "org.uk",
]);

const dom = {
  deviceNameInput: document.getElementById("deviceName"),
  saveDeviceNameBtn: document.getElementById("saveDeviceName"),
  deviceStatus: document.getElementById("deviceStatus"),
  currentDomain: document.getElementById("currentDomain"),
  currentEtld1: document.getElementById("currentEtld1"),
  addDemoDataBtn: document.getElementById("addDemoData"),
  modeActiveBtn: document.getElementById("modeActive"),
  modeRecycleBtn: document.getElementById("modeRecycle"),
  createSiteInput: document.getElementById("createSite"),
  createUsernameInput: document.getElementById("createUsername"),
  createPasswordInput: document.getElementById("createPassword"),
  createAccountBtn: document.getElementById("createAccount"),
  createSection: document.querySelector(".create"),
  accountList: document.getElementById("accountList"),
};

let currentDomain = "";
let accounts = [];
let editingAccountId = null;
let showRecycleBin = false;

init().catch((error) => {
  setStatus(`初始化失败: ${error.message}`);
});

async function init() {
  await loadDeviceName();
  await resolveCurrentDomain();
  await loadAccounts();
  renderAccounts();
  bindEvents();
}

function bindEvents() {
  dom.saveDeviceNameBtn.addEventListener("click", saveDeviceName);
  dom.addDemoDataBtn.addEventListener("click", addDemoAccounts);
  dom.createAccountBtn.addEventListener("click", createAccountFromInputs);
  dom.modeActiveBtn.addEventListener("click", () => setViewMode(false));
  dom.modeRecycleBtn.addEventListener("click", () => setViewMode(true));
}

function setViewMode(recycleBinMode) {
  showRecycleBin = recycleBinMode;
  if (showRecycleBin) {
    editingAccountId = null;
  }
  renderAccounts();
}

async function loadDeviceName() {
  const stored = await chrome.storage.local.get([STORAGE_KEY_DEVICE_NAME]);
  const value = stored[STORAGE_KEY_DEVICE_NAME] || "ChromeMac";
  dom.deviceNameInput.value = value;
}

async function saveDeviceName() {
  const name = dom.deviceNameInput.value.trim();
  if (!name) {
    setStatus("设备名称不能为空");
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY_DEVICE_NAME]: name });
  setStatus(`设备名称已保存为 ${name}`);
}

async function resolveCurrentDomain() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = activeTab?.url || "";
  const domain = normalizeDomain(url);
  currentDomain = domain;
  dom.currentDomain.textContent = domain || "-";
  dom.currentEtld1.textContent = domain ? etldPlusOne(domain) : "-";
}

async function loadAccounts() {
  const stored = await chrome.storage.local.get([STORAGE_KEY_ACCOUNTS]);
  const raw = Array.isArray(stored[STORAGE_KEY_ACCOUNTS]) ? stored[STORAGE_KEY_ACCOUNTS] : [];
  accounts = raw.map(normalizeAccountShape);
}

async function persistAccounts(nextAccounts) {
  accounts = nextAccounts.map(normalizeAccountShape);
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });
}

function normalizeAccountShape(account) {
  const now = Date.now();
  const sites = normalizeSites(account.sites || []);
  const canonical = account.canonicalSite || etldPlusOne(sites[0] || "");
  const createdAtMs = Number(account.createdAtMs || account.updatedAtMs || now);
  const username = account.username || "";
  return {
    accountId: account.accountId || `${canonical}${formatYYMMDDHHmmss(createdAtMs)}${username}`,
    canonicalSite: canonical,
    usernameAtCreate: account.usernameAtCreate || username,
    sites,
    username,
    password: account.password || "",
    totpSecret: account.totpSecret || "",
    recoveryCodes: account.recoveryCodes || "",
    note: account.note || "",
    usernameUpdatedAtMs: Number(account.usernameUpdatedAtMs || createdAtMs),
    passwordUpdatedAtMs: Number(account.passwordUpdatedAtMs || createdAtMs),
    totpUpdatedAtMs: Number(account.totpUpdatedAtMs || createdAtMs),
    recoveryCodesUpdatedAtMs: Number(account.recoveryCodesUpdatedAtMs || createdAtMs),
    noteUpdatedAtMs: Number(account.noteUpdatedAtMs || createdAtMs),
    isDeleted: Boolean(account.isDeleted),
    deletedAtMs: account.deletedAtMs == null ? null : Number(account.deletedAtMs),
    lastOperatedDeviceName: account.lastOperatedDeviceName || "ChromeMac",
    createdAtMs,
    updatedAtMs: Number(account.updatedAtMs || createdAtMs),
  };
}

function renderAccounts() {
  dom.modeActiveBtn.classList.toggle("mode-btn-active", !showRecycleBin);
  dom.modeRecycleBtn.classList.toggle("mode-btn-active", showRecycleBin);
  dom.createSection.classList.toggle("create-hidden", showRecycleBin);
  dom.accountList.innerHTML = "";

  const visibleAccounts = showRecycleBin
    ? accounts.filter((account) => account.isDeleted)
    : accounts.filter((account) => !account.isDeleted);

  if (visibleAccounts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = showRecycleBin
      ? "回收站为空"
      : "暂无账号，点击“新建账号”或“生成演示账号”。";
    dom.accountList.appendChild(empty);
    return;
  }

  for (const account of visibleAccounts) {
    const card = document.createElement("article");
    card.className = "account";

    const title = document.createElement("strong");
    title.textContent = account.accountId;
    card.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";
    const matched = isAccountMatchCurrentDomain(account, currentDomain);
    const statusBadge = matched ? '<span class="badge">当前站点可用</span>' : "";
    const deletedBadge = account.isDeleted ? '<span class="badge badge-danger">已删除</span>' : "";
    meta.innerHTML =
      `用户名: ${escapeHtml(account.username || "-")}<br/>` +
      `站点别名: ${escapeHtml((account.sites || []).join(", ") || "-")}<br/>` +
      `创建: ${formatTime(account.createdAtMs)} | 更新: ${formatTime(account.updatedAtMs)}<br/>` +
      `删除: ${formatTime(account.deletedAtMs)}<br/>` +
      `用户名更: ${formatTime(account.usernameUpdatedAtMs)} | 密码更: ${formatTime(account.passwordUpdatedAtMs)}<br/>` +
      `TOTP更: ${formatTime(account.totpUpdatedAtMs)} | 恢复码更: ${formatTime(account.recoveryCodesUpdatedAtMs)} | 备注更: ${formatTime(account.noteUpdatedAtMs)}<br/>` +
      `${statusBadge} ${deletedBadge}`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    if (!showRecycleBin) {
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
    } else {
      const restoreBtn = document.createElement("button");
      restoreBtn.textContent = "恢复账号";
      restoreBtn.addEventListener("click", () => restoreFromRecycleBin(account.accountId));
      actions.appendChild(restoreBtn);

      const permanentDeleteBtn = document.createElement("button");
      permanentDeleteBtn.textContent = "永久删除";
      permanentDeleteBtn.addEventListener("click", () => permanentlyDelete(account.accountId));
      actions.appendChild(permanentDeleteBtn);
    }

    card.appendChild(actions);

    if (!showRecycleBin && editingAccountId === account.accountId) {
      card.appendChild(buildEditor(account));
    }

    dom.accountList.appendChild(card);
  }
}

function buildEditor(account) {
  const editor = document.createElement("div");
  editor.className = "editor";

  const immutable = document.createElement("p");
  immutable.className = "immutable";
  immutable.textContent = "不可编辑: accountId / canonicalSite / usernameAtCreate / createdAt";
  editor.appendChild(immutable);

  const imm2 = document.createElement("p");
  imm2.className = "immutable";
  imm2.textContent = `canonicalSite=${account.canonicalSite}, usernameAtCreate=${account.usernameAtCreate}`;
  editor.appendChild(imm2);

  const sitesInput = createEditorField(editor, "站点别名(;分隔)", account.sites.join(";"));
  const usernameInput = createEditorField(editor, "用户名", account.username);
  const passwordInput = createEditorField(editor, "密码", account.password);
  const totpInput = createEditorField(editor, "TOTP", account.totpSecret || "");
  const recoveryInput = createEditorField(editor, "恢复码", account.recoveryCodes || "");
  const noteInput = createEditorTextarea(editor, "备注", account.note || "");

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
  wrap.className = "editor-row";

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

function createEditorTextarea(parent, labelText, value) {
  const wrap = document.createElement("label");
  wrap.className = "editor-row";

  const label = document.createElement("span");
  label.textContent = labelText;
  wrap.appendChild(label);

  const input = document.createElement("textarea");
  input.value = value || "";
  wrap.appendChild(input);

  parent.appendChild(wrap);
  return input;
}

async function createAccountFromInputs() {
  const site = normalizeDomain(dom.createSiteInput.value);
  const username = dom.createUsernameInput.value.trim();
  const password = dom.createPasswordInput.value;

  if (!site) {
    setStatus("站点不能为空");
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
  const deviceName = dom.deviceNameInput.value.trim() || "ChromeMac";
  const next = accounts.map((item) => ({ ...item, sites: [...(item.sites || [])] }));
  next.push(
    createAccount({
      site,
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
  setStatus("账号已创建");
  renderAccounts();
}

async function addDemoAccounts() {
  if (accounts.length > 0) {
    setStatus("已有账号，未重复生成演示数据");
    return;
  }

  const now = Date.now();
  const deviceName = dom.deviceNameInput.value.trim() || "ChromeMac";
  const demo = [
    createAccount({
      site: "icloud.com",
      username: "alice@icloud.com",
      password: "demo-icloud-pass",
      createdAtMs: now,
      deviceName,
    }),
    createAccount({
      site: "icloud.com",
      username: "alice-secondary@icloud.com",
      password: "demo-icloud-pass-2",
      createdAtMs: now + 1000,
      deviceName,
    }),
    createAccount({
      site: "qq.com",
      username: "demo@qq.com",
      password: "demo-qq-pass",
      createdAtMs: now + 2000,
      deviceName,
    }),
  ];

  const synced = syncAliasGroups(demo);
  await persistAccounts(synced);
  setStatus("已生成演示账号并同步别名组");
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
  const deviceName = dom.deviceNameInput.value.trim() || "ChromeMac";
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
  target.isDeleted = true;
  target.deletedAtMs = now;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = dom.deviceNameInput.value.trim() || "ChromeMac";
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
  target.isDeleted = false;
  target.deletedAtMs = null;
  target.updatedAtMs = now;
  target.lastOperatedDeviceName = dom.deviceNameInput.value.trim() || "ChromeMac";
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

function createAccount({ site, username, password, createdAtMs, deviceName }) {
  const normalizedSite = normalizeDomain(site);
  const canonical = etldPlusOne(normalizedSite);
  const accountId = `${canonical}${formatYYMMDDHHmmss(createdAtMs)}${username}`;

  return {
    accountId,
    canonicalSite: canonical,
    usernameAtCreate: username,
    sites: normalizeSites([normalizedSite]),
    username,
    password,
    totpSecret: "",
    recoveryCodes: "",
    note: "",
    usernameUpdatedAtMs: createdAtMs,
    passwordUpdatedAtMs: createdAtMs,
    totpUpdatedAtMs: createdAtMs,
    recoveryCodesUpdatedAtMs: createdAtMs,
    noteUpdatedAtMs: createdAtMs,
    isDeleted: false,
    deletedAtMs: null,
    lastOperatedDeviceName: deviceName,
    createdAtMs,
    updatedAtMs: createdAtMs,
  };
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

function isAccountMatchCurrentDomain(account, domain) {
  if (!domain) return false;
  const normalizedCurrent = normalizeDomain(domain);
  const currentEtld1 = etldPlusOne(normalizedCurrent);
  const sites = normalizeSites(account.sites || []);
  return sites.some((site) => site === normalizedCurrent || etldPlusOne(site) === currentEtld1);
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

function setStatus(message) {
  dom.deviceStatus.textContent = message;
}
