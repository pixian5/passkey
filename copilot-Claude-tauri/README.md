# Pass - Password Manager (Tauri Edition)

Cross-platform password manager built with Tauri 2, Rust, and TypeScript.

## Features

- 🔐 **Secure Storage**: SQLite database with WAL mode
- 🔒 **Master Password Protection**: Bcrypt-hashed authentication
- 🔑 **Password Management**: Create, edit, delete, and organize passwords
- 📁 **Folder Organization**: Categorize accounts with folders
- 🔍 **Full-Text Search**: Quick account lookup
- 🔐 **TOTP Support**: Two-factor authentication code generation
- 🗑️ **Recycle Bin**: Soft delete with restore capability
- 🔄 **Cloud Sync**: WebDAV and self-hosted server support
- 📤 **Import/Export**: CSV format support
- 🎨 **Modern UI**: Clean, responsive interface

## Architecture

### Backend (Rust)
- **Tauri 2**: Desktop application framework
- **rusqlite**: SQLite database with WAL journaling
- **bcrypt**: Password hashing
- **totp-lite**: TOTP code generation
- **reqwest**: HTTP client for sync
- **pass_core**: Shared Rust crates for domain models, merge logic, and storage

### Frontend (TypeScript + HTML/CSS)
- **Vanilla TypeScript**: No framework dependencies
- **Tauri API**: Native system integration
- **Responsive Design**: Grid-based layout

## Project Structure

```
copilot-Claude-tauri/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs        # Entry point
│   │   ├── lib.rs         # App state and data models
│   │   ├── commands.rs    # Tauri command handlers
│   │   ├── database.rs    # SQLite operations
│   │   ├── crypto.rs      # Password hashing
│   │   ├── totp.rs        # TOTP generation
│   │   ├── sync.rs        # Cloud sync logic
│   │   └── models.rs      # Data structures
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri configuration
├── src/
│   ├── main.ts            # Frontend application logic
│   └── styles.css         # UI styles
├── index.html             # Application shell
├── package.json           # Node dependencies
└── README.md              # This file
```

## Installation

### Prerequisites

- Rust 1.70+ and Cargo
- Node.js 16+ and npm
- Platform-specific dependencies:
  - **Linux**: `webkit2gtk`, `libsoup`, `libjavascriptcoregtk`
    ```bash
    sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev
    ```
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio C++ Build Tools

### Build Instructions

1. **Install dependencies**:
   ```bash
   cd copilot-Claude-tauri
   npm install
   ```

2. **Development mode**:
   ```bash
   npm run tauri dev
   ```

3. **Production build**:
   ```bash
   npm run tauri build
   ```

   Binaries will be in `src-tauri/target/release/bundle/`

## Usage

### First Launch

1. Enter a **master password** to initialize the database
2. Database will be created at `~/.pass/pass.db`

### Managing Passwords

- **Add Account**: Click "+ New Account" button
- **Edit Account**: Click on any account card
- **Search**: Use the search box in the header
- **Folders**: Organize accounts using the sidebar

### Synchronization

1. Configure sync backend (WebDAV or Self-Hosted)
2. Click "🔄 Sync" to push/pull changes
3. Enable auto-sync for periodic synchronization

### Data Management

- **Export**: `File > Export to CSV`
- **Import**: `File > Import from CSV`
- **Backup**: Copy `~/.pass/` directory

## Security

- **Encryption**: Master password is bcrypt-hashed (cost 12)
- **Storage**: SQLite database with WAL journaling
- **Network**: HTTPS for sync, optional bearer token auth
- **Memory**: Sensitive data cleared on lock

## Platform Support

- ✅ **Windows**: 10/11 (x86_64)
- ✅ **macOS**: 10.15+ (Intel and Apple Silicon)
- ✅ **Linux**: Ubuntu 20.04+, Debian 11+, Fedora 36+

## Development

### Rust Backend

Commands are defined in `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
async fn get_all_accounts(state: State<'_, AppState>) -> Result<Vec<PasswordAccount>, String> {
    // Implementation
}
```

### TypeScript Frontend

Invoke Rust commands from TypeScript:

```typescript
import { invoke } from "@tauri-apps/api/core";

const accounts = await invoke<PasswordAccount[]>("get_all_accounts", {
  includeDeleted: false
});
```

## Troubleshooting

### Build Errors

- Ensure all system dependencies are installed
- Clear build cache: `cargo clean` and `rm -rf node_modules`

### Database Issues

- Delete `~/.pass/pass.db` to start fresh
- Check file permissions on database directory

### Sync Failures

- Verify network connectivity
- Check WebDAV URL and credentials
- Review server logs for self-hosted backend

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## Credits

Built with:
- [Tauri](https://tauri.app/)
- [Rust](https://www.rust-lang.org/)
- [TypeScript](https://www.typescriptlang.org/)
