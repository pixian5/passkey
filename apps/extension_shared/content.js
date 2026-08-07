import { normalizeDomain } from "./account_core.js";
import { filterFillChooserAccounts } from "./fill_chooser_filter.js";
import { fillCredentialFields } from "./credential_fill_core.js";
import { PASS_EXTENSION_VERSION } from "./extension_version.js";
import { claimFillChooserActivation } from "./fill_chooser_activation.js";
import { installFloatingDrag } from "./floating_drag.js";
import { pageUiOwnerPriority } from "./page_ui_owner.js";
import { resolveWebAuthnWindowContext } from "./webauthn_client_data.js";

const PASS_LOGIN_COOLDOWN_MS = 5000;
const WEB_AUTHN_BRIDGE_SOURCE = "pass-webauthn-bridge";
const WEB_AUTHN_REQUEST_TYPE = "PASSKEY_REQUEST";
const WEB_AUTHN_RESPONSE_TYPE = "PASSKEY_RESPONSE";
const WEB_AUTHN_NOTICE_TYPE = "PASSKEY_NOTICE";
const WEB_AUTHN_DIAGNOSTIC_TYPE = "PASSKEY_DIAGNOSTIC";
const WEB_AUTHN_NOTICE_DOM_ATTR = "data-pass-webauthn-notice";
const WEB_AUTHN_NOTICE_MAX_AGE_MS = 5000;
const WEB_AUTHN_NOTICE_TOAST_DEDUPE_MS = 2500;
const PASS_PAGE_TOAST_HOST_ID = "pass-page-toast-host";
const PASS_CONTENT_VERSION_ATTR = "data-pass-content-version";
const PASS_PAGE_UI_OWNER_ATTR = "data-pass-ui-owner";
const PASS_PAGE_UI_OWNER_PRIORITY_ATTR = "data-pass-ui-owner-priority";
const PASS_PAGE_TOAST_DURATION_MS = 3000;
const PASS_PAGE_TOAST_STAGGER_MS = 450;
const PASS_PAGE_TOAST_MAX = 6;
const PASSKEY_USE_BROWSER_FALLBACK = "__PASSKEY_USE_BROWSER_FALLBACK__";
const PASSKEY_LOG_PREFIX = "[Pass content]";
const PASS_FILL_CHOOSER_ID = "pass-fill-chooser";
const PASS_LOGIN_SAVE_PROMPT_ID = "pass-login-save-prompt";
const PASS_FILL_LIST_COOLDOWN_MS = 400;
// Brief post-success window for focus churn between username/password.
const PASS_FILL_SUPPRESS_REOPEN_MS = 1200;
// Longer window: skip untrusted/SPA re-focus while the field still holds a value we just wrote.
// Explicit user activation (pointer on field, or Tab navigation) opts back in for re-pick.
const PASS_FILL_RECENT_VALUE_MS = 8000;
const PASS_FILL_USER_ACTIVATION_MS = 1000;

let lastPromptKey = "";
let lastPromptAt = 0;
let lastWebAuthnNoticeToastKey = "";
let lastWebAuthnNoticeToastAt = 0;
let passPageToastSeq = 0;
/** @type {{ id: number, el: HTMLDivElement, timer: number | null }[]} */
let passPageToasts = [];
/** @type {HTMLDivElement | null} */
let passPageToastHost = null;
/** @type {HTMLDivElement | null} */
let passPageToastContainer = null;
/** @type {HTMLDivElement | null} */
let loginSavePromptHost = null;
/** @type {((decision: "save" | "dismiss") => void) | null} */
let loginSavePromptResolve = null;
let fillChooserHost = null;
let fillChooserShadow = null;
let fillChooserListInFlight = false;
let fillChooserLastListAt = 0;
let fillChooserActiveInput = null;
let fillChooserLocked = false;
let fillChooserSuppressUntil = 0;
let fillChooserApplying = false;
let fillChooserLastAccounts = [];
// value → expiresAtMs. Identity-free so SPA remounts still match.
const fillChooserRecentValues = new Map();
// Monotonic generation so late LIST responses cannot repaint after a fill.
let fillChooserListGeneration = 0;
/** @type {{ input: EventTarget | null, at: number }} */
let fillChooserPointerActivation = { input: null, at: 0 };
let fillChooserKeyboardNavAt = 0;
const fillChooserActivationClaim = { input: null, at: 0 };

function logPasskeyContent(event, details = {}) {
  try {
    console.info(PASSKEY_LOG_PREFIX, event, details);
  } catch {
    // Ignore logging failures.
  }
}

function getPageUiOwnerIdentity() {
  try {
    const manifest = chrome.runtime.getManifest?.() || {};
    const name = String(manifest.name || "Pass").trim();
    const runtimeId = String(chrome.runtime.id || "").trim();
    const version = String(manifest.version || PASS_EXTENSION_VERSION || "0.0.0").trim();
    // During side-by-side testing, newer extension code must always own injected UI.
    // Runtime ID is only the deterministic tie-breaker for the same version.
    const priority = pageUiOwnerPriority(version);
    return { key: `${runtimeId}|${name}|${version}`, priority };
  } catch {
    return { key: "pass-extension|unknown", priority: pageUiOwnerPriority("0.0.0") };
  }
}

