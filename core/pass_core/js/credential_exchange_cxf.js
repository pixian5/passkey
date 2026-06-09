const COSE_ALG_ES256 = -7;
const COSE_ALG_RS256 = -257;

const OID_EC_PUBLIC_KEY = [1, 2, 840, 10045, 2, 1];
const OID_PRIME256V1 = [1, 2, 840, 10045, 3, 1, 7];
const OID_RSA_ENCRYPTION = [1, 2, 840, 113549, 1, 1, 1];

export function passPasskeyToCxfCredential(passkey) {
  const credentialId = normalizeString(passkey?.credentialIdB64u);
  const rpId = normalizeString(passkey?.rpId).toLowerCase();
  const userHandle = normalizeString(passkey?.userHandleB64u);
  const userName = normalizeString(passkey?.userName);
  const displayName = normalizeString(passkey?.displayName) || userName;
  const alg = Number(passkey?.alg || 0);

  if (!credentialId || !rpId || !userHandle) {
    throw new Error("passkey 缺少 credentialIdB64u/rpId/userHandleB64u");
  }
  if (Number(passkey?.signCount || 0) !== 0) {
    throw new Error("CXP 不允许导出 signCount 非 0 的通行密钥");
  }

  return {
    type: "passkey",
    credentialID: credentialId,
    relyingPartyIdentifier: rpId,
    userName,
    userDisplayName: displayName,
    userHandle,
    key: jwkToPkcs8B64u(passkey?.privateJwk, alg),
  };
}

export function cxfCredentialToPassPasskey(credential) {
  if (normalizeString(credential?.type) && normalizeString(credential?.type) !== "passkey") {
    throw new Error("不是 CXP passkey credential");
  }
  const decoded = pkcs8B64uToJwk(normalizeString(credential?.key));
  return {
    credentialIdB64u: normalizeString(credential?.credentialID),
    rpId: normalizeString(credential?.relyingPartyIdentifier).toLowerCase(),
    userName: normalizeString(credential?.userName),
    displayName: normalizeString(credential?.userDisplayName) || normalizeString(credential?.userName),
    userHandleB64u: normalizeString(credential?.userHandle),
    alg: decoded.alg,
    signCount: 0,
    privateJwk: decoded.privateJwk,
    publicJwk: decoded.publicJwk,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    lastUsedAtMs: null,
    mode: "managed",
    createCompatMethod: decoded.alg === COSE_ALG_RS256 ? "rs256" : "standard",
  };
}

export function buildCxfExportBundle({ accounts = [], passkeys = [], exporter = {} } = {}) {
  const passkeysById = new Map(
    passkeys
      .map((item) => [normalizeString(item?.credentialIdB64u), item])
      .filter(([id]) => id.length > 0)
  );

  return {
    formatVersion: "v1",
    exporterRelyingPartyIdentifier: normalizeString(exporter.relyingPartyIdentifier) || "com.pass.desktop",
    exporterDisplayName: normalizeString(exporter.displayName) || "Pass",
    timestamp: new Date().toISOString(),
    accounts: [
      {
        id: b64uUtf8("account|pass"),
        userName: normalizeString(exporter.displayName) || "Pass",
        email: "",
        collections: [],
        items: accounts
          .filter((account) => !account?.isDeleted)
          .map((account) => accountToCxfItem(account, passkeysById)),
      },
    ],
  };
}

function accountToCxfItem(account, passkeysById) {
  const credentials = [];
  if (normalizeString(account?.username) || normalizeString(account?.password)) {
    credentials.push({
      type: "basicAuthentication",
      userName: {
        fieldType: "string",
        value: normalizeString(account?.username),
        label: "username",
      },
      password: {
        fieldType: "concealedString",
        value: normalizeString(account?.password),
        label: "password",
      },
    });
  }
  if (normalizeString(account?.note)) {
    credentials.push({
      type: "note",
      content: {
        fieldType: "string",
        value: normalizeString(account?.note),
        label: "note",
      },
    });
  }
  for (const id of Array.isArray(account?.passkeyCredentialIds) ? account.passkeyCredentialIds : []) {
    const passkey = passkeysById.get(normalizeString(id));
    if (!passkey) continue;
    credentials.push(passPasskeyToCxfCredential(passkey));
  }

  const sites = Array.isArray(account?.sites) ? account.sites.map(normalizeString).filter(Boolean) : [];
  return {
    id: b64uUtf8(`item|${normalizeString(account?.accountId) || cryptoRandomId()}`),
    created: dateFromMs(account?.createdAtMs),
    lastModified: dateFromMs(account?.updatedAtMs),
    title: normalizeString(account?.canonicalSite) || sites[0] || normalizeString(account?.username),
    subtitle: sites[0] || "",
    favorite: Boolean(account?.isPinned),
    scope: sites.length > 0 ? { urls: sites.map((site) => `https://${site}`), androidApps: [] } : null,
    credentials,
    tags: [],
  };
}

