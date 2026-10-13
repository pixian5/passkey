export function explainCreateManageability({
  hasChallenge,
  hasUserId,
  authenticatorAttachment,
  attestation,
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

  // Pass has no certified attestation key or metadata chain. Let Chrome use
  // the real system authenticator when the RP explicitly requires proof.
  // 2026-10-13 实测复盘：1.9.6 曾移除此让位、改由 Pass 接管谷歌注册，凭据
  // 成功生成并返回（create-bridge-success），但谷歌服务端直接拒绝——页面弹
  // 「出了点问题：我们无法保存您所做的更改」+ RpcError。实锤谷歌强制校验
  // attestation，匿名证明（fmt=none）不被接受。让位是唯一正确行为。

  if (["direct", "enterprise"].includes(String(attestation || "").toLowerCase())) {
    return { manageable: false, reason: "attestation-required-by-rp" };
  }

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
