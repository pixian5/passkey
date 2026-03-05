# extension_chrome

Chrome extension scaffold (Manifest V3).

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
- Options page with JSON import/export for local storage data.

## Load extension
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Choose `/Users/x/code/pass/apps/extension_chrome`.

## Files
- `manifest.json`: MV3 entry.
- `popup.*`: main UI and logic.
- `background.js`: install-time initialization.
- `options.*`: data inspection and JSON import/export.
