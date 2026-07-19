export function isTrustedExtensionMessageSender(sender, runtimeId) {
  const expectedId = String(runtimeId || "").trim();
  return Boolean(expectedId && String(sender?.id || "") === expectedId);
}
