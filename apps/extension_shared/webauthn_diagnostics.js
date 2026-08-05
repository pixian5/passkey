const MAX_DIAGNOSTIC_EVENTS = 12;

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

function summarizeCreateOptions(publicKey) {
  return {
    rpId: safeString(publicKey?.rp?.id),
    attestation: safeString(publicKey?.attestation) || null,
    authenticatorSelection: summarizeAuthenticatorSelection(publicKey?.authenticatorSelection),
    pubKeyCredParams: Array.isArray(publicKey?.pubKeyCredParams)
      ? publicKey.pubKeyCredParams.map((item) => ({ type: safeString(item?.type), alg: Number(item?.alg) }))
      : [],
    excludeCredentialsCount: Array.isArray(publicKey?.excludeCredentials) ? publicKey.excludeCredentials.length : 0,
    extensionNames: extensionNames(publicKey?.extensions),
  };
}

export function buildPasskeyBridgeDiagnostic({ payload, response, extensionVersion, phase }) {
  const publicKey = payload?.publicKey || {};
  const operation = safeString(payload?.operation);
  const result = response?.result || {};
  return {
    atMs: Date.now(),
    extensionVersion: safeString(extensionVersion),
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
          userVerification: safeString(publicKey?.userVerification) || null,
          allowCredentialsCount: Array.isArray(publicKey?.allowCredentials) ? publicKey.allowCredentials.length : 0,
          extensionNames: extensionNames(publicKey?.extensions),
        },
    response: {
      ok: Boolean(response?.ok),
      errorName: safeString(response?.error?.name),
      errorCode: safeString(response?.error?.code),
      createMode: safeString(result?.createMode),
      createCompatMethod: safeString(result?.createCompatMethod),
      attestationFormat: safeString(result?.credential?.attestationFormat),
      authenticatorData: getAuthenticatorDataSummary(result?.credential),
      publicKeyAlgorithm: Number(result?.credential?.response?.publicKeyAlgorithm) || null,
      transports: Array.isArray(result?.credential?.response?.transports)
        ? result.credential.response.transports.map(safeString)
        : [],
      clientExtensionResultNames: extensionNames(result?.credential?.clientExtensionResults),
    },
  };
}

export async function appendPasskeyDiagnostic(storage, diagnostic) {
  if (!storage?.get || !storage?.set) return;
  const stored = await storage.get([STORAGE_KEY_PASSKEY_DIAGNOSTICS]);
  const entries = Array.isArray(stored?.[STORAGE_KEY_PASSKEY_DIAGNOSTICS])
    ? stored[STORAGE_KEY_PASSKEY_DIAGNOSTICS]
    : [];
  await storage.set({ [STORAGE_KEY_PASSKEY_DIAGNOSTICS]: [...entries, diagnostic].slice(-MAX_DIAGNOSTIC_EVENTS) });
}

export function getLatestCreateDiagnostic(entries) {
  if (!Array.isArray(entries)) return null;
  return [...entries].reverse().find((item) => item?.operation === "create") || null;
}
