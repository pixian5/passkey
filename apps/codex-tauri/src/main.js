// This page is copied directly into the Tauri webview without a bundler, so a
// bare npm import such as "@tauri-apps/api/core" cannot be resolved here.
const invoke = (command, args) => {
  const runtime = window.__TAURI__?.core ?? window.__TAURI_INTERNALS__;
  if (typeof runtime?.invoke !== "function") {
    throw new Error("Tauri 运行时不可用，请从 Tauri 应用内启动");
  }
  return runtime.invoke(command, args);
};

const $ = (s) => document.querySelector(s);

const els = {
  output: $("#output"),
  deviceName: $("#deviceName"),
  deviceLabel: $("#deviceLabel"),
  accountRows: $("#accountRows"),
  listEmpty: $("#listEmpty"),
  folderList: $("#folderList"),
  folderEmpty: $("#folderEmpty"),
  folderHead: $("#folderHead"),
  searchInput: $("#searchInput"),
  sortMode: $("#sortMode"),
  labelAll: $("#label-all"),
  labelPasskeys: $("#label-passkeys"),
  labelTotp: $("#label-totp"),
  labelRecycle: $("#label-recycle"),
  labelFolders: $("#label-folders"),
  accountForm: $("#accountForm"),
  accountId: $("#accountId"),
  sites: $("#sites"),
  username: $("#username"),
  password: $("#password"),
  totpSecret: $("#totpSecret"),
  recoveryCodes: $("#recoveryCodes"),
  note: $("#note"),
  editFolders: $("#editFolders"),
  editModal: $("#editModal"),
  editTitle: $("#editTitle"),
  folderModal: $("#folderModal"),
  newFolderName: $("#newFolderName"),
  folderSitesModal: $("#folderSitesModal"),
  folderSitesForm: $("#folderSitesForm"),
  folderSitesTitle: $("#folderSitesTitle"),
  folderSitesInput: $("#folderSitesInput"),
  folderAutoAdd: $("#folderAutoAdd"),
  folderDedupModal: $("#folderDedupModal"),
  folderDedupTitle: $("#folderDedupTitle"),
  folderDedupSummary: $("#folderDedupSummary"),
  folderDedupGroups: $("#folderDedupGroups"),
  btnKeepLatest: $("#btn-keep-latest"),
  btnKeepEarliest: $("#btn-keep-earliest"),
  contextMenu: $("#contextMenu"),
  btnNewFolder: $("#btn-new-folder"),
  btnCreateFolder: $("#btn-create-folder"),
  btnNew: $("#btn-new"),
  btnDelete: $("#btn-delete"),
  btnRestore: $("#btn-restore"),
  btnHealth: $("#btn-health"),
  btnDemo: $("#btn-demo"),
  btnExport: $("#btn-export"),
  btnSaveDevice: $("#btn-save-device"),
  localPayload: $("#localPayload"),
  remotePayload: $("#remotePayload"),
  btnLoadLocal: $("#btn-load-local"),
  btnClearRemote: $("#btn-clear-remote"),
  btnFillEmptyRemote: $("#btn-fill-empty-remote"),
  btnMergePreview: $("#btn-merge-preview"),
  mergePanel: $("#mergePanel"),
  mergeResult: $("#mergeResult"),
  mergeSummary: $("#mergeSummary"),
  mergePayloadOut: $("#mergePayloadOut"),
  syncEnabled: $("#syncEnabled"),
  syncBaseUrl: $("#syncBaseUrl"),
  syncToken: $("#syncToken"),
  syncEncKey: $("#syncEncKey"),
  syncMode: $("#syncMode"),
  btnSaveSync: $("#btn-save-sync"),
  btnGenSyncKey: $("#btn-gen-sync-key"),
  btnSyncPreview: $("#btn-sync-preview"),
  btnSyncNow: $("#btn-sync-now"),
  btnSyncNowSettings: $("#btn-sync-now-settings"),
  syncPreviewOut: $("#syncPreviewOut"),
  lockOverlay: $("#lockOverlay"),
  unlockPassword: $("#unlockPassword"),
  lockError: $("#lockError"),
  btnUnlock: $("#btn-unlock"),
  lockStatus: $("#lockStatus"),
  lockPassword: $("#lockPassword"),
  lockPassword2: $("#lockPassword2"),
  idleMinutes: $("#idleMinutes"),
  btnLockEnable: $("#btn-lock-enable"),
  btnLockDisable: $("#btn-lock-disable"),
  btnLockIdle: $("#btn-lock-idle"),
  btnLockNow: $("#btn-lock-now"),
  appMain: $("#appMain"),
  sidebar: $("#sidebar"),
  settingsModal: $("#settingsModal"),
  btnOpenSettings: $("#btn-open-settings"),
  btnOpenMerge: $("#btn-open-merge"),
  debugOut: $("#debugOut"),
};

let state = {
  activeAccounts: [],
  deletedAccounts: [],
  folders: [],
  passkeys: [],
  deviceName: "",
};