function jwkToPkcs8B64u(jwk, alg) {
  if (alg === COSE_ALG_ES256) return bytesToB64u(encodeP256PrivateKey(jwk));
  if (alg === COSE_ALG_RS256) return bytesToB64u(encodeRsaPrivateKey(jwk));
  throw new Error(`不支持的 passkey alg: ${alg}`);
}

function pkcs8B64uToJwk(value) {
  const reader = new DerReader(b64uToBytes(value));
  const info = reader.sequence();
  info.integer();
  const algorithm = info.sequence();
  const oid = algorithm.oid();
  if (sameOid(oid, OID_EC_PUBLIC_KEY)) {
    const curve = algorithm.oid();
    if (!sameOid(curve, OID_PRIME256V1)) throw new Error("仅支持 P-256 passkey");
    return decodeP256PrivateKey(info.octetString());
  }
  if (sameOid(oid, OID_RSA_ENCRYPTION)) {
    if (!algorithm.done()) algorithm.any();
    return decodeRsaPrivateKey(info.octetString());
  }
  throw new Error("未知 PKCS#8 私钥算法");
}

function encodeP256PrivateKey(jwk) {
  const d = leftPad(jwkBytes(jwk, "d"), 32);
  const x = leftPad(jwkBytes(jwk, "x"), 32);
  const y = leftPad(jwkBytes(jwk, "y"), 32);
  const publicKey = concat([new Uint8Array([0x04]), x, y]);
  const ecPrivateKey = derSequence([
    derInteger(new Uint8Array([0x01])),
    derOctetString(d),
    derContext(1, derBitString(publicKey)),
  ]);
  return derSequence([
    derInteger(new Uint8Array([0x00])),
    derSequence([derOid(OID_EC_PUBLIC_KEY), derOid(OID_PRIME256V1)]),
    derOctetString(ecPrivateKey),
  ]);
}

function encodeRsaPrivateKey(jwk) {
  const fields = ["n", "e", "d", "p", "q", "dp", "dq", "qi"].map((name) => trimZeros(jwkBytes(jwk, name)));
  const rsaPrivateKey = derSequence([derInteger(new Uint8Array([0x00])), ...fields.map(derInteger)]);
  return derSequence([
    derInteger(new Uint8Array([0x00])),
    derSequence([derOid(OID_RSA_ENCRYPTION), derNull()]),
    derOctetString(rsaPrivateKey),
  ]);
}

function decodeP256PrivateKey(data) {
  const reader = new DerReader(data).sequence();
  reader.integer();
  const d = leftPad(reader.octetString(), 32);
  let publicJwk = null;
  while (!reader.done()) {
    const item = reader.any();
    if (item.tag !== 0xa1) continue;
    const publicKey = new DerReader(item.value).bitString();
    if (publicKey.length === 65 && publicKey[0] === 0x04) {
      publicJwk = {
        kty: "EC",
        crv: "P-256",
        x: bytesToB64u(publicKey.slice(1, 33)),
        y: bytesToB64u(publicKey.slice(33, 65)),
        ext: true,
      };
    }
  }
  return {
    alg: COSE_ALG_ES256,
    privateJwk: {
      ...(publicJwk || { kty: "EC", crv: "P-256" }),
      d: bytesToB64u(d),
      ext: true,
      key_ops: ["sign"],
    },
    publicJwk,
  };
}

