(() => {
  const BRIDGE_SOURCE = "pass-webauthn-bridge";
  const REQUEST_TYPE = "PASSKEY_REQUEST";
  const RESPONSE_TYPE = "PASSKEY_RESPONSE";
  const REQUEST_TIMEOUT_MS = 10000;

  if (window.__passWebAuthnBridgeInstalled) {
    return;
  }
  window.__passWebAuthnBridgeInstalled = true;

  const credentials = navigator.credentials;
  if (!credentials) {
    return;
  }

  const originalCreate = credentials.create?.bind(credentials);
  const originalGet = credentials.get?.bind(credentials);

  if (typeof originalCreate !== "function" || typeof originalGet !== "function") {
    return;
  }

  const patchedCreate = async function patchedCreate(options) {
    if (!options?.publicKey) {
      return originalCreate(options);
    }
    if (!canPassManageCreate(options.publicKey)) {
      return originalCreate(options);
    }

    const serialized = serializeCreateOptions(options.publicKey);
    if (!serialized) {
      return originalCreate(options);
    }

    try {
      const response = await callBridge("create", serialized);
      return buildCreateCredential(response?.credential);
    } catch (error) {
      if (shouldFallbackToBrowser(error)) {
        return originalCreate(options);
      }
      throw toDomLikeError(error, "NotAllowedError");
    }
  };

  const patchedGet = async function patchedGet(options) {
    if (!options?.publicKey) {
      return originalGet(options);
    }
    if (!canPassManageGet(options.publicKey)) {
      return originalGet(options);
    }

    const serialized = serializeGetOptions(options.publicKey);
    if (!serialized) {
      return originalGet(options);
    }

    try {
      const response = await callBridge("get", serialized);
      return buildAssertionCredential(response?.credential);
    } catch (error) {
      if (shouldFallbackToBrowser(error)) {
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
          resolve(data.result || {});
          return;
        }
        reject(data.error || { name: "OperationError", message: "通行密钥操作失败" });
      };

      window.addEventListener("message", onMessage);
      timeoutId = setTimeout(() => {
        cleanup();
        reject({ name: "TimeoutError", message: "通行密钥请求超时" });
      }, REQUEST_TIMEOUT_MS);

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
      code === "PASSKEY_CONTEXT_INVALIDATED" ||
      code === "PASSKEY_RUNTIME_ERROR" ||
      code === "PASSKEY_EMPTY_RESPONSE" ||
      code === "PASSKEY_ALG_UNSUPPORTED" ||
      code === "PASSKEY_OP_UNSUPPORTED" ||
      name === "NotSupportedError" ||
      name === "TimeoutError";
  }

  function canPassManageCreate(publicKey) {
    const challenge = toBase64url(publicKey?.challenge);
    const userId = toBase64url(publicKey?.user?.id);
    if (!challenge || !userId) {
      return false;
    }

    const attachment = String(publicKey?.authenticatorSelection?.authenticatorAttachment || "").toLowerCase();
    if (attachment === "cross-platform") {
      return false;
    }

    return true;
  }

  function canPassManageGet(publicKey) {
    const challenge = toBase64url(publicKey?.challenge);
    if (!challenge) {
      return false;
    }

    const allow = Array.isArray(publicKey?.allowCredentials) ? publicKey.allowCredentials : [];
    if (allow.length === 0) {
      return true;
    }

    // If RP explicitly provides allowCredentials, Pass can only satisfy entries
    // that are internal-capable (or unspecified transports).
    const hasInternalCapable = allow.some((item) => {
      const transports = Array.isArray(item?.transports)
        ? item.transports.map((t) => String(t || "").toLowerCase())
        : [];
      if (transports.length === 0) {
        return true;
      }
      return transports.includes("internal");
    });
    return hasInternalCapable;
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