let lockState = { enabled: false, locked: false, idleLockMinutes: 5, hasPassword: false };
let activityTimer = null;
let totpTimer = null;
let filter = { type: "all" };
let selectedId = "";
let folderSitesTargetId = "";
let folderDedupTarget = null;

const message = (text) => {
  const el = els.output || document.querySelector("#output");
  if (!el) {
    console.log("[pass]", text);
    return;
  }
  el.hidden = false;
  el.textContent = String(text);
  clearTimeout(message._t);
  message._t = setTimeout(() => {
    el.hidden = true;
  }, 4000);
};

// Surface unexpected errors so "no reaction" is visible.
window.addEventListener("error", (e) => {
  message(`脚本错误: ${e.message || e}`);
});
window.addEventListener("unhandledrejection", (e) => {
  message(`请求失败: ${e.reason || e}`);
});

const escapeHtml = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const accountKey = (a) => a.recordId || a.id || a.accountId || "";

const hasTotp = (a) => Boolean((a.totpSecret || "").trim());
const hasPasskey = (a) => (a.passkeyCredentialIds || []).length > 0;

const folderIdsOf = (a) => {
  const ids = [...(a.folderIds || [])];
  if (a.folderId) ids.push(a.folderId);
  return [...new Set(ids.map(String))];
};

const passkeysForAccount = (a) => {
  const ids = new Set((a.passkeyCredentialIds || []).map(String));
  const sites = new Set((a.sites || []).map((s) => String(s).toLowerCase()));
  return (state.passkeys || []).filter((p) => {
    if (p.isDeleted || p.isPermanentlyDeleted) return false;
    if (ids.has(p.credentialIdB64u)) return true;
    const rp = (p.rpId || "").toLowerCase();
    return rp && sites.has(rp);
  });
};

// --- TOTP (RFC 6238, SHA1, 6 digits, 30s) ---
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(input || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of cleaned) {
    const val = alphabet.indexOf(c);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function hotp(keyBytes, counter) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // big-endian counter
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(bin % 10 ** 6).padStart(6, "0");
}

async function totpCode(secret) {
  const key = base32Decode(secret);
  if (!key.length) return null;
  const step = 30;
  const counter = Math.floor(Date.now() / 1000 / step);
  const code = await hotp(key, counter);
  const remain = step - (Math.floor(Date.now() / 1000) % step);
  return { code, remain };
}

