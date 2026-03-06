const STORAGE_KEY_PASSKEYS = "pass.passkeys";

const COSE_ALG_ES256 = -7;
const COSE_ALG_RS256 = -257;
const SUPPORTED_COSE_ALG_SET = new Set([COSE_ALG_ES256, COSE_ALG_RS256]);
const CREATE_COMPAT_STANDARD = "standard";
const CREATE_COMPAT_USER_NAME_FALLBACK = "user_name_fallback";
const CREATE_COMPAT_RS256 = "rs256";
const CREATE_COMPAT_USER_NAME_FALLBACK_RS256 = "user_name_fallback+rs256";
const AAGUID_ZERO = new Uint8Array(16);

class PasskeyError extends Error {
  constructor(name, message, code = "") {
    super(message);
    this.name = name;
    this.code = code;
  }
}

export async function ensurePasskeyStorageShape() {
  const stored = await chrome.storage.local.get([STORAGE_KEY_PASSKEYS]);
  if (!Array.isArray(stored[STORAGE_KEY_PASSKEYS])) {
    await chrome.storage.local.set({ [STORAGE_KEY_PASSKEYS]: [] });
  }
}

export async function handlePasskeyBridgeOperation(payload) {
  try {
    const operation = payload?.operation;
    const origin = String(payload?.origin || "");
    const host = normalizeHost(payload?.host || hostFromOrigin(origin));
    const publicKey = payload?.publicKey || null;

    if (!operation || !origin || !host || !publicKey) {
      throw new PasskeyError("TypeError", "缺少通行密钥请求参数", "PASSKEY_BAD_REQUEST");
    }

    assertSecureOrigin(origin);

    switch (operation) {
      case "create":
        return { ok: true, result: await createManagedCredential({ origin, host, publicKey }) };
      case "get":
        return { ok: true, result: await getManagedAssertion({ origin, host, publicKey }) };
      case "getCandidates":
        return { ok: true, result: await listManagedAssertionCandidates({ host, publicKey }) };
      default:
        throw new PasskeyError("NotSupportedError", `不支持的操作: ${operation}`, "PASSKEY_OP_UNSUPPORTED");
    }
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

async function createManagedCredential({ origin, host, publicKey }) {
  const challenge = base64urlToBytes(publicKey.challengeB64u);
  if (challenge.length === 0) {
    throw new PasskeyError("TypeError", "create 缺少 challenge", "PASSKEY_CHALLENGE_MISSING");
  }

  const rpId = normalizeHost(publicKey?.rp?.id || host);
  if (!rpId) {
    throw new PasskeyError("SecurityError", "create 缺少 rpId", "PASSKEY_RP_MISSING");
  }
  assertRpIdAllowedForHost(rpId, host);

  const userId = base64urlToBytes(publicKey?.user?.idB64u || "");
  const rawUserName = String(publicKey?.user?.name || "").trim();
  let userName = rawUserName;
  const displayNameRaw = String(publicKey?.user?.displayName || "").trim();
  const usedUserNameFallback = !rawUserName;
  if (userId.length === 0) {
    throw new PasskeyError("TypeError", "create 缺少 user.id", "PASSKEY_USER_MISSING");
  }
  if (!userName) {
    userName = displayNameRaw || `user_${bytesToBase64url(userId).slice(0, 16)}`;
  }
  const displayName = displayNameRaw || userName;

  const pubKeyCredParams = Array.isArray(publicKey?.pubKeyCredParams) ? publicKey.pubKeyCredParams : [];
  const selectedAlg = pickSupportedAlgorithm(pubKeyCredParams);
  if (!selectedAlg) {
    throw new PasskeyError("NotSupportedError", "仅支持 ES256(-7) 或 RS256(-257)", "PASSKEY_ALG_UNSUPPORTED");
  }
  const createCompatMethod = resolveCreateCompatMethod({
    alg: selectedAlg,
    usedUserNameFallback,
  });

  const passkeys = await loadPasskeys();
  const existing = pickLatestPasskeyForAccount(passkeys, rpId, userName);
  if (existing) {
    const deduped = dedupePasskeysForAccount(passkeys, existing, rpId, userName);
    const now = Date.now();
    const existingCompatMethod = normalizeCreateCompatMethod(
      existing?.createCompatMethod || createCompatMethod
    );
    const existingIndex = deduped.findIndex((item) => item?.credentialIdB64u === existing.credentialIdB64u);
    if (existingIndex >= 0) {
      deduped[existingIndex] = {
        ...deduped[existingIndex],
        updatedAtMs: now,
        createCompatMethod: existingCompatMethod,
      };
    }
    await savePasskeys(deduped);
    const reused = await buildCreateResultFromStoredPasskey({
      existing: deduped[Math.max(existingIndex, 0)] || existing,
      challenge,
      origin,
      rpId,
      userName,
      displayName,
    });
    return {
      ...reused,
      createMode: "existing",
      createCompatMethod: existingCompatMethod,
    };
  }

  const excludeIds = normalizeCredentialIdList(publicKey?.excludeCredentials || []);
  if (excludeIds.some((id) => passkeys.some((item) => item.rpId === rpId && item.credentialIdB64u === id))) {
    throw new PasskeyError("InvalidStateError", "凭据已存在（excludeCredentials 命中）", "PASSKEY_CREDENTIAL_EXISTS");
  }

  const keyPair = await generateManagedKeyPair(selectedAlg);
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const cosePublicKey = buildCosePublicKeyFromJwk(selectedAlg, publicJwk);

  const credentialId = randomBytes(32);
  const credentialIdB64u = bytesToBase64url(credentialId);

  const clientDataJSON = buildClientDataJSON({
    type: "webauthn.create",
    challengeB64u: bytesToBase64url(challenge),
    origin,
  });

  const rpIdHash = await sha256(utf8(rpId));
  const authData = concatBytes(
    rpIdHash,
    new Uint8Array([0x45]), // UP + UV + AT
    uint32be(0),
    AAGUID_ZERO,
    uint16be(credentialId.length),
    credentialId,
    cosePublicKey
  );

  const attestationObject = cborEncode(
    new Map([
      ["fmt", "none"],
      ["authData", authData],
      ["attStmt", new Map()],
    ])
  );

  const now = Date.now();
  passkeys.push({
    credentialIdB64u,
    rpId,
    userHandleB64u: bytesToBase64url(userId),
    userName,
    displayName,
    alg: selectedAlg,
    privateJwk,
    publicJwk,
    signCount: 0,
    createCompatMethod,
    createdAtMs: now,
    updatedAtMs: now,
    lastUsedAtMs: null,
  });
  await savePasskeys(passkeys);

  return {
    credential: {
      id: credentialIdB64u,
      rawIdB64u: credentialIdB64u,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSONB64u: bytesToBase64url(clientDataJSON),
        attestationObjectB64u: bytesToBase64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    },
    accountHint: {
      rpId,
      username: userName,
      credentialIdB64u,
      displayName,
    },
    createMode: "created",
    createCompatMethod,
  };
}

function pickLatestPasskeyForAccount(passkeys, rpId, userName) {
  const matched = (Array.isArray(passkeys) ? passkeys : []).filter((item) => {
    return item?.rpId === rpId && String(item?.userName || "").trim() === userName;
  });
  if (matched.length === 0) return null;
  matched.sort((a, b) => {
    const aTs = Number(a?.updatedAtMs || a?.createdAtMs || 0);
    const bTs = Number(b?.updatedAtMs || b?.createdAtMs || 0);
    if (aTs !== bTs) return bTs - aTs;
    return String(a?.credentialIdB64u || "").localeCompare(String(b?.credentialIdB64u || ""));
  });
  return matched[0];
}

function dedupePasskeysForAccount(passkeys, keep, rpId, userName) {
  const keepId = String(keep?.credentialIdB64u || "");
  return (Array.isArray(passkeys) ? passkeys : []).filter((item) => {
    if (!(item?.rpId === rpId && String(item?.userName || "").trim() === userName)) {
      return true;
    }
    return String(item?.credentialIdB64u || "") === keepId;
  });
}

async function buildCreateResultFromStoredPasskey({
  existing,
  challenge,
  origin,
  rpId,
  userName,
  displayName,
}) {
  const credentialIdB64u = String(existing?.credentialIdB64u || "");
  const credentialId = base64urlToBytes(credentialIdB64u);
  if (!credentialIdB64u || credentialId.length === 0) {
    throw new PasskeyError("OperationError", "已存在凭据数据无效", "PASSKEY_EXISTING_CREDENTIAL_INVALID");
  }

  const alg = normalizeManagedAlg(existing?.alg);
  const createCompatMethod = normalizeCreateCompatMethod(
    existing?.createCompatMethod || resolveCreateCompatMethod({ alg, usedUserNameFallback: false })
  );
  const publicJwk = existing?.publicJwk || null;
  let cosePublicKey;
  try {
    cosePublicKey = buildCosePublicKeyFromJwk(alg, publicJwk);
  } catch {
    throw new PasskeyError("OperationError", "已存在凭据公钥无效", "PASSKEY_EXISTING_PUBLIC_KEY_INVALID");
  }

  const clientDataJSON = buildClientDataJSON({
    type: "webauthn.create",
    challengeB64u: bytesToBase64url(challenge),
    origin,
  });

  const rpIdHash = await sha256(utf8(rpId));
  const signCount = Number(existing?.signCount || 0);
  const authData = concatBytes(
    rpIdHash,
    new Uint8Array([0x45]), // UP + UV + AT
    uint32be(signCount),
    AAGUID_ZERO,
    uint16be(credentialId.length),
    credentialId,
    cosePublicKey
  );

  const attestationObject = cborEncode(
    new Map([
      ["fmt", "none"],
      ["authData", authData],
      ["attStmt", new Map()],
    ])
  );

  return {
    credential: {
      id: credentialIdB64u,
      rawIdB64u: credentialIdB64u,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSONB64u: bytesToBase64url(clientDataJSON),
        attestationObjectB64u: bytesToBase64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    },
    accountHint: {
      rpId,
      username: userName,
      credentialIdB64u,
      displayName: displayName || String(existing?.displayName || userName || ""),
    },
    createCompatMethod,
  };
}

async function getManagedAssertion({ origin, host, publicKey }) {
  const challenge = base64urlToBytes(publicKey.challengeB64u);
  if (challenge.length === 0) {
    throw new PasskeyError("TypeError", "get 缺少 challenge", "PASSKEY_CHALLENGE_MISSING");
  }

  const { rpId, passkeys, candidates } = await resolveGetCandidates({ host, publicKey });
  if (candidates.length === 0) {
    throw new PasskeyError("NotAllowedError", "未找到可用通行密钥", "PASSKEY_NOT_FOUND");
  }
  const selected = candidates[0];

  const alg = normalizeManagedAlg(selected?.alg);
  const privateKey = await importManagedPrivateKey(alg, selected?.privateJwk);

  const clientDataJSON = buildClientDataJSON({
    type: "webauthn.get",
    challengeB64u: bytesToBase64url(challenge),
    origin,
  });
  const clientDataHash = await sha256(clientDataJSON);

  const nextSignCount = Number(selected.signCount || 0) + 1;
  const authenticatorData = concatBytes(
    await sha256(utf8(rpId)),
    new Uint8Array([0x05]), // UP + UV
    uint32be(nextSignCount)
  );
  const signedPayload = concatBytes(authenticatorData, clientDataHash);
  const signature = await signManagedAssertion(alg, privateKey, signedPayload);

  const now = Date.now();
  const updateIndex = passkeys.findIndex((item) => item.credentialIdB64u === selected.credentialIdB64u);
  if (updateIndex >= 0) {
    passkeys[updateIndex] = {
      ...passkeys[updateIndex],
      signCount: nextSignCount,
      lastUsedAtMs: now,
      updatedAtMs: now,
    };
    await savePasskeys(passkeys);
  }

  return {
    credential: {
      id: selected.credentialIdB64u,
      rawIdB64u: selected.credentialIdB64u,
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSONB64u: bytesToBase64url(clientDataJSON),
        authenticatorDataB64u: bytesToBase64url(authenticatorData),
        signatureB64u: bytesToBase64url(signature),
        userHandleB64u: selected.userHandleB64u || null,
      },
      clientExtensionResults: {},
    },
  };
}

async function listManagedAssertionCandidates({ host, publicKey }) {
  const { candidates } = await resolveGetCandidates({ host, publicKey });
  return {
    candidates: candidates.map((item) => ({
      credentialIdB64u: item.credentialIdB64u,
      rpId: item.rpId,
      userName: String(item.userName || ""),
      displayName: String(item.displayName || ""),
      signCount: Number(item.signCount || 0),
      createdAtMs: item.createdAtMs == null ? null : Number(item.createdAtMs),
      updatedAtMs: item.updatedAtMs == null ? null : Number(item.updatedAtMs),
      lastUsedAtMs: item.lastUsedAtMs == null ? null : Number(item.lastUsedAtMs),
    })),
  };
}

async function resolveGetCandidates({ host, publicKey }) {
  const rpId = normalizeHost(publicKey?.rpId || host);
  if (!rpId) {
    throw new PasskeyError("SecurityError", "get 缺少 rpId", "PASSKEY_RP_MISSING");
  }
  assertRpIdAllowedForHost(rpId, host);

  const passkeys = await loadPasskeys();
  let candidates = passkeys.filter((item) => item.rpId === rpId);
  const allowCredentialIds = normalizeCredentialIdList(publicKey?.allowCredentials || []);
  if (allowCredentialIds.length > 0) {
    const allowSet = new Set(allowCredentialIds);
    candidates = candidates.filter((item) => allowSet.has(item.credentialIdB64u));
  }

  candidates.sort((a, b) => (b.lastUsedAtMs || b.updatedAtMs || 0) - (a.lastUsedAtMs || a.updatedAtMs || 0));
  return { rpId, passkeys, candidates };
}

async function loadPasskeys() {
  const stored = await chrome.storage.local.get([STORAGE_KEY_PASSKEYS]);
  const raw = Array.isArray(stored[STORAGE_KEY_PASSKEYS]) ? stored[STORAGE_KEY_PASSKEYS] : [];
  return raw.filter((item) => item && typeof item === "object");
}

async function savePasskeys(items) {
  await chrome.storage.local.set({ [STORAGE_KEY_PASSKEYS]: items });
}

function normalizeCredentialIdList(input) {
  if (!Array.isArray(input)) return [];
  const values = input
    .map((item) => String(item?.idB64u || ""))
    .filter(Boolean)
    .map(normalizeBase64url);
  return [...new Set(values)];
}

function assertSecureOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new PasskeyError("SecurityError", "origin 非法", "PASSKEY_ORIGIN_INVALID");
  }
  if (url.protocol === "https:") return;
  const host = normalizeHost(url.hostname);
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (url.protocol === "http:" && isLocalhost) return;
  throw new PasskeyError("SecurityError", "仅允许 HTTPS 或 localhost", "PASSKEY_INSECURE_ORIGIN");
}

