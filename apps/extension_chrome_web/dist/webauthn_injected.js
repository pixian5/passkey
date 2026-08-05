(() => {
  // extension_version.js
  var PASS_EXTENSION_VERSION = "1.5.9";

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

  // webauthn_response.js
  function normalizeBase64url(input) {
    return String(input || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function base64urlToArrayBuffer(input) {
    const normalized = normalizeBase64url(input);
    if (!normalized) return new ArrayBuffer(0);
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const bin = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(bin.length);
    for (let index = 0; index < bin.length; index += 1) {
      bytes[index] = bin.charCodeAt(index);
    }
    return bytes.buffer;
  }
  function cloneArrayBuffer(input) {
    return input.slice(0);
  }
  function buildAuthenticatorAttestationResponse(responseData) {
    const clientDataJSON = base64urlToArrayBuffer(responseData?.clientDataJSONB64u);
    const attestationObject = base64urlToArrayBuffer(responseData?.attestationObjectB64u);
    const authenticatorData = base64urlToArrayBuffer(responseData?.authenticatorDataB64u);
    const publicKey = responseData?.publicKeyB64u ? base64urlToArrayBuffer(responseData.publicKeyB64u) : null;
    const publicKeyAlgorithm = Number(responseData?.publicKeyAlgorithm);
    const transports = Array.isArray(responseData?.transports) ? responseData.transports.map(String) : ["internal"];
    return {
      clientDataJSON,
      attestationObject,
      getTransports() {
        return [...transports];
      },
      getAuthenticatorData() {
        return cloneArrayBuffer(authenticatorData);
      },
      getPublicKey() {
        return publicKey ? cloneArrayBuffer(publicKey) : null;
      },
      getPublicKeyAlgorithm() {
        return Number.isFinite(publicKeyAlgorithm) ? publicKeyAlgorithm : 0;
      },
      toJSON() {
        return {
          clientDataJSON: normalizeBase64url(responseData?.clientDataJSONB64u),
          attestationObject: normalizeBase64url(responseData?.attestationObjectB64u),
          transports: [...transports],
          authenticatorData: normalizeBase64url(responseData?.authenticatorDataB64u),
          publicKey: responseData?.publicKeyB64u ? normalizeBase64url(responseData.publicKeyB64u) : null,
          publicKeyAlgorithm: Number.isFinite(publicKeyAlgorithm) ? publicKeyAlgorithm : 0
        };
      }
    };
  }
  function buildAuthenticatorAssertionResponse(responseData) {
    const userHandle = responseData?.userHandleB64u ? base64urlToArrayBuffer(responseData.userHandleB64u) : null;
    return {
      clientDataJSON: base64urlToArrayBuffer(responseData?.clientDataJSONB64u),
      authenticatorData: base64urlToArrayBuffer(responseData?.authenticatorDataB64u),
      signature: base64urlToArrayBuffer(responseData?.signatureB64u),
      userHandle,
      toJSON() {
        return {
          clientDataJSON: normalizeBase64url(responseData?.clientDataJSONB64u),
          authenticatorData: normalizeBase64url(responseData?.authenticatorDataB64u),
          signature: normalizeBase64url(responseData?.signatureB64u),
          userHandle: responseData?.userHandleB64u ? normalizeBase64url(responseData.userHandleB64u) : null
        };
      }
    };
  }

  // webauthn_routing.js
  function explainCreateManageability({
    hasChallenge,
    hasUserId,
    authenticatorAttachment,
    attestation,
    googleLegacyAppidSupport
  } = {}) {
    if (!hasChallenge || !hasUserId) {
      return { manageable: false, reason: "missing-challenge-or-user-id" };
    }
    if (googleLegacyAppidSupport === true) {
      return { manageable: false, reason: "google-legacy-appid-request" };
    }
    if (["direct", "enterprise"].includes(String(attestation || "").toLowerCase())) {
      return { manageable: false, reason: "attestation-required-by-rp" };
    }
    if (String(authenticatorAttachment || "").toLowerCase() === "cross-platform") {
      return { manageable: false, reason: "cross-platform-requested" };
    }
    return { manageable: true, reason: "managed-by-pass" };
  }
  function explainGetManageability({ hasChallenge } = {}) {
    if (!hasChallenge) {
      return { manageable: false, reason: "missing-challenge" };
    }
    return { manageable: true, reason: "managed-by-pass" };
  }
  function shouldFallbackToBrowser(error) {
    const code = String(error?.code || "");
    return code === "PASSKEY_NOT_FOUND" || code === "PASSKEY_USE_BROWSER";
  }

  // webauthn_injected.js
  (() => {
    const BRIDGE_SOURCE = "pass-webauthn-bridge";
    const REQUEST_TYPE = "PASSKEY_REQUEST";
    const RESPONSE_TYPE = "PASSKEY_RESPONSE";
    const NOTICE_TYPE = "PASSKEY_NOTICE";
    const DIAGNOSTIC_TYPE = "PASSKEY_DIAGNOSTIC";
    const REQUEST_TIMEOUT_MS = 1e4;
    const FALLBACK_NOTICE_DELAY_MS = 1200;
    const FALLBACK_NOTICE_DEDUPE_MS = 2500;
    const PASSKEY_LOG_PREFIX = "[Pass injected]";
    const CREATE_ERROR_MONITOR_MS = 3e4;
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
        href: window.location.href
      });
    } catch {
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
          details
        }, window.location.origin);
      } catch {
      }
    }
    function activateCreateErrorMonitor(diagnosticSessionId) {
      const now = Date.now();
      activeCreateDiagnostic = {
        diagnosticSessionId,
        startedAtMs: now,
        expiresAtMs: now + CREATE_ERROR_MONITOR_MS
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
          constructor: String(value?.constructor?.name || typeof reason),
          name: String(value?.name || ""),
          code: String(value?.code ?? ""),
          message: String(value?.message || reason || "")
        };
      } catch {
        return { constructor: "unknown", name: "", code: "", message: "\u65E0\u6CD5\u8BFB\u53D6\u9875\u9762\u9519\u8BEF\u5BF9\u8C61" };
      }
    }
    window.addEventListener("unhandledrejection", (event) => {
      const context = currentCreateDiagnosticContext();
      if (!context) return;
      postPageDiagnostic(context.diagnosticSessionId, "page-unhandled-rejection", {
        ...summarizePageError(event?.reason),
        afterCredentialReturnMs: Date.now() - context.startedAtMs
      });
    }, true);
    window.addEventListener("error", (event) => {
      const context = currentCreateDiagnosticContext();
      if (!context) return;
      postPageDiagnostic(context.diagnosticSessionId, "page-error", {
        ...summarizePageError(event?.error || event?.message),
        afterCredentialReturnMs: Date.now() - context.startedAtMs
      });
    }, true);
    const patchedCreate = async function patchedCreate2(options) {
      if (!options?.publicKey) {
        return originalCreate(options);
      }
      const createDecision = explainCreateManageability2(options.publicKey);
      logInjected("create-intercepted", {
        manageable: createDecision.manageable,
        reason: createDecision.reason,
        rpId: String(options?.publicKey?.rp?.id || window.location.hostname || ""),
        userName: String(options?.publicKey?.user?.name || ""),
        attachment: String(options?.publicKey?.authenticatorSelection?.authenticatorAttachment || "")
      });
      if (!createDecision.manageable) {
        await notifyFallbackBeforeBrowser("create", createDecision.reason);
        return originalCreate(options);
      }
      const serialized = serializeCreateOptions(options.publicKey);
      if (!serialized) {
        logInjected("create-serialize-empty", {
          rpId: String(options?.publicKey?.rp?.id || window.location.hostname || "")
        });
        return originalCreate(options);
      }
      try {
        logInjected("create-bridge-start", {
          rpId: String(serialized?.rp?.id || ""),
          userName: String(serialized?.user?.name || "")
        });
        const response = await callBridge("create", serialized);
        logInjected("create-bridge-success", {
          createMode: String(response?.createMode || ""),
          createCompatMethod: String(response?.createCompatMethod || ""),
          credentialId: String(response?.credential?.id || "")
        });
        activateCreateErrorMonitor(response?.diagnosticSessionId);
        return buildCreateCredential(response?.credential, response?.diagnosticSessionId);
      } catch (error) {
        logInjected("create-bridge-error", {
          name: error?.name || "Error",
          code: error?.code || "",
          message: error?.message || String(error || ""),
          willFallback: shouldFallbackToBrowser2(error)
        });
        if (shouldFallbackToBrowser2(error)) {
          await notifyFallbackBeforeBrowser("create", error?.code || error?.name || "fallback");
          return originalCreate(options);
        }
        throw toDomLikeError(error, "NotAllowedError");
      }
    };
    const patchedGet = async function patchedGet2(options) {
      if (!options?.publicKey) {
        return originalGet(options);
      }
      const getDecision = explainGetManageability2(options.publicKey);
      logInjected("get-intercepted", {
        manageable: getDecision.manageable,
        reason: getDecision.reason,
        rpId: String(options?.publicKey?.rpId || window.location.hostname || ""),
        allowCredentialsCount: Array.isArray(options?.publicKey?.allowCredentials) ? options.publicKey.allowCredentials.length : 0
      });
      if (!getDecision.manageable) {
        await notifyFallbackBeforeBrowser("get", getDecision.reason);
        return originalGet(options);
      }
      const serialized = serializeGetOptions(options.publicKey);
      if (!serialized) {
        logInjected("get-serialize-empty", {
          rpId: String(options?.publicKey?.rpId || window.location.hostname || "")
        });
        return originalGet(options);
      }
      try {
        logInjected("get-bridge-start", {
          rpId: String(serialized?.rpId || ""),
          allowCredentialsCount: Array.isArray(serialized?.allowCredentials) ? serialized.allowCredentials.length : 0
        });
        const response = await callBridge("get", serialized);
        logInjected("get-bridge-success", {
          credentialId: String(response?.credential?.id || "")
        });
        return buildAssertionCredential(response?.credential);
      } catch (error) {
        logInjected("get-bridge-error", {
          name: error?.name || "Error",
          code: error?.code || "",
          message: error?.message || String(error || ""),
          willFallback: shouldFallbackToBrowser2(error)
        });
        if (shouldFallbackToBrowser2(error)) {
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
          throw { name: "SecurityError", message: "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u5B89\u5168\u968F\u673A\u6570" };
        }
      })();
      const request = {
        source: BRIDGE_SOURCE,
        type: REQUEST_TYPE,
        requestId,
        operation,
        publicKey,
        sourceContext: frameContext
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
              operation
            });
            resolve({ ...data.result || {}, diagnosticSessionId: requestId });
            return;
          }
          logInjected("bridge-response-error", {
            requestId,
            operation,
            name: data?.error?.name || "Error",
            code: data?.error?.code || "",
            message: data?.error?.message || ""
          });
          reject(data.error || { name: "OperationError", message: "\u901A\u884C\u5BC6\u94A5\u64CD\u4F5C\u5931\u8D25" });
        };
        window.addEventListener("message", onMessage);
        timeoutId = setTimeout(() => {
          cleanup();
          logInjected("bridge-timeout", {
            requestId,
            operation
          });
          reject({ name: "TimeoutError", message: "\u901A\u884C\u5BC6\u94A5\u8BF7\u6C42\u8D85\u65F6" });
        }, REQUEST_TIMEOUT_MS);
        logInjected("bridge-posted", {
          requestId,
          operation
        });
        window.postMessage(request, frameContext.origin || "*");
      });
    }
    function serializeCreateOptions(publicKey) {
      const challenge = toBase64url(publicKey?.challenge);
      const userId = toBase64url(publicKey?.user?.id);
      if (!challenge || !userId) return null;
      const frameContext = resolveWebAuthnWindowContext(window);
      if (!frameContext.origin || frameContext.crossOrigin && !frameContext.topOrigin) return null;
      return {
        challengeB64u: challenge,
        rp: {
          id: String(publicKey?.rp?.id || frameContext.host || ""),
          name: String(publicKey?.rp?.name || publicKey?.rp?.id || frameContext.host || "")
        },
        user: {
          idB64u: userId,
          name: String(publicKey?.user?.name || ""),
          displayName: String(publicKey?.user?.displayName || publicKey?.user?.name || "")
        },
        pubKeyCredParams: Array.isArray(publicKey?.pubKeyCredParams) ? publicKey.pubKeyCredParams.map((item) => ({
          type: String(item?.type || "public-key"),
          alg: Number(item?.alg)
        })) : [],
        timeout: Number(publicKey?.timeout || 0) || null,
        attestation: publicKey?.attestation || null,
        authenticatorSelection: publicKey?.authenticatorSelection || null,
        excludeCredentials: serializeCredentialList(publicKey?.excludeCredentials || []),
        extensions: publicKey?.extensions || null,
        crossOrigin: frameContext.crossOrigin,
        topOrigin: frameContext.topOrigin
      };
    }
    function serializeGetOptions(publicKey) {
      const challenge = toBase64url(publicKey?.challenge);
      if (!challenge) return null;
      const frameContext = resolveWebAuthnWindowContext(window);
      if (!frameContext.origin || frameContext.crossOrigin && !frameContext.topOrigin) return null;
      return {
        challengeB64u: challenge,
        rpId: String(publicKey?.rpId || frameContext.host || ""),
        timeout: Number(publicKey?.timeout || 0) || null,
        userVerification: publicKey?.userVerification || null,
        allowCredentials: serializeCredentialList(publicKey?.allowCredentials || []),
        extensions: publicKey?.extensions || null,
        crossOrigin: frameContext.crossOrigin,
        topOrigin: frameContext.topOrigin
      };
    }
    function serializeCredentialList(list) {
      if (!Array.isArray(list)) return [];
      return list.map((item) => ({
        idB64u: toBase64url(item?.id),
        type: String(item?.type || "public-key"),
        transports: Array.isArray(item?.transports) ? item.transports.map(String) : []
      })).filter((item) => item.idB64u);
    }
    function buildCreateCredential(credential, diagnosticSessionId) {
      if (!credential) {
        throw new Error("\u521B\u5EFA\u901A\u884C\u5BC6\u94A5\u8FD4\u56DE\u4E3A\u7A7A");
      }
      const rawId = fromBase64url(credential.rawIdB64u || credential.id);
      const response = buildAuthenticatorAttestationResponse(credential?.response);
      if (typeof AuthenticatorAttestationResponse === "function") {
        Object.setPrototypeOf(response, AuthenticatorAttestationResponse.prototype);
      }
      const reportedApiMethods = /* @__PURE__ */ new Set();
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
            clientExtensionResults: credential.clientExtensionResults || {}
          };
        }
      };
      if (typeof PublicKeyCredential === "function") {
        Object.setPrototypeOf(result, PublicKeyCredential.prototype);
      }
      for (const method of [
        "getAuthenticatorData",
        "getPublicKey",
        "getPublicKeyAlgorithm",
        "getTransports",
        "toJSON"
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
          publicKey: base64urlToBytes(credential?.response?.publicKeyB64u).byteLength
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
          responseToJSON: typeof response.toJSON === "function"
        }
      });
      return result;
    }
    function buildAssertionCredential(credential) {
      if (!credential) {
        throw new Error("\u83B7\u53D6\u901A\u884C\u5BC6\u94A5\u65AD\u8A00\u8FD4\u56DE\u4E3A\u7A7A");
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
            clientExtensionResults: credential.clientExtensionResults || {}
          };
        }
      };
      if (typeof PublicKeyCredential === "function") {
        Object.setPrototypeOf(result, PublicKeyCredential.prototype);
      }
      return result;
    }
    function shouldFallbackToBrowser2(error) {
      return shouldFallbackToBrowser(error);
    }
    function canPassManageCreate(publicKey) {
      return explainCreateManageability2(publicKey).manageable;
    }
    function canPassManageGet(publicKey) {
      return explainGetManageability2(publicKey).manageable;
    }
    function explainCreateManageability2(publicKey) {
      const challenge = toBase64url(publicKey?.challenge);
      const userId = toBase64url(publicKey?.user?.id);
      return explainCreateManageability({
        hasChallenge: Boolean(challenge),
        hasUserId: Boolean(userId),
        authenticatorAttachment: publicKey?.authenticatorSelection?.authenticatorAttachment,
        attestation: publicKey?.attestation,
        googleLegacyAppidSupport: publicKey?.extensions?.googleLegacyAppidSupport === true
      });
    }
    function explainGetManageability2(publicKey) {
      const challenge = toBase64url(publicKey?.challenge);
      return explainGetManageability({ hasChallenge: Boolean(challenge) });
    }
    function postFallbackNotice(operation, reason) {
      const message = buildFallbackNoticeMessage(operation, reason);
      if (!message) return;
      const noticeKey = `${String(operation || "")}|${String(reason || "")}|${message}`;
      const now = Date.now();
      const isDuplicate = noticeKey === lastFallbackNoticeKey && now - lastFallbackNoticeAt < FALLBACK_NOTICE_DEDUPE_MS;
      lastFallbackNoticeKey = noticeKey;
      lastFallbackNoticeAt = now;
      logInjected("fallback-notice-posted", {
        operation,
        reason,
        message,
        deduped: isDuplicate
      });
      const noticePayload = {
        source: BRIDGE_SOURCE,
        type: NOTICE_TYPE,
        operation,
        reason,
        message,
        deduped: isDuplicate,
        postedAtMs: now
      };
      if (!isDuplicate) {
        try {
          const attr = "data-pass-webauthn-notice";
          const maxAgeMs = 5e3;
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
          const alreadyQueued = queue.some((item) => String(item?.operation || "") === String(operation || "") && String(item?.reason || "") === String(reason || "") && String(item?.message || "") === message);
          if (!alreadyQueued) {
            queue.push(noticePayload);
            if (queue.length > maxItems) queue = queue.slice(-maxItems);
            document.documentElement?.setAttribute(attr, JSON.stringify(queue));
          }
        } catch {
        }
      }
      window.postMessage(noticePayload, window.location.origin);
    }
    async function notifyFallbackBeforeBrowser(operation, reason) {
      postFallbackNotice(operation, reason);
      await sleep(FALLBACK_NOTICE_DELAY_MS);
    }
    function buildFallbackNoticeMessage(operation, reason) {
      const opLabel = operation === "get" ? "\u8BFB\u53D6\u901A\u884C\u5BC6\u94A5" : "\u4FDD\u5B58\u901A\u884C\u5BC6\u94A5";
      switch (String(reason || "")) {
        case "cross-platform-requested":
          return `Pass \u672A\u63A5\u7BA1${opLabel}\uFF0C\u672C\u6B21\u6539\u7531\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406\uFF1A\u7F51\u7AD9\u8BF7\u6C42\u5916\u7F6E\u5B89\u5168\u5BC6\u94A5`;
        case "google-legacy-appid-request":
          return `Pass \u672A\u63A5\u7BA1${opLabel}\uFF0C\u672C\u6B21\u6539\u7531\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406\uFF1AGoogle \u8BF7\u6C42\u65E7\u5F0F\u5916\u7F6E\u5B89\u5168\u5BC6\u94A5`;
        case "attestation-required-by-rp":
          return `Pass \u672A\u63A5\u7BA1${opLabel}\uFF0C\u672C\u6B21\u6539\u7531\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406\uFF1A\u7F51\u7AD9\u8981\u6C42\u53EF\u9A8C\u8BC1\u8BA4\u8BC1\u5668\u8BC1\u660E`;
        case "missing-challenge-or-user-id":
        case "missing-challenge":
          return `Pass \u672A\u63A5\u7BA1${opLabel}\uFF0C\u672C\u6B21\u6539\u7531\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406\uFF1A\u7F51\u7AD9\u8BF7\u6C42\u53C2\u6570\u4E0D\u5B8C\u6574`;
        case "PASSKEY_USE_BROWSER":
          return `Pass \u5DF2\u5207\u6362\u4E3A\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406${opLabel}`;
        case "PASSKEY_CONTEXT_INVALIDATED":
          return `Pass \u5DF2\u5207\u6362\u4E3A\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406${opLabel}\uFF1A\u6269\u5C55\u4E0A\u4E0B\u6587\u5931\u6548`;
        case "PASSKEY_RUNTIME_ERROR":
          return `Pass \u5DF2\u5207\u6362\u4E3A\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406${opLabel}\uFF1A\u6269\u5C55\u901A\u4FE1\u5931\u8D25`;
        case "PASSKEY_EMPTY_RESPONSE":
          return `Pass \u5DF2\u5207\u6362\u4E3A\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406${opLabel}\uFF1A\u6269\u5C55\u672A\u8FD4\u56DE\u7ED3\u679C`;
        case "PASSKEY_ALG_UNSUPPORTED":
          return `Pass \u5DF2\u5207\u6362\u4E3A\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406${opLabel}\uFF1A\u7F51\u7AD9\u8981\u6C42\u7684\u7B97\u6CD5\u5F53\u524D\u672A\u6258\u7BA1`;
        case "PASSKEY_OP_UNSUPPORTED":
          return `Pass \u5DF2\u5207\u6362\u4E3A\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406${opLabel}\uFF1A\u64CD\u4F5C\u7C7B\u578B\u5F53\u524D\u672A\u6258\u7BA1`;
        case "TimeoutError":
          return `Pass \u5DF2\u5207\u6362\u4E3A\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406${opLabel}\uFF1APass \u54CD\u5E94\u8D85\u65F6`;
        case "NotSupportedError":
          return `Pass \u5DF2\u5207\u6362\u4E3A\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406${opLabel}\uFF1A\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u6258\u7BA1`;
        default:
          return `Pass \u5DF2\u5207\u6362\u4E3A\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406${opLabel}`;
      }
    }
    function sleep(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, Number(ms) || 0));
      });
    }
    function toDomLikeError(error, fallbackName) {
      const err = new Error(error?.message || "\u901A\u884C\u5BC6\u94A5\u64CD\u4F5C\u5931\u8D25");
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
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
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
      }
      try {
        Object.defineProperty(target, key, {
          configurable: true,
          writable: true,
          value: fn
        });
        return true;
      } catch {
      }
      try {
        const proto = Object.getPrototypeOf(target);
        Object.defineProperty(proto, key, {
          configurable: true,
          writable: true,
          value: fn
        });
        return true;
      } catch {
        return false;
      }
    }
  })();
})();