function formatOtpDisplay(code) {
  if (!code || code.length !== 6) return code || "------";
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

const query = () => (els.searchInput?.value || "").trim().toLowerCase();
const matchesQuery = (a) => {
  const q = query();
  if (!q) return true;
  const hay = [a.username, a.accountId, a.note, ...(a.sites || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
};

const sortAccounts = (list) => {
  const mode = els.sortMode?.value || "default";
  const arr = [...list];
  const cmp = (x, y) => String(x || "").localeCompare(String(y || ""), "en");
  arr.sort((a, b) => {
    if (mode === "usernameAZ") return cmp(a.username, b.username);
    if (mode === "siteAZ") return cmp((a.sites || [])[0], (b.sites || [])[0]);
    return (b.updatedAtMs || 0) - (a.updatedAtMs || 0);
  });
  return arr;
};

const filteredAccounts = () => {
  let base;
  if (filter.type === "recycle") base = state.deletedAccounts || [];
  else {
    base = state.activeAccounts || [];
    if (filter.type === "passkeys") base = base.filter(hasPasskey);
    if (filter.type === "totp") base = base.filter(hasTotp);
    if (filter.type === "folder") {
      const fid = filter.id.toLowerCase();
      base = base.filter((a) => folderIdsOf(a).some((id) => id.toLowerCase() === fid));
    }
  }
  return sortAccounts(base.filter(matchesQuery));
};

const updateSidebarLabels = () => {
  const active = state.activeAccounts || [];
  if (els.labelAll) els.labelAll.textContent = `全部 (${active.length})`;
  if (els.labelPasskeys) els.labelPasskeys.textContent = `通行密钥 (${active.filter(hasPasskey).length})`;
  if (els.labelTotp) els.labelTotp.textContent = `验证码 (${active.filter(hasTotp).length})`;
  if (els.labelRecycle) {
    els.labelRecycle.textContent = `回收站 (${(state.deletedAccounts || []).length})`;
  }
  const folders = (state.folders || []).filter((f) => !f.isDeleted && !f.isPermanentlyDeleted);
  if (els.labelFolders) els.labelFolders.textContent = `文件夹 (${folders.length})`;
};

const applySidebarActive = () => {
  document.querySelectorAll(".sidebar .side-item[data-filter]").forEach((btn) => {
    const f = btn.dataset.filter || "";
    let on = false;
    if (f === "all" && filter.type === "all") on = true;
    else if (f === "passkeys" && filter.type === "passkeys") on = true;
    else if (f === "totp" && filter.type === "totp") on = true;
    else if (f === "recycle" && filter.type === "recycle") on = true;
    else if (
      f.startsWith("folder:") &&
      filter.type === "folder" &&
      f.slice(7).toLowerCase() === String(filter.id || "").toLowerCase()
    ) {
      on = true;
    }
    btn.classList.toggle("active", on);
  });
};

const setFilter = (next) => {
  filter = next || { type: "all" };
  if (els.searchInput) {
    if (filter.type === "passkeys") els.searchInput.placeholder = "搜索通行密钥账号（输入即搜）";
    else if (filter.type === "totp") els.searchInput.placeholder = "搜索验证码账号（输入即搜）";
    else if (filter.type === "recycle") els.searchInput.placeholder = "搜索回收站账号（输入即搜）";
    else if (filter.type === "folder") els.searchInput.placeholder = "搜索当前文件夹账号（输入即搜）";
    else els.searchInput.placeholder = "搜索全部账号（输入即搜）";
  }
  // Clear multi-select style residue and re-render list + folders first,
  // then mark the active sidebar item (folders are recreated in render).
  render();
  applySidebarActive();
};

const copyText = async (text, okMsg) => {
  try {
    await navigator.clipboard.writeText(text);
    message(okMsg);
  } catch {
    message("复制失败");
  }
};

const hideContextMenu = () => {
  if (els.contextMenu) els.contextMenu.hidden = true;
};

const showContextMenu = (event, items) => {
  if (!els.contextMenu) return;
  event.preventDefault();
  event.stopPropagation();
  els.contextMenu.innerHTML = "";
  items.forEach(({ label, action, danger = false }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = label;
    if (danger) item.classList.add("danger");
    item.addEventListener("click", async (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      hideContextMenu();
      try {
        await action();
      } catch (err) {
        message(`操作失败：${err}`);
      }
    });
    els.contextMenu.appendChild(item);
  });
  els.contextMenu.hidden = false;
  const menuRect = els.contextMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - menuRect.width - 8);
  const top = Math.min(event.clientY, window.innerHeight - menuRect.height - 8);
  els.contextMenu.style.left = `${Math.max(8, left)}px`;
  els.contextMenu.style.top = `${Math.max(8, top)}px`;
};

const openFolderSites = (folder) => {
  folderSitesTargetId = String(folder.id);
  if (els.folderSitesTitle) els.folderSitesTitle.textContent = `加入「${folder.name || "未命名文件夹"}」中的指定网站账号`;
  if (els.folderSitesInput) els.folderSitesInput.value = (folder.matchedSites || []).join("\n");
  if (els.folderAutoAdd) els.folderAutoAdd.checked = Boolean(folder.autoAddMatchingSites);
  if (els.folderSitesModal) els.folderSitesModal.hidden = false;
  setTimeout(() => els.folderSitesInput?.focus(), 50);
};

const closeFolderSites = () => {
  if (els.folderSitesModal) els.folderSitesModal.hidden = true;
  folderSitesTargetId = "";
};

const formatTime = (ms) => {
  if (!ms) return "-";
  try {
    return new Date(Number(ms)).toLocaleString();
  } catch {
    return "-";
  }
};

const renderFolderDedupGroups = () => {
  const groups = folderDedupTarget?.groups || [];
  if (els.folderDedupSummary) {
    els.folderDedupSummary.textContent = groups.length
      ? `重复组 ${groups.length} 组，按站点别名和用户名分组`
      : "当前文件夹暂无重复账号";
  }
  if (els.btnKeepLatest) els.btnKeepLatest.disabled = groups.length === 0;
  if (els.btnKeepEarliest) els.btnKeepEarliest.disabled = groups.length === 0;
  if (!els.folderDedupGroups) return;
  els.folderDedupGroups.innerHTML = "";
  if (!groups.length) {
    els.folderDedupGroups.innerHTML = '<div class="dedup-empty">当前文件夹暂无重复账号</div>';
    return;
  }
  groups.forEach((group) => {
    const card = document.createElement("section");
    card.className = "dedup-group";
    const head = document.createElement("div");
    head.className = "dedup-group-head";
    head.innerHTML = `<div><div class="dedup-group-title">${escapeHtml((group.siteAliases || []).join(", ") || "未命名站点")}</div><div class="dedup-account-meta">用户名：${escapeHtml(group.username || "(空用户名)")} · ${group.accounts.length} 个账号</div></div>`;
    card.appendChild(head);
    group.accounts.forEach((account, index) => {
      const row = document.createElement("div");
      row.className = "dedup-account";
      const label = index === 0 ? "最新" : index === group.accounts.length - 1 ? "最早" : "";
      row.innerHTML = `
        <div class="dedup-account-main">
          <div class="dedup-account-id">${label ? `<span class="dedup-keep-label">${label}</span>` : ""}${escapeHtml(account.accountId || accountKey(account) || "账号")}</div>
          <div class="dedup-account-sites">站点：${escapeHtml((account.sites || []).join(", ") || account.canonicalSite || "-")}</div>
          <div class="dedup-account-meta">更新时间：${escapeHtml(formatTime(account.updatedAtMs))} · 创建时间：${escapeHtml(formatTime(account.createdAtMs))}</div>
        </div>`;
      const keep = document.createElement("button");
      keep.type = "button";
      keep.className = "primary";
      keep.textContent = "仅保留此账号";
      keep.addEventListener("click", () => deduplicateFolder("account", accountKey(account)));
      row.appendChild(keep);
      card.appendChild(row);
    });
    els.folderDedupGroups.appendChild(card);
  });
};

const refreshFolderDedup = async () => {
  if (!folderDedupTarget?.folderId) return;
  const groups = await invoke("get_folder_duplicate_groups", {
    folderId: folderDedupTarget.folderId,
  });
  folderDedupTarget.groups = groups || [];
  renderFolderDedupGroups();
};

const openFolderDedup = async (folder) => {
  folderDedupTarget = { folderId: String(folder.id), folderName: folder.name || "未命名文件夹", groups: [] };
  if (els.folderDedupTitle) els.folderDedupTitle.textContent = `${folderDedupTarget.folderName} 内去重`;
  if (els.folderDedupModal) els.folderDedupModal.hidden = false;
  renderFolderDedupGroups();
  try {
    await refreshFolderDedup();
  } catch (err) {
    message(`读取重复账号失败：${err}`);
  }
};

const closeFolderDedup = () => {
  if (els.folderDedupModal) els.folderDedupModal.hidden = true;
  folderDedupTarget = null;
};

const deduplicateFolder = async (mode, accountId = null) => {
  if (!folderDedupTarget?.folderId) return;
  try {
    const result = await invoke("deduplicate_folder", {
      folderId: folderDedupTarget.folderId,
      mode,
      accountId,
    });
    await refreshState();
    await refreshFolderDedup();
    message(result.message || `去重完成，已移入回收站 ${result.deletedCount || 0} 个账号`);
  } catch (err) {
    message(`去重失败：${err}`);
  }
};

const renderFolders = () => {
  if (!els.folderList) return;
  const folders = (state.folders || []).filter((f) => !f.isDeleted && !f.isPermanentlyDeleted);
  if (els.folderEmpty) els.folderEmpty.hidden = folders.length > 0;
  els.folderList.innerHTML = "";
  folders.forEach((folder) => {
    const count = (state.activeAccounts || []).filter((a) =>
      folderIdsOf(a).some((id) => id.toLowerCase() === String(folder.id).toLowerCase())
    ).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "side-item";
    btn.dataset.filter = `folder:${folder.id}`;
    // Keep text on the button itself so clicks always hit the button element.
    btn.textContent = `${folder.name || "未命名"} (${count})`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setFilter({ type: "folder", id: String(folder.id) });
    });
    els.folderList.appendChild(btn);
  });
};

