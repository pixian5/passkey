# app_macos

Runnable macOS desktop app (SwiftUI) for local password management demo.

Remote sync bundles use AES-256-GCM with an independent Keychain-held sync key. The key is never sent to the server; browser extensions and other platforms must be configured with the same key. Remote sync and sync-bundle export are blocked until a valid 256-bit key is configured.

The app-lock password verifier uses PBKDF2-SHA-256 (310000 iterations). Existing legacy password verifiers are upgraded after the next successful password unlock. Sync endpoints must use HTTPS; HTTP is accepted only for `localhost`, `127.0.0.1`, and `::1` during local development, so network credentials are not sent in plaintext.

## Features
- Set and persist device name in `PassMac > Settings...`.
- Create account manually (site + username + password).
- Auto-sync alias domains across connected accounts (overlapping sites -> union).
- Edit stored account fields (sites/username/password/totp/recovery/note).
- Recycle bin view with restore and permanent delete.
- Generate demo accounts.
- Export local data to CSV.
- Export passwords and passkeys through Apple Credential Exchange on macOS 26+.
- Display all shown timestamps in `yy-M-d H:m:s` style (e.g. `26-3-14 9:2:8`).

## Run
```bash
cd /Users/x/code/pass/apps/app_macos
swift run PassMac
```

## Build
```bash
cd /Users/x/code/pass/apps/app_macos
swift build
```

## Xcode
- 默认开发路径：使用 [`project.yml`](/Users/x/code/pass/apps/app_macos/project.yml) 生成纯 App 工程，不包含 AutoFill 扩展和签名要求。
- 生成默认工程：
```bash
cd /Users/x/code/pass/apps/app_macos
xcodegen generate
```
- 如果以后有开发者账号，需要恢复系统级 AutoFill 扩展，再改用 [`project.autofill.yml`](/Users/x/code/pass/apps/app_macos/project.autofill.yml) 生成工程：
```bash
cd /Users/x/code/pass/apps/app_macos
xcodegen generate --spec project.autofill.yml
```

## Build .app bundle
```bash
cd /Users/x/code/pass/apps/app_macos
./scripts/package_app.sh
```

Generated bundle:
- `/Users/x/code/pass/apps/app_macos/dist/PassMac.app`
- `/Applications/PassMac.app`（默认自动安装）
- 安装后默认先关闭旧 `PassMac` 进程，再自动运行新版本

`package_app.sh` now builds through Xcode so the generated app bundle includes
`PassAutoFillExtension.appex`. The AutoFill/Credential Exchange path requires the
`project.autofill.yml` generated Xcode project and real Developer ID/App Store
signing before macOS will treat the app as a system credential provider. The
same signing is required for the app and extension to share the Keychain-held
database encryption key. Local verification can use `CODE_SIGNING_ALLOWED=NO`;
the packaging script removes the shared Keychain entitlement from that ad-hoc
development bundle so it can launch, but AutoFill cannot read the encrypted
database in that mode.

Skip installation:
```bash
cd /Users/x/code/pass/apps/app_macos
SKIP_INSTALL=1 ./scripts/package_app.sh
```

Skip auto launch:
```bash
cd /Users/x/code/pass/apps/app_macos
RUN_AFTER_INSTALL=0 ./scripts/package_app.sh
```

## Data files
- SQLite (WAL) data: `~/Library/Group Containers/group.com.pass.desktop.shared/pass-mac/pass.db`
- CSV export: `~/Library/Group Containers/group.com.pass.desktop.shared/pass-mac/pass-export-*.csv`
- If a historical audit record cannot be authenticated, the app leaves accounts,
  folders, and passkeys untouched, copies the original encrypted BLOB to
  `~/Library/Group Containers/group.com.pass.desktop.shared/pass-mac/corrupt-data-backups/`,
  and rebuilds only `history` as an empty encrypted collection. This prevents a
  startup error from recurring while retaining the damaged bytes for offline
  investigation. Always copy `pass.db`, `pass.db-wal`, and `pass.db-shm` before
  any manual recovery.
- Legacy bootstrap (one-time migration source, if present):
  - `~/Library/Application Support/pass-mac/accounts.json`
  - `~/Library/Application Support/pass-mac/passkeys.json`
