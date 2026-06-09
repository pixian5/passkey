# Android Credential Provider

This module registers Pass as an Android Credential Manager provider for passwords
and passkeys on Android 14+.

Implemented pieces:
- `PassCredentialProviderService` with the required Credential Manager query hooks.
- Manifest registration with `android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE`.
- `res/xml/provider.xml` capabilities for passwords and public-key credentials.
- Manual `application/vnd.fido.cxf+json` receive activity for Credential Exchange testing.

The service currently returns empty query results until the encrypted Android vault
and UI pending-intent selection flow are connected. The shared conversion contract
is in `/Users/x/code/pass/core/pass_core/js/credential_exchange_cxf.js`.

Build:
```bash
cd /Users/x/code/pass/apps/android_credential_provider
./gradlew assembleDebug
```

This repository does not include a Gradle wrapper yet. Install or generate one
before building the Android module.