const render = () => {
  if (els.deviceName) els.deviceName.value = state.deviceName || "";
  if (els.deviceLabel) els.deviceLabel.textContent = state.deviceName ? `· ${state.deviceName}` : "";
  updateSidebarLabels();
  renderFolders();
  applySidebarActive();

  const accounts = filteredAccounts();
  if (els.listEmpty) els.listEmpty.hidden = accounts.length > 0;
  if (!els.accountRows) return;
  els.accountRows.innerHTML = "";

  accounts.forEach((a) => {
    const key = accountKey(a);
    const row = document.createElement("div");
    row.className = "account-row" + (key === selectedId ? " selected" : "");
    row.dataset.id = key;

    const title = a.accountId || a.username || (a.sites || [])[0] || "账号";
    const sites = (a.sites || []).join("  ");
    const pks = passkeysForAccount(a);
    const pkLine = pks
      .slice(0, 2)
      .map((p) => `通行密钥 RP ID: ${p.rpId || "—"} 用户名: ${p.userName || p.displayName || "—"}`)
      .join(" · ");

    const deleted = a.isDeleted
      ? `<span class="deleted-tag">已删除</span>`
      : "";

    row.innerHTML = `
      <div class="row-title">${escapeHtml(title)}${deleted}</div>
      <div class="row-line row-username">用户名: ${escapeHtml(a.username || "—")}</div>
      <div class="row-sub row-sites">站点别名: ${escapeHtml(sites || "—")}</div>
      ${pkLine ? `<div class="row-sub">${escapeHtml(pkLine)}</div>` : ""}
      <div class="row-otp" data-totp="${escapeHtml((a.totpSecret || "").trim())}" hidden></div>
    `;

    // click title area opens edit; username/sites copy on click
    row.addEventListener("click", (e) => {
      const t = e.target;
      if (t.closest(".row-username")) {
        e.stopPropagation();
        copyText(a.username || "", "用户名已复制");
        return;
      }
      if (t.closest(".row-sites")) {
        e.stopPropagation();
        copyText((a.sites || []).join("\n"), "站点别名已复制");
        return;
      }
      if (t.closest(".row-otp button")) return;
      selectedId = key;
      openEdit(a);
      render();
    });

    els.accountRows.appendChild(row);
  });

  refreshTotpRows();
};

