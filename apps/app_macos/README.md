# app_macos

Runnable macOS desktop app (SwiftUI) for local password management demo.

## Features
- Set and persist device name in `PassMac > Settings...`.
- Create account manually (site + username + password).
- Auto-sync alias domains across connected accounts (overlapping sites -> union).
- Edit stored account fields (sites/username/password/totp/recovery/note).
- Recycle bin view with restore and permanent delete.
- Generate demo accounts.
- Export local data to CSV.
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

## Build .app bundle
```bash
cd /Users/x/code/pass/apps/app_macos
./scripts/package_app.sh
```

Generated bundle:
- `/Users/x/code/pass/apps/app_macos/dist/PassMac.app`
- `/Applications/PassMac.app`（默认自动安装）
- 安装后默认先关闭旧 `PassMac` 进程，再自动运行新版本

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
- SQLite (WAL) data: `~/Library/Application Support/pass-mac/pass.db`
- CSV export: `~/Library/Application Support/pass-mac/pass-export-*.csv`
- Legacy bootstrap (one-time migration source, if present):
  - `~/Library/Application Support/pass-mac/accounts.json`
  - `~/Library/Application Support/pass-mac/passkeys.json`
