(() => {
  // extension_version.js
  var PASS_EXTENSION_VERSION = "1.4.2";

  // webauthn_injected.js
  (() => {
    const BRIDGE_SOURCE = "pass-webauthn-bridge";
    const REQUEST_TYPE = "PASSKEY_REQUEST";
    const RESPONSE_TYPE = "PASSKEY_RESPONSE";
    const NOTICE_TYPE = "PASSKEY_NOTICE";
    const REQUEST_TIMEOUT_MS = 1e4;
    const FALLBACK_NOTICE_DELAY_MS = 1200;
    const FALLBACK_NOTICE_DEDUPE_MS = 2500;
    const PASSKEY_LOG_PREFIX = "[Pass injected]";
    let lastFallbackNoticeKey = "";
    let lastFallbackNoticeAt = 0;
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
    const patchedCreate = async function patchedCreate2(options) {
      if (!options?.publicKey) {
        return originalCreate(options);
      }
      const createDecision = explainCreateManageability(options.publicKey);
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
        return buildCreateCredential(response?.credential);
      } catch (error) {
        logInjected("create-bridge-error", {
          name: error?.name || "Error",
          code: error?.code || "",
          message: error?.message || String(error || ""),
          willFallback: shouldFallbackToBrowser(error)
        });
        if (shouldFallbackToBrowser(error)) {
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
      const getDecision = explainGetManageability(options.publicKey);
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
          willFallback: shouldFallbackToBrowser(error)
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
        publicKey
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
          if (event.origin && event.origin !== window.location.origin) return;
          const data = event.data;
          if (!data || data.source !== BRIDGE_SOURCE || data.type !== RESPONSE_TYPE) return;
          if (data.requestId !== requestId) return;
          cleanup();
          if (data.ok) {
            logInjected("bridge-response-ok", {
              requestId,
              operation
            });
            resolve(data.result || {});
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
        window.postMessage(request, window.location.origin);
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
          name: String(publicKey?.rp?.name || publicKey?.rp?.id || window.location.hostname || "")
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
        crossOrigin: window.top !== window.self
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
        crossOrigin: window.top !== window.self
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
    function buildCreateCredential(credential) {
      if (!credential) {
        throw new Error("\u521B\u5EFA\u901A\u884C\u5BC6\u94A5\u8FD4\u56DE\u4E3A\u7A7A");
      }
      const rawId = fromBase64url(credential.rawIdB64u || credential.id);
      const clientDataJSON = fromBase64url(credential?.response?.clientDataJSONB64u);
      const attestationObject = fromBase64url(credential?.response?.attestationObjectB64u);
      const transports = Array.isArray(credential?.response?.transports) ? credential.response.transports : ["internal"];
      const response = {
        clientDataJSON,
        attestationObject,
        getTransports() {
          return transports;
        }
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
              transports
            },
            clientExtensionResults: credential.clientExtensionResults || {}
          };
        }
      };
      if (typeof PublicKeyCredential === "function") {
        Object.setPrototypeOf(result, PublicKeyCredential.prototype);
      }
      return result;
    }
    function buildAssertionCredential(credential) {
      if (!credential) {
        throw new Error("\u83B7\u53D6\u901A\u884C\u5BC6\u94A5\u65AD\u8A00\u8FD4\u56DE\u4E3A\u7A7A");
      }
      const rawId = fromBase64url(credential.rawIdB64u || credential.id);
      const userHandle = credential?.response?.userHandleB64u ? fromBase64url(credential.response.userHandleB64u) : null;
      const response = {
        clientDataJSON: fromBase64url(credential?.response?.clientDataJSONB64u),
        authenticatorData: fromBase64url(credential?.response?.authenticatorDataB64u),
        signature: fromBase64url(credential?.response?.signatureB64u),
        userHandle
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
              userHandle: credential?.response?.userHandleB64u || null
            },
            clientExtensionResults: credential.clientExtensionResults || {}
          };
        }
      };
      if (typeof PublicKeyCredential === "function") {
        Object.setPrototypeOf(result, PublicKeyCredential.prototype);
      }
      return result;
    }
    function shouldFallbackToBrowser(error) {
      const code = String(error?.code || "");
      const name = String(error?.name || "");
      return code === "PASSKEY_NOT_FOUND" || code === "PASSKEY_USE_BROWSER" || code === "PASSKEY_CONTEXT_INVALIDATED" || code === "PASSKEY_RUNTIME_ERROR" || code === "PASSKEY_EMPTY_RESPONSE" || code === "PASSKEY_ALG_UNSUPPORTED" || code === "PASSKEY_OP_UNSUPPORTED" || name === "NotSupportedError" || name === "TimeoutError";
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
        const transports = Array.isArray(item?.transports) ? item.transports.map((t) => String(t || "").toLowerCase()) : [];
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
        case "allow-credentials-without-internal":
          return `Pass \u672A\u63A5\u7BA1${opLabel}\uFF0C\u672C\u6B21\u6539\u7531\u6D4F\u89C8\u5668\u539F\u751F\u5904\u7406\uFF1A\u7F51\u7AD9\u6307\u5B9A\u4E86\u975E\u672C\u673A\u901A\u884C\u5BC6\u94A5`;
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