async function refreshTotpRows() {
  const nodes = document.querySelectorAll(".row-otp[data-totp]");
  for (const node of nodes) {
    const secret = node.getAttribute("data-totp") || "";
    if (!secret) {
      node.hidden = true;
      continue;
    }
    try {
      const res = await totpCode(secret);
      if (!res) {
        node.hidden = true;
        continue;
      }
      node.hidden = false;
      const shown = formatOtpDisplay(res.code);
      node.innerHTML = `验证码: <button type="button" data-code="${res.code}">${shown}</button> (剩余 ${res.remain}s)`;
      node.querySelector("button")?.addEventListener("click", (e) => {
        e.stopPropagation();
        copyText(res.code, "验证码已复制");
      });
    } catch {
      node.hidden = true;
    }
  }
}

const populateFolderSelect = (selected = []) => {
  if (!els.editFolders) return;
  const sel = new Set(selected.map(String));
  const folders = (state.folders || []).filter((f) => !f.isDeleted);
  els.editFolders.innerHTML = "";
  folders.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.name || f.id;
    opt.selected = sel.has(String(f.id));
    els.editFolders.appendChild(opt);
  });
};

const openEdit = (account = null) => {
  if (!els.editModal) return;
  if (account) {
    selectedId = accountKey(account);
    els.accountId.value = selectedId;
    els.sites.value = (account.sites || []).join(", ");
    els.username.value = account.username || "";
    els.password.value = account.password || "";
    els.totpSecret.value = account.totpSecret || "";
    els.recoveryCodes.value = account.recoveryCodes || "";
    els.note.value = account.note || "";
    if (els.editTitle) els.editTitle.textContent = "编辑账号";
    populateFolderSelect(folderIdsOf(account));
    if (els.btnDelete) {
      els.btnDelete.hidden = false;
      els.btnDelete.textContent = filter.type === "recycle" ? "永久删除" : "移入回收站";
    }
    if (els.btnRestore) els.btnRestore.hidden = filter.type !== "recycle";
  } else {
    selectedId = "";
    els.accountId.value = "";
    els.accountForm?.reset();
    if (els.editTitle) els.editTitle.textContent = "新建账号";
    populateFolderSelect(
      filter.type === "folder" && filter.id ? [filter.id] : []
    );
    if (els.btnDelete) els.btnDelete.hidden = true;
    if (els.btnRestore) els.btnRestore.hidden = true;
  }
  els.editModal.hidden = false;
};

const closeEdit = () => {
  if (els.editModal) els.editModal.hidden = true;
};

const openSettings = (tab = "general") => {
  if (!els.settingsModal) return;
  els.settingsModal.hidden = false;
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.settingsTab === tab);
  });
  document.querySelectorAll(".settings-pane").forEach((p) => {
    p.classList.toggle("active", p.dataset.pane === tab);
  });
};
const closeSettings = () => {
  if (els.settingsModal) els.settingsModal.hidden = true;
};

const refreshState = async () => {
  const next = await invoke("get_app_state");
  state = {
    activeAccounts: next.activeAccounts || [],
    deletedAccounts: next.deletedAccounts || [],
    folders: next.folders || [],
    passkeys: next.passkeys || [],
    deviceName: next.deviceName || "",
  };
  render();
};

const applyLockUi = () => {
  const locked = Boolean(lockState.enabled && lockState.locked);
  if (els.lockOverlay) els.lockOverlay.hidden = !locked;
  if (els.appMain) els.appMain.style.visibility = locked ? "hidden" : "visible";
  if (els.lockStatus) {
    els.lockStatus.textContent = lockState.enabled
      ? `状态：已启用；${lockState.locked ? "已锁定" : "已解锁"}；空闲 ${lockState.idleLockMinutes || 5} 分钟`
      : "状态：未启用";
  }
  if (els.idleMinutes && lockState.idleLockMinutes) {
    els.idleMinutes.value = String(lockState.idleLockMinutes);
  }
};

const refreshLock = async () => {
  lockState = await invoke("get_lock_state");
  applyLockUi();
  return lockState;
};

const noteActivity = async () => {
  try {
    await invoke("lock_touch");
  } catch (_) {}
};

const loadSyncSettings = async () => {
  try {
    const s = await invoke("get_sync_settings");
    if (els.syncEnabled) els.syncEnabled.checked = Boolean(s.enabled);
    if (els.syncBaseUrl) els.syncBaseUrl.value = s.baseUrl || "";
    if (els.syncToken) els.syncToken.value = s.authToken || "";
    if (els.syncEncKey) els.syncEncKey.value = s.encryptionKey || "";
    if (els.syncMode) els.syncMode.value = s.mode || "merge";
  } catch (err) {
    message(`读取同步设置失败：${err}`);
  }
};

