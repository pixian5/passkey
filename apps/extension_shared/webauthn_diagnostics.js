const MAX_DIAGNOSTIC_EVENTS = 40;
let diagnosticWriteChain = Promise.resolve();

export const STORAGE_KEY_PASSKEY_DIAGNOSTICS = "pass.webauthn.diagnostics.v1";

function safeString(value) {
  return String(value || "").trim();
}

function toBase64urlBytes(value) {
  const normalized = safeString(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (!normalized) return new Uint8Array();
  try {
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function byteLengthOfBase64url(value) {
  return toBase64urlBytes(value).length;
}

function safeDiagnosticSessionId(value) {
  const normalized = safeString(value);
  return /^req_[a-zA-Z0-9-]{8,80}$/.test(normalized) ? normalized : "";
}

function safeErrorText(value) {
  return safeString(value)
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .slice(0, 300);
}

function parseClientDataSummary(credential) {
  const bytes = toBase64urlBytes(credential?.response?.clientDataJSONB64u);
  const summary = { byteLength: bytes.length, validJson: false };
  if (bytes.length === 0) return summary;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    summary.validJson = true;
    summary.type = safeString(parsed?.type);
    summary.origin = safeString(parsed?.origin);
    summary.crossOrigin = Boolean(parsed?.crossOrigin);
    summary.topOrigin = safeString(parsed?.topOrigin) || null;
    summary.challengeByteLength = byteLengthOfBase64url(parsed?.challenge);
  } catch {
    // The parse result is enough; never retain the original clientDataJSON.
  }
  return summary;
}

function getAuthenticatorDataSummary(credential) {
  const bytes = toBase64urlBytes(credential?.response?.authenticatorDataB64u);
  if (bytes.length < 37) return { byteLength: bytes.length };
  const flags = bytes[32];
  const summary = {
    byteLength: bytes.length,
    flags: `0x${flags.toString(16).padStart(2, "0")}`,
    userPresent: Boolean(flags & 0x01),
    userVerified: Boolean(flags & 0x04),
    backupEligible: Boolean(flags & 0x08),
    backupState: Boolean(flags & 0x10),
    attestedCredentialData: Boolean(flags & 0x40),
    extensionDataIncluded: Boolean(flags & 0x80),
    signCount: ((bytes[33] << 24) | (bytes[34] << 16) | (bytes[35] << 8) | bytes[36]) >>> 0,
  };
  if (flags & 0x40 && bytes.length >= 55) {
    summary.aaguid = bytesToHex(bytes.slice(37, 53));
    summary.credentialIdLength = (bytes[53] << 8) | bytes[54];
  }
  return summary;
}

function summarizeAuthenticatorSelection(selection) {
  if (!selection || typeof selection !== "object") return null;
  const summary = {};
  for (const key of ["authenticatorAttachment", "residentKey", "requireResidentKey", "userVerification"]) {
    if (Object.prototype.hasOwnProperty.call(selection, key)) summary[key] = selection[key];
  }
  return summary;
}

function extensionNames(extensions) {
  return extensions && typeof extensions === "object" ? Object.keys(extensions).sort() : [];
}

function summarizeRequestedExtensions(extensions) {
  const names = extensionNames(extensions);
  return {
    names,
    credPropsRequested: extensions?.credProps === true,
    appidExcludeRequested: Object.prototype.hasOwnProperty.call(extensions || {}, "appidExclude"),
    googleLegacyAppidSupport: Object.prototype.hasOwnProperty.call(extensions || {}, "googleLegacyAppidSupport")
      ? Boolean(extensions.googleLegacyAppidSupport)
      : null,
  };
}

function summarizeCredentialDescriptors(descriptors) {
  const list = Array.isArray(descriptors) ? descriptors : [];
  const transports = {};
  for (const descriptor of list) {
    for (const transport of Array.isArray(descriptor?.transports) ? descriptor.transports : []) {
      const name = safeString(transport) || "unknown";
      transports[name] = (transports[name] || 0) + 1;
    }
  }
  return { count: list.length, transports };
}

function summarizeCreateOptions(publicKey) {
  return {
    rpId: safeString(publicKey?.rp?.id),
    rpNamePresent: Boolean(safeString(publicKey?.rp?.name)),
    challengeByteLength: byteLengthOfBase64url(publicKey?.challengeB64u),
    userIdByteLength: byteLengthOfBase64url(publicKey?.user?.idB64u),
    userNamePresent: Boolean(safeString(publicKey?.user?.name)),
    displayNamePresent: Boolean(safeString(publicKey?.user?.displayName)),
    timeoutMs: Number(publicKey?.timeout) || null,
    attestation: safeString(publicKey?.attestation) || null,
    authenticatorSelection: summarizeAuthenticatorSelection(publicKey?.authenticatorSelection),
    pubKeyCredParams: Array.isArray(publicKey?.pubKeyCredParams)
      ? publicKey.pubKeyCredParams.map((item) => ({ type: safeString(item?.type), alg: Number(item?.alg) }))
      : [],
    excludeCredentials: summarizeCredentialDescriptors(publicKey?.excludeCredentials),
    extensions: summarizeRequestedExtensions(publicKey?.extensions),
  };
}

function originMatchesRpId(origin, rpId) {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    const normalizedRpId = safeString(rpId).toLowerCase();
    return Boolean(normalizedRpId) && (host === normalizedRpId || host.endsWith(`.${normalizedRpId}`));
  } catch {
    return false;
  }
}

function buildCreateSelfChecks({ payload, result, credential, clientData, authenticatorData }) {
  const request = payload?.publicKey || {};
  const rawIdByteLength = byteLengthOfBase64url(credential?.rawIdB64u || credential?.id);
  const algorithms = Array.isArray(request?.pubKeyCredParams)
    ? request.pubKeyCredParams.map((item) => Number(item?.alg)).filter(Number.isFinite)
    : [];
  const clientExtensionResultNames = extensionNames(credential?.clientExtensionResults);
  const recognizedOutputs = new Set(["appid", "credProps", "hmacCreateSecret", "largeBlob", "prf"]);
  return {
    clientDataTypeIsCreate: clientData.type === "webauthn.create",
    clientDataOriginMatchesRequest: Boolean(clientData.origin) && clientData.origin === safeString(payload?.origin),
    rpIdMatchesOrigin: originMatchesRpId(safeString(payload?.origin), request?.rp?.id),
    authenticatorDataLongEnough: authenticatorData.byteLength >= 55,
    attestedCredentialDataPresent: authenticatorData.attestedCredentialData === true,
    credentialIdLengthMatchesRawId: Number(authenticatorData.credentialIdLength) === rawIdByteLength,
    selectedAlgorithmWasOffered: algorithms.includes(Number(credential?.response?.publicKeyAlgorithm)),
    responseHasClientData: byteLengthOfBase64url(credential?.response?.clientDataJSONB64u) > 0,
    responseHasAttestationObject: byteLengthOfBase64url(credential?.response?.attestationObjectB64u) > 0,
    responseHasAuthenticatorData: byteLengthOfBase64url(credential?.response?.authenticatorDataB64u) > 0,
    responseHasPublicKey: byteLengthOfBase64url(credential?.response?.publicKeyB64u) > 0,
    createModePresent: Boolean(safeString(result?.createMode)),
    nonStandardClientExtensionResultNames: clientExtensionResultNames.filter((name) => !recognizedOutputs.has(name)),
  };
}

export function buildPasskeyBridgeDiagnostic({ payload, response, extensionVersion, phase }) {
  const publicKey = payload?.publicKey || {};
  const operation = safeString(payload?.operation);
  const result = response?.result || {};
  const credential = result?.credential || {};
  const clientData = parseClientDataSummary(credential);
  const authenticatorData = getAuthenticatorDataSummary(credential);
  return {
    atMs: Date.now(),
    extensionVersion: safeString(extensionVersion),
    diagnosticSessionId: safeDiagnosticSessionId(payload?.diagnosticSessionId),
    phase: safeString(phase),
    operation,
    origin: safeString(payload?.origin),
    host: safeString(payload?.host),
    sourceContext: {
      origin: safeString(payload?.sourceContext?.origin),
      host: safeString(payload?.sourceContext?.host),
      crossOrigin: Boolean(payload?.sourceContext?.crossOrigin),
      topOrigin: safeString(payload?.sourceContext?.topOrigin),
    },
    request: operation === "create"
      ? summarizeCreateOptions(publicKey)
      : {
          rpId: safeString(publicKey?.rpId),
          challengeByteLength: byteLengthOfBase64url(publicKey?.challengeB64u),
          timeoutMs: Number(publicKey?.timeout) || null,
          userVerification: safeString(publicKey?.userVerification) || null,
          allowCredentials: summarizeCredentialDescriptors(publicKey?.allowCredentials),
          extensions: summarizeRequestedExtensions(publicKey?.extensions),
        },
    response: {
      ok: Boolean(response?.ok),
      errorName: safeString(response?.error?.name),
      errorCode: safeString(response?.error?.code),
      errorMessage: safeErrorText(response?.error?.message),
      createMode: safeString(result?.createMode),
      createCompatMethod: safeString(result?.createCompatMethod),
      credentialType: safeString(credential?.type),
      authenticatorAttachment: safeString(credential?.authenticatorAttachment),
      rawIdByteLength: byteLengthOfBase64url(credential?.rawIdB64u || credential?.id),
      attestationFormat: safeString(credential?.attestationFormat),
      clientData,
      authenticatorData,
      byteLengths: {
        attestationObject: byteLengthOfBase64url(credential?.response?.attestationObjectB64u),
        publicKey: byteLengthOfBase64url(credential?.response?.publicKeyB64u),
      },
      publicKeyAlgorithm: Number(credential?.response?.publicKeyAlgorithm) || null,
      transports: Array.isArray(credential?.response?.transports)
        ? credential.response.transports.map(safeString)
        : [],
      clientExtensionResults: {
        names: extensionNames(credential?.clientExtensionResults),
        credPropsRk: credential?.clientExtensionResults?.credProps?.rk === true,
      },
    },
    selfChecks: operation === "create"
      ? buildCreateSelfChecks({ payload, result, credential, clientData, authenticatorData })
      : null,
  };
}

export function buildPasskeyPageDiagnostic({ payload, extensionVersion }) {
  const details = payload?.details && typeof payload.details === "object" ? payload.details : {};
  const phase = safeString(payload?.phase);
  const diagnostic = {
    atMs: Date.now(),
    extensionVersion: safeString(extensionVersion),
    diagnosticSessionId: safeDiagnosticSessionId(payload?.diagnosticSessionId),
    phase,
    operation: safeString(payload?.operation),
    origin: safeString(payload?.origin),
    host: safeString(payload?.host),
  };
  if (phase === "page-credential-returned") {
    diagnostic.pageCredential = {
      credentialConstructor: safeString(details.credentialConstructor),
      responseConstructor: safeString(details.responseConstructor),
      credentialType: safeString(details.credentialType),
      authenticatorAttachment: safeString(details.authenticatorAttachment),
      rawIdByteLength: Number(details.rawIdByteLength) || 0,
      responseByteLengths: {
        clientDataJSON: Number(details?.responseByteLengths?.clientDataJSON) || 0,
        attestationObject: Number(details?.responseByteLengths?.attestationObject) || 0,
        authenticatorData: Number(details?.responseByteLengths?.authenticatorData) || 0,
        publicKey: Number(details?.responseByteLengths?.publicKey) || 0,
      },
      responseOwnKeys: Array.isArray(details.responseOwnKeys) ? details.responseOwnKeys.map(safeString).sort() : [],
      responseJsonKeys: Array.isArray(details.responseJsonKeys) ? details.responseJsonKeys.map(safeString).sort() : [],
      clientExtensionResultNames: Array.isArray(details.clientExtensionResultNames)
        ? details.clientExtensionResultNames.map(safeString).sort()
        : [],
      api: {
        credentialToJSON: details?.api?.credentialToJSON === true,
        getClientExtensionResults: details?.api?.getClientExtensionResults === true,
        getAuthenticatorData: details?.api?.getAuthenticatorData === true,
        getPublicKey: details?.api?.getPublicKey === true,
        getPublicKeyAlgorithm: details?.api?.getPublicKeyAlgorithm === true,
        getTransports: details?.api?.getTransports === true,
        responseToJSON: details?.api?.responseToJSON === true,
      },
    };
  } else if (phase === "page-api-called") {
    diagnostic.pageApi = {
      method: safeString(details.method),
      resultNames: Array.isArray(details.resultNames) ? details.resultNames.map(safeString).sort() : [],
    };
  } else if (phase === "page-unhandled-rejection" || phase === "page-error") {
    diagnostic.pageError = {
      constructor: safeString(details.constructor),
      name: safeString(details.name),
      code: safeString(details.code).slice(0, 80),
      message: safeErrorText(details.message),
      afterCredentialReturnMs: Math.max(0, Number(details.afterCredentialReturnMs) || 0),
    };
  }
  return diagnostic;
}

export function appendPasskeyDiagnostic(storage, diagnostic) {
  if (!storage?.get || !storage?.set) return;
  const write = async () => {
    const stored = await storage.get([STORAGE_KEY_PASSKEY_DIAGNOSTICS]);
    const entries = Array.isArray(stored?.[STORAGE_KEY_PASSKEY_DIAGNOSTICS])
      ? stored[STORAGE_KEY_PASSKEY_DIAGNOSTICS]
      : [];
    await storage.set({ [STORAGE_KEY_PASSKEY_DIAGNOSTICS]: [...entries, diagnostic].slice(-MAX_DIAGNOSTIC_EVENTS) });
  };
  diagnosticWriteChain = diagnosticWriteChain.catch(() => {}).then(write);
  return diagnosticWriteChain;
}

export function getLatestCreateDiagnostic(entries) {
  if (!Array.isArray(entries)) return null;
  return [...entries].reverse().find((item) => item?.operation === "create") || null;
}

export function getLatestCreateDiagnosticReport(entries) {
  const latest = getLatestCreateDiagnostic(entries);
  if (!latest) return null;
  const sessionId = safeDiagnosticSessionId(latest?.diagnosticSessionId);
  const events = sessionId
    ? entries.filter((item) => item?.operation === "create" && item?.diagnosticSessionId === sessionId)
    : [latest];
  const orderedEvents = [...events].sort((left, right) => Number(left?.atMs || 0) - Number(right?.atMs || 0));
  return {
    reportVersion: 2,
    extensionVersion: safeString(latest?.extensionVersion),
    operation: "create",
    diagnosticSessionId: sessionId,
    startedAtMs: Number(orderedEvents[0]?.atMs || 0),
    lastEventAtMs: Number(orderedEvents.at(-1)?.atMs || 0),
    eventCount: orderedEvents.length,
    events: orderedEvents,
  };
}
