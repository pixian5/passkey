# Android Credential Provider

This module registers Pass as an Android Credential Manager provider for passwords
and passkeys on Android 14+ (`minSdk = 34`).

## Implemented

- `PassCredentialProviderService` — Credential Manager query hooks
  (`onBeginGetCredentialRequest`, `onBeginCreateCredentialRequest`,
  `onClearCredentialStateRequest`).
- Manifest registration with `android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE`.
- `res/xml/provider.xml` capabilities for passwords and public-key credentials.
- Demo vault loader (`filesDir/pass_demo_vault.json`), seeded from
  `assets/pass_demo_vault.json` on first read.
- **Selectable accounts (query phase):** when the demo vault has non-deleted
  accounts and the request includes a password option,
  `beginGetCredential` returns a `PasswordCredentialEntry` list. Each entry
  carries a `PendingIntent` to `PassCredentialSettingsActivity` with
  `accountId` / `username` / `sites` extras only — **no password**.
- Confirm activity shows the selected account metadata and explains that full
  vault unlock + credential result is not wired yet.
- Manual `application/vnd.fido.cxf+json` receive activity for Credential Exchange
  testing.

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
   # No Gradle wrapper in-tree yet — use system Gradle 8.x+ or `gradle wrapper` first.
   gradle :app:assembleDebug
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

- Encrypted vault unlock and real password / public-key credential results
- Finishing the activity with `PendingIntentHandler.setGetCredentialResponse`
- Site/domain filtering for calling apps (demo returns all non-deleted accounts,
  optionally filtered by `BeginGetPasswordOption.allowedUserIds`)
- Gradle wrapper in this package