function decodeRsaPrivateKey(data) {
  const reader = new DerReader(data).sequence();
  reader.integer();
  const values = ["n", "e", "d", "p", "q", "dp", "dq", "qi"].map(() => trimZeros(reader.integer()));
  const names = ["n", "e", "d", "p", "q", "dp", "dq", "qi"];
  const privateJwk = { kty: "RSA", alg: "RS256", ext: true, key_ops: ["sign"] };
  names.forEach((name, index) => {
    privateJwk[name] = bytesToB64u(values[index]);
  });
  return {
    alg: COSE_ALG_RS256,
    privateJwk,
    publicJwk: {
      kty: "RSA",
      alg: "RS256",
      n: bytesToB64u(values[0]),
      e: bytesToB64u(values[1]),
      ext: true,
    },
  };
}

class DerReader {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    this.offset = 0;
  }

  done() {
    return this.offset >= this.bytes.length;
  }

  sequence() {
    return new DerReader(this.expect(0x30));
  }

  integer() {
    return this.expect(0x02);
  }

  octetString() {
    return this.expect(0x04);
  }

  bitString() {
    const value = this.expect(0x03);
    if (value[0] !== 0x00) throw new Error("DER BIT STRING 使用了未支持的 padding");
    return value.slice(1);
  }

  oid() {
    const value = this.expect(0x06);
    const first = value[0];
    const output = [Math.floor(first / 40), first % 40];
    let current = 0;
    for (const byte of value.slice(1)) {
      current = (current << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        output.push(current);
        current = 0;
      }
    }
    return output;
  }

  any() {
    if (this.done()) throw new Error("DER 读取越界");
    const tag = this.bytes[this.offset++];
    const length = this.length();
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error("DER 长度越界");
    const value = this.bytes.slice(this.offset, end);
    this.offset = end;
    return { tag, value };
  }

  expect(tag) {
    const item = this.any();
    if (item.tag !== tag) throw new Error(`DER tag 不匹配: ${item.tag} != ${tag}`);
    return item.value;
  }

  length() {
    const first = this.bytes[this.offset++];
    if ((first & 0x80) === 0) return first;
    const count = first & 0x7f;
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      value = (value << 8) | this.bytes[this.offset++];
    }
    return value;
  }
}

function derSequence(values) {
  return derTagged(0x30, concat(values));
}

function derInteger(value) {
  let bytes = trimZeros(value);
  if (bytes.length === 0) bytes = new Uint8Array([0x00]);
  if ((bytes[0] & 0x80) !== 0) bytes = concat([new Uint8Array([0x00]), bytes]);
  return derTagged(0x02, bytes);
}

function derOctetString(value) {
  return derTagged(0x04, value);
}

function derBitString(value) {
  return derTagged(0x03, concat([new Uint8Array([0x00]), value]));
}

function derNull() {
  return new Uint8Array([0x05, 0x00]);
}

function derOid(components) {
  const body = [components[0] * 40 + components[1]];
  for (const component of components.slice(2)) {
    body.push(...base128(component));
  }
  return derTagged(0x06, new Uint8Array(body));
}

function derContext(number, value) {
  return derTagged(0xa0 + number, value);
}

function derTagged(tag, value) {
  return concat([new Uint8Array([tag]), derLength(value.length), value]);
}

function derLength(length) {
  if (length < 128) return new Uint8Array([length]);
  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function base128(value) {
  const output = [value & 0x7f];
  value >>= 7;
  while (value > 0) {
    output.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return output;
}

function jwkBytes(jwk, key) {
  const value = normalizeString(jwk?.[key]);
  if (!value) throw new Error(`JWK 缺少 ${key}`);
  return b64uToBytes(value);
}

function b64uToBytes(value) {
  const normalized = normalizeString(value).replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function bytesToB64u(bytes) {
  return Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function b64uUtf8(value) {
  return bytesToB64u(new TextEncoder().encode(value));
}

function trimZeros(bytes) {
  let index = 0;
  while (index < bytes.length - 1 && bytes[index] === 0) index += 1;
  return bytes.slice(index);
}

function leftPad(bytes, length) {
  if (bytes.length >= length) return bytes.slice(bytes.length - length);
  return concat([new Uint8Array(length - bytes.length), bytes]);
}

function concat(values) {
  const length = values.reduce((sum, value) => sum + value.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function normalizeString(value) {
  return String(value || "").trim();
}

function sameOid(lhs, rhs) {
  return lhs.length === rhs.length && lhs.every((value, index) => value === rhs[index]);
}

function dateFromMs(value) {
  const timestamp = Number(value || 0);
  return timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2);
}