function claimPageUiOwner() {
  const root = document.documentElement;
  if (!root) return false;
  const current = getPageUiOwnerIdentity();
  const existingKey = String(root.getAttribute(PASS_PAGE_UI_OWNER_ATTR) || "");
  const existingPriority = Number(root.getAttribute(PASS_PAGE_UI_OWNER_PRIORITY_ATTR) || 0);
  if (existingKey && existingKey !== current.key) {
    if (existingPriority > current.priority) return false;
    if (existingPriority === current.priority && existingKey.localeCompare(current.key) < 0) return false;
    // A higher-priority extension is taking over an already rendered chooser.
    document.getElementById(PASS_FILL_CHOOSER_ID)?.remove();
    document.getElementById(PASS_PAGE_TOAST_HOST_ID)?.remove();
    hideLoginSavePrompt("dismiss");
  }
  root.setAttribute(PASS_PAGE_UI_OWNER_ATTR, current.key);
  root.setAttribute(PASS_PAGE_UI_OWNER_PRIORITY_ATTR, String(current.priority));
  return true;
}

function ownsPageUi() {
  const owned = claimPageUiOwner();
  if (owned) {
    document.documentElement?.setAttribute(PASS_CONTENT_VERSION_ATTR, PASS_EXTENSION_VERSION);
  }
  return owned;
}

if (!globalThis.__passContentBridgeInstalled) {
  globalThis.__passContentBridgeInstalled = true;
  installPassContentBridge();
}

function installPassContentBridge() {
  const ownsUi = claimPageUiOwner();
  try {
    window.__passContentVersion = PASS_EXTENSION_VERSION;
    if (ownsUi) {
      document.documentElement?.setAttribute(PASS_CONTENT_VERSION_ATTR, PASS_EXTENSION_VERSION);
    }
    console.info(`${PASSKEY_LOG_PREFIX} loaded`, {
      version: PASS_EXTENSION_VERSION,
      href: window.location.href,
    });
  } catch {
    // Ignore bootstrap diagnostics failures.
  }

  window.addEventListener("message", onWebAuthnBridgeMessage, false);
  // Injected may post notices before this isolated script reaches document_idle.
  // Also re-drain a few times for late posts / DOM buffer rewrites during the
  // injected FALLBACK_NOTICE_DELAY window.
  drainPendingWebAuthnNotice();
  for (const delayMs of [120, 400, 1000, 1600]) {
    window.setTimeout(() => drainPendingWebAuthnNotice(), delayMs);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PASS_LOCKED") {
      fillChooserLocked = true;
      hideFillChooser();
      return;
    }
    if (message?.type === "PASS_UNLOCKED") {
      fillChooserLocked = false;
      return;
    }
    if (message?.type === "PASS_FILL_CREDENTIALS") {
      if (!ownsPageUi()) {
        sendResponse({ ok: false, error: "页面已由另一个 Pass 扩展接管" });
        return;
      }
      sendResponse(applyExternalFillCredentials(message.payload));
      return;
    }
  });

  document.addEventListener("focusin", onFillFieldFocusIn, true);
  document.addEventListener("input", onFillChooserUserInput, true);
  document.addEventListener("pointerdown", onDocumentPointerDownForFillChooser, true);
  document.addEventListener("pointerdown", onFillChooserUserPointer, true);
  document.addEventListener("click", onFillChooserUserClick, true);
  document.addEventListener("keydown", onFillChooserUserKeydown, true);
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

    if (loginSavePromptHost) {
      event.preventDefault();
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

    let checkFinished = false;
    chrome.runtime.sendMessage(
      {
        type: "PASS_CONTENT_CHECK_LOGIN",
        payload,
      },
      (response) => {
        checkFinished = true;
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
        void showLoginSavePrompt(payload, mode).then((decision) => {
          if (decision !== "save") {
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
        });
      }
    );

    // Only recover when the background never answers. Once the prompt is shown,
    // the intercepted submission waits for an explicit user choice.
    setTimeout(() => {
      if (!checkFinished) resumeOnce();
    }, 800);
    },
    true
  );
}

function hideLoginSavePrompt(decision = null) {
  loginSavePromptHost?.remove();
  loginSavePromptHost = null;
  const resolve = loginSavePromptResolve;
  loginSavePromptResolve = null;
  if (decision && resolve) resolve(decision);
}

