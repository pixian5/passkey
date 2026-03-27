import { invoke } from "@tauri-apps/api/core";

const els = {
  output: document.querySelector("#output"),
  deviceName: document.querySelector("#deviceName"),
  accountList: document.querySelector("#accountList"),
  trashList: document.querySelector("#trashList"),
  accountForm: document.querySelector("#accountForm"),
  accountId: document.querySelector("#accountId"),
  sites: document.querySelector("#sites"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  totpSecret: document.querySelector("#totpSecret"),
  recoveryCodes: document.querySelector("#recoveryCodes"),
  note: document.querySelector("#note"),
  btnHealth: document.querySelector("#btn-health"),
  btnDemo: document.querySelector("#btn-demo"),
  btnExport: document.querySelector("#btn-export"),
  btnSaveDevice: document.querySelector("#btn-save-device"),
  btnNew: document.querySelector("#btn-new"),
  btnDelete: document.querySelector("#btn-delete")
};

let state = {
  activeAccounts: [],
  deletedAccounts: [],
  deviceName: ""
};

const message = (text) => {
  els.output.textContent = text;
};

const formatTs = (ms) => {
  const d = new Date(ms);
  const yy = String(d.getFullYear()).slice(-2);
  return `${yy}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;
};

const render = () => {
  els.deviceName.value = state.deviceName ?? "";

  els.accountList.innerHTML = "";
  state.activeAccounts.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <button class="row-btn" data-id="${item.id}">
        <strong>${item.username || "(未命名用户)"}</strong>
        <span>${item.sites.join(", ")}</span>
        <small>更新：${formatTs(item.updatedAtMs)}</small>
      </button>
    `;
    li.querySelector("button")?.addEventListener("click", () => fillForm(item));
    els.accountList.appendChild(li);
  });

  els.trashList.innerHTML = "";
  state.deletedAccounts.forEach((item) => {
    const li = document.createElement("li");
    const wrap = document.createElement("div");
    wrap.className = "trash-row";
    wrap.innerHTML = `<span>${item.username} / ${item.sites.join(", ")}</span>`;

    const restore = document.createElement("button");
    restore.textContent = "恢复";
    restore.addEventListener("click", async () => {
      await invoke("restore_account", { id: item.id });
      await refreshState();
      message("已恢复账号");
    });

    const purge = document.createElement("button");
    purge.textContent = "彻底删除";
    purge.className = "danger";
    purge.addEventListener("click", async () => {
      await invoke("hard_delete_account", { id: item.id });
      await refreshState();
      message("已彻底删除");
    });

    wrap.append(restore, purge);
    li.appendChild(wrap);
    els.trashList.appendChild(li);
  });
};

const parseSites = (value) =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const clearForm = () => {
  els.accountId.value = "";
  els.sites.value = "";
  els.username.value = "";
  els.password.value = "";
  els.totpSecret.value = "";
  els.recoveryCodes.value = "";
  els.note.value = "";
};

const fillForm = (item) => {
  els.accountId.value = item.id;
  els.sites.value = item.sites.join(", ");
  els.username.value = item.username;
  els.password.value = item.password;
  els.totpSecret.value = item.totpSecret;
  els.recoveryCodes.value = item.recoveryCodes;
  els.note.value = item.note;
};

const collectInput = () => ({
  sites: parseSites(els.sites.value),
  username: els.username.value,
  password: els.password.value,
  totpSecret: els.totpSecret.value,
  recoveryCodes: els.recoveryCodes.value,
  note: els.note.value
});

const refreshState = async () => {
  state = await invoke("get_app_state");
  render();
};

els.btnHealth?.addEventListener("click", async () => {
  const health = await invoke("health_check");
  message(JSON.stringify(health, null, 2));
});

els.btnDemo?.addEventListener("click", async () => {
  await invoke("generate_demo_accounts");
  await refreshState();
  message("已生成演示账号");
});

els.btnExport?.addEventListener("click", async () => {
  const result = await invoke("export_csv");
  message(`导出成功：${result.csvPath}`);
});

els.btnSaveDevice?.addEventListener("click", async () => {
  await invoke("set_device_name", { deviceName: els.deviceName.value });
  await refreshState();
  message("设备名已保存");
});

els.btnNew?.addEventListener("click", clearForm);

els.btnDelete?.addEventListener("click", async () => {
  const id = els.accountId.value;
  if (!id) {
    message("请先在左侧选择账号");
    return;
  }
  await invoke("soft_delete_account", { id });
  clearForm();
  await refreshState();
  message("已移入回收站");
});

els.accountForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = els.accountId.value;
  const payload = collectInput();

  if (id) {
    await invoke("update_account", { id, input: payload });
    message("更新成功");
  } else {
    await invoke("create_account", { input: payload });
    message("创建成功");
  }

  await refreshState();
});

await refreshState();
message("已加载 codex-tauri，目标：对齐 macOS 版核心能力");
