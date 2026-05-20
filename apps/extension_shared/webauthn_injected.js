(() => {
  const BRIDGE_SOURCE = "pass-webauthn-bridge";
  const REQUEST_TYPE = "PASSKEY_REQUEST";
  const RESPONSE_TYPE = "PASSKEY_RESPONSE";
  const NOTICE_TYPE = "PASSKEY_NOTICE";
  const REQUEST_TIMEOUT_MS = 10000;
  const FALLBACK_NOTICE_DELAY_MS = 1200;
  const PASSKEY_LOG_PREFIX = "[Pass injected]";
  const PASS_EXTENSION_VERSION = "0.1.9";
  const FALLBACK_TOAST_ID = "pass-injected-fallback-toast";
  const FALLBACK_OVERLAY_ID = "pass-injected-fallback-overlay";

  if (window.__passWebAuthnBridgeInstalled) {
    return;
  }
  window.__passWebAuthnBridgeInstalled = true;
  try {
    window.__passInjectedVersion = PASS_EXTENSION_VERSION;
    document.documentElement?.setAttribute("data-pass-injected-version", PASS_EXTENSION_VERSION);
    console.info(`${PASSKEY_LOG_PREFIX} installed`, {
      version: PASS_EXTENSION_VERSION,
      href: window.location.href,
    });
  } catch {
    // Ignore bootstrap diagnostics failures.
  }

  const credentials = navigator.credentials;
  if (!credentials) {
    return;
  }

  const originalCreate = credentials.create?.bind(credentials);
  const originalGet = credentials.get?.bind(credentials);

  if (typeof originalCreate !== "function" || typeof originalGet !== "function") {
    return;
  }

  function logInjected(event, details = {}) {
    try {
      console.info(PASSKEY_LOG_PREFIX, event, details);
    } catch {
      // Ignore logging failures.
    }
  }

  const patchedCreate = async function patchedCreate(options) {
    if (!options?.publicKey) {
      return originalCreate(options);
    }
    const createDecision = explainCreateManageability(options.publicKey);
    logInjected("create-intercepted", {
      manageable: createDecision.manageable,
      reason: createDecision.reason,
      rpId: String(options?.publicKey?.rp?.id || window.location.hostname || ""),
      userName: String(options?.publicKey?.user?.name || ""),
      attachment: String(options?.publicKey?.authenticatorSelection?.authenticatorAttachment || ""),
    });
    if (!createDecision.manageable) {
      await notifyFallbackBeforeBrowser("create", createDecision.reason);
      return originalCreate(options);
    }

    const serialized = serializeCreateOptions(options.publicKey);
    if (!serialized) {
      logInjected("create-serialize-empty", {
        rpId: String(options?.publicKey?.rp?.id || window.location.hostname || ""),
      });
      return originalCreate(options);
    }

    try {
      logInjected("create-bridge-start", {
        rpId: String(serialized?.rp?.id || ""),
        userName: String(serialized?.user?.name || ""),
      });
      const response = await callBridge("create", serialized);
      logInjected("create-bridge-success", {
        createMode: String(response?.createMode || ""),
        createCompatMethod: String(response?.createCompatMethod || ""),
        credentialId: String(response?.credential?.id || ""),
      });
      return buildCreateCredential(response?.credential);
    } catch (error) {
      logInjected("create-bridge-error", {
        name: error?.name || "Error",
        code: error?.code || "",
        message: error?.message || String(error || ""),
        willFallback: shouldFallbackToBrowser(error),
      });
      if (shouldFallbackToBrowser(error)) {
        await notifyFallbackBeforeBrowser("create", error?.code || error?.name || "fallback");
        return originalCreate(options);
      }
      throw toDomLikeError(error, "NotAllowedError");
    }
  };

  const patchedGet = async function patchedGet(options) {
    if (!options?.publicKey) {
      return originalGet(options);
    }
    const getDecision = explainGetManageability(options.publicKey);
    logInjected("get-intercepted", {
      manageable: getDecision.manageable,
      reason: getDecision.reason,
      rpId: String(options?.publicKey?.rpId || window.location.hostname || ""),
      allowCredentialsCount: Array.isArray(options?.publicKey?.allowCredentials)
        ? options.publicKey.allowCredentials.length
        : 0,
    });
    if (!getDecision.manageable) {
      await notifyFallbackBeforeBrowser("get", getDecision.reason);
      return originalGet(options);
    }

    const serialized = serializeGetOptions(options.publicKey);
    if (!serialized) {
      logInjected("get-serialize-empty", {
        rpId: String(options?.publicKey?.rpId || window.location.hostname || ""),
      });
      return originalGet(options);
    }

    try {
      logInjected("get-bridge-start", {
        rpId: String(serialized?.rpId || ""),
        allowCredentialsCount: Array.isArray(serialized?.allowCredentials) ? serialized.allowCredentials.length : 0,
      });
      const response = await callBridge("get", serialized);
      logInjected("get-bridge-success", {
        credentialId: String(response?.credential?.id || ""),
      });
      return buildAssertionCredential(response?.credential);
    } catch (error) {
      logInjected("get-bridge-error", {
        name: error?.name || "Error",
        code: error?.code || "",
        message: error?.message || String(error || ""),
        willFallback: shouldFallbackToBrowser(error),
      });
      if (shouldFallbackToBrowser(error)) {
        await notifyFallbackBeforeBrowser("get", error?.code || error?.name || "fallback");
        return originalGet(options);
      }
      throw toDomLikeError(error, "NotAllowedError");
    }
  };

  const createPatched = installMethod(credentials, "create", patchedCreate);
  const getPatched = installMethod(credentials, "get", patchedGet);
  if (!createPatched || !getPatched) {
    return;
  }

  async function callBridge(operation, publicKey) {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const request = {
      source: BRIDGE_SOURCE,
      type: REQUEST_TYPE,
      requestId,
      operation,
      publicKey,
    };

    return await new Promise((resolve, reject) => {
      let completed = false;
      let timeoutId = null;

      const cleanup = () => {
        if (completed) return;
        completed = true;
        window.removeEventListener("message", onMessage);
        if (timeoutId) clearTimeout(timeoutId);
      };

      const onMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== BRIDGE_SOURCE || data.type !== RESPONSE_TYPE) return;
        if (data.requestId !== requestId) return;

        cleanup();
        if (data.ok) {
          logInjected("bridge-response-ok", {
            requestId,
            operation,
          });
          resolve(data.result || {});
          return;
        }
        logInjected("bridge-response-error", {
          requestId,
          operation,
          name: data?.error?.name || "Error",
          code: data?.error?.code || "",
          message: data?.error?.message || "",
        });
        reject(data.error || { name: "OperationError", message: "通行密钥操作失败" });
      };

      window.addEventListener("message", onMessage);
      timeoutId = setTimeout(() => {
        cleanup();
        logInjected("bridge-timeout", {
          requestId,
          operation,
        });
        reject({ name: "TimeoutError", message: "通行密钥请求超时" });
      }, REQUEST_TIMEOUT_MS);

      logInjected("bridge-posted", {
        requestId,
        operation,
      });
      window.postMessage(request, "*");
    });
  }

  function serializeCreateOptions(publicKey) {
    const challenge = toBase64url(publicKey?.challenge);
    const userId = toBase64url(publicKey?.user?.id);
    if (!challenge || !userId) return null;

    return {
      challengeB64u: challenge,
      rp: {
        id: String(publicKey?.rp?.id || window.location.hostname || ""),
        name: String(publicKey?.rp?.name || publicKey?.rp?.id || window.location.hostname || ""),
      },
      user: {
        idB64u: userId,
        name: String(publicKey?.user?.name || ""),
        displayName: String(publicKey?.user?.displayName || publicKey?.user?.name || ""),
      },
      pubKeyCredParams: Array.isArray(publicKey?.pubKeyCredParams)
        ? publicKey.pubKeyCredParams.map((item) => ({
            type: String(item?.type || "public-key"),
            alg: Number(item?.alg),
          }))
        : [],
      timeout: Number(publicKey?.timeout || 0) || null,
      attestation: publicKey?.attestation || null,
      authenticatorSelection: publicKey?.authenticatorSelection || null,
      excludeCredentials: serializeCredentialList(publicKey?.excludeCredentials || []),
      extensions: publicKey?.extensions || null,
      crossOrigin: window.top !== window.self,
    };
  }

  function serializeGetOptions(publicKey) {
    const challenge = toBase64url(publicKey?.challenge);
    if (!challenge) return null;

    return {
      challengeB64u: challenge,
      rpId: String(publicKey?.rpId || window.location.hostname || ""),
      timeout: Number(publicKey?.timeout || 0) || null,
      userVerification: publicKey?.userVerification || null,
      allowCredentials: serializeCredentialList(publicKey?.allowCredentials || []),
      extensions: publicKey?.extensions || null,
      crossOrigin: window.top !== window.self,
    };
  }

  function serializeCredentialList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => ({
        idB64u: toBase64url(item?.id),
        type: String(item?.type || "public-key"),
        transports: Array.isArray(item?.transports) ? item.transports.map(String) : [],
      }))
      .filter((item) => item.idB64u);
  }

  function buildCreateCredential(credential) {
    if (!credential) {
      throw new Error("创建通行密钥返回为空");
    }

    const rawId = fromBase64url(credential.rawIdB64u || credential.id);
    const clientDataJSON = fromBase64url(credential?.response?.clientDataJSONB64u);
    const attestationObject = fromBase64url(credential?.response?.attestationObjectB64u);
    const transports = Array.isArray(credential?.response?.transports)
      ? credential.response.transports
      : ["internal"];

    const response = {
      clientDataJSON,
      attestationObject,
      getTransports() {
        return transports;
      },
    };
    if (typeof AuthenticatorAttestationResponse === "function") {
      Object.setPrototypeOf(response, AuthenticatorAttestationResponse.prototype);
    }

    const result = {
      id: credential.id,
      rawId,
      type: credential.type || "public-key",
      authenticatorAttachment: credential.authenticatorAttachment || "platform",
      response,
      getClientExtensionResults() {
        return credential.clientExtensionResults || {};
      },
      toJSON() {
        return {
          id: credential.id,
          rawId: credential.rawIdB64u || credential.id,
          type: credential.type || "public-key",
          response: {
            clientDataJSON: credential?.response?.clientDataJSONB64u || "",
            attestationObject: credential?.response?.attestationObjectB64u || "",
            transports,
          },
          clientExtensionResults: credential.clientExtensionResults || {},
        };
      },
    };
    if (typeof PublicKeyCredential === "function") {
      Object.setPrototypeOf(result, PublicKeyCredential.prototype);
    }
    return result;
  }

  function buildAssertionCredential(credential) {
    if (!credential) {
      throw new Error("获取通行密钥断言返回为空");
    }

    const rawId = fromBase64url(credential.rawIdB64u || credential.id);
    const userHandle = credential?.response?.userHandleB64u
      ? fromBase64url(credential.response.userHandleB64u)
      : null;

    const response = {
      clientDataJSON: fromBase64url(credential?.response?.clientDataJSONB64u),
      authenticatorData: fromBase64url(credential?.response?.authenticatorDataB64u),
      signature: fromBase64url(credential?.response?.signatureB64u),
      userHandle,
    };
    if (typeof AuthenticatorAssertionResponse === "function") {
      Object.setPrototypeOf(response, AuthenticatorAssertionResponse.prototype);
    }

    const result = {
      id: credential.id,
      rawId,
      type: credential.type || "public-key",
      authenticatorAttachment: credential.authenticatorAttachment || "platform",
      response,
      getClientExtensionResults() {
        return credential.clientExtensionResults || {};
      },
      toJSON() {
        return {
          id: credential.id,
          rawId: credential.rawIdB64u || credential.id,
          type: credential.type || "public-key",
          response: {
            clientDataJSON: credential?.response?.clientDataJSONB64u || "",
            authenticatorData: credential?.response?.authenticatorDataB64u || "",
            signature: credential?.response?.signatureB64u || "",
            userHandle: credential?.response?.userHandleB64u || null,
          },
          clientExtensionResults: credential.clientExtensionResults || {},
        };
      },
    };
    if (typeof PublicKeyCredential === "function") {
      Object.setPrototypeOf(result, PublicKeyCredential.prototype);
    }
    return result;
  }

  function shouldFallbackToBrowser(error) {
    const code = String(error?.code || "");
    const name = String(error?.name || "");
    return code === "PASSKEY_NOT_FOUND" ||
      code === "PASSKEY_USE_BROWSER" ||
      code === "PASSKEY_CONTEXT_INVALIDATED" ||
      code === "PASSKEY_RUNTIME_ERROR" ||
      code === "PASSKEY_EMPTY_RESPONSE" ||
      code === "PASSKEY_ALG_UNSUPPORTED" ||
      code === "PASSKEY_OP_UNSUPPORTED" ||
      name === "NotSupportedError" ||
      name === "TimeoutError";
  }

  function canPassManageCreate(publicKey) {
    return explainCreateManageability(publicKey).manageable;
  }

  function canPassManageGet(publicKey) {
    return explainGetManageability(publicKey).manageable;
  }

  function explainCreateManageability(publicKey) {
    const challenge = toBase64url(publicKey?.challenge);
    const userId = toBase64url(publicKey?.user?.id);
    if (!challenge || !userId) {
      return { manageable: false, reason: "missing-challenge-or-user-id" };
    }

    const attachment = String(publicKey?.authenticatorSelection?.authenticatorAttachment || "").toLowerCase();
    if (attachment === "cross-platform") {
      return { manageable: false, reason: "cross-platform-requested" };
    }

    return { manageable: true, reason: "managed-by-pass" };
  }

  function explainGetManageability(publicKey) {
    const challenge = toBase64url(publicKey?.challenge);
    if (!challenge) {
      return { manageable: false, reason: "missing-challenge" };
    }

    const allow = Array.isArray(publicKey?.allowCredentials) ? publicKey.allowCredentials : [];
    if (allow.length === 0) {
      return { manageable: true, reason: "no-allow-credentials" };
    }

    const hasInternalCapable = allow.some((item) => {
      const transports = Array.isArray(item?.transports)
        ? item.transports.map((t) => String(t || "").toLowerCase())
        : [];
      if (transports.length === 0) {
        return true;
      }
      return transports.includes("internal");
    });
    if (!hasInternalCapable) {
      return { manageable: false, reason: "allow-credentials-without-internal" };
    }

    return { manageable: true, reason: "allow-credentials-has-internal" };
  }

  function postFallbackNotice(operation, reason) {
    const message = buildFallbackNoticeMessage(operation, reason);
    if (!message) return;
    showInjectedFallbackToast(message);
    showInjectedFallbackOverlay(message);
    logInjected("fallback-notice-posted", {
      operation,
      reason,
      message,
    });
    window.postMessage({
      source: BRIDGE_SOURCE,
      type: NOTICE_TYPE,
      operation,
      reason,
      message,
    }, "*");
  }

  async function notifyFallbackBeforeBrowser(operation, reason) {
    postFallbackNotice(operation, reason);
    await sleep(FALLBACK_NOTICE_DELAY_MS);
  }

  function buildFallbackNoticeMessage(operation, reason) {
    const opLabel = operation === "get" ? "读取通行密钥" : "保存通行密钥";
    switch (String(reason || "")) {
      case "cross-platform-requested":
        return `Pass 未接管${opLabel}，本次改由浏览器原生处理：网站请求外置安全密钥`;
      case "allow-credentials-without-internal":
        return `Pass 未接管${opLabel}，本次改由浏览器原生处理：网站指定了非本机通行密钥`;
      case "missing-challenge-or-user-id":
      case "missing-challenge":
        return `Pass 未接管${opLabel}，本次改由浏览器原生处理：网站请求参数不完整`;
      case "PASSKEY_USE_BROWSER":
        return `Pass 已切换为浏览器原生处理${opLabel}`;
      case "PASSKEY_CONTEXT_INVALIDATED":
        return `Pass 已切换为浏览器原生处理${opLabel}：扩展上下文失效`;
      case "PASSKEY_RUNTIME_ERROR":
        return `Pass 已切换为浏览器原生处理${opLabel}：扩展通信失败`;
      case "PASSKEY_EMPTY_RESPONSE":
        return `Pass 已切换为浏览器原生处理${opLabel}：扩展未返回结果`;
      case "PASSKEY_ALG_UNSUPPORTED":
        return `Pass 已切换为浏览器原生处理${opLabel}：网站要求的算法当前未托管`;
      case "PASSKEY_OP_UNSUPPORTED":
        return `Pass 已切换为浏览器原生处理${opLabel}：操作类型当前未托管`;
      case "TimeoutError":
        return `Pass 已切换为浏览器原生处理${opLabel}：Pass 响应超时`;
      case "NotSupportedError":
        return `Pass 已切换为浏览器原生处理${opLabel}：当前环境不支持托管`;
      default:
        return `Pass 已切换为浏览器原生处理${opLabel}`;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function showInjectedFallbackToast(message) {
    const text = String(message || "").trim();
    if (!text) return;

    let toast = document.getElementById(FALLBACK_TOAST_ID);
    if (!(toast instanceof HTMLDivElement)) {
      toast = document.createElement("div");
      toast.id = FALLBACK_TOAST_ID;
      toast.style.position = "fixed";
      toast.style.top = "14px";
      toast.style.right = "14px";
      toast.style.zIndex = "2147483647";
      toast.style.maxWidth = "min(520px, calc(100vw - 28px))";
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
    setTimeout(() => {
      const current = document.getElementById(FALLBACK_TOAST_ID);
      if (current instanceof HTMLDivElement) {
        current.style.opacity = "0";
      }
    }, 3000);
  }

  function showInjectedFallbackOverlay(message) {
    const text = String(message || "").trim();
    if (!text) return;

    let overlay = document.getElementById(FALLBACK_OVERLAY_ID);
    if (!(overlay instanceof HTMLDivElement)) {
      overlay = document.createElement("div");
      overlay.id = FALLBACK_OVERLAY_ID;
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "2147483646";
      overlay.style.pointerEvents = "none";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.background = "rgba(18, 24, 20, 0.18)";
      overlay.style.opacity = "0";
      overlay.style.transition = "opacity 120ms ease-out";

      const panel = document.createElement("div");
      panel.setAttribute("data-role", "panel");
      panel.style.maxWidth = "min(720px, calc(100vw - 48px))";
      panel.style.padding = "18px 22px";
      panel.style.borderRadius = "16px";
      panel.style.border = "1px solid #63a56a";
      panel.style.background = "linear-gradient(180deg, #e8f8ea 0%, #d5f2d9 100%)";
      panel.style.color = "#1d5b2c";
      panel.style.font = '700 30px/1.45 "SF Pro Text", "PingFang SC", sans-serif';
      panel.style.boxShadow = "0 24px 80px rgba(24, 68, 33, 0.28)";
      panel.style.textAlign = "center";
      panel.style.whiteSpace = "pre-wrap";
      panel.style.wordBreak = "break-word";
      overlay.appendChild(panel);

      (document.documentElement || document.body).appendChild(overlay);
    }

    const panel = overlay.querySelector('[data-role="panel"]');
    if (panel instanceof HTMLDivElement) {
      panel.textContent = text;
    }
    overlay.style.opacity = "1";
    setTimeout(() => {
      const current = document.getElementById(FALLBACK_OVERLAY_ID);
      if (current instanceof HTMLDivElement) {
        current.style.opacity = "0";
      }
    }, Math.max(0, FALLBACK_NOTICE_DELAY_MS - 80));
  }

  function toDomLikeError(error, fallbackName) {
    const err = new Error(error?.message || "通行密钥操作失败");
    err.name = error?.name || fallbackName;
    err.code = error?.code || "";
    return err;
  }

  function toBase64url(input) {
    const bytes = toBytes(input);
    if (!bytes || bytes.length === 0) return "";
    return bytesToBase64url(bytes);
  }

  function fromBase64url(input) {
    const bytes = base64urlToBytes(input);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  function toBytes(input) {
    if (!input) return null;
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    return null;
  }

  function bytesToBase64url(bytes) {
    let bin = "";
    for (const byte of bytes) {
      bin += String.fromCharCode(byte);
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64urlToBytes(input) {
    const normalized = String(input || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    if (!normalized) return new Uint8Array();
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }

  function installMethod(target, key, fn) {
    try {
      target[key] = fn;
      if (target[key] === fn) return true;
    } catch {
      // continue
    }

    try {
      Object.defineProperty(target, key, {
        configurable: true,
        writable: true,
        value: fn,
      });
      return true;
    } catch {
      // continue
    }

    try {
      const proto = Object.getPrototypeOf(target);
      Object.defineProperty(proto, key, {
        configurable: true,
        writable: true,
        value: fn,
      });
      return true;
    } catch {
      return false;
    }
  }
})();
