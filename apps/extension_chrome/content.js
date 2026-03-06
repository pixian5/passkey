const STORAGE_KEY_ACCOUNTS = "pass.accounts";
const PASS_LOGIN_COOLDOWN_MS = 5000;
const WEB_AUTHN_BRIDGE_SOURCE = "pass-webauthn-bridge";
const WEB_AUTHN_REQUEST_TYPE = "PASSKEY_REQUEST";
const WEB_AUTHN_RESPONSE_TYPE = "PASSKEY_RESPONSE";
const PASS_PAGE_TOAST_ID = "pass-page-toast";
const PASS_PAGE_TOAST_DURATION_MS = 3000;

const ETLD2_SUFFIXES = new Set([
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "co.uk",
  "org.uk",
]);

let lastPromptKey = "";
let lastPromptAt = 0;
let accountsCache = [];
let passPageToastTimer = null;

initAccountCache().catch(() => {
  // Ignore cache bootstrap errors; detection continues with empty cache.
});
installWebAuthnBridge();
window.addEventListener("message", onWebAuthnBridgeMessage, false);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!changes[STORAGE_KEY_ACCOUNTS]) return;
  const next = changes[STORAGE_KEY_ACCOUNTS].newValue;
  accountsCache = Array.isArray(next) ? next.map(normalizeAccountShape) : [];
});

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

    const mode = decidePromptMode(payload);
    if (!mode) return;

    const promptKey = `${payload.domain}|${payload.username}|${payload.password}|${mode}`;
    const now = Date.now();
    if (promptKey === lastPromptKey && now - lastPromptAt < PASS_LOGIN_COOLDOWN_MS) {
      return;
    }

    const submitter = event.submitter;
    event.preventDefault();

    const actionText = mode === "update" ? "更新密码" : "保存账号";
    const confirmed = window.confirm(
      `检测到登录行为。\n域名: ${payload.domain}\n用户名: ${payload.username}\n是否${actionText}到 Pass？`
    );

    lastPromptKey = promptKey;
    lastPromptAt = now;

    if (!confirmed) {
      resumeSubmit(form, submitter);
      return;
    }

    let resumed = false;
    const resumeOnce = () => {
      if (resumed) return;
      resumed = true;
      resumeSubmit(form, submitter);
    };

    chrome.runtime.sendMessage(
      {
        type: "PASS_SAVE_FROM_LOGIN",
        payload,
      },
      () => {
        resumeOnce();
      }
    );

    // Fallback in case runtime message callback is delayed.
    setTimeout(resumeOnce, 250);
  },
  true
);

async function initAccountCache() {
  const result = await chrome.storage.local.get([STORAGE_KEY_ACCOUNTS]);
  const raw = Array.isArray(result[STORAGE_KEY_ACCOUNTS]) ? result[STORAGE_KEY_ACCOUNTS] : [];
  accountsCache = raw.map(normalizeAccountShape);
}

