# extension_firefox

Firefox extension scaffold (Manifest V3).

## Current features
- First-run device name (default `ChromeMac`) and editable save.
- Detect current tab domain and eTLD+1.
- Create account manually and edit account fields in popup.
- Recycle bin view with restore and permanent delete.
- Demo account generation.
- Add current domain into account alias group.
- Alias group auto-sync across accounts (overlap or same eTLD+1).
- Soft-delete / restore account.
- Copy password from popup.
- Fill username/password into current webpage login form.
- Detect login form submission and prompt to save/update credentials
  (if same site + username + password already exists, no prompt).
- Managed passkey bridge (WebAuthn):
  - intercept `navigator.credentials.create/get` in page context;
  - store managed passkey records in extension IndexedDB;
  - perform assertion signing with managed private key for supported RP;
  - auto upsert account record (`rpId + username`, empty password) after passkey registration and link passkey credential ID to that account;
  - auto merge duplicate account rows for same username + same site/alias group.
- Popup passkey panel:
  - view/search/filter managed passkeys;
  - filter by current site;
  - copy credential id and delete passkey.
- Options page with JSON import/export for local storage data.

## Load extension
1. Install dependencies:
   ```bash
   cd /Users/x/code/pass/apps/extension_firefox
   npm install
   ```
2. Build runtime bundles:
   ```bash
   npm run build
   ```
3. Open `about:debugging#/runtime/this-firefox`.
4. Click "临时载入附加组件".
5. Choose `/Users/x/code/pass/apps/extension_firefox/manifest.json`.

## Development
- `npm run build`: one-shot bundle to `dist/`.
- `npm run build:watch`: watch mode bundle to `dist/`.

## Notes
- Runtime scripts are loaded from `dist/*.js` in `manifest.json` and HTML.
- Source files (`popup.js`, `options.js`, `background.js`, `content.js`) are modular and shared via `account_core.js`.
- Sync merge/conflict logic is centralized in shared core module: `core/pass_core/js/sync_merge_core.js` (imported by `options.js`).
- Business data (`accounts/passkeys/folders`) now persists in extension IndexedDB via `data_store.js`.
- `chrome.storage.local` is kept for settings and lightweight data-change signaling only.
- Legacy `chrome.storage.local` business keys are auto-migrated into IndexedDB on first run.

## Files
- `manifest.json`: MV3 entry.
- `scripts/build.mjs`: esbuild entry (bundles to `dist/`).
- `popup.*`: popup UI and source logic.
- `background.js`: background source logic.
- `options.*`: options UI and source logic.
- `content.js`: content source logic.
- `account_core.js`: shared account/domain/sort/merge core logic.
- `data_store.js`: IndexedDB data access + legacy storage migration.
- `../../core/pass_core/js/sync_merge_core.js`: shared sync merge/conflict kernel.
