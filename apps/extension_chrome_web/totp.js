/**
 * TOTP (RFC 6238, SHA1, 6 digits, 30s) 与 OTPAuth URI / Google Authenticator 迁移解析核心
 */

export function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = String(input || "")
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of cleaned) {
    const val = alphabet.indexOf(c);
    if (val < 0) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

export function base32Encode(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let buffer = 0, bits = 0, out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits ? out + alphabet[(buffer << (5 - bits)) & 31] : out;
}

export async function hotp(keyBytes, counter) {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  // big-endian counter
  const high = Math.floor(counter / 2 ** 32);
  const low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is not available in current environment");
  }
  const cryptoKey = await subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await subtle.sign("HMAC", cryptoKey, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(bin % 10 ** 6).padStart(6, "0");
}

export async function totpCode(secret, nowMs = Date.now(), step = 30) {
  const key = base32Decode(secret);
  if (!key.length) return null;
  const counter = Math.floor(nowMs / 1000 / step);
  const code = await hotp(key, counter);
  const remain = step - (Math.floor(nowMs / 1000) % step);
  return { code, remain };
}

export function formatOtpDisplay(code) {
  if (!code || code.length !== 6) return code || "------";
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export const normalizedTotpSecret = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/=+$/g, "");

export const isValidTotpSecret = (value) => {
  const secret = normalizedTotpSecret(value);
  return secret.length >= 8 && /^[A-Z2-7]+$/.test(secret) && base32Decode(secret).length > 0;
};

export const normalizeImportedSite = (value) => {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return "";
  const withoutScheme = raw.replace(/^https?:\/\//, "").split(/[/?#]/)[0].split(":")[0];
  if (!withoutScheme) return "";
  return withoutScheme.includes(".") ? withoutScheme : `${withoutScheme}.com`;
};

export const parseOtpAuthUri = (value) => {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return null;
  }
  if (url.protocol.toLowerCase() !== "otpauth:" || url.hostname.toLowerCase() !== "totp") return null;
  const secret = normalizedTotpSecret(url.searchParams.get("secret"));
  if (!isValidTotpSecret(secret)) return null;
  const label = decodeURIComponent(url.pathname || "")
    .replace(/^\/+/, "")
    .trim();
  const colon = label.indexOf(":");
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : "";
  const username = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const issuer = (url.searchParams.get("issuer") || labelIssuer).trim();
  const site = normalizeImportedSite(issuer) || normalizeImportedSite(username.split("@").pop());
  return { secret, username, site };
};

export const readProtoVarint = (bytes, start) => {
  let value = 0, shift = 0, index = start;
  while (index < bytes.length && shift < 35) {
    const byte = bytes[index++];
    value |= (byte & 127) << shift;
    if (!(byte & 128)) return [value, index];
    shift += 7;
  }
  throw new Error("二维码数据损坏");
};

export const googleMigrationEntries = (raw) => {
  const url = new URL(raw);
  if (url.protocol !== "otpauth-migration:") return [];
  const source = Uint8Array.from(atob(url.searchParams.get("data") || ""), (c) => c.charCodeAt(0));
  const decoder = new TextDecoder();
  const readFields = (bytes) => {
    const fields = []; let index = 0;
    while (index < bytes.length) {
      const [tag, afterTag] = readProtoVarint(bytes, index); index = afterTag;
      const wire = tag & 7, field = tag >>> 3;
      if (wire === 2) { const [length, afterLength] = readProtoVarint(bytes, index); fields.push([field, bytes.slice(afterLength, afterLength + length)]); index = afterLength + length; }
      else if (wire === 0) { const [value, afterValue] = readProtoVarint(bytes, index); fields.push([field, value]); index = afterValue; }
      else throw new Error("不支持的二维码字段");
    }
    return fields;
  };
  return readFields(source).filter(([field]) => field === 1).flatMap(([, value]) => {
    const fields = readFields(value); const find = (id) => fields.find(([field]) => field === id)?.[1];
    const secretBytes = find(1), name = find(2), issuer = find(3), type = find(6);
    if (!(secretBytes instanceof Uint8Array) || (type != null && type !== 2)) return [];
    const username = name instanceof Uint8Array ? decoder.decode(name) : "";
    const issuerText = issuer instanceof Uint8Array ? decoder.decode(issuer) : "";
    const site = normalizeImportedSite(issuerText) || normalizeImportedSite(username.split("@").pop());
    return site ? [{ site, username, secret: base32Encode(secretBytes) }] : [];
  });
};