function assertRpIdAllowedForHost(rpId, host) {
  if (!rpId || !host) {
    throw new PasskeyError("SecurityError", "rpId 或 host 缺失", "PASSKEY_RP_HOST_MISSING");
  }
  if (host === rpId || host.endsWith(`.${rpId}`)) return;
  throw new PasskeyError("SecurityError", "rpId 与当前域名不匹配", "PASSKEY_RP_MISMATCH");
}

function hostFromOrigin(origin) {
  try {
    return new URL(origin).hostname || "";
  } catch {
    return "";
  }
}

function normalizeHost(input) {
  let value = String(input || "").trim().toLowerCase();
  while (value.endsWith(".")) {
    value = value.slice(0, -1);
  }
  return value;
}

function normalizeBase64url(input) {
  return String(input || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function buildClientDataJSON({ type, challengeB64u, origin }) {
  const payload = {
    type,
    challenge: normalizeBase64url(challengeB64u),
    origin,
    crossOrigin: false,
  };
  return utf8(JSON.stringify(payload));
}

function utf8(input) {
  return new TextEncoder().encode(String(input));
}

function uint16be(value) {
  const out = new Uint8Array(2);
  out[0] = (value >> 8) & 0xff;
  out[1] = value & 0xff;
  return out;
}

function uint32be(value) {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

function concatBytes(...parts) {
  const normalized = parts
    .filter(Boolean)
    .map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)));
  const total = normalized.reduce((sum, item) => sum + item.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of normalized) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha256(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", source));
}

function encodeCoseEc2PublicKey(x, y) {
  const cose = new Map([
    [1, 2], // kty: EC2
    [3, COSE_ALG_ES256], // alg: ES256
    [-1, 1], // crv: P-256
    [-2, x], // x
    [-3, y], // y
  ]);
  return cborEncode(cose);
}

function encodeCoseRsaPublicKey(n, e) {
  const cose = new Map([
    [1, 3], // kty: RSA
    [3, COSE_ALG_RS256], // alg: RS256
    [-1, n], // modulus
    [-2, e], // exponent
  ]);
  return cborEncode(cose);
}

function pickSupportedAlgorithm(pubKeyCredParams) {
  if (!Array.isArray(pubKeyCredParams)) return null;
  for (const item of pubKeyCredParams) {
    const type = String(item?.type || "public-key").toLowerCase();
    const alg = Number(item?.alg);
    if (type !== "public-key") continue;
    if (SUPPORTED_COSE_ALG_SET.has(alg)) {
      return alg;
    }
  }
  return null;
}

function normalizeManagedAlg(alg) {
  const parsed = Number(alg);
  if (SUPPORTED_COSE_ALG_SET.has(parsed)) {
    return parsed;
  }
  return COSE_ALG_ES256;
}

function resolveCreateCompatMethod({ alg, usedUserNameFallback }) {
  const safeAlg = normalizeManagedAlg(alg);
  if (safeAlg === COSE_ALG_RS256 && usedUserNameFallback) {
    return CREATE_COMPAT_USER_NAME_FALLBACK_RS256;
  }
  if (safeAlg === COSE_ALG_RS256) {
    return CREATE_COMPAT_RS256;
  }
  if (usedUserNameFallback) {
    return CREATE_COMPAT_USER_NAME_FALLBACK;
  }
  return CREATE_COMPAT_STANDARD;
}

function normalizeCreateCompatMethod(input) {
  const value = String(input || "").trim().toLowerCase();
  if (
    value === CREATE_COMPAT_STANDARD ||
    value === CREATE_COMPAT_USER_NAME_FALLBACK ||
    value === CREATE_COMPAT_RS256 ||
    value === CREATE_COMPAT_USER_NAME_FALLBACK_RS256
  ) {
    return value;
  }
  return CREATE_COMPAT_STANDARD;
}

async function generateManagedKeyPair(alg) {
  if (alg === COSE_ALG_RS256) {
    return await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"]
    );
  }
  return await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
}

