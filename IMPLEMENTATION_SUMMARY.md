# Pass - Cross-Platform Password Manager

## Project Overview

This repository now includes **Tauri** and **Flutter** implementations of the Pass password manager, complementing the existing macOS SwiftUI app and browser extensions.

## Implementations

### 1. Tauri (Windows/Ubuntu/macOS) - `copilot-Claude-tauri/`

**Technology Stack:**
- **Backend**: Rust with Tauri 2
- **Frontend**: Vanilla TypeScript + HTML/CSS
- **Database**: SQLite with WAL mode
- **Security**: bcrypt password hashing

**Key Features:**
- ✅ Master password authentication
- ✅ Account CRUD with full-text search
- ✅ TOTP support
- ✅ Folder organization
- ✅ WebDAV & self-hosted sync
- ✅ CSV import/export
- ✅ Recycle bin
- ✅ Integration with pass_core Rust crates

**Build & Run:**
```bash
cd copilot-Claude-tauri
npm install
npm run tauri dev      # Development mode
npm run tauri build    # Production build
```

**Architecture Highlights:**
- Direct integration with pass-domain, pass-merge, pass-storage crates
- Native SQLite operations via rusqlite
- TOTP generation with totp-lite
- HTTP sync via reqwest
- Small bundle size (~8-10 MB)

---

### 2. Flutter (Windows/Ubuntu/macOS/Android/iOS) - `copilot-Claude-flutter/`

**Technology Stack:**
- **Framework**: Flutter 3.0+
- **Language**: Dart
- **Database**: SQLite via sqflite
- **Security**: Flutter Secure Storage + SHA-256
- **UI**: Material Design 3

**Key Features:**
- ✅ Master password authentication
- ✅ Account CRUD with full-text search
- ✅ Material Design 3 UI
- ✅ Folder organization
- ✅ WebDAV & self-hosted sync
- ✅ Platform secure storage integration
- ✅ Dark mode support
- ✅ Responsive grid layout
- 🔄 TOTP support (architecture ready)
- 🔄 Rust FFI integration (architecture ready)

**Build & Run:**
```bash
cd copilot-Claude-flutter
flutter pub get
flutter run -d windows    # or macos, linux, android, ios
flutter build windows     # Production build
```

**Architecture Highlights:**
- Provider for state management
- SQLite with flutter_secure_storage
- Platform-specific keychain integration (DPAPI, Keychain, libsecret)
- Material Design 3 adaptive UI
- Ready for flutter_rust_bridge integration

---

## Feature Comparison Matrix

| Feature | macOS SwiftUI | Tauri | Flutter | Chrome Ext |
|---------|--------------|-------|---------|------------|
| **Password Management** | ✅ | ✅ | ✅ | ✅ |
| **TOTP** | ✅ | ✅ | 🔄 | ✅ |
| **Folders** | ✅ | ✅ | ✅ | ❌ |
| **Search** | ✅ | ✅ | ✅ | ✅ |
| **Recycle Bin** | ✅ | ✅ | ✅ | ❌ |
| **WebDAV Sync** | ✅ | ✅ | ✅ | ✅ |
| **Self-Hosted Sync** | ✅ | ✅ | ✅ | ✅ |
| **iCloud Sync** | ✅ | ❌ | ❌ | ❌ |
| **CSV Import/Export** | ✅ | ✅ | 🔄 | ✅ |
| **QR Import** | ✅ | 🔄 | 🔄 | ❌ |
| **Passkey Support** | ✅ | 🔄 | 🔄 | ✅ |
| **History/Undo** | ✅ | 🔄 | 🔄 | ✅ |
| **Auto-Sync** | ✅ | 🔄 | 🔄 | ✅ |

Legend: ✅ Implemented | 🔄 Architecture Ready | ❌ Not Applicable/Planned

---

## Platform Support Matrix

| Platform | Tauri | Flutter | SwiftUI | Browser Ext |
|----------|-------|---------|---------|-------------|
| **Windows 10/11** | ✅ | ✅ | ❌ | Chrome |
| **macOS 10.15+** | ✅ | ✅ | ✅ | Safari |
| **Ubuntu 20.04+** | ✅ | ✅ | ❌ | Chrome/Firefox |
| **Linux (Other)** | ✅ | ✅ | ❌ | Chrome/Firefox |
| **Android** | ❌ | ✅ | ❌ | ❌ |
| **iOS** | ❌ | ✅ | ❌ | ❌ |

---

## Shared Architecture

Both implementations leverage the existing **Rust Core** (`core/pass_core/`):

### Core Rust Crates

1. **pass-domain**: Data models, HLC, operations
   - `PasswordAccount`, `Operation`, `HybridLogicalClock`
   - Field-level tracking with timestamps

2. **pass-merge**: Conflict resolution
   - Three-way merge with HLC ordering
   - Causal operation tracking

3. **pass-storage**: SQLite schema helpers
   - Embedded SQL schema
   - Migration support

4. **pass-transport**: Sync protocol contracts
   - `pass.sync.bundle.v2` schema
   - WebDAV and self-hosted backends

