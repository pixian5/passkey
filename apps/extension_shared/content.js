import { normalizeDomain } from "./account_core.js";

const PASS_LOGIN_COOLDOWN_MS = 5000;
const WEB_AUTHN_BRIDGE_SOURCE = "pass-webauthn-bridge";
const WEB_AUTHN_REQUEST_TYPE = "PASSKEY_REQUEST";
const WEB_AUTHN_RESPONSE_TYPE = "PASSKEY_RESPONSE";
const WEB_AUTHN_NOTICE_TYPE = "PASSKEY_NOTICE";
const PASS_PAGE_TOAST_ID = "pass-page-toast";
const PASS_PAGE_TOAST_DURATION_MS = 3000;
const PASSKEY_USE_BROWSER_FALLBACK = "__PASSKEY_USE_BROWSER_FALLBACK__";
const PASSKEY_LOG_PREFIX = "[Pass content]";
const PASS_EXTENSION_VERSION = "0.2.3";
const PASS_FILL_CHOOSER_ID = "pass-fill-chooser";
const PASS_FILL_LIST_COOLDOWN_MS = 400;

let lastPromptKey = "";
let lastPromptAt = 0;
let passPageToastTimer = null;
let fillChooserHost = null;
let fillChooserShadow = null;
let fillChooserHideTimer = null;
let fillChooserListInFlight = false;
let fillChooserLastListAt = 0;
let fillChooserActiveInput = null;
let fillChooserLocked = false;

function logPasskeyContent(event, details = {}) {
  try {
    console.info(PASSKEY_LOG_PREFIX, event, details);
  } catch {
    // Ignore logging failures.
  }
}

if (!globalThis.__passContentBridgeInstalled) {
  globalThis.__passContentBridgeInstalled = true;
  installPassContentBridge();
}

function installPassContentBridge() {
  try {
    window.__passContentVersion = PASS_EXTENSION_VERSION;
    document.documentElement?.setAttribute("data-pass-content-version", PASS_EXTENSION_VERSION);
    console.info(`${PASSKEY_LOG_PREFIX} loaded`, {
      version: PASS_EXTENSION_VERSION,
      href: window.location.href,
    });
  } catch {
    // Ignore bootstrap diagnostics failures.
  }

  window.addEventListener("message", onWebAuthnBridgeMessage, false);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "PASS_LOCKED") {
      fillChooserLocked = true;
      hideFillChooser();
      return;
    }
    if (message?.type === "PASS_UNLOCKED") {
      fillChooserLocked = false;
      return;
    }
  });

  document.addEventListener("focusin", onFillFieldFocusIn, true);
  document.addEventListener("pointerdown", onDocumentPointerDownForFillChooser, true);
  window.addEventListener("scroll", () => hideFillChooser(), true);
  window.addEventListener("resize", () => hideFillChooser());

  document.addEventListener(
    "submit",
    (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    // Allow only the replay submit to pass without interception.
    if (form.dataset.passResubmitting === "1") {
      delete form.dataset.passResubmitting;
      return;
    }

    const payload = extractCredentialPayload(form);
    if (!payload) return;

    const submitter = event.submitter;
    event.preventDefault();

    let resumed = false;
    const resumeOnce = () => {
      if (resumed) return;
      resumed = true;
      resumeSubmit(form, submitter);
    };

    chrome.runtime.sendMessage(
      {
        type: "PASS_CONTENT_CHECK_LOGIN",
        payload,
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError || !response?.ok || !response?.shouldPrompt) {
          resumeOnce();
          return;
        }
        const mode = response.mode === "update" ? "update" : "create";
        const promptKey = `${payload.domain}|${payload.username}|${mode}`;
        const now = Date.now();
        if (promptKey === lastPromptKey && now - lastPromptAt < PASS_LOGIN_COOLDOWN_MS) {
          resumeOnce();
          return;
        }
        lastPromptKey = promptKey;
        lastPromptAt = now;
        const actionText = mode === "update" ? "更新密码" : "保存账号";
        const confirmed = window.confirm(
          `检测到登录行为。\n域名: ${payload.domain}\n用户名: ${payload.username}\n是否${actionText}到 Pass？`
        );
        if (!confirmed) {
          resumeOnce();
          return;
        }
        chrome.runtime.sendMessage(
          {
            type: "PASS_SAVE_FROM_LOGIN",
            payload,
          },
          () => {
            resumeOnce();
          }
        );
        setTimeout(resumeOnce, 250);
      }
    );

    // Fallback in case runtime message callback is delayed.
    setTimeout(resumeOnce, 800);
    },
    true
  );
}

