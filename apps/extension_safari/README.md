# extension_safari

Safari Web Extension wrapper for the existing Pass browser extension.

## What it is
- Generated from `/Users/x/code/pass/apps/extension_chrome`
- Reuses the Chrome extension source files directly
- Safari wrapper project lives at:
  - `/Users/x/code/pass/apps/extension_safari/PassSafari/PassSafari.xcodeproj`

## Current structure
- Safari host app bundle id: `com.pass.safari`
- Safari extension bundle id: `com.pass.safari.Extension`
- macOS only

## Open in Xcode
```bash
open /Users/x/code/pass/apps/extension_safari/PassSafari/PassSafari.xcodeproj
```

## Build from terminal
```bash
cd /Users/x/code/pass/apps/extension_safari/PassSafari
xcodebuild -project PassSafari.xcodeproj -scheme PassSafari -configuration Debug -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

Built app:
- `/Users/x/code/pass/apps/extension_safari/PassSafari/build/Build/Products/Debug/PassSafari.app`

## Apple Development signing
For local development on this Mac, use the bundled script:

```bash
cd /Users/x/code/pass/apps/extension_safari
./scripts/build_signed_safari.sh
```

What it does:
- kills any old `PassSafari` process
- cleans the old derived data
- builds the Safari host app with the local `Apple Development` certificate already installed on this Mac
- installs the built app to `/Applications/PassSafari.app`
- re-registers it with LaunchServices
- launches the new app

## Enable in Safari
1. Build and run `PassSafari.app` once.
2. Open Safari.
3. Go to `Safari > Settings > Extensions`.
4. Enable `PassSafari Extension`.
5. If needed, allow it on all websites.

## Notes
- The generated Safari project references files from `/Users/x/code/pass/apps/extension_chrome` instead of copying them, so we keep one extension codebase.
- Before building Safari, rebuild the shared web extension bundle if JS changed:
```bash
cd /Users/x/code/pass/apps/extension_chrome
npm run build
```
- Safari converter reported that `clipboardRead` is not supported by the current Safari version. Clipboard-related flows may need Safari-specific fallback behavior later.
- The source `manifest.json` currently has no icon entries, so the generated Safari project used default assets.
