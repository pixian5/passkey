const STORAGE_KEY_ACCOUNTS = "pass.accounts";
const PASS_LOGIN_COOLDOWN_MS = 5000;

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

initAccountCache().catch(() => {
  // Ignore cache bootstrap errors; detection continues with empty cache.
});

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