const collectSyncSettings = () => ({
  enabled: Boolean(els.syncEnabled?.checked),
  baseUrl: (els.syncBaseUrl?.value || "").trim(),
  authToken: (els.syncToken?.value || "").trim(),
  encryptionKey: (els.syncEncKey?.value || "").trim(),
  mode: els.syncMode?.value || "merge",
});

const buildLocalSyncPayload = () => ({
  accounts: [...(state.activeAccounts || []), ...(state.deletedAccounts || [])],
  folders: state.folders || [],
  passkeys: state.passkeys || [],
});

const extractPayload = (text, label) => {
  const raw = (text || "").trim();
  if (!raw) throw new Error(`${label} 为空`);
  const obj = JSON.parse(raw);
  return obj?.payload ?? obj;
};

const runSyncNow = async () => {
  await invoke("set_sync_settings", { settings: collectSyncSettings() });
  const raw = await invoke("sync_now");
  const result = typeof raw === "string" ? JSON.parse(raw) : raw;
  const report = result.report || {};
  await refreshState();
  message(report.message || "同步完成");
};

document.addEventListener("contextmenu", (e) => {
  const folderButton = e.target instanceof Element
    ? e.target.closest("#folderList .side-item[data-filter^='folder:']")
    : null;
  if (folderButton) {
    const folderId = String(folderButton.dataset.filter || "").slice(7);
    const folder = (state.folders || []).find((item) => String(item.id) === folderId);
    if (!folder) return;
    showContextMenu(e, [
      { label: "加入指定网站全部账号", action: () => openFolderSites(folder) },
      { label: "文件夹内去重", action: () => openFolderDedup(folder) },
      {
        label: "删除文件夹",
        danger: true,
        action: async () => {
          if (!confirm(`删除文件夹「${folder.name || "未命名文件夹"}」？文件夹内账号不会被删除。`)) return;
          await invoke("delete_folder", { id: folder.id });
          if (filter.type === "folder" && String(filter.id).toLowerCase() === String(folder.id).toLowerCase()) {
            setFilter({ type: "all" });
          }
          await refreshState();
          message(`文件夹「${folder.name || "未命名文件夹"}」已删除`);
        },
      },
    ]);
    return;
  }

  const sideButton = e.target instanceof Element
    ? e.target.closest("#sidebar .side-item[data-filter]")
    : null;
  if (sideButton) {
    showContextMenu(e, [{ label: "新建账号", action: () => openEdit(null) }]);
    return;
  }

  const folderHead = e.target instanceof Element ? e.target.closest("#folderHead") : null;
  if (folderHead) {
    showContextMenu(e, [{ label: "新建账号", action: () => openEdit(null) }]);
  }
});

// Robust sidebar + folder actions via document-level delegation.
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;

  // New folder button
  if (t.closest("#btn-new-folder")) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (els.newFolderName) els.newFolderName.value = "";
      if (els.folderModal) {
        els.folderModal.hidden = false;
        els.folderModal.removeAttribute("hidden");
      }
      message("请输入文件夹名称");
      setTimeout(() => els.newFolderName?.focus(), 50);
    } catch (err) {
      message(`打开新建文件夹失败: ${err}`);
    }
    return;
  }

  // Create folder confirm
  if (t.closest("#btn-create-folder")) {
    e.preventDefault();
    e.stopPropagation();
    (async () => {
      try {
        const name = (els.newFolderName?.value || "").trim();
        if (!name) {
          message("文件夹名不能为空");
          return;
        }
        await invoke("create_folder", { name });
        if (els.folderModal) {
          els.folderModal.hidden = true;
          els.folderModal.setAttribute("hidden", "");
        }
        await refreshState();
        message(`文件夹「${name}」已创建`);
      } catch (err) {
        message(`创建文件夹失败: ${err}`);
      }
    })();
    return;
  }

  // Sidebar filter items (static + dynamic folders)
  const sideBtn = t.closest(".side-item[data-filter]");
  if (sideBtn && (sideBtn.closest("#sidebar") || sideBtn.closest(".sidebar"))) {
    e.preventDefault();
    e.stopPropagation();
    const f = sideBtn.getAttribute("data-filter") || sideBtn.dataset.filter || "";
    console.log("[pass] filter click", f);
    if (f === "all") setFilter({ type: "all" });
    else if (f === "passkeys") setFilter({ type: "passkeys" });
    else if (f === "totp") setFilter({ type: "totp" });
    else if (f === "recycle") setFilter({ type: "recycle" });
    else if (f.startsWith("folder:")) setFilter({ type: "folder", id: f.slice(7) });
    else message(`未知筛选: ${f}`);
    return;
  }
});

