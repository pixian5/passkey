# Android Credential Provider

This development module registers an incomplete password-only Android Credential
Manager provider scaffold on Android 14+ (`minSdk = 34`). It must not be shipped
as a production provider until the unlock and credential-result paths below are complete.

Current project status is tracked in [`../../docs/current-app-extension-implementation-reference-zh.md`](../../docs/current-app-extension-implementation-reference-zh.md). This module is not an Android management app yet.

## Implemented

- `PassCredentialProviderService` — Credential Manager query hooks
  (`onBeginGetCredentialRequest`, `onBeginCreateCredentialRequest`,
  `onClearCredentialStateRequest`).
- Manifest registration with `android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE`.
- `res/xml/provider.xml` advertises only password credentials. Passkey capability
  is intentionally absent until create/get results are implemented.
- Demo vault loader (`filesDir/pass_demo_vault.json`), seeded from
  `assets/pass_demo_vault.json` on first read.
- **Selectable accounts (query phase):** when the demo vault has non-deleted
  accounts and the request includes a password option,
  `beginGetCredential` returns a `PasswordCredentialEntry` list. Each entry
  carries a `PendingIntent` to `PassCredentialSettingsActivity` with
  `accountId` / `username` / `sites` extras only — **no password**.
- Confirm activity shows the selected account metadata and explains that full
  vault unlock + credential result is not wired yet.
- Credential Exchange is intentionally not registered: the former receive
  activity discarded every import without parsing or confirmation.

Shared conversion contract: `core/pass_core/js/credential_exchange_cxf.js`.

## Demo vault

### Default (seeded)

On first `loadDemoAccounts`, if `filesDir/pass_demo_vault.json` is missing the
app copies `app/src/main/assets/pass_demo_vault.json` into the sandbox.

### Install / override with adb

```bash
PKG=com.pass.credentialprovider

# Write a custom vault into the app sandbox (debuggable builds)
adb shell run-as "$PKG" sh -c 'cat > files/pass_demo_vault.json' <<'EOF'
{
  "accounts": [
    {
      "id": "demo-1",
      "username": "alice@example.com",
      "sites": ["example.com"],
      "isDeleted": false
    }
  ]
}
EOF

# Or push a local file
adb push ./my_vault.json /data/local/tmp/pass_demo_vault.json
adb shell run-as "$PKG" cp /data/local/tmp/pass_demo_vault.json files/pass_demo_vault.json
```

Schema (do **not** put real passwords in the query-phase demo file):

```json
{
  "accounts": [
    {
      "id": "demo-1",
      "username": "alice",
      "sites": ["example.com"],
      "isDeleted": false
    }
  ]
}
```

## How to test selectable entries

1. **Build & install**

   ```bash
   cd apps/android_credential_provider
   # Use JDK 25 LTS. Install Android SDK Platform 36 first.
   ./gradlew testDebugUnitTest :app:assembleDebug
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

2. **Enable the provider**  
   System settings → *Passwords, passkeys & autofill* / preferred service (OEM wording
   varies) and enable **Pass** as a credential provider.

3. **Confirm demo vault**  
   Open the app (settings activity) or watch logcat:

   ```bash
   adb logcat -s PassProviderRepo
   ```

   Expect a seed log and later `demoAccounts=N` / `returning N password entries`.

4. **Trigger Credential Manager get**  
   Use an app that requests a password via Credential Manager (Android 14+), or a
   harness calling `CredentialManager.getCredential` with `GetPasswordOption`.
   Pass should appear in the system account picker with demo usernames.

5. **Select an account**  
   Choosing an entry opens `PassCredentialSettingsActivity` with account id /
   username / sites. The screen states that password fill requires vault unlock
   (not implemented). Credential Manager will not receive a password until the
   unlock + PendingIntent result path is completed.

6. **Create flow (stub)**  
   Create requests return a single `CreateEntry` that opens the same activity
   with `pass.action=create`.

## Dependencies

`app/build.gradle.kts`:

- `androidx.credentials:credentials:1.7.0-alpha02`
- `compileSdk` / `targetSdk` 36, `minSdk` 34

API used for entries (verified against the 1.7.0-alpha02 AAR):

```text
PasswordCredentialEntry.Builder(context, username, pendingIntent, beginGetPasswordOption)
  .setDisplayName(...)
  .build()
```

## Not yet wired

- Encrypted vault unlock and real password credential results
- Passkey create/get support and public-key capability declaration
- Credential Exchange parsing, preview, confirmation, and durable import
- Finishing the activity with `PendingIntentHandler.setGetCredentialResponse`
- Site/domain filtering for calling apps (demo returns all non-deleted accounts,
  optionally filtered by `BeginGetPasswordOption.allowedUserIds`)
