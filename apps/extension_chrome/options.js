const STORAGE_KEY_ACCOUNTS = "pass.accounts";

const dom = {
  payload: document.getElementById("payload"),
  refreshBtn: document.getElementById("refreshBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  clearBtn: document.getElementById("clearBtn"),
  status: document.getElementById("status")
};

init().catch((error) => {
  setStatus(`初始化失败: ${error.message}`);
});

async function init() {
  await refresh();
  dom.refreshBtn.addEventListener("click", refresh);
  dom.exportBtn.addEventListener("click", exportJson);
  dom.importBtn.addEventListener("click", importJson);
  dom.clearBtn.addEventListener("click", clearAll);
}

async function refresh() {
  const result = await chrome.storage.local.get([STORAGE_KEY_ACCOUNTS]);
  const accounts = Array.isArray(result[STORAGE_KEY_ACCOUNTS]) ? result[STORAGE_KEY_ACCOUNTS] : [];
  dom.payload.value = JSON.stringify({ accounts }, null, 2);
  setStatus(`已加载 ${accounts.length} 条账号`);
}

async function exportJson() {
  const text = dom.payload.value;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pass-extension-accounts.json";
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
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: accounts });
  setStatus(`导入完成，共 ${accounts.length} 条账号`);
}

async function clearAll() {
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: [] });
  await refresh();
  setStatus("账号已清空");
}

function setStatus(message) {
  dom.status.textContent = message;
}

