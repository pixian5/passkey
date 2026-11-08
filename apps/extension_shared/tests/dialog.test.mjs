import test from "node:test";
import assert from "node:assert/strict";

import {
  openModal,
  closeModal,
  isModalOpen,
  hasAnyOpenModal,
  setButtonBusy,
  ConfirmationDialog,
  ActionConfirmDialog,
  ModalEscapeHandler,
  FIXED_NEW_ACCOUNT_FOLDER_ID,
  isFixedFolder,
  formatFolderModalConfig,
  formatFolderSitesModalConfig,
} from "../../codex-tauri/src/dialog.js";

function createMockElement(initialHidden = true) {
  let hidden = initialHidden;
  const classes = new Set();
  return {
    get hidden() {
      return hidden;
    },
    set hidden(val) {
      hidden = Boolean(val);
    },
    getAttribute(name) {
      if (name === "hidden") return hidden ? "" : null;
      return null;
    },
    setAttribute(name) {
      if (name === "hidden") hidden = true;
    },
    removeAttribute(name) {
      if (name === "hidden") hidden = false;
    },
    classList: {
      add(cls) {
        classes.add(cls);
      },
      remove(cls) {
        classes.delete(cls);
      },
      toggle(cls, force) {
        if (force === undefined) {
          if (classes.has(cls)) classes.delete(cls);
          else classes.add(cls);
        } else if (force) classes.add(cls);
        else classes.delete(cls);
      },
      has(cls) {
        return classes.has(cls);
      },
    },
    textContent: "",
    disabled: false,
    focusCalled: false,
    focus() {
      this.focusCalled = true;
    },
  };
}

test("openModal and closeModal update hidden attributes accurately", () => {
  const el = createMockElement(true);
  assert.equal(isModalOpen(el), false);

  openModal(el);
  assert.equal(el.hidden, false);
  assert.equal(isModalOpen(el), true);

  closeModal(el);
  assert.equal(el.hidden, true);
  assert.equal(isModalOpen(el), false);
});

test("hasAnyOpenModal checks for active modal in document querySelector", () => {
  const root = {
    querySelector(selector) {
      if (selector === ".modal:not([hidden])") return { id: "openModal" };
      return null;
    },
  };
  assert.equal(hasAnyOpenModal(root), true);

  const emptyRoot = {
    querySelector() {
      return null;
    },
  };
  assert.equal(hasAnyOpenModal(emptyRoot), false);
});

test("setButtonBusy modifies and restores button state cleanly", () => {
  const button = createMockElement(false);
  button.textContent = "保存";
  button.disabled = false;

  const restore = setButtonBusy(button, "正在保存…");
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "正在保存…");
  assert.equal(button.classList.has("is-busy"), true);

  restore();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "保存");
  assert.equal(button.classList.has("is-busy"), false);

  // Calling restore multiple times is idempotent
  restore();
  assert.equal(button.textContent, "保存");
});

test("ConfirmationDialog manages async requests, confirms, and cancels", async () => {
  const modalEl = createMockElement(true);
  const dialog = new ConfirmationDialog({ modalEl });

  // 1. Confirm flow
  const p1 = dialog.request();
  assert.equal(dialog.isOpen(), true);
  dialog.close(true);
  const res1 = await p1;
  assert.equal(res1, true);
  assert.equal(dialog.isOpen(), false);

  // 2. Cancel flow
  const p2 = dialog.request();
  assert.equal(dialog.isOpen(), true);
  dialog.close(false);
  const res2 = await p2;
  assert.equal(res2, false);

  // 3. New request supersedes pending request
  const p3 = dialog.request();
  const p4 = dialog.request();
  dialog.close(true);
  const res3 = await p3;
  const res4 = await p4;
  assert.equal(res3, false); // Cancelled by subsequent request
  assert.equal(res4, true);
});

test("ActionConfirmDialog customizes title, message, and button styles", async () => {
  const modalEl = createMockElement(true);
  const titleEl = createMockElement();
  const messageEl = createMockElement();
  const confirmBtn = createMockElement();
  const cancelBtn = createMockElement();

  const dialog = new ActionConfirmDialog({
    modalEl,
    titleEl,
    messageEl,
    confirmBtn,
    cancelBtn,
  });

  const p = dialog.requestConfirm({
    title: "永久删除",
    message: "确认删除该凭据吗？",
    confirmText: "删除",
    danger: true,
  });

  assert.equal(titleEl.textContent, "永久删除");
  assert.equal(messageEl.textContent, "确认删除该凭据吗？");
  assert.equal(confirmBtn.textContent, "删除");
  assert.equal(confirmBtn.classList.has("danger"), true);
  assert.equal(confirmBtn.classList.has("primary"), false);
  assert.equal(confirmBtn.focusCalled, true);

  dialog.close(true);
  const res = await p;
  assert.equal(res, true);
});

test("ModalEscapeHandler triggers highest priority open handler", () => {
  const escapeHandler = new ModalEscapeHandler();
  let firstClosed = false;
  let secondClosed = false;

  escapeHandler.register(
    20,
    () => true,
    () => {
      secondClosed = true;
    }
  );
  escapeHandler.register(
    10,
    () => true,
    () => {
      firstClosed = true;
    }
  );

  const handled = escapeHandler.handleEscape();
  assert.equal(handled, true);
  assert.equal(firstClosed, true);
  assert.equal(secondClosed, false);
});

test("isFixedFolder identifies fixed new account folder ID accurately", () => {
  assert.equal(isFixedFolder(FIXED_NEW_ACCOUNT_FOLDER_ID), true);
  assert.equal(isFixedFolder("F16A2C4E-4A2A-43D5-A670-3F1767D41001"), true);
  assert.equal(isFixedFolder("custom-folder"), false);
  assert.equal(isFixedFolder(null), false);
});

test("formatFolderModalConfig configures new folder and rename folder dialogs", () => {
  // New folder mode
  const newConfig = formatFolderModalConfig(null);
  assert.deepEqual(newConfig, {
    error: null,
    isRename: false,
    title: "新建文件夹",
    name: "",
    submitText: "创建",
    targetId: "",
  });

  // Rename folder mode
  const renameConfig = formatFolderModalConfig({ id: "folder-123", name: "工作" });
  assert.deepEqual(renameConfig, {
    error: null,
    isRename: true,
    title: "重命名文件夹",
    name: "工作",
    submitText: "保存",
    targetId: "folder-123",
  });

  // Attempt to rename fixed folder
  const fixedConfig = formatFolderModalConfig({ id: FIXED_NEW_ACCOUNT_FOLDER_ID });
  assert.equal(fixedConfig.error, "固定文件夹不可重命名");
  assert.equal(fixedConfig.isRename, true);
});

test("formatFolderSitesModalConfig formats title, matched sites, and autoAdd flag", () => {
  assert.equal(formatFolderSitesModalConfig(null), null);

  const config = formatFolderSitesModalConfig({
    id: "f-sites",
    name: "财务",
    matchedSites: ["bank.com", "tax.gov"],
    autoAddMatchingSites: true,
  });
  assert.deepEqual(config, {
    targetId: "f-sites",
    title: "加入「财务」中的指定网站账号",
    sitesText: "bank.com\ntax.gov",
    autoAdd: true,
  });
});

