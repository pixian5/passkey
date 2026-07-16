export const LOCK_CREDENTIAL_VERSION = 2;
export const LOCK_PBKDF2_ITERATIONS = 310000;

export function bytesToBase64(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

export function base64ToBytes(base64) {
  try {
    const binary = atob(String(base64 || ""));
    const output = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) output[i] = binary.charCodeAt(i);
    return output;
  } catch {
    return new Uint8Array();
  }
}

export function normalizeLockMasterCredential(value) {
  if (!value || typeof value !== "object") return null;
  const version = Number(value.version || 1);
  const saltBase64 = String(value.saltBase64 || "");
  const digestBase64 = String(value.digestBase64 || "");
  if (![1, LOCK_CREDENTIAL_VERSION].includes(version) || !saltBase64 || !digestBase64) return null;
  const saltBytes = base64ToBytes(saltBase64);
  if (saltBytes.length < 16) return null;
  const iterations = version === LOCK_CREDENTIAL_VERSION
    ? Number(value.iterations || LOCK_PBKDF2_ITERATIONS)
    : 1;
  if (!Number.isInteger(iterations) || iterations < 1) return null;
  return { version, saltBase64, digestBase64, iterations };
}

async function legacyDigest(password, saltBytes) {
  const passwordBytes = new TextEncoder().encode(String(password || ""));
  const merged = new Uint8Array(saltBytes.length + passwordBytes.length);
  merged.set(saltBytes, 0);
  merged.set(passwordBytes, saltBytes.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", merged));
}

async function pbkdf2Digest(password, saltBytes, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

export async function createLockMasterCredential(password) {
  const normalizedPassword = String(password || "").trim();
  if (!normalizedPassword) return null;
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const digest = await pbkdf2Digest(normalizedPassword, saltBytes, LOCK_PBKDF2_ITERATIONS);
  return {
    version: LOCK_CREDENTIAL_VERSION,
    saltBase64: bytesToBase64(saltBytes),
    digestBase64: bytesToBase64(digest),
    iterations: LOCK_PBKDF2_ITERATIONS,
  };
}

export async function verifyLockMasterPassword(credential, password) {
  const normalized = normalizeLockMasterCredential(credential);
  if (!normalized) return false;
  const saltBytes = base64ToBytes(normalized.saltBase64);
  const digest = normalized.version === 1
    ? await legacyDigest(String(password || "").trim(), saltBytes)
    : await pbkdf2Digest(String(password || "").trim(), saltBytes, normalized.iterations);
  return timingSafeEqual(digest, base64ToBytes(normalized.digestBase64));
}

function timingSafeEqual(lhs, rhs) {
  if (lhs.length !== rhs.length) return false;
  let difference = 0;
  for (let i = 0; i < lhs.length; i += 1) difference |= lhs[i] ^ rhs[i];
  return difference === 0;
}