function extractCredentialPayload(form) {
  const inputs = Array.from(form.querySelectorAll("input"));
  const passwordInputs = inputs.filter((input) => {
    return isVisible(input) && (input.type || "").toLowerCase() === "password" && input.value;
  });
  if (passwordInputs.length === 0) return null;

  const passwordInput = passwordInputs[0];
  const password = passwordInput.value.trim();
  if (!password) return null;

  const usernameInput = findUsernameInput(inputs, passwordInput);
  const username = (usernameInput?.value || "").trim();
  if (!username) return null;

  const domain = normalizeDomain(window.location.hostname);
  if (!domain) return null;

  return {
    domain,
    username,
    password,
  };
}

function findUsernameInput(inputs, passwordInput) {
  const candidates = inputs.filter((input) => {
    if (input === passwordInput) return false;
    if (!isVisible(input)) return false;
    const type = (input.type || "").toLowerCase();
    const semantic = `${input.name || ""} ${input.id || ""} ${input.autocomplete || ""}`.toLowerCase();
    return (
      type === "email" ||
      type === "text" ||
      type === "tel" ||
      semantic.includes("user") ||
      semantic.includes("email") ||
      semantic.includes("login")
    );
  });

  if (candidates.length > 0) return candidates[0];

  const fallback = inputs.filter((input) => {
    if (!isVisible(input)) return false;
    return input.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  return fallback[0] || null;
}

function resumeSubmit(form, submitter) {
  form.dataset.passResubmitting = "1";

  if (submitter instanceof HTMLElement && typeof form.requestSubmit === "function") {
    form.requestSubmit(submitter);
    return;
  }
  form.submit();
}

function isVisible(input) {
  if (!(input instanceof HTMLElement)) return false;
  if ((input.type || "").toLowerCase() === "hidden") return false;
  if (input.disabled || input.readOnly) return false;
  const style = window.getComputedStyle(input);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (Number(style.opacity || "1") === 0) return false;
  const rect = input.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  return true;
}

function inputSemanticText(element) {
  if (!(element instanceof HTMLElement)) return "";
  return [
    element.getAttribute?.("name"),
    element.id,
    element.getAttribute?.("autocomplete"),
    element.getAttribute?.("placeholder"),
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("data-testid"),
  ].map((value) => String(value || "").toLowerCase()).join(" ");
}

function isPasswordInput(element) {
  return element instanceof HTMLInputElement
    && isVisible(element)
    && String(element.type || "").toLowerCase() === "password";
}

function isUsernameLikeInput(element, { strict = true } = {}) {
  if (!(element instanceof HTMLInputElement)) return false;
  if (!isVisible(element)) return false;
  if (isPasswordInput(element)) return false;
  const type = String(element.type || "text").toLowerCase();
  if (!["text", "email", "tel", "url", "search", ""].includes(type)) return false;
  const semantic = inputSemanticText(element);
  const autocomplete = String(element.autocomplete || "").toLowerCase();
  if (
    autocomplete.includes("username")
    || autocomplete.includes("email")
    || autocomplete === "tel"
    || autocomplete.includes("nickname")
  ) {
    return true;
  }
  if (
    semantic.includes("user")
    || semantic.includes("email")
    || semantic.includes("login")
    || semantic.includes("account")
    || semantic.includes("phone")
    || semantic.includes("mobile")
    || semantic.includes("member")
  ) {
    return true;
  }
  // Near a password field, allow plain text/email inputs even without semantic hints.
  return !strict && (type === "text" || type === "email" || type === "tel" || type === "");
}

function isFillableCredentialInput(element) {
  return isPasswordInput(element) || isUsernameLikeInput(element, { strict: true });
}

function collectVisiblePasswordInputs(scope = document) {
  return Array.from(scope.querySelectorAll('input[type="password"]')).filter(isVisible);
}

function findRelatedPasswordInput(usernameInput) {
  if (!(usernameInput instanceof HTMLInputElement)) return null;
  const form = usernameInput.form || usernameInput.closest("form");
  const scope = form || document;
  const passwordInputs = collectVisiblePasswordInputs(scope);
  if (passwordInputs.length === 0) return collectVisiblePasswordInputs(document)[0] || null;
  const sameForm = passwordInputs.find((input) => {
    return input.form === usernameInput.form || (form && form.contains(input));
  });
  if (sameForm) return sameForm;
  const following = passwordInputs.find((input) => {
    return Boolean(usernameInput.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  return following || passwordInputs[0] || null;
}

function scoreUsernameCandidate(input, passwordInput) {
  let score = 0;
  const type = String(input.type || "text").toLowerCase();
  const semantic = inputSemanticText(input);
  const autocomplete = String(input.autocomplete || "").toLowerCase();
  if (autocomplete.includes("username") || autocomplete.includes("email")) score += 50;
  if (type === "email") score += 20;
  if (type === "text" || type === "") score += 8;
  if (type === "tel") score += 6;
  if (semantic.includes("user") || semantic.includes("login") || semantic.includes("account")) score += 25;
  if (semantic.includes("email")) score += 22;
  if (semantic.includes("phone") || semantic.includes("mobile")) score += 12;
  if (passwordInput) {
    if (input.form && passwordInput.form && input.form === passwordInput.form) score += 30;
    if (passwordInput.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING) score += 15;
  }
  if (input.readOnly || input.disabled) score -= 100;
  return score;
}

function findRelatedUsernameInput(passwordInput) {
  if (!(passwordInput instanceof HTMLInputElement)) return null;
  const form = passwordInput.form || passwordInput.closest("form");
  const scopes = [];
  if (form) scopes.push(form);
  scopes.push(document);

  const seen = new Set();
  const candidates = [];
  for (const scope of scopes) {
    for (const input of scope.querySelectorAll("input")) {
      if (!(input instanceof HTMLInputElement) || seen.has(input) || input === passwordInput) continue;
      seen.add(input);
      // Prefer semantic matches; if none, fall back to plain text inputs in the same form.
      if (isUsernameLikeInput(input, { strict: true }) || (form && form.contains(input) && isUsernameLikeInput(input, { strict: false }))) {
        candidates.push(input);
      }
    }
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => scoreUsernameCandidate(right, passwordInput) - scoreUsernameCandidate(left, passwordInput));
  return candidates[0] || null;
}

function setNativeInputValue(input, value) {
  if (!(input instanceof HTMLInputElement)) return;
  try {
    input.focus({ preventScroll: true });
  } catch {
    try { input.focus(); } catch { /* ignore */ }
  }
  const proto = window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  // Fire a broader event set so React/Vue/Angular controlled fields update.
  try {
    input.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertReplacementText", data: value }));
  } catch {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

function fillFocusedCredentialFields(username, password) {
  const active = fillChooserActiveInput;
  let usernameInput = null;
  let passwordInput = null;
  const wantedUsername = String(username || "");
  const wantedPassword = String(password || "");

  if (active instanceof HTMLInputElement) {
    if (isPasswordInput(active)) {
      passwordInput = active;
      usernameInput = findRelatedUsernameInput(active);
    } else {
      usernameInput = active;
      passwordInput = findRelatedPasswordInput(active);
    }
  }

  // Always resolve the pair so selecting from either field fills both.
  if (!passwordInput) {
    passwordInput = collectVisiblePasswordInputs(document)[0] || null;
  }
  if (!usernameInput && passwordInput) {
    usernameInput = findRelatedUsernameInput(passwordInput);
  }
  if (usernameInput && !passwordInput) {
    passwordInput = findRelatedPasswordInput(usernameInput);
  }

  let filledUsername = false;
  let filledPassword = false;
  if (usernameInput && wantedUsername) {
    setNativeInputValue(usernameInput, wantedUsername);
    filledUsername = usernameInput.value === wantedUsername || Boolean(usernameInput.value);
  }
  if (passwordInput && wantedPassword) {
    setNativeInputValue(passwordInput, wantedPassword);
    filledPassword = passwordInput.value === wantedPassword || Boolean(passwordInput.value);
  }

  return {
    filledUsername,
    filledPassword,
    filledAny: filledUsername || filledPassword,
    filledBoth: Boolean(wantedUsername ? filledUsername : true) && Boolean(wantedPassword ? filledPassword : true)
      && (filledUsername || filledPassword),
  };
}

function hideFillChooser() {
  if (fillChooserHideTimer) {
    clearTimeout(fillChooserHideTimer);
    fillChooserHideTimer = null;
  }
  if (fillChooserHost) {
    fillChooserHost.remove();
    fillChooserHost = null;
    fillChooserShadow = null;
  }
}

function positionFillChooserNear(input) {
  if (!fillChooserHost || !(input instanceof HTMLElement)) return;
  const rect = input.getBoundingClientRect();
  const top = Math.min(window.innerHeight - 12, Math.max(8, rect.bottom + 6));
  const left = Math.min(window.innerWidth - 280, Math.max(8, rect.left));
  fillChooserHost.style.top = `${top}px`;
  fillChooserHost.style.left = `${left}px`;
}

function ensureFillChooserHost() {
  if (fillChooserHost && fillChooserShadow) return fillChooserShadow;
  const host = document.createElement("div");
  host.id = PASS_FILL_CHOOSER_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483646";
  host.style.maxWidth = "min(360px, calc(100vw - 16px))";
  const shadow = host.attachShadow({ mode: "closed" });
  fillChooserHost = host;
  fillChooserShadow = shadow;
  document.documentElement.appendChild(host);
  return shadow;
}

function renderFillChooser(accounts, input) {
  hideFillChooser();
  if (!Array.isArray(accounts) || accounts.length === 0) return;
  fillChooserActiveInput = input;
  const shadow = ensureFillChooserHost();
  positionFillChooserNear(input);

  const root = document.createElement("div");
  root.style.background = "#ffffff";
  root.style.border = "1px solid #c7dafb";
  root.style.borderRadius = "10px";
  root.style.boxShadow = "0 10px 26px rgba(36, 67, 109, 0.22)";
  root.style.padding = "8px";
  root.style.font = '12px/1.4 "SF Pro Text", "PingFang SC", sans-serif';
  root.style.color = "#1d314d";

  const title = document.createElement("div");
  title.textContent = "Pass 填充账号";
  title.style.fontWeight = "600";
  title.style.fontSize = "13px";
  title.style.margin = "2px 4px 8px";
  root.appendChild(title);

  const list = document.createElement("div");
  list.style.display = "grid";
  list.style.gap = "6px";

  for (const account of accounts) {
    const button = document.createElement("button");
    button.type = "button";
    button.style.display = "grid";
    button.style.gap = "2px";
    button.style.width = "100%";
    button.style.textAlign = "left";
    button.style.border = "1px solid #d1e3ff";
    button.style.borderRadius = "8px";
    button.style.padding = "7px 8px";
    button.style.background = "#f7fbff";
    button.style.cursor = "pointer";
    button.style.color = "inherit";
    button.style.font = "inherit";

    const nameLine = document.createElement("div");
    nameLine.textContent = String(account?.username || "未命名账号");
    nameLine.style.fontWeight = "600";
    button.appendChild(nameLine);

    const siteLine = document.createElement("div");
    const sites = Array.isArray(account?.sites) ? account.sites.filter(Boolean) : [];
    siteLine.textContent = sites.slice(0, 3).join(" · ") || "匹配当前站点";
    siteLine.style.fontSize = "11px";
    siteLine.style.color = "#4b6485";
    button.appendChild(siteLine);

    button.addEventListener("mousedown", (event) => {
      // Keep focus on the field while selecting.
      event.preventDefault();
    });
    button.addEventListener("click", (event) => {
      if (event.isTrusted === false) return;
      void applyFillAccount(String(account?.accountId || ""));
    });
    list.appendChild(button);
  }

  root.appendChild(list);

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.justifyContent = "flex-end";
  footer.style.marginTop = "8px";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.textContent = "关闭";
  closeBtn.style.border = "1px solid #9ab9eb";
  closeBtn.style.borderRadius = "8px";
  closeBtn.style.padding = "4px 8px";
  closeBtn.style.background = "#fff";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.font = "inherit";
  closeBtn.addEventListener("click", (event) => {
    if (event.isTrusted === false) return;
    hideFillChooser();
  });
  footer.appendChild(closeBtn);
  root.appendChild(footer);
  shadow.appendChild(root);
}

function runtimeSendMessage(message) {
  return new Promise((resolve) => {
    if (!isRuntimeAvailable()) {
      resolve({ ok: false, error: "扩展上下文不可用" });
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message || "消息发送失败" });
          return;
        }
        resolve(response || { ok: false, error: "空响应" });
      });
    } catch (error) {
      resolve({ ok: false, error: error?.message || String(error || "消息发送失败") });
    }
  });
}

async function showFillChooserForInput(input) {
  if (fillChooserLocked || !isFillableCredentialInput(input)) return;
  const now = Date.now();
  if (fillChooserListInFlight) return;
  if (now - fillChooserLastListAt < PASS_FILL_LIST_COOLDOWN_MS && fillChooserHost) {
    positionFillChooserNear(input);
    fillChooserActiveInput = input;
    return;
  }

  fillChooserListInFlight = true;
  try {
    const response = await runtimeSendMessage({ type: "PASS_CONTENT_LIST_FILL_ACCOUNTS" });
    fillChooserLastListAt = Date.now();
    if (!response?.ok) {
      if (response?.locked) fillChooserLocked = true;
      hideFillChooser();
      return;
    }
    const accounts = Array.isArray(response.accounts) ? response.accounts : [];
    if (accounts.length === 0) {
      hideFillChooser();
      return;
    }
    renderFillChooser(accounts, input);
  } finally {
    fillChooserListInFlight = false;
  }
}

async function applyFillAccount(accountId) {
  const id = String(accountId || "").trim();
  if (!id) return;
  const response = await runtimeSendMessage({
    type: "PASS_CONTENT_FILL_ACCOUNT",
    payload: { accountId: id },
  });
  if (!response?.ok) {
    if (response?.locked) {
      fillChooserLocked = true;
      hideFillChooser();
      showPassPageToast(response.error || "扩展已锁定", "warning");
      return;
    }
    showPassPageToast(response?.error || "填充失败", "error");
    return;
  }
  const result = fillFocusedCredentialFields(response.username || "", response.password || "");
  hideFillChooser();
  if (result.filledUsername && result.filledPassword) {
    showPassPageToast(`已填充用户名和密码：${response.username || "账号"}`, "success");
  } else if (result.filledPassword && !result.filledUsername) {
    showPassPageToast(`已填充密码，但未找到用户名框：${response.username || ""}`.trim(), "warning");
  } else if (result.filledUsername && !result.filledPassword) {
    showPassPageToast(`已填充用户名，但未找到密码框：${response.username || ""}`.trim(), "warning");
  } else {
    showPassPageToast("未找到可填充的用户名/密码输入框", "warning");
  }
}

function onFillFieldFocusIn(event) {
  const target = event.target;
  if (!isFillableCredentialInput(target)) return;
  void showFillChooserForInput(target);
}

function onDocumentPointerDownForFillChooser(event) {
  if (!fillChooserHost) return;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  if (path.includes(fillChooserHost)) return;
  if (event.target === fillChooserActiveInput) return;
  hideFillChooser();
}

function onWebAuthnBridgeMessage(event) {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== WEB_AUTHN_BRIDGE_SOURCE) return;
  if (data.type === WEB_AUTHN_NOTICE_TYPE) {
    handleWebAuthnBridgeNotice(data);
    return;
  }
  if (data.type !== WEB_AUTHN_REQUEST_TYPE) return;

  const requestId = String(data.requestId || "");
  if (!requestId) return;

  const payload = {
    operation: data.operation,
    publicKey: data.publicKey,
    origin: window.location.origin,
    host: window.location.hostname,
  };

  logPasskeyContent("bridge-request-received", {
    requestId,
    operation: String(payload.operation || ""),
    host: String(payload.host || ""),
    rpId: String(payload?.publicKey?.rp?.id || payload?.publicKey?.rpId || ""),
  });

  void handleWebAuthnBridgeRequest(requestId, payload);
}

function handleWebAuthnBridgeNotice(data) {
  const message = String(data?.message || "").trim();
  if (!message) return;
  logPasskeyContent("bridge-notice-received", {
    reason: String(data?.reason || ""),
    operation: String(data?.operation || ""),
    message,
  });
  showPassPageToast(message);
}

async function handleWebAuthnBridgeRequest(requestId, payload) {
  try {
    if (!isRuntimeAvailable()) {
      logPasskeyContent("bridge-runtime-unavailable", {
        requestId,
        operation: String(payload?.operation || ""),
      });
      postWebAuthnBridgeResponse(requestId, {
        ok: false,
        error: {
          name: "NotSupportedError",
          message: "扩展上下文已失效，请刷新页面后重试",
          code: "PASSKEY_CONTEXT_INVALIDATED",
        },
      });
      return;
    }

    logPasskeyContent("bridge-request-forwarded", {
      requestId,
      operation: String(payload?.operation || ""),
      viaChooser: payload?.operation === "get",
    });
    const response = payload?.operation === "get"
      ? await handlePasskeyGetWithChooser(payload)
      : await sendPasskeyBridgeOperation(payload);
    logPasskeyContent("bridge-response-received", {
      requestId,
      operation: String(payload?.operation || ""),
      ok: Boolean(response?.ok),
      errorCode: String(response?.error?.code || ""),
      createMode: String(response?.result?.createMode || ""),
      createCompatMethod: String(response?.result?.createCompatMethod || ""),
    });
    if (response?.ok) {
      if (payload?.operation === "create") {
        const createMode = String(response?.result?.createMode || "").toLowerCase();
        const compatLabel = formatPasskeyCreateCompatToastLabel(response?.result?.createCompatMethod);
        if (createMode === "replaced") {
          showPassPageToast(`Pass 已更新通行密钥${compatLabel ? `（${compatLabel}）` : ""}`);
        } else if (createMode === "existing") {
          showPassPageToast(`Pass 已存在同账号通行密钥，已复用${compatLabel ? `（${compatLabel}）` : ""}`);
        } else {
          showPassPageToast(`Pass 已保存通行密钥${compatLabel ? `（${compatLabel}）` : ""}`);
        }
      } else if (payload?.operation === "get") {
        const siteLabel = resolvePasskeyReadSiteLabel(payload, response);
        const accountLabel = resolvePasskeyReadAccountLabel(response);
        if (accountLabel) {
          showPassPageToast(`${siteLabel} 已读取密钥 ${accountLabel}`);
        } else {
          showPassPageToast(`${siteLabel} 已读取密钥`);
        }
      }
    }
    postWebAuthnBridgeResponse(requestId, response);
  } catch (error) {
    logPasskeyContent("bridge-request-failed", {
      requestId,
      operation: String(payload?.operation || ""),
      name: error?.name || "Error",
      message: error?.message || String(error || ""),
    });
    postWebAuthnBridgeResponse(requestId, {
      ok: false,
      error: {
        name: "OperationError",
        message: error?.message || String(error || "通行密钥处理失败"),
        code: "PASSKEY_HANDLE_FAILED",
      },
    });
  }
}

function formatPasskeyCreateCompatToastLabel(method) {
  const value = String(method || "").trim().toLowerCase();
  if (value === "user_name_fallback+rs256") return "命中兼容2+3";
  if (value === "user_name_fallback") return "命中兼容2";
  if (value === "rs256") return "命中兼容3";
  if (value === "standard") return "命中标准托管";
  return "";
}

function resolvePasskeyReadSiteLabel(payload, response) {
  const hintedRpId = normalizeDomain(response?.result?.assertionHint?.rpId || "");
  if (hintedRpId) return hintedRpId;
  const rpId = normalizeDomain(payload?.publicKey?.rpId || "");
  if (rpId) return rpId;
  const host = normalizeDomain(payload?.host || window.location.hostname || "");
  if (host) return host;
  return "当前网站";
}

function resolvePasskeyReadAccountLabel(response) {
  const userName = String(response?.result?.assertionHint?.userName || "").trim();
  if (userName) return userName;
  const displayName = String(response?.result?.assertionHint?.displayName || "").trim();
  if (displayName) return displayName;
  return "";
}

function showPassPageToast(message, tone = "success") {
  const text = String(message || "").trim();
  if (!text) return;

  let toast = document.getElementById(PASS_PAGE_TOAST_ID);
  if (!(toast instanceof HTMLDivElement)) {
    toast = document.createElement("div");
    toast.id = PASS_PAGE_TOAST_ID;
    toast.style.position = "fixed";
    toast.style.top = "14px";
    toast.style.right = "14px";
    toast.style.zIndex = "2147483647";
    toast.style.maxWidth = "min(420px, calc(100vw - 28px))";
    toast.style.padding = "10px 12px";
    toast.style.borderRadius = "10px";
    toast.style.font = '600 24px/1.4 "SF Pro Text", "PingFang SC", sans-serif';
    toast.style.pointerEvents = "none";
    toast.style.opacity = "0";
    toast.style.transition = "opacity 140ms ease-out";
    (document.documentElement || document.body).appendChild(toast);
  }

  const styles = {
    success: {
      border: "1px solid #63a56a",
      background: "linear-gradient(180deg, #e8f8ea 0%, #d5f2d9 100%)",
      color: "#1d5b2c",
      shadow: "0 12px 28px rgba(24, 68, 33, 0.22)",
    },
    error: {
      border: "1px solid #d46a6a",
      background: "linear-gradient(180deg, #fdecec 0%, #f8d4d4 100%)",
      color: "#8a1f1f",
      shadow: "0 12px 28px rgba(120, 24, 24, 0.22)",
    },
    warning: {
      border: "1px solid #d2b14a",
      background: "linear-gradient(180deg, #fff8df 0%, #ffe9a8 100%)",
      color: "#6a5208",
      shadow: "0 12px 28px rgba(120, 92, 16, 0.2)",
    },
  };
  const style = styles[tone] || styles.success;
  toast.style.border = style.border;
  toast.style.background = style.background;
  toast.style.color = style.color;
  toast.style.boxShadow = style.shadow;
  toast.textContent = text;
  toast.style.opacity = "1";

  if (passPageToastTimer != null) {
    clearTimeout(passPageToastTimer);
    passPageToastTimer = null;
  }
  passPageToastTimer = window.setTimeout(() => {
    const current = document.getElementById(PASS_PAGE_TOAST_ID);
    if (!(current instanceof HTMLDivElement)) return;
    current.style.opacity = "0";
  }, PASS_PAGE_TOAST_DURATION_MS);
}

async function handlePasskeyGetWithChooser(payload) {
  logPasskeyContent("chooser-candidates-requested", {
    host: String(payload?.host || ""),
    rpId: String(payload?.publicKey?.rpId || ""),
  });
  const candidateResponse = await sendPasskeyBridgeOperation({
    ...payload,
    operation: "getCandidates",
  });

  logPasskeyContent("chooser-candidates-response", {
    ok: Boolean(candidateResponse?.ok),
    count: Array.isArray(candidateResponse?.result?.candidates)
      ? candidateResponse.result.candidates.length
      : 0,
    errorCode: String(candidateResponse?.error?.code || ""),
  });

  if (!candidateResponse?.ok) {
    return await sendPasskeyBridgeOperation(payload);
  }

  const candidates = Array.isArray(candidateResponse?.result?.candidates)
    ? candidateResponse.result.candidates
    : [];
  if (candidates.length === 0) {
    logPasskeyContent("chooser-skipped", { reason: "no-candidate" });
    return await sendPasskeyBridgeOperation(payload);
  }

  const selectedId = await selectPasskeyCandidate(candidates);
  logPasskeyContent("chooser-selection-finished", {
    selectedId: String(selectedId || ""),
    usedBrowserFallback: selectedId === PASSKEY_USE_BROWSER_FALLBACK,
  });
  if (!selectedId || selectedId === PASSKEY_USE_BROWSER_FALLBACK) {
    return {
      ok: false,
      error: {
        name: "AbortError",
        message: "用户关闭 Pass 通行密钥选择，继续使用浏览器通行密钥",
        code: "PASSKEY_USE_BROWSER",
      },
    };
  }

  const nextPayload = {
    ...payload,
    publicKey: {
      ...(payload.publicKey || {}),
      allowCredentials: [
        {
          idB64u: selectedId,
          type: "public-key",
          transports: ["internal"],
        },
      ],
    },
  };
  return await sendPasskeyBridgeOperation(nextPayload);
}

function sendPasskeyBridgeOperation(payload) {
  return new Promise((resolve) => {
    if (!isRuntimeAvailable()) {
      logPasskeyContent("runtime-unavailable-before-send", {
        operation: String(payload?.operation || ""),
      });
      resolve({
        ok: false,
        error: {
          name: "NotSupportedError",
          message: "扩展上下文已失效，请刷新页面后重试",
          code: "PASSKEY_CONTEXT_INVALIDATED",
        },
      });
      return;
    }

    try {
      logPasskeyContent("runtime-send-start", {
        operation: String(payload?.operation || ""),
        host: String(payload?.host || ""),
        rpId: String(payload?.publicKey?.rp?.id || payload?.publicKey?.rpId || ""),
      });
      chrome.runtime.sendMessage(
        {
          type: "PASS_PASSKEY_OPERATION",
          payload,
        },
        (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          const runtimeMessage = String(runtimeError.message || "");
          const contextInvalidated = runtimeMessage.toLowerCase().includes("extension context invalidated");
          logPasskeyContent("runtime-send-error", {
            operation: String(payload?.operation || ""),
            runtimeMessage,
            contextInvalidated,
          });
          resolve({
            ok: false,
            error: {
              name: contextInvalidated ? "NotSupportedError" : "OperationError",
              message: runtimeMessage || "扩展消息发送失败",
              code: contextInvalidated ? "PASSKEY_CONTEXT_INVALIDATED" : "PASSKEY_RUNTIME_ERROR",
            },
          });
          return;
        }

          if (!response) {
            logPasskeyContent("runtime-empty-response", {
              operation: String(payload?.operation || ""),
            });
            resolve({
              ok: false,
              error: {
                name: "OperationError",
                message: "扩展未返回通行密钥响应",
                code: "PASSKEY_EMPTY_RESPONSE",
              },
            });
            return;
          }

          logPasskeyContent("runtime-send-response", {
            operation: String(payload?.operation || ""),
            ok: Boolean(response?.ok),
            errorCode: String(response?.error?.code || ""),
          });
          resolve(response);
        }
      );
    } catch (error) {
      logPasskeyContent("runtime-send-threw", {
        operation: String(payload?.operation || ""),
        message: error?.message || String(error || ""),
      });
      resolve({
        ok: false,
        error: {
          name: "NotSupportedError",
          message: error?.message || "扩展上下文已失效，请刷新页面后重试",
          code: "PASSKEY_CONTEXT_INVALIDATED",
        },
      });
    }
  });
}

