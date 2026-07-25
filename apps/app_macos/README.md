# app_macos（平台系统能力与旧 SwiftUI 参考）

This module remains buildable for macOS AutoFill, Credential Exchange, migration,
and compatibility verification. The current cross-platform desktop product is
`apps/codex-tauri`; new shared management features should not be added here.

Remote sync may use AES-256-GCM with an independent local sync key, or plaintext `pass.sync.bundle.v2` when the key is left empty. Secrets are stored as 0600 files in the shared app-group directory, so normal launches do not access or prompt for the macOS Keychain. A legacy Keychain item, when present, is read once without UI and migrated to the file store. The sync key is never sent to the server; when encryption is used, browser extensions and other platforms must share the same key. Leaving the key empty enables plaintext sync/export (passwords may be exposed on the wire or in files—only use on trusted paths). The self-hosted server is the default primary source; WebDAV/iCloud can be selected as mirrors or the primary source, and preview never writes data.

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
- In Settings, use `接入服务器` to install or update the self-hosted sync service over the system `/usr/bin/ssh` client. The SSH username defaults to `root`; password/private-key credentials are encrypted in the local app-group file store and are saved per server host for reuse.
- Display all shown timestamps in `yy-M-d H:m:s` style (e.g. `26-3-14 9:2:8`).

## Run（推荐）
开发测试版请优先打成 `.app` 安装到“应用程序”并前台启动，避免 `swift run` 与访达安装副本混用：

```bash
cd /Users/x/code/pass/apps/app_macos
./scripts/package_app.sh
```

脚本会：结束旧 `PassMac` → Release 构建 → 写入 `dist/PassMac.app` → 复制到 `/Applications/PassMac.app` → `open` 启动。

## 快速调试
```bash
cd /Users/x/code/pass/apps/app_macos
./scripts/build_pass_core_ffi.sh   # 同步合并依赖 Rust dylib
swift run PassMac
```

开发时会从 `Vendor/pass_core_ffi/` 或 `core/pass_core/target/release/` 动态加载 `libpass_core_ffi.dylib`。  
强制回退旧 Swift 合并：`PASS_USE_SWIFT_MERGE=1`。

## Build
```bash
cd /Users/x/code/pass/apps/app_macos
./scripts/build_pass_core_ffi.sh
swift build
```

## 同步合并（Rust Core）

- 默认同步 merge / safety 走 `pass_merge::v2`（`pass-core-ffi`）。
- 加载或调用失败时自动回退 Swift 实现，并写 `NSLog`。
- 架构说明见 [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)。



## 本地写入一致性（1.1.1）

- 账号 / 文件夹 / Passkey 核心合并导入走 `saveCoreCollectionsAtomically`（SQLite 事务）。
- 单集合保存失败会从磁盘恢复内存，避免界面显示未落盘数据。
- 主密码启用/校验不 `trim`。
- SSH 部署路径使用 shell quote。
- 该模块是旧 Swift 参考与系统能力实现；共享管理功能以 Tauri 为准。

## 安全说明（开发测试版）
- 主窗口、设置、新建账号、历史窗口都套了 AppLock 门禁。
- AutoFill 扩展不再无交互直接出密，会要求用户确认。
- 本地备份脚本不再把 `pass-db-key-v1` 与加密库放在同一目录；恢复时需单独提供密钥。
- 同步加密密钥可选：填写 256 位密钥则端到端加密，留空则明文同步/导出（仅建议可信环境）；CSV 导出会对 `=+-@` 等公式前缀做防护。

## Xcode
- 所有开发和打包均使用包含 AutoFill 扩展的 [`project.autofill.yml`](/Users/x/code/pass/apps/app_macos/project.autofill.yml)。`package_app.sh` 会自动重新生成该工程，避免扩展被遗漏。
- 手动生成工程：
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
app and extension share the database key through the app-group file store.
The local development bundle is ad-hoc signed without the main-app sandbox so
the `接入服务器` action can launch the system `/usr/bin/ssh` and `/usr/bin/scp`.
Production distribution should use a signed helper or another approved SSH
transport instead of reusing this development entitlement set.
Local verification can use `CODE_SIGNING_ALLOWED=NO`; the packaging script
still removes the obsolete shared Keychain entitlement from ad-hoc development
bundles.

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
- Local database key: `~/Library/Group Containers/group.com.pass.desktop.shared/pass-mac/pass-db-key-v1` (0600)
- Sync credentials: `~/Library/Group Containers/group.com.pass.desktop.shared/pass-mac/sync-credentials-v1.json` (0600)
- App Lock verifier: `~/Library/Group Containers/group.com.pass.desktop.shared/pass-mac/app-lock-credential-v1.json` (0600)
- Existing `sync-secrets.json` is migrated first and deleted only after the new file is written successfully.
- Sync credentials and App Lock verifier are encrypted with the local database key before being written to their 0600 files.
- SSH host keys are kept in `ssh-known-hosts`; new keys are accepted once and changed keys are rejected by OpenSSH. Server provisioning requires root or passwordless sudo. When the server URL contains an explicit HTTPS port (for example `https://uk.sbbz.tech:5443`), the server must have `/etc/bz/certs/server.crt` and `/etc/bz/certs/server.key`; deployment copies them into the service-only TLS directory, listens publicly on that port, opens the port when UFW is active, and backs up the existing SQLite database before restarting the service. A URL without an explicit port keeps the backend on `127.0.0.1:53333` and requires an already configured HTTPS reverse proxy.
- If the database or its key cannot be read, the app does not fall back to the smaller legacy JSON store or create a replacement database key.
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
