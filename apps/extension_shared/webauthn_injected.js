import { PASS_EXTENSION_VERSION } from "./extension_version.js";
import { resolveWebAuthnWindowContext } from "./webauthn_client_data.js";
import {
  buildAuthenticatorAssertionResponse,
  buildAuthenticatorAttestationResponse,
} from "./webauthn_response.js";
import {
  explainCreateManageability as explainCreateRouting,
  explainGetManageability as explainGetRouting,
  shouldFallbackToBrowser as shouldFallbackRouting,
} from "./webauthn_routing.js";

(() => {
  const BRIDGE_SOURCE = "pass-webauthn-bridge";
  const REQUEST_TYPE = "PASSKEY_REQUEST";
  const RESPONSE_TYPE = "PASSKEY_RESPONSE";
  const NOTICE_TYPE = "PASSKEY_NOTICE";
  const DIAGNOSTIC_TYPE = "PASSKEY_DIAGNOSTIC";
  const REQUEST_TIMEOUT_MS = 10000;
  const FALLBACK_NOTICE_DELAY_MS = 1200;
  const FALLBACK_NOTICE_DEDUPE_MS = 2500;
  const PASSKEY_LOG_PREFIX = "[Pass injected]";
  const CREATE_ERROR_MONITOR_MS = 30000;
  let lastFallbackNoticeKey = "";
  let lastFallbackNoticeAt = 0;
  let activeCreateDiagnostic = null;

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

  function postPageDiagnostic(diagnosticSessionId, phase, details = {}) {
    if (!diagnosticSessionId) return;
    try {
      window.postMessage({
        source: BRIDGE_SOURCE,
        type: DIAGNOSTIC_TYPE,
        operation: "create",
        diagnosticSessionId,
        phase,
        details,
      }, window.location.origin);
    } catch {
      // Diagnostics must never interfere with the RP's WebAuthn flow.
    }
  }

  function activateCreateErrorMonitor(diagnosticSessionId) {
    const now = Date.now();
    activeCreateDiagnostic = {
      diagnosticSessionId,
      startedAtMs: now,
      expiresAtMs: now + CREATE_ERROR_MONITOR_MS,
    };
  }

  function currentCreateDiagnosticContext() {
    if (!activeCreateDiagnostic || Date.now() > activeCreateDiagnostic.expiresAtMs) {
      activeCreateDiagnostic = null;
      return null;
    }
    return activeCreateDiagnostic;
  }

  function summarizePageError(reason) {
    try {
      const value = reason && typeof reason === "object" ? reason : {};
      return {
        constructor: String(value?.constructor?.name || typeof reason || ""),
        name: String(value?.name || ""),
        code: String(value?.code ?? ""),
        message: String(value?.message || reason || ""),
      };
    } catch {
      return { constructor: "unknown", name: "", code: "", message: "无法读取页面错误对象" };
    }
  }

  window.addEventListener("unhandledrejection", (event) => {
    const context = currentCreateDiagnosticContext();
    if (!context) return;
    postPageDiagnostic(context.diagnosticSessionId, "page-unhandled-rejection", {
      ...summarizePageError(event?.reason),
      afterCredentialReturnMs: Date.now() - context.startedAtMs,
    });
  }, true);

  window.addEventListener("error", (event) => {
    const context = currentCreateDiagnosticContext();
    if (!context) return;
    postPageDiagnostic(context.diagnosticSessionId, "page-error", {
      ...summarizePageError(event?.error || event?.message),
      afterCredentialReturnMs: Date.now() - context.startedAtMs,
    });
  }, true);

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
      activateCreateErrorMonitor(response?.diagnosticSessionId);
      return buildCreateCredential(response?.credential, response?.diagnosticSessionId);
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
    const frameContext = resolveWebAuthnWindowContext(window);
    const requestId = (() => {
      try {
        if (typeof crypto?.randomUUID === "function") return `req_${crypto.randomUUID()}`;
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        return `req_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
      } catch {
        throw { name: "SecurityError", message: "当前环境不支持安全随机数" };
      }
    })();
    const request = {
      source: BRIDGE_SOURCE,
      type: REQUEST_TYPE,
      requestId,
      operation,
      publicKey,
      sourceContext: frameContext,
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
        if (event.origin && frameContext.origin && event.origin !== frameContext.origin) return;
        const data = event.data;
        if (!data || data.source !== BRIDGE_SOURCE || data.type !== RESPONSE_TYPE) return;
        if (data.requestId !== requestId) return;

        cleanup();
        if (data.ok) {
          logInjected("bridge-response-ok", {
            requestId,
            operation,
          });
          resolve({ ...(data.result || {}), diagnosticSessionId: requestId });
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
      window.postMessage(request, frameContext.origin || "*");
    });
  }

  function serializeCreateOptions(publicKey) {
    const challenge = toBase64url(publicKey?.challenge);
    const userId = toBase64url(publicKey?.user?.id);
    if (!challenge || !userId) return null;
    const frameContext = resolveWebAuthnWindowContext(window);
    if (!frameContext.origin || (frameContext.crossOrigin && !frameContext.topOrigin)) return null;

    return {
      challengeB64u: challenge,
      rp: {
        id: String(publicKey?.rp?.id || frameContext.host || ""),
        name: String(publicKey?.rp?.name || publicKey?.rp?.id || frameContext.host || ""),
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
      crossOrigin: frameContext.crossOrigin,
      topOrigin: frameContext.topOrigin,
    };
  }

  function serializeGetOptions(publicKey) {
    const challenge = toBase64url(publicKey?.challenge);
    if (!challenge) return null;
    const frameContext = resolveWebAuthnWindowContext(window);
    if (!frameContext.origin || (frameContext.crossOrigin && !frameContext.topOrigin)) return null;

    return {
      challengeB64u: challenge,
      rpId: String(publicKey?.rpId || frameContext.host || ""),
      timeout: Number(publicKey?.timeout || 0) || null,
      userVerification: publicKey?.userVerification || null,
      allowCredentials: serializeCredentialList(publicKey?.allowCredentials || []),
      extensions: publicKey?.extensions || null,
      crossOrigin: frameContext.crossOrigin,
      topOrigin: frameContext.topOrigin,
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

  function buildCreateCredential(credential, diagnosticSessionId) {
    if (!credential) {
      throw new Error("创建通行密钥返回为空");
    }

    const rawId = fromBase64url(credential.rawIdB64u || credential.id);
    const response = buildAuthenticatorAttestationResponse(credential?.response);
    if (typeof AuthenticatorAttestationResponse === "function") {
      Object.setPrototypeOf(response, AuthenticatorAttestationResponse.prototype);
    }

    const reportedApiMethods = new Set();
    const reportApiCall = (method, resultNames = []) => {
      if (reportedApiMethods.has(method)) return;
      reportedApiMethods.add(method);
      postPageDiagnostic(diagnosticSessionId, "page-api-called", { method, resultNames });
    };
    const result = {
      id: credential.id,
      rawId,
      type: credential.type || "public-key",
      authenticatorAttachment: credential.authenticatorAttachment || "platform",
      response,
      getClientExtensionResults() {
        const extensionResults = credential.clientExtensionResults || {};
        reportApiCall("PublicKeyCredential.getClientExtensionResults", Object.keys(extensionResults));
        return extensionResults;
      },
      toJSON() {
        reportApiCall("PublicKeyCredential.toJSON");
        return {
          id: credential.id,
          rawId: credential.rawIdB64u || credential.id,
          type: credential.type || "public-key",
          authenticatorAttachment: credential.authenticatorAttachment || "platform",
          response: response.toJSON(),
          clientExtensionResults: credential.clientExtensionResults || {},
        };
      },
    };
    if (typeof PublicKeyCredential === "function") {
      Object.setPrototypeOf(result, PublicKeyCredential.prototype);
    }
    for (const method of [
      "getAuthenticatorData",
      "getPublicKey",
      "getPublicKeyAlgorithm",
      "getTransports",
      "toJSON",
    ]) {
      if (typeof response?.[method] !== "function") continue;
      const originalMethod = response[method].bind(response);
      response[method] = (...args) => {
        reportApiCall(`AuthenticatorAttestationResponse.${method}`);
        return originalMethod(...args);
      };
    }
    postPageDiagnostic(diagnosticSessionId, "page-credential-returned", {
      credentialConstructor: String(result?.constructor?.name || ""),
      responseConstructor: String(response?.constructor?.name || ""),
      credentialType: String(result.type || ""),
      authenticatorAttachment: String(result.authenticatorAttachment || ""),
      rawIdByteLength: rawId.byteLength,
      responseByteLengths: {
        clientDataJSON: response.clientDataJSON?.byteLength || 0,
        attestationObject: response.attestationObject?.byteLength || 0,
        authenticatorData: base64urlToBytes(credential?.response?.authenticatorDataB64u).byteLength,
        publicKey: base64urlToBytes(credential?.response?.publicKeyB64u).byteLength,
      },
      responseOwnKeys: Object.keys(response),
      responseJsonKeys: Object.keys(credential?.response || {}),
      clientExtensionResultNames: Object.keys(credential.clientExtensionResults || {}),
      api: {
        credentialToJSON: typeof result.toJSON === "function",
        getClientExtensionResults: typeof result.getClientExtensionResults === "function",
        getAuthenticatorData: typeof response.getAuthenticatorData === "function",
        getPublicKey: typeof response.getPublicKey === "function",
        getPublicKeyAlgorithm: typeof response.getPublicKeyAlgorithm === "function",
        getTransports: typeof response.getTransports === "function",
        responseToJSON: typeof response.toJSON === "function",
      },
    });
    return result;
  }

  function buildAssertionCredential(credential) {
    if (!credential) {
      throw new Error("获取通行密钥断言返回为空");
    }

    const rawId = fromBase64url(credential.rawIdB64u || credential.id);
    const response = buildAuthenticatorAssertionResponse(credential?.response);
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
          authenticatorAttachment: credential.authenticatorAttachment || "platform",
          response: response.toJSON(),
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
    return shouldFallbackRouting(error);
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
    return explainCreateRouting({
      hasChallenge: Boolean(challenge),
      hasUserId: Boolean(userId),
      authenticatorAttachment: publicKey?.authenticatorSelection?.authenticatorAttachment,
      googleLegacyAppidSupport: publicKey?.extensions?.googleLegacyAppidSupport === true,
    });
  }

  function explainGetManageability(publicKey) {
    const challenge = toBase64url(publicKey?.challenge);
    return explainGetRouting({ hasChallenge: Boolean(challenge) });
  }

  function postFallbackNotice(operation, reason) {
    const message = buildFallbackNoticeMessage(operation, reason);
    if (!message) return;

    // Visual toast is owned by the content script (isolated world). Injected only
    // posts the notice so we keep a single toast implementation.
    // Also park the latest notice on the DOM so content can drain it if it
    // installed after this postMessage (document_start vs document_idle race).
    const noticeKey = `${String(operation || "")}|${String(reason || "")}|${message}`;
    const now = Date.now();
    const isDuplicate = noticeKey === lastFallbackNoticeKey && now - lastFallbackNoticeAt < FALLBACK_NOTICE_DEDUPE_MS;
    lastFallbackNoticeKey = noticeKey;
    lastFallbackNoticeAt = now;

    logInjected("fallback-notice-posted", {
      operation,
      reason,
      message,
      deduped: isDuplicate,
    });

    const noticePayload = {
      source: BRIDGE_SOURCE,
      type: NOTICE_TYPE,
      operation,
      reason,
      message,
      deduped: isDuplicate,
      postedAtMs: now,
    };

    // Queue on the DOM (array) so content can drain missed notices after idle install.
    // Keep only a short recent window; content owns display dedupe.
    if (!isDuplicate) {
      try {
        const attr = "data-pass-webauthn-notice";
        const maxAgeMs = 5000;
        const maxItems = 5;
        let queue = [];
        const raw = document.documentElement?.getAttribute(attr);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) queue = parsed;
            else if (parsed && typeof parsed === "object") queue = [parsed];
          } catch {
            queue = [];
          }
        }
        queue = queue.filter((item) => {
          if (!item || typeof item !== "object") return false;
          const postedAtMs = Number(item.postedAtMs || 0);
          return !postedAtMs || now - postedAtMs <= maxAgeMs;
        });
        const alreadyQueued = queue.some((item) => (
          String(item?.operation || "") === String(operation || "")
          && String(item?.reason || "") === String(reason || "")
          && String(item?.message || "") === message
        ));
        if (!alreadyQueued) {
          queue.push(noticePayload);
          if (queue.length > maxItems) queue = queue.slice(-maxItems);
          document.documentElement?.setAttribute(attr, JSON.stringify(queue));
        }
      } catch {
        // Ignore DOM buffer failures; postMessage may still deliver.
      }
    }

    window.postMessage(noticePayload, window.location.origin);
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
      case "google-legacy-appid-request":
        return `Pass 未接管${opLabel}，本次改由浏览器原生处理：Google 请求旧式外置安全密钥`;
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
