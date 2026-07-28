/**
 * Shared, DOM-agnostic credential-pair fill path. The content script supplies
 * browser field discovery and native value assignment; tests supply tiny fake
 * fields. Keeping the decision here prevents chooser and popup filling from
 * drifting apart.
 */
export function fillCredentialFields({
  activeInput,
  username,
  password,
  isPasswordInput,
  findRelatedUsername,
  findRelatedPassword,
  findFallbackPassword,
  writeValue,
}) {
  let usernameInput = null;
  let passwordInput = null;
  const wantedUsername = String(username || "");
  const wantedPassword = String(password || "");

  if (activeInput) {
    if (isPasswordInput(activeInput)) {
      passwordInput = activeInput;
      usernameInput = findRelatedUsername(activeInput);
    } else {
      usernameInput = activeInput;
      passwordInput = findRelatedPassword(activeInput);
    }
  }

  if (!passwordInput) passwordInput = findFallbackPassword();
  if (!usernameInput && passwordInput) usernameInput = findRelatedUsername(passwordInput);
  if (usernameInput && !passwordInput) passwordInput = findRelatedPassword(usernameInput);

  let filledUsername = false;
  let filledPassword = false;
  if (usernameInput) {
    writeValue(usernameInput, wantedUsername);
    filledUsername = usernameInput.value === wantedUsername;
  }
  if (passwordInput) {
    writeValue(passwordInput, wantedPassword);
    filledPassword = passwordInput.value === wantedPassword;
  }

  return {
    filledUsername,
    filledPassword,
    filledAny: filledUsername || filledPassword,
    filledBoth: Boolean(usernameInput ? filledUsername : !wantedUsername)
      && Boolean(passwordInput ? filledPassword : !wantedPassword)
      && (filledUsername || filledPassword || Boolean(usernameInput || passwordInput)),
  };
}