function buildCosePublicKeyFromJwk(alg, publicJwk) {
  if (alg === COSE_ALG_RS256) {
    const n = base64urlToBytes(publicJwk?.n || "");
    const e = base64urlToBytes(publicJwk?.e || "");
    if (n.length === 0 || e.length === 0) {
      throw new Error("RSA JWK invalid");
    }
    return encodeCoseRsaPublicKey(n, e);
  }
  const x = base64urlToBytes(publicJwk?.x || "");
  const y = base64urlToBytes(publicJwk?.y || "");
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("EC JWK invalid");
  }
  return encodeCoseEc2PublicKey(x, y);
}

async function importManagedPrivateKey(alg, privateJwk) {
  if (alg === COSE_ALG_RS256) {
    return await crypto.subtle.importKey(
      "jwk",
      privateJwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
  return await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

async function signManagedAssertion(alg, privateKey, payload) {
  if (alg === COSE_ALG_RS256) {
    return new Uint8Array(
      await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        privateKey,
        payload
      )
    );
  }
  const rawSignature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      payload
    )
  );
  return ecdsaRawSignatureToDer(rawSignature);
}

function cborEncode(value) {
  const out = [];

  const pushUInt = (major, num) => {
    if (!Number.isInteger(num) || num < 0) {
      throw new PasskeyError("OperationError", "CBOR 仅支持非负整数长度", "PASSKEY_CBOR_UINT");
    }
    if (num < 24) {
      out.push((major << 5) | num);
      return;
    }
    if (num < 0x100) {
      out.push((major << 5) | 24, num);
      return;
    }
    if (num < 0x10000) {
      out.push((major << 5) | 25, (num >> 8) & 0xff, num & 0xff);
      return;
    }
    out.push(
      (major << 5) | 26,
      (num >>> 24) & 0xff,
      (num >>> 16) & 0xff,
      (num >>> 8) & 0xff,
      num & 0xff
    );
  };

  const encode = (input) => {
    if (input === null) {
      out.push(0xf6);
      return;
    }
    if (typeof input === "boolean") {
      out.push(input ? 0xf5 : 0xf4);
      return;
    }
    if (typeof input === "number") {
      if (!Number.isInteger(input)) {
        throw new PasskeyError("OperationError", "CBOR 不支持浮点数", "PASSKEY_CBOR_FLOAT");
      }
      if (input >= 0) {
        pushUInt(0, input);
      } else {
        pushUInt(1, -1 - input);
      }
      return;
    }
    if (typeof input === "string") {
      const bytes = utf8(input);
      pushUInt(3, bytes.length);
      out.push(...bytes);
      return;
    }
    if (input instanceof Uint8Array) {
      pushUInt(2, input.length);
      out.push(...input);
      return;
    }
    if (input instanceof ArrayBuffer) {
      encode(new Uint8Array(input));
      return;
    }
    if (Array.isArray(input)) {
      pushUInt(4, input.length);
      for (const item of input) {
        encode(item);
      }
      return;
    }
    if (input instanceof Map) {
      pushUInt(5, input.size);
      for (const [key, value] of input.entries()) {
        encode(key);
        encode(value);
      }
      return;
    }
    if (typeof input === "object") {
      const entries = Object.entries(input);
      pushUInt(5, entries.length);
      for (const [key, value] of entries) {
        encode(key);
        encode(value);
      }
      return;
    }
    throw new PasskeyError("OperationError", "CBOR 不支持的数据类型", "PASSKEY_CBOR_TYPE");
  };

  encode(value);
  return new Uint8Array(out);
}