function showLoginSavePrompt(payload, mode) {
  hideLoginSavePrompt("dismiss");
  hideFillChooser();

  return new Promise((resolve) => {
    loginSavePromptResolve = resolve;
    const host = document.createElement("div");
    host.id = PASS_LOGIN_SAVE_PROMPT_ID;
    host.setAttribute("popover", "manual");
    const criticalStyles = {
      all: "initial",
      position: "fixed",
      inset: "14px 14px auto auto",
      margin: "0",
      padding: "0",
      border: "0",
      width: "min(360px, calc(100vw - 28px))",
      maxWidth: "min(360px, calc(100vw - 28px))",
      zIndex: "2147483647",
      colorScheme: "light",
    };
    for (const [property, value] of Object.entries(criticalStyles)) {
      const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      host.style.setProperty(cssProperty, value, "important");
    }

    const shadow = host.attachShadow({ mode: "closed" });
    const root = document.createElement("div");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", mode === "update" ? "更新 Pass 中的密码" : "保存账号到 Pass");
    root.style.boxSizing = "border-box";
    root.style.width = "100%";
    root.style.padding = "12px";
    root.style.border = "1px solid #c7dafb";
    root.style.borderRadius = "10px";
    root.style.background = "#ffffff";
    root.style.boxShadow = "0 10px 26px rgba(36, 67, 109, 0.22)";
    root.style.color = "#1d314d";
    root.style.cursor = "grab";
    root.style.font = '12px/1.4 "SF Pro Text", "PingFang SC", sans-serif';

    const title = document.createElement("div");
    title.textContent = mode === "update" ? "更新已保存的密码？" : "保存这个账号？";
    title.style.marginBottom = "8px";
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.style.cursor = "grab";
    title.style.touchAction = "none";
    title.style.userSelect = "none";
    title.setAttribute("data-pass-drag-handle", "true");
    root.appendChild(title);

    const details = document.createElement("div");
    details.style.display = "grid";
    details.style.gap = "3px";
    details.style.marginBottom = "12px";
    details.style.color = "#4b6485";
    details.style.cursor = "default";
    details.setAttribute("data-pass-no-drag", "true");

    const explanationLine = document.createElement("div");
    explanationLine.textContent = mode === "update"
      ? "检测到该账号密码已更改。"
      : "检测到一个尚未保存的登录账号。";
    explanationLine.style.marginBottom = "3px";
    explanationLine.style.color = "#1d314d";
    details.appendChild(explanationLine);
    const domainLine = document.createElement("div");
    domainLine.textContent = `网站：${String(payload?.domain || "当前网站")}`;
    details.appendChild(domainLine);
    const usernameLine = document.createElement("div");
    usernameLine.textContent = `用户名：${String(payload?.username || "未命名账号")}`;
    details.appendChild(usernameLine);
    root.appendChild(details);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.setAttribute("data-pass-no-drag", "true");

    const dismissButton = document.createElement("button");
    dismissButton.type = "button";
    dismissButton.textContent = "暂不保存";
    dismissButton.style.border = "1px solid #9ab9eb";
    dismissButton.style.borderRadius = "8px";
    dismissButton.style.padding = "6px 10px";
    dismissButton.style.background = "#ffffff";
    dismissButton.style.color = "#1d314d";
    dismissButton.style.cursor = "pointer";
    dismissButton.style.font = "inherit";
    dismissButton.addEventListener("click", (event) => {
      if (event.isTrusted === false) return;
      hideLoginSavePrompt("dismiss");
    });
    actions.appendChild(dismissButton);

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = mode === "update" ? "更新并继续" : "保存并继续";
    saveButton.style.border = "1px solid #2d68c4";
    saveButton.style.borderRadius = "8px";
    saveButton.style.padding = "6px 10px";
    saveButton.style.background = "#2d68c4";
    saveButton.style.color = "#ffffff";
    saveButton.style.cursor = "pointer";
    saveButton.style.font = "inherit";
    saveButton.addEventListener("click", (event) => {
      if (event.isTrusted === false) return;
      hideLoginSavePrompt("save");
    });
    actions.appendChild(saveButton);
    root.appendChild(actions);

    shadow.appendChild(root);
    loginSavePromptHost = host;
    document.documentElement.appendChild(host);
    if (typeof host.showPopover === "function") {
      try {
        host.showPopover();
      } catch {
        host.removeAttribute("popover");
      }
    } else {
      host.removeAttribute("popover");
    }
    host.style.setProperty("display", "block", "important");
    installFloatingDrag({ host, surface: root });
  });
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
  // A page may replace its login form while the persistent confirmation prompt is open.
  // requestSubmit() throws for a detached form, so abandon the replay instead of surfacing
  // an uncaught browser error after the page has already canceled that submission.
  if (!(form instanceof HTMLFormElement) || !form.isConnected) return;

  if (
    submitter instanceof HTMLElement &&
    submitter.isConnected &&
    submitter.form === form &&
    typeof HTMLFormElement.prototype.requestSubmit === "function"
  ) {
    form.dataset.passResubmitting = "1";
    try {
      HTMLFormElement.prototype.requestSubmit.call(form, submitter);
    } finally {
      // Constraint validation can cancel before a submit event consumes the marker.
      if (form.dataset.passResubmitting === "1") delete form.dataset.passResubmitting;
    }
    return;
  }
  HTMLFormElement.prototype.submit.call(form);
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
  if (isPasswordInput(element) || isUsernameLikeInput(element, { strict: true })) return true;
  if (!(element instanceof HTMLInputElement) || !isUsernameLikeInput(element, { strict: false })) {
    return false;
  }

  // Some login pages expose a plain text username field without any semantic
  // name, id, or autocomplete attribute. Treat it as a credential field only
  // when it is paired with a visible password input, keeping search fields on
  // ordinary pages out of the chooser.
  const form = element.form || element.closest("form");
  if (form) return collectVisiblePasswordInputs(form).length > 0;
  const passwordInputs = collectVisiblePasswordInputs(document);
  if (passwordInputs.length === 0) return false;
  if (passwordInputs.length === 1) return true;
  return passwordInputs.some((passwordInput) => Boolean(
    element.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING,
  ));
}

function collectVisiblePasswordInputs(scope = document) {
  return Array.from(scope.querySelectorAll('input[type="password"]')).filter(isVisible);
}

