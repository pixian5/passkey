function normalizeBase64url(input) {
  return String(input || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64urlToArrayBuffer(input) {
  const normalized = normalizeBase64url(input);
  if (!normalized) return new ArrayBuffer(0);
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
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

export function buildAuthenticatorAttestationResponse(responseData) {
  const clientDataJSON = base64urlToArrayBuffer(responseData?.clientDataJSONB64u);
  const attestationObject = base64urlToArrayBuffer(responseData?.attestationObjectB64u);
  const authenticatorData = base64urlToArrayBuffer(responseData?.authenticatorDataB64u);
  const publicKey = responseData?.publicKeyB64u
    ? base64urlToArrayBuffer(responseData.publicKeyB64u)
    : null;
  const publicKeyAlgorithm = Number(responseData?.publicKeyAlgorithm);
  const transports = Array.isArray(responseData?.transports)
    ? responseData.transports.map(String)
    : ["internal"];

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
        publicKey: responseData?.publicKeyB64u
          ? normalizeBase64url(responseData.publicKeyB64u)
          : null,
        publicKeyAlgorithm: Number.isFinite(publicKeyAlgorithm) ? publicKeyAlgorithm : 0,
      };
    },
  };
}

export function buildAuthenticatorAssertionResponse(responseData) {
  const userHandle = responseData?.userHandleB64u
    ? base64urlToArrayBuffer(responseData.userHandleB64u)
    : null;
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
        userHandle: responseData?.userHandleB64u
          ? normalizeBase64url(responseData.userHandleB64u)
          : null,
      };
    },
  };
}