5. **pass-csvio**: CSV import/export
   - Chrome/Firefox/Safari format support

6. **pass-core-ffi**: C ABI for cross-platform FFI
   - Exportable for Flutter/React Native

### Database Schema (Consistent Across Platforms)

```sql
-- Accounts
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  canonical_site TEXT NOT NULL,
  sites TEXT NOT NULL,              -- JSON array
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  totp_secret TEXT,
  recovery_codes TEXT,
  note TEXT,
  folder_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(folder_id) REFERENCES folders(id)
);

-- Folders
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  matched_sites TEXT NOT NULL,      -- JSON array
  auto_add_matching INTEGER NOT NULL DEFAULT 0
);

-- Sync Config
CREATE TABLE sync_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  backend_type TEXT NOT NULL,       -- 'webdav' or 'self-hosted'
  server_url TEXT NOT NULL,
  username TEXT,
  password TEXT,
  bearer_token TEXT,
  auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
  auto_sync_interval_minutes INTEGER NOT NULL DEFAULT 30
);
```

---

## Development Guidelines

### Code Organization

**Tauri:**
```
src-tauri/src/
├── lib.rs          # App state, data models
├── main.rs         # Entry point
├── commands.rs     # Tauri commands (frontend API)
├── database.rs     # SQLite operations
├── crypto.rs       # Password hashing
├── totp.rs         # TOTP generation
└── sync.rs         # Cloud synchronization
```

**Flutter:**
```
lib/
├── main.dart                # App entry point
├── models/models.dart       # Data models
├── services/
│   ├── app_state.dart       # State management
│   ├── database_service.dart # SQLite operations
│   └── sync_service.dart    # Cloud synchronization
├── screens/
│   ├── lock_screen.dart     # Authentication
│   └── home_screen.dart     # Main UI
└── widgets/
    └── account_card.dart    # Reusable components
```

### Adding New Features

1. **Add to Rust Core** (if domain logic):
   - Update `pass-domain` for new models
   - Update `pass-merge` for new conflict resolution
   - Update `pass-storage` for schema changes

2. **Add to Tauri**:
   - Add Rust command in `commands.rs`
   - Add TypeScript call in `main.ts`
   - Update UI in HTML/CSS

3. **Add to Flutter**:
   - Add method to `DatabaseService`
   - Add method to `AppState`
   - Update UI screens

---

## Testing

### Tauri Testing

```bash
cd copilot-Claude-tauri

# Run tests
cargo test --manifest-path=src-tauri/Cargo.toml

# Build and run
npm install
npm run tauri dev

# Production build
npm run tauri build
```

### Flutter Testing

```bash
cd copilot-Claude-flutter

# Run tests
flutter test

# Run on desktop
flutter run -d windows  # or macos, linux

# Build release
flutter build windows --release
```

---

## Security Considerations

### Tauri
- Master password: bcrypt hashed (cost 12)
- Storage: SQLite with WAL journaling
- Network: HTTPS only, bearer token auth
- Platform keystore: Via tauri-plugin-keychain (planned)

### Flutter
- Master password: SHA-256 hashed
- Storage: SQLite + flutter_secure_storage
- Platform keystore: Native integration
  - Windows: DPAPI
  - macOS: Keychain Services
  - Linux: libsecret
  - Android: Keystore
  - iOS: Keychain Services

---

## Future Enhancements

### Short Term
- [ ] Complete TOTP implementation in Flutter
- [ ] Add biometric authentication
- [ ] Implement auto-sync timers
- [ ] Add QR code scanning
- [ ] Complete Rust FFI bridge for Flutter

### Medium Term
- [ ] Browser extension communication protocol
- [ ] Cloud backup encryption
- [ ] Password health checker
- [ ] Import from other password managers
- [ ] Password generator with policies

### Long Term
- [ ] End-to-end encryption
- [ ] Team/family sharing
- [ ] Audit logs
- [ ] Browser extension auto-fill integration
- [ ] Mobile passkey support

---

## Deployment

### Tauri Distribution

**Windows:**
- `.msi` installer via WiX
- `.exe` portable executable

**macOS:**
- `.app` bundle
- `.dmg` disk image
- Code signing required for distribution

**Linux:**
- `.AppImage` portable
- `.deb` package for Debian/Ubuntu
- `.rpm` package for Fedora/RHEL

### Flutter Distribution

**Desktop:**
- Windows: `.exe` installer
- macOS: `.app` bundle (requires signing)
- Linux: `.snap`, `.deb`, `.rpm`, or `.AppImage`

**Mobile:**
- Android: `.apk` or Google Play Store
- iOS: App Store (requires Apple Developer account)

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit pull request

---

## License

MIT License - See LICENSE file for details

---

## Credits

- **Tauri**: https://tauri.app/
- **Flutter**: https://flutter.dev/
- **Rust**: https://www.rust-lang.org/
- **TypeScript**: https://www.typescriptlang.org/
- **Dart**: https://dart.dev/

---

## Contact & Support

For issues, questions, or contributions:
- GitHub Issues: https://github.com/pixian5/passkey/issues
- Discussions: https://github.com/pixian5/passkey/discussions
