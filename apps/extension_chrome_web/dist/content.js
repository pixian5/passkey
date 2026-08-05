(() => {
  // ../../core/pass_core/js/sync_policy.js
  var ETLD2_SUFFIXES = [
    "com.cn",
    "net.cn",
    "org.cn",
    "gov.cn",
    "edu.cn",
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "com.au",
    "net.au",
    "org.au",
    "com.br",
    "com.mx",
    "co.jp",
    "or.jp",
    "ne.jp",
    "co.kr",
    "co.in",
    "com.hk",
    "com.tw",
    "com.sg",
    "co.nz",
    "org.nz",
    "com.ar",
    "com.tr",
    "co.za",
    "com.ua"
  ];
  var SYNC_OUTBOX_MAX_DELAY_MS = 60 * 60 * 1e3;

  // account_core.js
  var ETLD2_SUFFIXES2 = new Set(ETLD2_SUFFIXES);
  var DOMAIN_ALIAS_GROUPS = Object.freeze([
    Object.freeze({
      id: "apple",
      domains: Object.freeze(["apple.com", "apple.com.cn", "icloud.com", "icloud.com.cn"])
    }),
    Object.freeze({
      id: "qq",
      domains: Object.freeze(["qq.com", "wx.qq.com"])
    }),
    Object.freeze({
      id: "baidu",
      domains: Object.freeze(["baidu.com", "passport.baidu.com", "pan.baidu.com"])
    }),
    Object.freeze({
      id: "sina",
      domains: Object.freeze(["sina.com", "mail.sina.com", "weibo.com"])
    }),
    Object.freeze({
      id: "github",
      domains: Object.freeze(["github.com", "gist.github.com"])
    }),
    Object.freeze({
      id: "gitlab",
      domains: Object.freeze(["gitlab.com", "about.gitlab.com"])
    }),
    Object.freeze({
      id: "google",
      domains: Object.freeze(["google.com", "accounts.google.com"])
    }),
    Object.freeze({
      id: "youtube",
      domains: Object.freeze(["youtube.com", "studio.youtube.com"])
    }),
    Object.freeze({
      id: "x",
      domains: Object.freeze(["x.com", "twitter.com"])
    }),
    Object.freeze({
      id: "facebook",
      domains: Object.freeze(["facebook.com", "messenger.com"])
    }),
    Object.freeze({
      id: "amazon",
      domains: Object.freeze(["amazon.com", "smile.amazon.com"])
    }),
    Object.freeze({
      id: "microsoft",
      domains: Object.freeze([
        "microsoft.com",
        "microsoftonline.com",
        // Keep the common shorthand used by older records linked to the same
        // Microsoft sign-in provider as the fully qualified host names.
        "microsoftonline",
        "login.microsoftonline.com",
        "login.microsoft.com",
        "account.microsoft.com",
        "live.com",
        "hotmail.com",
        "outlook.com",
        "account.live.com",
        "office.com",
        "outlook.office.com",
        "microsoft365.com",
        "office365.com",
        "azure.com",
        "msn.com"
      ])
    }),
    Object.freeze({
      id: "paypal",
      domains: Object.freeze(["paypal.com"])
    }),
    Object.freeze({
      id: "netflix",
      domains: Object.freeze(["netflix.com", "help.netflix.com"])
    }),
    Object.freeze({
      id: "spotify",
      domains: Object.freeze(["spotify.com", "open.spotify.com"])
    }),
    Object.freeze({
      id: "linkedin",
      domains: Object.freeze(["linkedin.com"])
    }),
    Object.freeze({
      id: "dropbox",
      domains: Object.freeze(["dropbox.com"])
    })
  ]);
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

  // credential_fill_core.js
  function fillCredentialFields({
    activeInput,
    username,
    password,
    isPasswordInput: isPasswordInput2,
    findRelatedUsername,
    findRelatedPassword,
    findFallbackPassword,
    writeValue
  }) {
    let usernameInput = null;
    let passwordInput = null;
    const wantedUsername = String(username || "");
    const wantedPassword = String(password || "");
    if (activeInput) {
      if (isPasswordInput2(activeInput)) {
        passwordInput = activeInput;
        usernameInput = findRelatedUsername(activeInput);
      } else {
        usernameInput = activeInput;
        passwordInput = findRelatedPassword(activeInput);
      }
    }
    if (!passwordInput && !activeInput) passwordInput = findFallbackPassword();
    if (!usernameInput && passwordInput) usernameInput = findRelatedUsername(passwordInput);
    if (usernameInput && !passwordInput) passwordInput = findRelatedPassword(usernameInput);
    let filledUsername = false;
    let filledPassword = false;
    if (usernameInput) {
      writeValue(usernameInput, wantedUsername);
      filledUsername = usernameInput.value === wantedUsername;
    }
    if (passwordInput) {
      writeValue(passwordInput, wantedPassword);
      filledPassword = passwordInput.value === wantedPassword;
    }
    return {
      filledUsername,
      filledPassword,
      filledAny: filledUsername || filledPassword,
      filledBoth: Boolean(usernameInput ? filledUsername : !wantedUsername) && Boolean(passwordInput ? filledPassword : !wantedPassword) && (filledUsername || filledPassword || Boolean(usernameInput || passwordInput))
    };
  }

  // extension_version.js
  var PASS_EXTENSION_VERSION = "1.5.3";

  // fill_chooser_activation.js
  var FILL_CHOOSER_ACTIVATION_DEDUPE_MS = 650;
  function claimFillChooserActivation(state, input, nowMs = Date.now()) {
    if (!state || !input) return false;
    const now = Number(nowMs || 0);
    if (state.input === input && now >= Number(state.at || 0) && now - Number(state.at || 0) < FILL_CHOOSER_ACTIVATION_DEDUPE_MS) {
      return false;
    }
    state.input = input;
    state.at = now;
    return true;
  }

  // page_ui_owner.js
  var PAGE_UI_PRIORITY_BASE = 1e3;
  var VERSION_PART_RADIX = 65536;
  function parseVersionPart(value) {
    const parsed = Number.parseInt(String(value || "0"), 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(VERSION_PART_RADIX - 1, parsed));
  }
  function pageUiOwnerPriority(version) {
    const [major = "0", minor = "0", patch = "0"] = String(version || "").split(".");
    return PAGE_UI_PRIORITY_BASE + (parseVersionPart(major) * VERSION_PART_RADIX + parseVersionPart(minor)) * VERSION_PART_RADIX + parseVersionPart(patch);
  }

  // webauthn_client_data.js
  function normalizeHttpOrigin(value) {
    const raw = String(value || "").trim();
    if (!raw || raw === "null") return "";
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
      return parsed.origin;
    } catch {
      return "";
    }
  }
  function readLocationOrigin(target) {
    try {
      return normalizeHttpOrigin(target?.location?.origin);
    } catch {
      return "";
    }
  }
  function readAncestorOrigins(targetWindow) {
    try {
      return Array.from(targetWindow?.location?.ancestorOrigins || []).map(normalizeHttpOrigin).filter(Boolean);
    } catch {
      return [];
    }
  }
  function resolveWebAuthnWindowContext(targetWindow) {
    if (!targetWindow) {
      return { origin: "", host: "", crossOrigin: false, topOrigin: "" };
    }
    let isTopLevel = true;
    try {
      isTopLevel = targetWindow.top === targetWindow.self;
    } catch {
      isTopLevel = false;
    }
    const ancestorOrigins = readAncestorOrigins(targetWindow);
    let origin = readLocationOrigin(targetWindow);
    if (!origin && !isTopLevel) {
      origin = readLocationOrigin(targetWindow.parent) || ancestorOrigins[0] || "";
    }
    let topOrigin = isTopLevel ? origin : readLocationOrigin(targetWindow.top);
    if (!topOrigin && ancestorOrigins.length > 0) {
      topOrigin = ancestorOrigins[ancestorOrigins.length - 1];
    }
    const crossOrigin = !isTopLevel && (!origin || !topOrigin || origin !== topOrigin);
    let host = "";
    try {
      host = origin ? new URL(origin).hostname : "";
    } catch {
      host = "";
    }
    return {
      origin,
      host,
      crossOrigin,
      topOrigin: crossOrigin ? topOrigin : ""
    };
  }

  // content.js
  var PASS_LOGIN_COOLDOWN_MS = 5e3;
  var WEB_AUTHN_BRIDGE_SOURCE = "pass-webauthn-bridge";
  var WEB_AUTHN_REQUEST_TYPE = "PASSKEY_REQUEST";
  var WEB_AUTHN_RESPONSE_TYPE = "PASSKEY_RESPONSE";
  var WEB_AUTHN_NOTICE_TYPE = "PASSKEY_NOTICE";
  var WEB_AUTHN_NOTICE_DOM_ATTR = "data-pass-webauthn-notice";
  var WEB_AUTHN_NOTICE_MAX_AGE_MS = 5e3;
  var WEB_AUTHN_NOTICE_TOAST_DEDUPE_MS = 2500;
  var PASS_PAGE_TOAST_HOST_ID = "pass-page-toast-host";
  var PASS_CONTENT_VERSION_ATTR = "data-pass-content-version";
  var PASS_PAGE_UI_OWNER_ATTR = "data-pass-ui-owner";
  var PASS_PAGE_UI_OWNER_PRIORITY_ATTR = "data-pass-ui-owner-priority";
  var PASS_PAGE_TOAST_DURATION_MS = 3e3;
  var PASS_PAGE_TOAST_STAGGER_MS = 450;
  var PASS_PAGE_TOAST_MAX = 6;
  var PASSKEY_USE_BROWSER_FALLBACK = "__PASSKEY_USE_BROWSER_FALLBACK__";
  var PASSKEY_LOG_PREFIX = "[Pass content]";
  var PASS_FILL_CHOOSER_ID = "pass-fill-chooser";
  var PASS_FILL_LIST_COOLDOWN_MS = 400;
  var PASS_FILL_SUPPRESS_REOPEN_MS = 1200;
  var PASS_FILL_RECENT_VALUE_MS = 8e3;
  var PASS_FILL_USER_ACTIVATION_MS = 1e3;
  var lastPromptKey = "";
  var lastPromptAt = 0;
  var lastWebAuthnNoticeToastKey = "";
  var lastWebAuthnNoticeToastAt = 0;
  var passPageToastSeq = 0;
  var passPageToasts = [];
  var passPageToastHost = null;
  var passPageToastContainer = null;
  var fillChooserHost = null;
  var fillChooserShadow = null;
  var fillChooserListInFlight = false;
  var fillChooserLastListAt = 0;
  var fillChooserActiveInput = null;
  var fillChooserLocked = false;
  var fillChooserSuppressUntil = 0;
  var fillChooserApplying = false;
  var fillChooserLastAccounts = [];
  var fillChooserRecentValues = /* @__PURE__ */ new Map();
  var fillChooserListGeneration = 0;
  var fillChooserPointerActivation = { input: null, at: 0 };
  var fillChooserKeyboardNavAt = 0;
  var fillChooserActivationClaim = { input: null, at: 0 };
  function logPasskeyContent(event, details = {}) {
    try {
      console.info(PASSKEY_LOG_PREFIX, event, details);
    } catch {
    }
  }
  function getPageUiOwnerIdentity() {
    try {
      const manifest = chrome.runtime.getManifest?.() || {};
      const name = String(manifest.name || "Pass").trim();
      const runtimeId = String(chrome.runtime.id || "").trim();
      const version = String(manifest.version || PASS_EXTENSION_VERSION || "0.0.0").trim();
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
      document.getElementById(PASS_FILL_CHOOSER_ID)?.remove();
      document.getElementById(PASS_PAGE_TOAST_HOST_ID)?.remove();
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
        href: window.location.href
      });
    } catch {
    }
    window.addEventListener("message", onWebAuthnBridgeMessage, false);
    drainPendingWebAuthnNotice();
    for (const delayMs of [120, 400, 1e3, 1600]) {
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
          sendResponse({ ok: false, error: "\u9875\u9762\u5DF2\u7531\u53E6\u4E00\u4E2A Pass \u6269\u5C55\u63A5\u7BA1" });
          return;
        }
        sendResponse(applyExternalFillCredentials(message.payload));
        return;
      }
    });
    document.addEventListener("focusin", onFillFieldFocusIn, true);
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
            payload
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
            const actionText = mode === "update" ? "\u66F4\u65B0\u5BC6\u7801" : "\u4FDD\u5B58\u8D26\u53F7";
            const confirmed = window.confirm(
              `\u68C0\u6D4B\u5230\u767B\u5F55\u884C\u4E3A\u3002
\u57DF\u540D: ${payload.domain}
\u7528\u6237\u540D: ${payload.username}
\u662F\u5426${actionText}\u5230 Pass\uFF1F`
            );
            if (!confirmed) {
              resumeOnce();
              return;
            }
            chrome.runtime.sendMessage(
              {
                type: "PASS_SAVE_FROM_LOGIN",
                payload
              },
              () => {
                resumeOnce();
              }
            );
            setTimeout(resumeOnce, 250);
          }
        );
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
      password
    };
  }
  function findUsernameInput(inputs, passwordInput) {
    const candidates = inputs.filter((input) => {
      if (input === passwordInput) return false;
      if (!isVisible(input)) return false;
      const type = (input.type || "").toLowerCase();
      const semantic = `${input.name || ""} ${input.id || ""} ${input.autocomplete || ""}`.toLowerCase();
      return type === "email" || type === "text" || type === "tel" || semantic.includes("user") || semantic.includes("email") || semantic.includes("login");
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
      element.getAttribute?.("data-testid")
    ].map((value) => String(value || "").toLowerCase()).join(" ");
  }
  function isPasswordInput(element) {
    return element instanceof HTMLInputElement && isVisible(element) && String(element.type || "").toLowerCase() === "password";
  }
  function isUsernameLikeInput(element, { strict = true } = {}) {
    if (!(element instanceof HTMLInputElement)) return false;
    if (!isVisible(element)) return false;
    if (isPasswordInput(element)) return false;
    const type = String(element.type || "text").toLowerCase();
    if (!["text", "email", "tel", "url", "search", ""].includes(type)) return false;
    const semantic = inputSemanticText(element);
    const autocomplete = String(element.autocomplete || "").toLowerCase();
    if (autocomplete.includes("username") || autocomplete.includes("email") || autocomplete === "tel" || autocomplete.includes("nickname")) {
      return true;
    }
    if (semantic.includes("user") || semantic.includes("email") || semantic.includes("login") || semantic.includes("account") || semantic.includes("phone") || semantic.includes("mobile") || semantic.includes("member")) {
      return true;
    }
    return !strict && (type === "text" || type === "email" || type === "tel" || type === "");
  }
  function isFillableCredentialInput(element) {
    if (isPasswordInput(element) || isUsernameLikeInput(element, { strict: true })) return true;
    if (!(element instanceof HTMLInputElement) || !isUsernameLikeInput(element, { strict: false })) {
      return false;
    }
    const form = element.form || element.closest("form");
    if (form) return collectVisiblePasswordInputs(form).length > 0;
    const passwordInputs = collectVisiblePasswordInputs(document);
    if (passwordInputs.length === 0) return false;
    if (passwordInputs.length === 1) return true;
    return passwordInputs.some((passwordInput) => Boolean(
      element.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING
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
    const seen = /* @__PURE__ */ new Set();
    const candidates = [];
    for (const input of form.querySelectorAll("input")) {
      if (!(input instanceof HTMLInputElement) || seen.has(input) || input === passwordInput) continue;
      seen.add(input);
      if (isUsernameLikeInput(input, { strict: true }) || isUsernameLikeInput(input, { strict: false })) {
        candidates.push(input);
      }
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
      try {
        input.focus();
      } catch {
      }
    }
    const proto = window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
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
      writeValue: setNativeInputValue
    });
  }
  function applyExternalFillCredentials(payload) {
    const username = String(payload?.username || "");
    const password = String(payload?.password || "");
    if (!username && !password) {
      return { ok: false, error: "\u7F3A\u5C11\u7528\u6237\u540D\u548C\u5BC6\u7801" };
    }
    const active = document.activeElement;
    fillChooserActiveInput = isFillableCredentialInput(active) ? active : null;
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
      error: result.filledAny ? void 0 : "\u672A\u627E\u5230\u53EF\u586B\u5145\u7684\u7528\u6237\u540D/\u5BC6\u7801\u8F93\u5165\u6846"
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
      colorScheme: "light"
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
    root.style.font = '12px/1.4 "SF Pro Text", "PingFang SC", sans-serif';
    root.style.color = "#1d314d";
    const title = document.createElement("div");
    const siteLabel = normalizeDomain(window.location.hostname) || "\u5F53\u524D\u7F51\u7AD9";
    const windowTitle = `\u586B\u5145\u8D26\u53F7 \xB7 ${siteLabel}`;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", windowTitle);
    title.textContent = windowTitle;
    title.style.fontWeight = "600";
    title.style.fontSize = "13px";
    title.style.margin = "2px 4px 8px";
    title.style.paddingRight = "56px";
    root.appendChild(title);
    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gap = "6px";
    list.style.minHeight = "0";
    list.style.flex = "1 1 auto";
    list.style.maxHeight = "min(500px, calc(100vh - 96px))";
    list.style.overflowY = "auto";
    list.style.scrollbarGutter = "stable";
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
      nameLine.textContent = String(account?.username || "\u672A\u547D\u540D\u8D26\u53F7");
      nameLine.style.fontWeight = "600";
      button.appendChild(nameLine);
      const siteLine = document.createElement("div");
      const sites = Array.isArray(account?.sites) ? account.sites.filter(Boolean) : [];
      siteLine.textContent = sites.slice(0, 3).join(" \xB7 ") || "\u5339\u914D\u5F53\u524D\u7AD9\u70B9";
      siteLine.style.fontSize = "11px";
      siteLine.style.color = "#4b6485";
      button.appendChild(siteLine);
      button.addEventListener("mousedown", (event) => {
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
    closeBtn.textContent = "\u5173\u95ED";
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
        resolve({ ok: false, error: "\u6269\u5C55\u4E0A\u4E0B\u6587\u4E0D\u53EF\u7528" });
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message || "\u6D88\u606F\u53D1\u9001\u5931\u8D25" });
            return;
          }
          resolve(response || { ok: false, error: "\u7A7A\u54CD\u5E94" });
        });
      } catch (error) {
        resolve({ ok: false, error: error?.message || String(error || "\u6D88\u606F\u53D1\u9001\u5931\u8D25") });
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
    if (fillChooserPointerActivation.input === input && now - fillChooserPointerActivation.at < PASS_FILL_USER_ACTIVATION_MS) {
      return true;
    }
    if (fillChooserKeyboardNavAt > 0 && now - fillChooserKeyboardNavAt < PASS_FILL_USER_ACTIVATION_MS) {
      fillChooserKeyboardNavAt = 0;
      return true;
    }
    return false;
  }
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
      if (listGeneration !== fillChooserListGeneration || !ownsPageUi() || isFillChooserBlocked()) {
        return;
      }
      if (!response?.ok) {
        if (response?.locked) fillChooserLocked = true;
        hideFillChooser();
        if (response?.error && response?.error !== "\u6269\u5C55\u4E0A\u4E0B\u6587\u4E0D\u53EF\u7528") {
          showPassPageToast(response.error, response?.locked ? "warning" : "error");
        }
        return;
      }
      const accounts = Array.isArray(response.accounts) ? response.accounts : [];
      if (accounts.length === 0) {
        hideFillChooser();
        if (userInitiated) showPassPageToast("\u5F53\u524D\u7F51\u7AD9\u6CA1\u6709\u5339\u914D\u7684 Pass \u8D26\u53F7", "info");
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
    const targetInput = fillChooserActiveInput;
    fillChooserApplying = true;
    fillChooserListGeneration += 1;
    fillChooserListInFlight = false;
    hideFillChooser();
    let shouldReshow = false;
    try {
      const response = await runtimeSendMessage({
        type: "PASS_CONTENT_FILL_ACCOUNT",
        payload: { accountId: id }
      });
      if (!response?.ok) {
        if (response?.locked) {
          fillChooserLocked = true;
          showPassPageToast(response.error || "\u6269\u5C55\u5DF2\u9501\u5B9A", "warning");
          return;
        }
        showPassPageToast(response?.error || "\u586B\u5145\u5931\u8D25", "error");
        shouldReshow = true;
        return;
      }
      fillChooserActiveInput = targetInput;
      const result = fillFocusedCredentialFields(response.username || "", response.password || "");
      suppressFillChooserReopen();
      const hasUsernameValue = Boolean(String(response.username || "").trim());
      const hasPasswordValue = Boolean(String(response.password || ""));
      if (result.filledUsername && result.filledPassword) {
        if (hasUsernameValue && hasPasswordValue) {
          showPassPageToast(`\u5DF2\u586B\u5145\u7528\u6237\u540D\u548C\u5BC6\u7801\uFF1A${response.username || "\u8D26\u53F7"}`, "success");
        } else if (hasUsernameValue) {
          showPassPageToast(`\u5DF2\u586B\u5145\u7528\u6237\u540D\uFF08\u5BC6\u7801\u4E3A\u7A7A\uFF0C\u5DF2\u6E05\u7A7A\u5BC6\u7801\u6846\uFF09\uFF1A${response.username || "\u8D26\u53F7"}`, "success");
        } else if (hasPasswordValue) {
          showPassPageToast("\u5DF2\u586B\u5145\u5BC6\u7801\uFF08\u7528\u6237\u540D\u4E3A\u7A7A\uFF0C\u5DF2\u6E05\u7A7A\u7528\u6237\u540D\u6846\uFF09", "success");
        } else {
          showPassPageToast("\u5DF2\u6E05\u7A7A\u627E\u5230\u7684\u7528\u6237\u540D/\u5BC6\u7801\u8F93\u5165\u6846", "warning");
        }
      } else if (result.filledPassword && !result.filledUsername) {
        showPassPageToast(
          hasPasswordValue ? "\u5DF2\u586B\u5145\u5BC6\u7801" : "\u5DF2\u6E05\u7A7A\u5BC6\u7801\u6846",
          "success"
        );
      } else if (result.filledUsername && !result.filledPassword) {
        showPassPageToast(
          hasUsernameValue ? `\u5DF2\u586B\u5145\u7528\u6237\u540D\uFF1A${response.username || "\u8D26\u53F7"}` : "\u5DF2\u6E05\u7A7A\u7528\u6237\u540D\u6846",
          "success"
        );
      } else {
        showPassPageToast("\u672A\u627E\u5230\u53EF\u586B\u5145\u7684\u7528\u6237\u540D/\u5BC6\u7801\u8F93\u5165\u6846", "warning");
      }
    } finally {
      fillChooserApplying = false;
      if (!fillChooserHost) fillChooserActiveInput = null;
    }
    if (shouldReshow) reshowFillChooser(targetInput);
  }
  function onFillChooserUserPointer(event) {
    if (event.isTrusted === false || !ownsPageUi()) return;
    const input = resolveFillableInputFromEventTarget(event.target);
    if (!input) return;
    fillChooserPointerActivation = { input, at: Date.now() };
    if (document.activeElement === input && !isFillChooserBlocked()) {
      void showFillChooserForInput(input, { userInitiated: true });
    }
  }
  function onFillChooserUserClick(event) {
    if (event.isTrusted === false || !ownsPageUi()) return;
    const input = resolveFillableInputFromEventTarget(event.target);
    if (!input || isFillChooserBlocked()) return;
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
      sourceContext: data.sourceContext
    };
    logPasskeyContent("bridge-request-received", {
      requestId,
      operation: String(payload.operation || ""),
      host: String(payload.host || ""),
      rpId: String(payload?.publicKey?.rp?.id || payload?.publicKey?.rpId || "")
    });
    void handleWebAuthnBridgeRequest(requestId, payload);
  }
  function clearPendingWebAuthnNoticeAttr() {
    try {
      document.documentElement?.removeAttribute(WEB_AUTHN_NOTICE_DOM_ATTR);
    } catch {
    }
  }
  function readPendingWebAuthnNotices() {
    try {
      const raw = document.documentElement?.getAttribute(WEB_AUTHN_NOTICE_DOM_ATTR);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === "object");
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {
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
    }
  }
  function handleWebAuthnBridgeNotice(data, { clearDomBuffer = true } = {}) {
    if (!ownsPageUi()) return;
    const message = String(data?.message || "").trim();
    if (!message) return;
    if (clearDomBuffer) clearPendingWebAuthnNoticeAttr();
    logPasskeyContent("bridge-notice-received", {
      reason: String(data?.reason || ""),
      operation: String(data?.operation || ""),
      message,
      producerDeduped: Boolean(data?.deduped)
    });
    const noticeKey = `${String(data?.operation || "")}|${String(data?.reason || "")}|${message}`;
    const now = Date.now();
    if (noticeKey === lastWebAuthnNoticeToastKey && now - lastWebAuthnNoticeToastAt < WEB_AUTHN_NOTICE_TOAST_DEDUPE_MS) {
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
          operation: String(payload?.operation || "")
        });
        postWebAuthnBridgeResponse(requestId, {
          ok: false,
          error: {
            name: "NotSupportedError",
            message: "\u6269\u5C55\u4E0A\u4E0B\u6587\u5DF2\u5931\u6548\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5",
            code: "PASSKEY_CONTEXT_INVALIDATED"
          }
        });
        return;
      }
      logPasskeyContent("bridge-request-forwarded", {
        requestId,
        operation: String(payload?.operation || ""),
        viaChooser: payload?.operation === "get"
      });
      const response = payload?.operation === "get" ? await handlePasskeyGetWithChooser(payload) : await sendPasskeyBridgeOperation(payload);
      logPasskeyContent("bridge-response-received", {
        requestId,
        operation: String(payload?.operation || ""),
        ok: Boolean(response?.ok),
        errorCode: String(response?.error?.code || ""),
        createMode: String(response?.result?.createMode || ""),
        createCompatMethod: String(response?.result?.createCompatMethod || "")
      });
      if (response?.ok) {
        if (payload?.operation === "create") {
          const createMode = String(response?.result?.createMode || "").toLowerCase();
          const compatLabel = formatPasskeyCreateCompatToastLabel(response?.result?.createCompatMethod);
          if (createMode === "replaced") {
            showPassPageToast(`Pass \u5DF2\u66F4\u65B0\u901A\u884C\u5BC6\u94A5\uFF0C\u7B49\u5F85\u7F51\u7AD9\u786E\u8BA4${compatLabel ? `\uFF08${compatLabel}\uFF09` : ""}`, "info");
          } else if (createMode === "existing") {
            showPassPageToast(`Pass \u5DF2\u51C6\u5907\u5DF2\u6709\u901A\u884C\u5BC6\u94A5\uFF0C\u7B49\u5F85\u7F51\u7AD9\u786E\u8BA4${compatLabel ? `\uFF08${compatLabel}\uFF09` : ""}`, "info");
          } else {
            showPassPageToast(`Pass \u5DF2\u751F\u6210\u901A\u884C\u5BC6\u94A5\uFF0C\u7B49\u5F85\u7F51\u7AD9\u786E\u8BA4${compatLabel ? `\uFF08${compatLabel}\uFF09` : ""}`, "info");
          }
        } else if (payload?.operation === "get") {
          const siteLabel = resolvePasskeyReadSiteLabel(payload, response);
          const accountLabel = resolvePasskeyReadAccountLabel(response);
          if (accountLabel) {
            showPassPageToast(`${siteLabel} \u5DF2\u8BFB\u53D6\u5BC6\u94A5 ${accountLabel}`);
          } else {
            showPassPageToast(`${siteLabel} \u5DF2\u8BFB\u53D6\u5BC6\u94A5`);
          }
        }
      }
      postWebAuthnBridgeResponse(requestId, response);
    } catch (error) {
      logPasskeyContent("bridge-request-failed", {
        requestId,
        operation: String(payload?.operation || ""),
        name: error?.name || "Error",
        message: error?.message || String(error || "")
      });
      postWebAuthnBridgeResponse(requestId, {
        ok: false,
        error: {
          name: "OperationError",
          message: error?.message || String(error || "\u901A\u884C\u5BC6\u94A5\u5904\u7406\u5931\u8D25"),
          code: "PASSKEY_HANDLE_FAILED"
        }
      });
    }
  }
  function formatPasskeyCreateCompatToastLabel(method) {
    const value = String(method || "").trim().toLowerCase();
    if (value === "user_name_fallback+rs256") return "\u547D\u4E2D\u517C\u5BB92+3";
    if (value === "user_name_fallback") return "\u547D\u4E2D\u517C\u5BB92";
    if (value === "rs256") return "\u547D\u4E2D\u517C\u5BB93";
    if (value === "standard") return "\u547D\u4E2D\u6807\u51C6\u6258\u7BA1";
    return "";
  }
  function resolvePasskeyReadSiteLabel(payload, response) {
    const hintedRpId = normalizeDomain(response?.result?.assertionHint?.rpId || "");
    if (hintedRpId) return hintedRpId;
    const rpId = normalizeDomain(payload?.publicKey?.rpId || "");
    if (rpId) return rpId;
    const host = normalizeDomain(payload?.host || window.location.hostname || "");
    if (host) return host;
    return "\u5F53\u524D\u7F51\u7AD9";
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
    host.setAttribute("aria-label", "Pass \u63D0\u793A");
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
      colorScheme: "light"
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
        badgeFg: "#e8f8ea"
      },
      error: {
        border: "1px solid #d46a6a",
        background: "linear-gradient(180deg, #fdecec 0%, #f8d4d4 100%)",
        color: "#8a1f1f",
        shadow: "0 12px 28px rgba(120, 24, 24, 0.22)",
        badgeBg: "#8a1f1f",
        badgeFg: "#fdecec"
      },
      warning: {
        border: "1px solid #d2b14a",
        background: "linear-gradient(180deg, #fff8df 0%, #ffe9a8 100%)",
        color: "#6a5208",
        shadow: "0 12px 28px rgba(120, 92, 16, 0.2)",
        badgeBg: "#6a5208",
        badgeFg: "#fff8df"
      },
      info: {
        border: "1px solid #6b91d8",
        background: "linear-gradient(180deg, #edf4ff 0%, #dbe9ff 100%)",
        color: "#214f9a",
        shadow: "0 12px 28px rgba(33, 79, 154, 0.2)",
        badgeBg: "#214f9a",
        badgeFg: "#edf4ff"
      }
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
    const index = passPageToasts.findIndex((item2) => item2.id === id);
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
    void el.offsetWidth;
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
    const lifetime = PASS_PAGE_TOAST_DURATION_MS + passPageToasts.length * PASS_PAGE_TOAST_STAGGER_MS;
    const entry = {
      id,
      el,
      timer: null
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
      rpId: String(payload?.publicKey?.rpId || "")
    });
    const candidateResponse = await sendPasskeyBridgeOperation({
      ...payload,
      operation: "getCandidates"
    });
    logPasskeyContent("chooser-candidates-response", {
      ok: Boolean(candidateResponse?.ok),
      count: Array.isArray(candidateResponse?.result?.candidates) ? candidateResponse.result.candidates.length : 0,
      errorCode: String(candidateResponse?.error?.code || "")
    });
    if (!candidateResponse?.ok) {
      return await sendPasskeyBridgeOperation(payload);
    }
    const candidates = Array.isArray(candidateResponse?.result?.candidates) ? candidateResponse.result.candidates : [];
    if (candidates.length === 0) {
      logPasskeyContent("chooser-skipped", { reason: "no-candidate" });
      return await sendPasskeyBridgeOperation(payload);
    }
    const selectedId = await selectPasskeyCandidate(candidates);
    logPasskeyContent("chooser-selection-finished", {
      selectedId: String(selectedId || ""),
      usedBrowserFallback: selectedId === PASSKEY_USE_BROWSER_FALLBACK
    });
    if (!selectedId || selectedId === PASSKEY_USE_BROWSER_FALLBACK) {
      return {
        ok: false,
        error: {
          name: "AbortError",
          message: "\u7528\u6237\u5173\u95ED Pass \u901A\u884C\u5BC6\u94A5\u9009\u62E9\uFF0C\u7EE7\u7EED\u4F7F\u7528\u6D4F\u89C8\u5668\u901A\u884C\u5BC6\u94A5",
          code: "PASSKEY_USE_BROWSER"
        }
      };
    }
    const nextPayload = {
      ...payload,
      publicKey: {
        ...payload.publicKey || {},
        allowCredentials: [
          {
            idB64u: selectedId,
            type: "public-key",
            transports: ["internal"]
          }
        ]
      }
    };
    return await sendPasskeyBridgeOperation(nextPayload);
  }
  function sendPasskeyBridgeOperation(payload) {
    return new Promise((resolve) => {
      if (!isRuntimeAvailable()) {
        logPasskeyContent("runtime-unavailable-before-send", {
          operation: String(payload?.operation || "")
        });
        resolve({
          ok: false,
          error: {
            name: "NotSupportedError",
            message: "\u6269\u5C55\u4E0A\u4E0B\u6587\u5DF2\u5931\u6548\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5",
            code: "PASSKEY_CONTEXT_INVALIDATED"
          }
        });
        return;
      }
      try {
        logPasskeyContent("runtime-send-start", {
          operation: String(payload?.operation || ""),
          host: String(payload?.host || ""),
          rpId: String(payload?.publicKey?.rp?.id || payload?.publicKey?.rpId || "")
        });
        chrome.runtime.sendMessage(
          {
            type: "PASS_PASSKEY_OPERATION",
            payload
          },
          (response) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
              const runtimeMessage = String(runtimeError.message || "");
              const contextInvalidated = runtimeMessage.toLowerCase().includes("extension context invalidated");
              logPasskeyContent("runtime-send-error", {
                operation: String(payload?.operation || ""),
                runtimeMessage,
                contextInvalidated
              });
              resolve({
                ok: false,
                error: {
                  name: contextInvalidated ? "NotSupportedError" : "OperationError",
                  message: runtimeMessage || "\u6269\u5C55\u6D88\u606F\u53D1\u9001\u5931\u8D25",
                  code: contextInvalidated ? "PASSKEY_CONTEXT_INVALIDATED" : "PASSKEY_RUNTIME_ERROR"
                }
              });
              return;
            }
            if (!response) {
              logPasskeyContent("runtime-empty-response", {
                operation: String(payload?.operation || "")
              });
              resolve({
                ok: false,
                error: {
                  name: "OperationError",
                  message: "\u6269\u5C55\u672A\u8FD4\u56DE\u901A\u884C\u5BC6\u94A5\u54CD\u5E94",
                  code: "PASSKEY_EMPTY_RESPONSE"
                }
              });
              return;
            }
            logPasskeyContent("runtime-send-response", {
              operation: String(payload?.operation || ""),
              ok: Boolean(response?.ok),
              errorCode: String(response?.error?.code || "")
            });
            resolve(response);
          }
        );
      } catch (error) {
        logPasskeyContent("runtime-send-threw", {
          operation: String(payload?.operation || ""),
          message: error?.message || String(error || "")
        });
        resolve({
          ok: false,
          error: {
            name: "NotSupportedError",
            message: error?.message || "\u6269\u5C55\u4E0A\u4E0B\u6587\u5DF2\u5931\u6548\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5",
            code: "PASSKEY_CONTEXT_INVALIDATED"
          }
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
      root.style.fontFamily = '"SF Pro Text", "PingFang SC", sans-serif';
      root.style.color = "#1d314d";
      const title = document.createElement("div");
      const siteLabel = normalizeDomain(window.location.hostname) || "\u5F53\u524D\u7F51\u7AD9";
      const windowTitle = `\u9009\u62E9\u901A\u884C\u5BC6\u94A5 \xB7 ${siteLabel}`;
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
        nameLine.textContent = userName || displayName || "\u672A\u547D\u540D\u51ED\u636E";
        nameLine.style.fontWeight = "600";
        button.appendChild(nameLine);
        const detailLine = document.createElement("div");
        detailLine.textContent = `\u6700\u8FD1\u4F7F\u7528: ${formatChooserTime(item?.lastUsedAtMs)} | \u66F4\u65B0: ${formatChooserTime(item?.updatedAtMs)}`;
        detailLine.style.fontSize = "11px";
        detailLine.style.color = "#4b6485";
        button.appendChild(detailLine);
        const idLine = document.createElement("div");
        idLine.textContent = `ID: ${shortenMiddle(String(item?.credentialIdB64u || ""), 18)}`;
        idLine.style.fontSize = "11px";
        idLine.style.color = "#4b6485";
        button.appendChild(idLine);
        button.addEventListener("click", (event) => {
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
      cancelBtn.textContent = "\u5173\u95ED";
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
      }, 12e4);
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
        error: response?.error || null
      },
      window.location.origin
    );
  }
})();
