export function explainCreateManageability({ hasChallenge, hasUserId, authenticatorAttachment } = {}) {
  if (!hasChallenge || !hasUserId) {
    return { manageable: false, reason: "missing-challenge-or-user-id" };
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