function isRuntimeAvailable() {
  return typeof chrome !== "undefined" && !!chrome?.runtime?.id;
}

function selectPasskeyCandidate(candidates) {
  return new Promise((resolve) => {
    const existing = document.getElementById("pass-passkey-chooser");
    if (existing) existing.remove();

    // Closed shadow root keeps chooser buttons out of the page's DOM tree so
    // malicious pages cannot querySelector/click them to force a silent assert.
    const host = document.createElement("div");
    host.id = "pass-passkey-chooser";
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.right = "12px";
    host.style.top = "12px";
    host.style.zIndex = "2147483647";
    const shadow = host.attachShadow({ mode: "closed" });

    const root = document.createElement("div");
    root.style.position = "relative";
    root.style.maxWidth = "340px";
    root.style.width = "calc(100vw - 24px)";
    root.style.background = "#ffffff";
    root.style.border = "1px solid #c7dafb";
    root.style.borderRadius = "10px";
    root.style.boxShadow = "0 10px 26px rgba(36, 67, 109, 0.22)";
    root.style.padding = "10px";
    root.style.fontSize = "12px";
    root.style.fontFamily = "\"SF Pro Text\", \"PingFang SC\", sans-serif";
    root.style.color = "#1d314d";

    const title = document.createElement("div");
    title.textContent = "选择要使用的通行密钥";
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.style.marginBottom = "8px";
    root.appendChild(title);

    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gap = "6px";
    let timerId = null;

    const cleanup = (value) => {
      host.remove();
      document.removeEventListener("keydown", onKeydown, true);
      if (timerId) clearTimeout(timerId);
      resolve(value);
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(PASSKEY_USE_BROWSER_FALLBACK);
      }
    };
    document.addEventListener("keydown", onKeydown, true);

    for (const item of candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.style.display = "grid";
      button.style.gap = "3px";
      button.style.width = "100%";
      button.style.textAlign = "left";
      button.style.border = "1px solid #d1e3ff";
      button.style.borderRadius = "8px";
      button.style.padding = "7px 8px";
      button.style.background = "#f7fbff";
      button.style.cursor = "pointer";

      const nameLine = document.createElement("div");
      const userName = String(item?.userName || "").trim();
      const displayName = String(item?.displayName || "").trim();
      nameLine.textContent = userName || displayName || "未命名凭据";
      nameLine.style.fontWeight = "600";
      button.appendChild(nameLine);

      const detailLine = document.createElement("div");
      detailLine.textContent = `最近使用: ${formatChooserTime(item?.lastUsedAtMs)} | 更新: ${formatChooserTime(item?.updatedAtMs)}`;
      detailLine.style.fontSize = "11px";
      detailLine.style.color = "#4b6485";
      button.appendChild(detailLine);

      const idLine = document.createElement("div");
      idLine.textContent = `ID: ${shortenMiddle(String(item?.credentialIdB64u || ""), 18)}`;
      idLine.style.fontSize = "11px";
      idLine.style.color = "#4b6485";
      button.appendChild(idLine);

      button.addEventListener("click", (event) => {
        // Ignore synthetic clicks that the page may still try to dispatch onto
        // retargeted shadow hosts; require a real user activation when available.
        if (event.isTrusted === false) return;
        cleanup(String(item?.credentialIdB64u || ""));
      });

      list.appendChild(button);
    }

    root.appendChild(list);

    const footer = document.createElement("div");
    footer.style.marginTop = "8px";
    footer.style.display = "flex";
    footer.style.justifyContent = "flex-end";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "关闭";
    cancelBtn.style.border = "1px solid #9ab9eb";
    cancelBtn.style.borderRadius = "8px";
    cancelBtn.style.padding = "5px 8px";
    cancelBtn.style.background = "#ffffff";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.addEventListener("click", (event) => {
      if (event.isTrusted === false) return;
      cleanup(PASSKEY_USE_BROWSER_FALLBACK);
    });
    footer.appendChild(cancelBtn);

    root.appendChild(footer);
    shadow.appendChild(root);
    document.documentElement.appendChild(host);

    timerId = setTimeout(() => {
      cleanup(PASSKEY_USE_BROWSER_FALLBACK);
    }, 120000);
  });
}

function formatChooserTime(ms) {
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

function shortenMiddle(value, keep = 16) {
  const text = String(value || "");
  if (text.length <= keep) return text;
  const head = Math.max(4, Math.floor(keep / 2));
  const tail = Math.max(4, keep - head);
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function postWebAuthnBridgeResponse(requestId, response) {
  window.postMessage(
    {
      source: WEB_AUTHN_BRIDGE_SOURCE,
      type: WEB_AUTHN_RESPONSE_TYPE,
      requestId,
      ok: Boolean(response?.ok),
      result: response?.result || null,
      error: response?.error || null,
    },
    window.location.origin
  );
}