els.searchInput?.addEventListener("input", () => render());
els.sortMode?.addEventListener("change", () => render());
els.btnNew?.addEventListener("click", () => openEdit(null));
els.btnOpenSettings?.addEventListener("click", () => openSettings("general"));
document.querySelectorAll("[data-close-settings]").forEach((el) => el.addEventListener("click", closeSettings));
document.querySelectorAll("[data-close-edit]").forEach((el) => el.addEventListener("click", closeEdit));
document.querySelectorAll("[data-close-folder]").forEach((el) =>
  el.addEventListener("click", () => {
    if (els.folderModal) els.folderModal.hidden = true;
  })
);
document.querySelectorAll("[data-close-folder-sites]").forEach((el) =>
  el.addEventListener("click", closeFolderSites)
);
document.querySelectorAll("[data-close-folder-dedup]").forEach((el) =>
  el.addEventListener("click", closeFolderDedup)
);
document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element) || !e.target.closest("#contextMenu")) hideContextMenu();
});
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => openSettings(btn.dataset.settingsTab || "general"));
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSettings();
    closeEdit();
    if (els.folderModal) els.folderModal.hidden = true;
    closeFolderSites();
    closeFolderDedup();
    hideContextMenu();
  }
});


els.accountForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    sites: (els.sites.value || "")
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
    username: els.username.value,
    password: els.password.value,
    totpSecret: els.totpSecret.value,
    recoveryCodes: els.recoveryCodes.value,
    note: els.note.value,
  };
  const id = els.accountId.value;
  try {
    if (id) {
      await invoke("update_account", { id, input: payload });
      const selected = [...(els.editFolders?.selectedOptions || [])].map((o) => o.value);
      await invoke("set_account_folders", { id, folderIds: selected });
      message("已保存");
    } else {
      await invoke("create_account", { input: payload });
      await refreshState();
      const created = state.activeAccounts.find(
        (a) => a.username === payload.username && (a.sites || [])[0] === payload.sites[0]
      );
      if (created) {
        const selected = [...(els.editFolders?.selectedOptions || [])].map((o) => o.value);
        if (selected.length) {
          await invoke("set_account_folders", {
            id: accountKey(created),
            folderIds: selected,
          });
        }
      }
      message("已创建");
    }
    closeEdit();
    await refreshState();
  } catch (err) {
    message(`保存失败：${err}`);
  }
});

els.folderSitesForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!folderSitesTargetId) return;
  const siteInputs = (els.folderSitesInput?.value || "")
    .split(/[,，\n]/)
    .map((site) => site.trim())
    .filter(Boolean);
  try {
    const result = await invoke("configure_folder_site_rules", {
      folderId: folderSitesTargetId,
      siteInputs,
      autoAdd: Boolean(els.folderAutoAdd?.checked),
    });
    closeFolderSites();
    await refreshState();
    message(result.message || `已加入 ${result.addedCount || 0} 个账号`);
  } catch (err) {
    message(`保存文件夹规则失败：${err}`);
  }
});

els.btnKeepLatest?.addEventListener("click", () => deduplicateFolder("latest"));
els.btnKeepEarliest?.addEventListener("click", () => deduplicateFolder("earliest"));

els.btnDelete?.addEventListener("click", async () => {
  const id = els.accountId.value;
  if (!id) return;
  if (filter.type === "recycle") {
    await invoke("hard_delete_account", { id });
    message("已永久删除");
  } else {
    await invoke("soft_delete_account", { id });
    message("已移入回收站");
  }
  closeEdit();
  await refreshState();
});

els.btnRestore?.addEventListener("click", async () => {
  const id = els.accountId.value;
  if (!id) return;
  await invoke("restore_account", { id });
  closeEdit();
  await refreshState();
  message("已恢复");
});

els.btnSaveDevice?.addEventListener("click", async () => {
  await invoke("set_device_name", { deviceName: els.deviceName.value });
  await refreshState();
  message("设备名已保存");
});
els.btnExport?.addEventListener("click", async () => {
  const r = await invoke("export_csv");
  message(`CSV：${r.csvPath}`);
});
els.btnDemo?.addEventListener("click", async () => {
  await invoke("generate_demo_accounts");
  await refreshState();
  message("已生成演示数据");
});
els.btnHealth?.addEventListener("click", async () => {
  const h = await invoke("health_check");
  if (els.debugOut) els.debugOut.textContent = JSON.stringify(h, null, 2);
  openSettings("debug");
});

els.btnSaveSync?.addEventListener("click", async () => {
  try {
    await invoke("set_sync_settings", { settings: collectSyncSettings() });
    message("同步设置已保存");
  } catch (err) {
    message(`保存失败：${err}`);
  }
});
els.btnGenSyncKey?.addEventListener("click", async () => {
  const key = await invoke("generate_sync_encryption_key");
  if (els.syncEncKey) els.syncEncKey.value = key;
  message("已生成同步密钥");
});
els.btnSyncPreview?.addEventListener("click", async () => {
  try {
    await invoke("set_sync_settings", { settings: collectSyncSettings() });
    const raw = await invoke("sync_preview");
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (els.syncPreviewOut) {
      els.syncPreviewOut.hidden = false;
      els.syncPreviewOut.textContent = JSON.stringify(result.report || result, null, 2);
    }
    message(result.report?.message || "预览完成");
  } catch (err) {
    message(`预览失败：${err}`);
  }
});
els.btnSyncNow?.addEventListener("click", async () => {
  try {
    await runSyncNow();
  } catch (err) {
    message(`同步失败：${err}`);
    openSettings("sync");
  }
});
els.btnSyncNowSettings?.addEventListener("click", async () => {
  try {
    await runSyncNow();
  } catch (err) {
    message(`同步失败：${err}`);
  }
});

