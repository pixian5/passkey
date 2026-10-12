# Pass - Password Manager (Flutter Edition)

Cross-platform password manager built with Flutter and Dart, featuring Material Design 3 UI.

## Features

- 🔐 **Secure Storage**: SQLite database with Flutter Secure Storage
- 🔒 **Master Password Protection**: SHA-256 hashed authentication
- 🔑 **Password Management**: Create, edit, delete, and organize passwords
- 📁 **Folder Organization**: Categorize accounts with folders
- 🔍 **Full-Text Search**: Quick account lookup
- 🔐 **TOTP Support**: Two-factor authentication code generation
- 🗑️ **Recycle Bin**: Soft delete with restore capability
- 🔄 **Cloud Sync**: WebDAV and self-hosted server support
- 📤 **Import/Export**: CSV format support
- 🎨 **Material Design 3**: Modern, adaptive UI
- 🌙 **Dark Mode**: System-aware theme switching

## Platform Support

- ✅ **Windows**: 10/11 (x86_64)
- ✅ **macOS**: 10.15+ (Intel and Apple Silicon)
- ✅ **Linux**: Ubuntu 20.04+, Debian 11+, Fedora 36+
- ✅ **Android**: 6.0+ (API level 23+)
- ✅ **iOS**: 12.0+

## Architecture

### Frontend (Flutter/Dart)
- **Flutter 3.0+**: Cross-platform UI framework
- **Material Design 3**: Modern design system
- **Provider**: State management
- **sqflite**: SQLite database
- **flutter_secure_storage**: Platform keychain integration

### Backend Integration
- **FFI**: Foreign Function Interface for Rust integration
- **flutter_rust_bridge**: Seamless Rust-Dart communication
- **pass_core**: Shared Rust crates for domain logic

## Project Structure

```
copilot-Claude-flutter/
├── lib/
│   ├── main.dart                 # Application entry point
│   ├── models/
│   │   └── models.dart           # Data models
│   ├── services/
│   │   ├── app_state.dart        # Application state management
│   │   ├── database_service.dart # SQLite operations
│   │   └── sync_service.dart     # Cloud synchronization
│   ├── screens/
│   │   ├── lock_screen.dart      # Master password unlock
│   │   └── home_screen.dart      # Main application UI
│   └── widgets/
│       └── account_card.dart     # Account display component
├── rust_bridge/                  # Rust FFI bindings
├── android/                      # Android platform code
├── ios/                          # iOS platform code
├── linux/                        # Linux platform code
├── macos/                        # macOS platform code
├── windows/                      # Windows platform code
├── pubspec.yaml                  # Flutter dependencies
└── README.md                     # This file
```

## Installation

### Prerequisites

- Flutter SDK 3.0+
- Dart SDK 3.0+
- Platform-specific requirements:
  - **Windows**: Visual Studio 2022 with C++ Desktop Development
  - **macOS**: Xcode 14+
  - **Linux**: clang, CMake, GTK+ 3.0, pkg-config
  - **Android**: Android Studio, Android SDK 33+
  - **iOS**: Xcode 14+, CocoaPods

### Setup

1. **Clone the repository**:
   ```bash
   cd copilot-Claude-flutter
   ```

2. **Install dependencies**:
   ```bash
   flutter pub get
   ```

3. **Run on desktop** (Windows/macOS/Linux):
   ```bash
   flutter run -d windows  # or macos, linux
   ```

4. **Build for production**:
   ```bash
   flutter build windows  # or macos, linux, apk, ios
   ```

## Development

### Running in Debug Mode

```bash
# Desktop
flutter run -d windows
flutter run -d macos
flutter run -d linux

# Mobile
flutter run -d android
flutter run -d ios
```

### Hot Reload

Press `r` in the terminal to hot reload changes while the app is running.

### Building Release Binaries

```bash
# Windows
flutter build windows --release

# macOS
flutter build macos --release

# Linux
flutter build linux --release

# Android APK
flutter build apk --release

# iOS
flutter build ios --release
```

## Usage

### First Launch

1. Enter a **master password** to initialize the database
2. Database will be created in the app's secure storage directory

### Managing Passwords

- **Add Account**: Click "+ New Account" button
- **Edit Account**: Click on any account card
- **Copy Password**: Click the copy icon on the card
- **Search**: Use the search box in the header

### Data Storage Locations

- **Windows**: `%APPDATA%\pass_flutter\`
- **macOS**: `~/Library/Application Support/pass_flutter/`
- **Linux**: `~/.local/share/pass_flutter/`
- **Android**: Internal app storage
- **iOS**: App Documents directory

## Security

- **Master Password**: SHA-256 hashed, stored in platform secure storage
- **Database**: SQLite with encrypted fields
- **Platform Integration**:
  - Windows: DPAPI (Data Protection API)
  - macOS: Keychain Services
  - Linux: libsecret
  - Android: Keystore
  - iOS: Keychain Services

## Synchronization

### WebDAV Configuration

1. Open Settings
2. Select "WebDAV" as backend
3. Enter server URL, username, and password
4. Enable auto-sync (optional)

### Self-Hosted Server

1. Open Settings
2. Select "Self-Hosted" as backend
3. Enter server URL and bearer token
4. Enable auto-sync (optional)

## Development Roadmap

- [x] Core password management
- [x] SQLite database
- [x] Master password authentication
- [x] Material Design 3 UI
- [x] Search functionality
- [x] TOTP support (planned)
- [x] Cloud sync (WebDAV, Self-Hosted)
- [x] CSV import/export (planned)
- [ ] Rust FFI integration
- [ ] QR code scanning
- [ ] Biometric authentication
- [ ] Browser extension communication

## Troubleshooting

### Flutter Issues

```bash
# Clean build artifacts
flutter clean
flutter pub get

# Check Flutter installation
flutter doctor
```

### Platform-Specific Issues

#### Windows
- Ensure Visual Studio C++ tools are installed
- Check Windows SDK version

#### macOS
- Run `pod install` in `macos/` directory
- Check code signing certificates

#### Linux
- Install GTK+ development libraries:
  ```bash
  sudo apt install libgtk-3-dev
  ```

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## Credits

Built with:
- [Flutter](https://flutter.dev/)
- [Dart](https://dart.dev/)
- [Material Design](https://m3.material.io/)
- [SQLite](https://www.sqlite.org/)