function decidePromptMode(payload) {
  const activeAccounts = accountsCache.filter((account) => !account.isDeleted);

  const exact = activeAccounts.some((account) => {
    return accountMatchesDomain(account, payload.domain) &&
      account.username === payload.username &&
      account.password === payload.password;
  });
  if (exact) return null;

  const updateCandidate = activeAccounts.some((account) => {
    return accountMatchesDomain(account, payload.domain) &&
      account.username === payload.username &&
      account.password !== payload.password;
  });

  return updateCandidate ? "update" : "create";
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

function normalizeAccountShape(account) {
  const sites = normalizeSites(account.sites || []);
  return {
    sites,
    username: account.username || "",
    password: account.password || "",
    isDeleted: Boolean(account.isDeleted),
  };
}

function accountMatchesDomain(account, domain) {
  const normalized = normalizeDomain(domain);
  const etld1 = etldPlusOne(normalized);
  return account.sites.some((site) => site === normalized || etldPlusOne(site) === etld1);
}

function normalizeDomain(input) {
  if (!input) return "";
  let value = input.trim().toLowerCase();
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

function isVisible(input) {
  if (!(input instanceof HTMLElement)) return false;
  if ((input.type || "").toLowerCase() === "hidden") return false;
  if (input.disabled || input.readOnly) return false;
  const style = window.getComputedStyle(input);
  return style.display !== "none" && style.visibility !== "hidden";
}

function installWebAuthnBridge() {
  if (!isRuntimeAvailable()) return;
  const scriptId = "pass-webauthn-bridge-injected";
  if (document.getElementById(scriptId)) return;
  const parent = document.head || document.documentElement;
  if (!parent) return;

  const script = document.createElement("script");
  script.id = scriptId;
  try {
    script.src = chrome.runtime.getURL("webauthn_injected.js");
  } catch {
    return;
  }
  script.async = false;
  parent.appendChild(script);
  script.remove();
}

function onWebAuthnBridgeMessage(event) {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== WEB_AUTHN_BRIDGE_SOURCE || data.type !== WEB_AUTHN_REQUEST_TYPE) return;

  const requestId = String(data.requestId || "");
  if (!requestId) return;

  const payload = {
    operation: data.operation,
    publicKey: data.publicKey,
    origin: window.location.origin,
    host: window.location.hostname,
  };

  void handleWebAuthnBridgeRequest(requestId, payload);
}

async function handleWebAuthnBridgeRequest(requestId, payload) {
  try {
    if (!isRuntimeAvailable()) {
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

    const response = payload?.operation === "get"
      ? await handlePasskeyGetWithChooser(payload)
      : await sendPasskeyBridgeOperation(payload);
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
        showPassPageToast("Pass 已读取通行密钥");
      }
    }
    postWebAuthnBridgeResponse(requestId, response);
  } catch (error) {
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

function showPassPageToast(message) {
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
    toast.style.border = "1px solid #63a56a";
    toast.style.background = "linear-gradient(180deg, #e8f8ea 0%, #d5f2d9 100%)";
    toast.style.color = "#1d5b2c";
    toast.style.font = '600 24px/1.4 "SF Pro Text", "PingFang SC", sans-serif';
    toast.style.boxShadow = "0 12px 28px rgba(24, 68, 33, 0.22)";
    toast.style.pointerEvents = "none";
    toast.style.opacity = "0";
    toast.style.transition = "opacity 140ms ease-out";
    (document.documentElement || document.body).appendChild(toast);
  }

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
  const candidateResponse = await sendPasskeyBridgeOperation({
    ...payload,
    operation: "getCandidates",
  });

  if (!candidateResponse?.ok) {
    return await sendPasskeyBridgeOperation(payload);
  }

  const candidates = Array.isArray(candidateResponse?.result?.candidates)
    ? candidateResponse.result.candidates
    : [];
  if (candidates.length <= 1) {
    return await sendPasskeyBridgeOperation(payload);
  }

  const selectedId = await selectPasskeyCandidate(candidates);
  if (!selectedId) {
    return {
      ok: false,
      error: {
        name: "NotAllowedError",
        message: "用户取消通行密钥选择",
        code: "PASSKEY_USER_CANCEL",
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

          resolve(response);
        }
      );
    } catch (error) {
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
    if (existing) {
      existing.remove();
    }

    const root = document.createElement("div");
    root.id = "pass-passkey-chooser";
    root.style.position = "fixed";
    root.style.left = "12px";
    root.style.top = "12px";
    root.style.zIndex = "2147483647";
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
      root.remove();
      document.removeEventListener("keydown", onKeydown, true);
      if (timerId) {
        clearTimeout(timerId);
      }
      resolve(value);
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cleanup(null);
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

      button.addEventListener("click", () => {
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
    cancelBtn.textContent = "取消";
    cancelBtn.style.border = "1px solid #9ab9eb";
    cancelBtn.style.borderRadius = "8px";
    cancelBtn.style.padding = "5px 8px";
    cancelBtn.style.background = "#ffffff";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.addEventListener("click", () => {
      cleanup(null);
    });
    footer.appendChild(cancelBtn);

    root.appendChild(footer);
    document.documentElement.appendChild(root);

    timerId = setTimeout(() => {
      cleanup(null);
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
    "*"
  );
}