function ecdsaRawSignatureToDer(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== 64) {
    throw new PasskeyError("OperationError", "ECDSA 签名长度非法", "PASSKEY_SIG_INVALID");
  }
  const r = raw.slice(0, 32);
  const s = raw.slice(32, 64);

  const normalizeInt = (input) => {
    let start = 0;
    while (start < input.length - 1 && input[start] === 0) {
      start += 1;
    }
    let value = input.slice(start);
    if (value[0] & 0x80) {
      value = concatBytes(new Uint8Array([0x00]), value);
    }
    return value;
  };

  const rNorm = normalizeInt(r);
  const sNorm = normalizeInt(s);
  const sequenceLen = 2 + rNorm.length + 2 + sNorm.length;

  return concatBytes(
    new Uint8Array([0x30, sequenceLen, 0x02, rNorm.length]),
    rNorm,
    new Uint8Array([0x02, sNorm.length]),
    sNorm
  );
}

function bytesToBase64url(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    bytes = new Uint8Array(bytes || []);
  }
  let bin = "";
  for (const byte of bytes) {
    bin += String.fromCharCode(byte);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlToBytes(input) {
  const normalized = normalizeBase64url(input);
  if (!normalized) return new Uint8Array();
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  let bin;
  try {
    bin = atob(base64);
  } catch {
    return new Uint8Array();
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function normalizeError(error) {
  const message = error?.message || String(error || "未知错误");
  const name = error?.name || "OperationError";
  const code = error?.code || "";
  return { name, message, code };
}