function findRelatedPasswordInput(usernameInput) {
  if (!(usernameInput instanceof HTMLInputElement)) return null;
  const form = usernameInput.form || usernameInput.closest("form");
  if (!form) return null;
  return collectVisiblePasswordInputs(form).find((input) => input !== usernameInput) || null;
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
  if (!form) return null;
  const seen = new Set();
  const candidates = [];
  for (const input of form.querySelectorAll("input")) {
    if (!(input instanceof HTMLInputElement) || seen.has(input) || input === passwordInput) continue;
    seen.add(input);
    // Prefer semantic matches; if none, fall back to plain text inputs in the same form.
    if (isUsernameLikeInput(input, { strict: true }) || isUsernameLikeInput(input, { strict: false })) {
      candidates.push(input);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => scoreUsernameCandidate(right, passwordInput) - scoreUsernameCandidate(left, passwordInput));
  return candidates[0] || null;
}

function resolveFillChooserUsernameInput(input) {
  if (!(input instanceof HTMLInputElement)) return null;
  if (isPasswordInput(input)) return findRelatedUsernameInput(input);
  return isUsernameLikeInput(input, { strict: false }) ? input : null;
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
  noteFillChooserRecentValue(value);
}

function fillFocusedCredentialFields(username, password) {
  return fillCredentialFields({
    activeInput: fillChooserActiveInput instanceof HTMLInputElement ? fillChooserActiveInput : null,
    username,
    password,
    isPasswordInput,
    findRelatedUsername: findRelatedUsernameInput,
    findRelatedPassword: findRelatedPasswordInput,
    findFallbackPassword: () => collectVisiblePasswordInputs(document)[0] || null,
    // Writes empty strings too, clearing stale website autofill values.
    writeValue: setNativeInputValue,
  });
}

// Popup / background "fill active tab" path: reuse the same field discovery + setter.
function applyExternalFillCredentials(payload) {
  const username = String(payload?.username || "");
  const password = String(payload?.password || "");
  if (!username && !password) {
    return { ok: false, error: "缺少用户名和密码" };
  }

  const active = document.activeElement;
  fillChooserActiveInput = isFillableCredentialInput(active) ? active : null;
  // Popup fill should not leave the in-page chooser open over the updated fields.
  hideFillChooser();
  const result = fillFocusedCredentialFields(username, password);
  if (result.filledAny) {
    suppressFillChooserReopen();
  }
  fillChooserActiveInput = null;
  return {
    ok: result.filledAny,
    filledUsername: result.filledUsername,
    filledPassword: result.filledPassword,
    error: result.filledAny ? undefined : "未找到可填充的用户名/密码输入框",
  };
}

function hideFillChooser() {
  if (fillChooserHost) {
    fillChooserHost.remove();
    fillChooserHost = null;
    fillChooserShadow = null;
  }
}

function ensureFillChooserHost() {
  if (fillChooserHost && fillChooserShadow) return fillChooserShadow;
  const host = document.createElement("div");
  host.id = PASS_FILL_CHOOSER_ID;
  host.setAttribute("popover", "manual");
  const criticalStyles = {
    all: "initial",
    position: "fixed",
    inset: "14px 14px auto auto",
    margin: "0",
    padding: "0",
    border: "0",
    width: "min(360px, calc(100vw - 28px))",
    maxWidth: "min(360px, calc(100vw - 28px))",
    maxHeight: "min(560px, calc(100vh - 28px))",
    overflow: "hidden",
    zIndex: "2147483647",
    colorScheme: "light",
  };
  for (const [property, value] of Object.entries(criticalStyles)) {
    const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    host.style.setProperty(cssProperty, value, "important");
  }
  const shadow = host.attachShadow({ mode: "closed" });
  fillChooserHost = host;
  fillChooserShadow = shadow;
  document.documentElement.appendChild(host);
  if (typeof host.showPopover === "function") {
    try {
      host.showPopover();
    } catch {
      host.removeAttribute("popover");
    }
  } else {
    host.removeAttribute("popover");
  }
  host.style.setProperty("display", "block", "important");
  return shadow;
}

function renderFillChooser(accounts, input) {
  hideFillChooser();
  if (!Array.isArray(accounts) || accounts.length === 0) return;
  fillChooserLastAccounts = accounts;
  fillChooserActiveInput = input;
  const visibleAccounts = filterFillChooserAccounts(
    accounts,
    resolveFillChooserUsernameInput(input)?.value || "",
  );
  const shadow = ensureFillChooserHost();

  const root = document.createElement("div");
  root.style.background = "#ffffff";
  root.style.border = "1px solid #c7dafb";
  root.style.borderRadius = "10px";
  root.style.boxShadow = "0 10px 26px rgba(36, 67, 109, 0.22)";
  root.style.padding = "8px";
  root.style.boxSizing = "border-box";
  root.style.width = "100%";
  root.style.maxHeight = "min(560px, calc(100vh - 16px))";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.overflow = "hidden";
  root.style.position = "relative";
  root.style.cursor = "grab";
  root.style.font = '12px/1.4 "SF Pro Text", "PingFang SC", sans-serif';
  root.style.color = "#1d314d";

  const title = document.createElement("div");
  const siteLabel = normalizeDomain(window.location.hostname) || "当前网站";
  const windowTitle = `填充账号 · ${siteLabel}`;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", windowTitle);
  title.textContent = windowTitle;
  title.style.fontWeight = "600";
  title.style.fontSize = "13px";
  title.style.margin = "2px 4px 8px";
  title.style.paddingRight = "56px";
  title.style.cursor = "grab";
  title.style.touchAction = "none";
  title.style.userSelect = "none";
  title.setAttribute("data-pass-drag-handle", "true");
  root.appendChild(title);

  const list = document.createElement("div");
  list.style.display = "grid";
  list.style.gap = "6px";
  list.style.minHeight = "0";
  list.style.flex = "1 1 auto";
  list.style.maxHeight = "min(500px, calc(100vh - 96px))";
  list.style.overflowY = "auto";
  list.style.scrollbarGutter = "stable";
  list.style.cursor = "default";
  list.setAttribute("data-pass-no-drag", "true");

  if (visibleAccounts.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "没有匹配的账号";
    empty.style.padding = "18px 10px";
    empty.style.textAlign = "center";
    empty.style.color = "#4b6485";
    empty.setAttribute("role", "status");
    list.appendChild(empty);
  }

  for (const account of visibleAccounts) {
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
  footer.style.position = "absolute";
  footer.style.top = "8px";
  footer.style.right = "8px";
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
  installFloatingDrag({ host: fillChooserHost, surface: root });
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

function suppressFillChooserReopen(ms = PASS_FILL_SUPPRESS_REOPEN_MS) {
  fillChooserSuppressUntil = Math.max(fillChooserSuppressUntil, Date.now() + Math.max(0, Number(ms) || 0));
}

function noteFillChooserRecentValue(value) {
  const text = String(value || "");
  if (!text) return;
  const expiresAt = Date.now() + PASS_FILL_RECENT_VALUE_MS;
  fillChooserRecentValues.set(text, expiresAt);
  // Opportunistic prune so the map cannot grow without bound.
  if (fillChooserRecentValues.size > 32) {
    const now = Date.now();
    for (const [key, until] of fillChooserRecentValues) {
      if (until <= now) fillChooserRecentValues.delete(key);
    }
  }
}

function isRecentFillChooserValue(value) {
  const text = String(value || "");
  if (!text) return false;
  const until = fillChooserRecentValues.get(text);
  if (!until) return false;
  if (Date.now() >= until) {
    fillChooserRecentValues.delete(text);
    return false;
  }
  return true;
}

function isFillChooserBlocked() {
  return fillChooserApplying || Date.now() < fillChooserSuppressUntil;
}

function resolveFillableInputFromEventTarget(target) {
  if (isFillableCredentialInput(target)) return target;
  if (target instanceof Element) {
    const labeled = target.closest?.("label");
    if (labeled instanceof HTMLLabelElement && isFillableCredentialInput(labeled.control)) {
      return labeled.control;
    }
  }
  if (target instanceof HTMLLabelElement && isFillableCredentialInput(target.control)) {
    return target.control;
  }
  return null;
}

function hasUserActivationForFillChooser(input) {
  const now = Date.now();
  if (
    fillChooserPointerActivation.input === input
    && now - fillChooserPointerActivation.at < PASS_FILL_USER_ACTIVATION_MS
  ) {
    return true;
  }
  // Tab / Shift+Tab: allow only the immediate next focusin, then clear.
  if (fillChooserKeyboardNavAt > 0 && now - fillChooserKeyboardNavAt < PASS_FILL_USER_ACTIVATION_MS) {
    fillChooserKeyboardNavAt = 0;
    return true;
  }
  return false;
}

// Skip auto/SPA/autofocus re-focus of fields that still hold a value we just wrote.
// Explicit user activation (pointer on field or keyboard focus move) opts back in.
function shouldSkipChooserForFilledInput(input, { userInitiated = false } = {}) {
  if (userInitiated) return false;
  if (!(input instanceof HTMLInputElement)) return false;
  return isRecentFillChooserValue(input.value);
}

function reshowFillChooser(input) {
  if (!ownsPageUi() || !(input instanceof HTMLElement) || fillChooserLocked || !isFillableCredentialInput(input)) return;
  if (Array.isArray(fillChooserLastAccounts) && fillChooserLastAccounts.length > 0) {
    renderFillChooser(fillChooserLastAccounts, input);
    return;
  }
  void showFillChooserForInput(input, { userInitiated: true });
}

async function showFillChooserForInput(input, { userInitiated = false } = {}) {
  if (!ownsPageUi() || fillChooserLocked || isFillChooserBlocked() || !isFillableCredentialInput(input)) return;
  if (shouldSkipChooserForFilledInput(input, { userInitiated })) return;
  const now = Date.now();
  if (userInitiated && !claimFillChooserActivation(fillChooserActivationClaim, input, now)) return;
  if (fillChooserListInFlight) return;
  if (now - fillChooserLastListAt < PASS_FILL_LIST_COOLDOWN_MS && fillChooserHost) {
    fillChooserActiveInput = input;
    return;
  }

  const listGeneration = ++fillChooserListGeneration;
  fillChooserListInFlight = true;
  try {
    const response = await runtimeSendMessage({ type: "PASS_CONTENT_LIST_FILL_ACCOUNTS" });
    fillChooserLastListAt = Date.now();
    // Drop stale list work: a newer list started, or the user already filled.
    if (listGeneration !== fillChooserListGeneration || !ownsPageUi() || isFillChooserBlocked()) {
      return;
    }
    if (!response?.ok) {
      if (response?.locked) fillChooserLocked = true;
      hideFillChooser();
      if (response?.error && response?.error !== "扩展上下文不可用") {
        showPassPageToast(response.error, response?.locked ? "warning" : "error");
      }
      return;
    }
    const accounts = Array.isArray(response.accounts) ? response.accounts : [];
    if (accounts.length === 0) {
      hideFillChooser();
      if (userInitiated) showPassPageToast("当前网站没有匹配的 Pass 账号", "info");
      return;
    }
    if (shouldSkipChooserForFilledInput(input, { userInitiated })) return;
    renderFillChooser(accounts, input);
  } finally {
    if (listGeneration === fillChooserListGeneration) {
      fillChooserListInFlight = false;
    }
  }
}

async function applyFillAccount(accountId) {
  const id = String(accountId || "").trim();
  if (!id || fillChooserApplying || !ownsPageUi()) return;
  // Capture before hide: hide tears down the host but must not lose the fill target.
  const targetInput = fillChooserActiveInput;
  fillChooserApplying = true;
  // Invalidate any in-flight list so its response cannot repaint after fill.
  fillChooserListGeneration += 1;
  fillChooserListInFlight = false;
  // Close immediately on click so fill-related focus events cannot reopen mid-request.
  // Suppress only after a successful fill — failures re-open the list for retry.
  hideFillChooser();
  let shouldReshow = false;
  try {
    const response = await runtimeSendMessage({
      type: "PASS_CONTENT_FILL_ACCOUNT",
      payload: { accountId: id },
    });
    if (!response?.ok) {
      if (response?.locked) {
        fillChooserLocked = true;
        showPassPageToast(response.error || "扩展已锁定", "warning");
        return;
      }
      showPassPageToast(response?.error || "填充失败", "error");
      shouldReshow = true;
      return;
    }
    // Keep the originating field as the fill anchor across the async gap.
    fillChooserActiveInput = targetInput;
    const result = fillFocusedCredentialFields(response.username || "", response.password || "");
    suppressFillChooserReopen();
    const hasUsernameValue = Boolean(String(response.username || "").trim());
    const hasPasswordValue = Boolean(String(response.password || ""));
    if (result.filledUsername && result.filledPassword) {
      if (hasUsernameValue && hasPasswordValue) {
        showPassPageToast(`已填充用户名和密码：${response.username || "账号"}`, "success");
      } else if (hasUsernameValue) {
        showPassPageToast(`已填充用户名（密码为空，已清空密码框）：${response.username || "账号"}`, "success");
      } else if (hasPasswordValue) {
        showPassPageToast("已填充密码（用户名为空，已清空用户名框）", "success");
      } else {
        showPassPageToast("已清空找到的用户名/密码输入框", "warning");
      }
    } else if (result.filledPassword && !result.filledUsername) {
      showPassPageToast(
        hasPasswordValue
          ? "已填充密码"
          : "已清空密码框",
        "success",
      );
    } else if (result.filledUsername && !result.filledPassword) {
      showPassPageToast(
        hasUsernameValue
          ? `已填充用户名：${response.username || "账号"}`
          : "已清空用户名框",
        "success",
      );
    } else {
      showPassPageToast("未找到可填充的用户名/密码输入框", "warning");
    }
  } finally {
    fillChooserApplying = false;
    // On failure reshow already rebound active input; clear only when still closed.
    if (!fillChooserHost) fillChooserActiveInput = null;
  }
  // Reshow outside the applying window so render/show are not blocked.
  if (shouldReshow) reshowFillChooser(targetInput);
}

function onFillChooserUserPointer(event) {
  if (event.isTrusted === false || !ownsPageUi()) return;
  const input = resolveFillableInputFromEventTarget(event.target);
  if (!input) return;
  fillChooserPointerActivation = { input, at: Date.now() };
  // Re-clicking an already-focused field does not re-fire focusin; open explicitly.
  if (document.activeElement === input && !isFillChooserBlocked()) {
    void showFillChooserForInput(input, { userInitiated: true });
  }
}

function onFillChooserUserInput(event) {
  if (!ownsPageUi() || !fillChooserHost || fillChooserApplying) return;
  const target = event.target;
  const usernameInput = resolveFillChooserUsernameInput(fillChooserActiveInput);
  if (target !== usernameInput || fillChooserLastAccounts.length === 0) return;
  renderFillChooser(fillChooserLastAccounts, fillChooserActiveInput);
}

function onFillChooserUserClick(event) {
  if (event.isTrusted === false || !ownsPageUi()) return;
  const input = resolveFillableInputFromEventTarget(event.target);
  if (!input || isFillChooserBlocked()) return;
  // Some login pages suppress the native focus event while routing clicks
  // through a custom form controller. A trusted click is still explicit user
  // activation, so use it as a fallback to open the chooser.
  if (document.activeElement === input || event.target === input) {
    void showFillChooserForInput(input, { userInitiated: true });
  }
}

function onFillChooserUserKeydown(event) {
  if (event.isTrusted === false) return;
  if (event.key !== "Tab") return;
  fillChooserKeyboardNavAt = Date.now();
}

function onFillFieldFocusIn(event) {
  if (!ownsPageUi() || isFillChooserBlocked()) return;
  const target = event.target;
  if (!isFillableCredentialInput(target)) return;
  // Prefer explicit activation (pointer on field / Tab). Bare isTrusted is not enough:
  // browser autofocus is also trusted and would reopen the chooser after SPA remount.
  const userInitiated = hasUserActivationForFillChooser(target);
  void showFillChooserForInput(target, { userInitiated });
}

function onDocumentPointerDownForFillChooser(event) {
  if (!ownsPageUi() || !fillChooserHost) return;
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
  if (data.type === WEB_AUTHN_DIAGNOSTIC_TYPE) {
    forwardWebAuthnPageDiagnostic(data);
    return;
  }
  if (data.type !== WEB_AUTHN_REQUEST_TYPE) return;

  const requestId = String(data.requestId || "");
  if (!requestId) return;

  const frameContext = resolveWebAuthnWindowContext(window);
  const payload = {
    operation: data.operation,
    publicKey: data.publicKey,
    origin: frameContext.origin,
    host: frameContext.host,
    // Page-provided context is diagnostic-only. The operation always uses the
    // isolated-world context above, which cannot be forged by the page.
    sourceContext: data.sourceContext,
    diagnosticSessionId: requestId,
  };

  logPasskeyContent("bridge-request-received", {
    requestId,
    operation: String(payload.operation || ""),
    host: String(payload.host || ""),
    rpId: String(payload?.publicKey?.rp?.id || payload?.publicKey?.rpId || ""),
  });

  void handleWebAuthnBridgeRequest(requestId, payload);
}

function forwardWebAuthnPageDiagnostic(data) {
  if (!isRuntimeAvailable()) return;
  const frameContext = resolveWebAuthnWindowContext(window);
  const payload = {
    operation: String(data?.operation || ""),
    phase: String(data?.phase || ""),
    diagnosticSessionId: String(data?.diagnosticSessionId || ""),
    origin: frameContext.origin,
    host: frameContext.host,
    details: data?.details,
  };
  logPasskeyContent("page-diagnostic-forwarded", {
    operation: payload.operation,
    phase: payload.phase,
    diagnosticSessionId: payload.diagnosticSessionId,
  });
  try {
    chrome.runtime.sendMessage({
      type: "PASS_PASSKEY_DIAGNOSTIC_EVENT",
      payload,
    }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // Diagnostics must never interfere with the RP's WebAuthn flow.
  }
}

function clearPendingWebAuthnNoticeAttr() {
  try {
    document.documentElement?.removeAttribute(WEB_AUTHN_NOTICE_DOM_ATTR);
  } catch {
    // Ignore DOM access failures.
  }
}

function readPendingWebAuthnNotices() {
  try {
    const raw = document.documentElement?.getAttribute(WEB_AUTHN_NOTICE_DOM_ATTR);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === "object");
    // Backward-compatible: single object buffer.
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {
    // Ignore corrupt buffers.
  }
  return [];
}

function drainPendingWebAuthnNotice() {
  try {
    const notices = readPendingWebAuthnNotices();
    if (notices.length === 0) return;
    clearPendingWebAuthnNoticeAttr();
    const now = Date.now();
    for (const data of notices) {
      if (!data || data.source !== WEB_AUTHN_BRIDGE_SOURCE || data.type !== WEB_AUTHN_NOTICE_TYPE) continue;
      const postedAtMs = Number(data.postedAtMs || 0);
      if (postedAtMs > 0 && now - postedAtMs > WEB_AUTHN_NOTICE_MAX_AGE_MS) continue;
      handleWebAuthnBridgeNotice(data, { clearDomBuffer: false });
    }
  } catch {
    // Ignore corrupt/stale buffers.
  }
}

function handleWebAuthnBridgeNotice(data, { clearDomBuffer = true } = {}) {
  if (!ownsPageUi()) return;
  const message = String(data?.message || "").trim();
  if (!message) return;
  // Live postMessage delivery supersedes the DOM buffer for this notice.
  if (clearDomBuffer) clearPendingWebAuthnNoticeAttr();
  logPasskeyContent("bridge-notice-received", {
    reason: String(data?.reason || ""),
    operation: String(data?.operation || ""),
    message,
    producerDeduped: Boolean(data?.deduped),
  });
  // Single toast owner: content script renders passkey fallback notices.
  // Dedupe here (not only in injected) so a missed first postMessage + later
  // producer-deduped retry can still surface once when content drains the DOM buffer.
  const noticeKey = `${String(data?.operation || "")}|${String(data?.reason || "")}|${message}`;
  const now = Date.now();
  if (
    noticeKey === lastWebAuthnNoticeToastKey
    && now - lastWebAuthnNoticeToastAt < WEB_AUTHN_NOTICE_TOAST_DEDUPE_MS
  ) {
    return;
  }
  lastWebAuthnNoticeToastKey = noticeKey;
  lastWebAuthnNoticeToastAt = now;
  showPassPageToast(message, "warning");
}

async function handleWebAuthnBridgeRequest(requestId, payload) {
  if (!ownsPageUi()) return;
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
          showPassPageToast(`Pass 已更新通行密钥，等待网站确认${compatLabel ? `（${compatLabel}）` : ""}`, "info");
        } else if (createMode === "existing") {
          showPassPageToast(`Pass 已准备已有通行密钥，等待网站确认${compatLabel ? `（${compatLabel}）` : ""}`, "info");
        } else {
          showPassPageToast(`Pass 已生成通行密钥，等待网站确认${compatLabel ? `（${compatLabel}）` : ""}`, "info");
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

function ensurePassPageToastHost() {
  if (passPageToastHost?.isConnected && passPageToastContainer) {
    return passPageToastContainer;
  }

  document.getElementById(PASS_PAGE_TOAST_HOST_ID)?.remove();
  const host = document.createElement("div");
  host.id = PASS_PAGE_TOAST_HOST_ID;
  host.setAttribute("popover", "manual");
  host.setAttribute("aria-label", "Pass 提示");
  const criticalStyles = {
    all: "initial",
    position: "fixed",
    inset: "14px 14px auto auto",
    margin: "0",
    padding: "0",
    border: "0",
    width: "auto",
    height: "auto",
    maxWidth: "min(360px, calc(100vw - 28px))",
    background: "transparent",
    overflow: "visible",
    pointerEvents: "none",
    zIndex: "2147483647",
    colorScheme: "light",
  };
  for (const [property, value] of Object.entries(criticalStyles)) {
    const cssProperty = property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    host.style.setProperty(cssProperty, value, "important");
  }

  const shadow = host.attachShadow({ mode: "closed" });
  const container = document.createElement("div");
  container.setAttribute("role", "status");
  container.setAttribute("aria-live", "polite");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "flex-end";
  container.style.gap = "8px";
  container.style.maxWidth = "100%";
  container.style.pointerEvents = "none";
  shadow.appendChild(container);

  (document.body || document.documentElement).appendChild(host);
  if (typeof host.showPopover === "function") {
    try {
      host.showPopover();
    } catch {
      host.removeAttribute("popover");
    }
  } else {
    host.removeAttribute("popover");
  }
  host.style.setProperty("display", "block", "important");
  passPageToastHost = host;
  passPageToastContainer = container;
  return container;
}

function passPageToastToneStyle(tone) {
  const styles = {
    success: {
      border: "1px solid #63a56a",
      background: "linear-gradient(180deg, #e8f8ea 0%, #d5f2d9 100%)",
      color: "#1d5b2c",
      shadow: "0 12px 28px rgba(24, 68, 33, 0.22)",
      badgeBg: "#1d5b2c",
      badgeFg: "#e8f8ea",
    },
    error: {
      border: "1px solid #d46a6a",
      background: "linear-gradient(180deg, #fdecec 0%, #f8d4d4 100%)",
      color: "#8a1f1f",
      shadow: "0 12px 28px rgba(120, 24, 24, 0.22)",
      badgeBg: "#8a1f1f",
      badgeFg: "#fdecec",
    },
    warning: {
      border: "1px solid #d2b14a",
      background: "linear-gradient(180deg, #fff8df 0%, #ffe9a8 100%)",
      color: "#6a5208",
      shadow: "0 12px 28px rgba(120, 92, 16, 0.2)",
      badgeBg: "#6a5208",
      badgeFg: "#fff8df",
    },
    info: {
      border: "1px solid #6b91d8",
      background: "linear-gradient(180deg, #edf4ff 0%, #dbe9ff 100%)",
      color: "#214f9a",
      shadow: "0 12px 28px rgba(33, 79, 154, 0.2)",
      badgeBg: "#214f9a",
      badgeFg: "#edf4ff",
    },
  };
  return styles[tone] || styles.success;
}

function renumberPassPageToasts() {
  passPageToasts.forEach((item, index) => {
    const badge = item.el.querySelector("[data-role='toast-index']");
    if (badge instanceof HTMLElement) {
      badge.textContent = String(index + 1);
    }
  });
}

function dismissPassPageToast(id) {
  const index = passPageToasts.findIndex((item) => item.id === id);
  if (index < 0) return;
  const [item] = passPageToasts.splice(index, 1);
  if (item.timer != null) {
    clearTimeout(item.timer);
    item.timer = null;
  }
  item.el.style.opacity = "0";
  item.el.style.transform = "translateY(-4px)";
  window.setTimeout(() => {
    item.el.remove();
    if (passPageToastHost?.isConnected && passPageToasts.length === 0) {
      passPageToastHost.remove();
      passPageToastHost = null;
      passPageToastContainer = null;
    }
  }, 160);
  renumberPassPageToasts();
}

function showPassPageToast(message, tone = "success") {
  if (!ownsPageUi()) return;
  const text = String(message || "").trim();
  if (!text) return;

  // Keep only the newest window of toasts if the stack is full.
  while (passPageToasts.length >= PASS_PAGE_TOAST_MAX) {
    const oldest = passPageToasts[0];
    if (!oldest) break;
    dismissPassPageToast(oldest.id);
  }

  const host = ensurePassPageToastHost();
  const style = passPageToastToneStyle(tone);
  const id = ++passPageToastSeq;
  const el = document.createElement("div");
  el.dataset.toastId = String(id);
  el.style.display = "flex";
  el.style.alignItems = "flex-start";
  el.style.gap = "10px";
  el.style.padding = "10px 12px";
  el.style.borderRadius = "8px";
  el.style.border = style.border;
  el.style.background = style.background;
  el.style.color = style.color;
  el.style.boxShadow = style.shadow;
  el.style.font = '600 14px/1.45 "SF Pro Text", "PingFang SC", sans-serif';
  el.style.opacity = "0";
  el.style.transform = "translateY(-4px)";
  el.style.transition = "opacity 140ms ease-out, transform 140ms ease-out";
  el.style.maxWidth = "100%";

  const badge = document.createElement("span");
  badge.dataset.role = "toast-index";
  badge.textContent = String(passPageToasts.length + 1);
  badge.style.flex = "0 0 auto";
  badge.style.minWidth = "1.5em";
  badge.style.height = "1.5em";
  badge.style.display = "inline-flex";
  badge.style.alignItems = "center";
  badge.style.justifyContent = "center";
  badge.style.borderRadius = "999px";
  badge.style.background = style.badgeBg;
  badge.style.color = style.badgeFg;
  badge.style.fontSize = "12px";
  badge.style.fontWeight = "700";
  badge.style.lineHeight = "1";
  badge.style.marginTop = "4px";

  const body = document.createElement("div");
  body.dataset.role = "toast-body";
  body.textContent = text;
  body.style.flex = "1 1 auto";
  body.style.whiteSpace = "pre-wrap";
  body.style.wordBreak = "break-word";

  el.appendChild(badge);
  el.appendChild(body);
  host.appendChild(el);

  // Force layout so the enter transition runs.
  void el.offsetWidth;
  el.style.opacity = "1";
  el.style.transform = "translateY(0)";

  // Dismiss oldest first: later toasts stay longer by a small stagger.
  const lifetime = PASS_PAGE_TOAST_DURATION_MS + passPageToasts.length * PASS_PAGE_TOAST_STAGGER_MS;
  const entry = {
    id,
    el,
    timer: null,
  };
  entry.timer = window.setTimeout(() => {
    dismissPassPageToast(id);
  }, lifetime);
  passPageToasts.push(entry);
  renumberPassPageToasts();
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
    const siteLabel = normalizeDomain(window.location.hostname) || "当前网站";
    const windowTitle = `选择通行密钥 · ${siteLabel}`;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", windowTitle);
    title.textContent = windowTitle;
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
