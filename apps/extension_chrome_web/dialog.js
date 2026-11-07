/**
 * pass dialog & modal manager
 *
 * 弹窗与确认框管理器：收敛全端模态弹窗的显示/隐藏状态、忙碌按钮动效（setButtonBusy）、
 * 基于 Promise 的异步确认框模型（ConfirmationDialog），以及 ESC 键分级退出拦截器。
 */

export const openModal = (el) => {
  if (!el) return false;
  el.hidden = false;
  el.removeAttribute?.("hidden");
  return true;
};

export const closeModal = (el) => {
  if (!el) return false;
  el.hidden = true;
  el.setAttribute?.("hidden", "");
  return true;
};

export const isModalOpen = (el) => {
  if (!el) return false;
  if (el.hidden) return false;
  if (typeof el.getAttribute === "function" && el.getAttribute("hidden") !== null) return false;
  return true;
};

export const hasAnyOpenModal = (root = (typeof document !== "undefined" ? document : null)) => {
  if (!root?.querySelector) return false;
  return Boolean(root.querySelector(".modal:not([hidden])"));
};

/**
 * 按钮忙碌状态守卫
 * 返回还原函数，调用时恢复原文本并清除 is-busy 样式与禁用态
 */
export const setButtonBusy = (button, busyText) => {
  if (!button) return () => {};
  const originalText = button.textContent;
  const wasDisabled = Boolean(button.disabled);
  button.disabled = true;
  button.classList?.add?.("is-busy");
  button.textContent = busyText;

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    button.disabled = wasDisabled;
    button.classList?.remove?.("is-busy");
    button.textContent = originalText;
  };
};

/**
 * 异步模态确认框基类
 */
export class ConfirmationDialog {
  constructor(options = {}) {
    this.modalEl = options.modalEl || null;
    this._resolve = null;
  }

  request(setupFn) {
    if (this._resolve) {
      this.close(false);
    }
    return new Promise((resolve) => {
      this._resolve = resolve;
      if (typeof setupFn === "function") {
        setupFn();
      }
      openModal(this.modalEl);
    });
  }

  close(confirmed = false) {
    closeModal(this.modalEl);
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(confirmed);
  }

  isOpen() {
    return isModalOpen(this.modalEl);
  }
}

/**
 * 通用操作确认弹窗（#actionConfirmModal）
 */
export class ActionConfirmDialog extends ConfirmationDialog {
  constructor(elements = {}) {
    super({ modalEl: elements.modalEl });
    this.titleEl = elements.titleEl || null;
    this.messageEl = elements.messageEl || null;
    this.confirmBtn = elements.confirmBtn || null;
    this.cancelBtn = elements.cancelBtn || null;
  }

  requestConfirm({
    title = "确认操作",
    message = "确定继续吗？",
    confirmText = "确认",
    danger = false,
  } = {}) {
    return this.request(() => {
      if (this.titleEl) this.titleEl.textContent = title;
      if (this.messageEl) this.messageEl.textContent = message || "确定继续吗？";
      if (this.confirmBtn) {
        this.confirmBtn.textContent = confirmText;
        this.confirmBtn.classList?.toggle?.("primary", !danger);
        this.confirmBtn.classList?.toggle?.("danger", danger);
      }
      this.confirmBtn?.focus?.();
    });
  }
}

/**
 * ESC 按键多级弹窗关闭分发器
 */
export class ModalEscapeHandler {
  constructor() {
    this.handlers = [];
  }

  register(priority, checkOpenFn, closeFn) {
    this.handlers.push({ priority, checkOpenFn, closeFn });
    this.handlers.sort((a, b) => a.priority - b.priority);
  }

  handleEscape() {
    for (const h of this.handlers) {
      if (h.checkOpenFn()) {
        h.closeFn();
        return true;
      }
    }
    return false;
  }
}