els.btnLoadLocal?.addEventListener("click", async () => {
  await refreshState();
  if (els.localPayload) els.localPayload.value = JSON.stringify(buildLocalSyncPayload(), null, 2);
});
els.btnClearRemote?.addEventListener("click", () => {
  if (els.remotePayload) els.remotePayload.value = "";
});
els.btnFillEmptyRemote?.addEventListener("click", () => {
  if (els.remotePayload) {
    els.remotePayload.value = JSON.stringify({ accounts: [], folders: [], passkeys: [] }, null, 2);
  }
});
els.btnOpenMerge?.addEventListener("click", () => {
  if (els.mergePanel) els.mergePanel.hidden = false;
  openSettings("debug");
});
els.btnMergePreview?.addEventListener("click", async () => {
  try {
    const localObj = (els.localPayload?.value || "").trim()
      ? extractPayload(els.localPayload.value, "本地")
      : buildLocalSyncPayload();
    const remoteObj = extractPayload(els.remotePayload?.value, "远端");
    const raw = await invoke("merge_sync_payloads", {
      localJson: JSON.stringify(localObj),
      remoteJson: JSON.stringify(remoteObj),
    });
    const result = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (els.mergeResult) els.mergeResult.hidden = false;
    if (els.mergeSummary) {
      els.mergeSummary.textContent = `safe=${result.safe}\n${(result.reasons || []).join(", ")}`;
    }
    if (els.mergePayloadOut) els.mergePayloadOut.textContent = JSON.stringify(result.payload, null, 2);
    message("JSON 合并预览完成");
  } catch (err) {
    message(`预览失败：${err}`);
  }
});

els.btnUnlock?.addEventListener("click", async () => {
  try {
    lockState = await invoke("lock_unlock", { password: els.unlockPassword?.value || "" });
    if (els.unlockPassword) els.unlockPassword.value = "";
    if (els.lockError) els.lockError.textContent = "";
    applyLockUi();
    await refreshState();
    await loadSyncSettings();
    message("已解锁");
  } catch (err) {
    if (els.lockError) els.lockError.textContent = String(err);
  }
});
els.btnLockEnable?.addEventListener("click", async () => {
  try {
    lockState = await invoke("lock_enable", {
      password: els.lockPassword?.value || "",
      confirm: els.lockPassword2?.value || "",
      idleLockMinutes: Number(els.idleMinutes?.value || 5),
    });
    try {
      await invoke("set_sync_settings", { settings: collectSyncSettings() });
    } catch (_) {}
    if (els.lockPassword) els.lockPassword.value = "";
    if (els.lockPassword2) els.lockPassword2.value = "";
    applyLockUi();
    message("应用锁已启用");
  } catch (err) {
    message(`启用失败：${err}`);
  }
});
els.btnLockDisable?.addEventListener("click", async () => {
  try {
    lockState = await invoke("lock_disable", { password: els.lockPassword?.value || "" });
    applyLockUi();
    message("应用锁已关闭");
  } catch (err) {
    message(`关闭失败：${err}`);
  }
});
els.btnLockIdle?.addEventListener("click", async () => {
  try {
    lockState = await invoke("lock_set_idle", { minutes: Number(els.idleMinutes?.value || 5) });
    applyLockUi();
    message("空闲时间已保存");
  } catch (err) {
    message(String(err));
  }
});
els.btnLockNow?.addEventListener("click", async () => {
  await invoke("lock_now");
  await refreshLock();
  state = { activeAccounts: [], deletedAccounts: [], folders: [], passkeys: [], deviceName: "" };
  closeEdit();
  closeSettings();
  render();
  message("已锁定");
});

const boot = async () => {
  await refreshLock();
  if (!(lockState.enabled && lockState.locked)) {
    await refreshState();
    await loadSyncSettings();
  }
  if (activityTimer) clearInterval(activityTimer);
  activityTimer = setInterval(async () => {
    try {
      const prev = lockState.locked;
      await refreshLock();
      if (!prev && lockState.locked) {
        state = { activeAccounts: [], deletedAccounts: [], folders: [], passkeys: [], deviceName: "" };
        closeEdit();
        closeSettings();
        render();
        message("空闲超时，已锁定");
      }
    } catch (_) {}
  }, 15000);
  if (totpTimer) clearInterval(totpTimer);
  totpTimer = setInterval(() => refreshTotpRows(), 1000);
  window.addEventListener("pointerdown", () => noteActivity());
  window.addEventListener("keydown", () => noteActivity());
};

await boot();
