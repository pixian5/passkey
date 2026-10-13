export function explainCreateManageability({
  hasChallenge,
  hasUserId,
  authenticatorAttachment,
  googleLegacyAppidSupport,
} = {}) {
  if (!hasChallenge || !hasUserId) {
    return { manageable: false, reason: "missing-challenge-or-user-id" };
  }

  // Google's legacy AppID extension turns create() into a roaming U2F
  // registration bound to its gstatic AppID. A platform credential cannot
  // satisfy that contract, so leave the request to Chrome.
  if (googleLegacyAppidSupport === true) {
    return { manageable: false, reason: "google-legacy-appid-request" };
  }

  // 2026-10-13 变更：原先只要 RP 要求 direct/enterprise 证明就让位给系统认证器，
  // 结果谷歌一类站点永远无法把通行密钥存进 Pass。Pass 的托管创建对此是协议正确的：
  // 返回匿名证明（fmt="none" + 全零 AAGUID），attestation 仍如实序列化上报，
  // 是否接受由 RP 在服务端决定。见 tests/google_passkey_registration.test.mjs。
  // 故不再因 attestation 让位，改由 Pass 接管创建。

  if (String(authenticatorAttachment || "").toLowerCase() === "cross-platform") {
    return { manageable: false, reason: "cross-platform-requested" };
  }

  return { manageable: true, reason: "managed-by-pass" };
}

export function explainGetManageability({ hasChallenge } = {}) {
  if (!hasChallenge) {
    return { manageable: false, reason: "missing-challenge" };
  }

  // Credential transports are hints for a browser authenticator picker. They
  // do not restrict a stored Pass credential, whose ID is verified separately.
  return { manageable: true, reason: "managed-by-pass" };
}

export function shouldFallbackToBrowser(error) {
  const code = String(error?.code || "");
  return code === "PASSKEY_NOT_FOUND" || code === "PASSKEY_USE_BROWSER";
}
