# pass

Cross-platform password manager workspace.

## Current status
- Design docs completed in [`docs/`](/Users/x/code/pass/docs/README.md).
- Rust shared core workspace initialized in [`core/pass_core`](/Users/x/code/pass/core/pass_core/README.md).
- App scaffolds created:
  - [`apps/app_macos`](/Users/x/code/pass/apps/app_macos/README.md)
  - [`apps/app_flutter`](/Users/x/code/pass/apps/app_flutter/README.md)
  - [`apps/extension_chrome`](/Users/x/code/pass/apps/extension_chrome/README.md)
  - [`apps/sync_agent_desktop`](/Users/x/code/pass/apps/sync_agent_desktop/README.md)
  - [`apps/sync_server_ubuntu`](/Users/x/code/pass/apps/sync_server_ubuntu/README.md)

## Core crates
- `pass-domain`: model primitives (`Operation`, `TimeRange`, `HybridLogicalClock`).
- `pass-merge`: merge comparator and delete conflict resolution.
- `pass-storage`: embedded SQL schema migration file.
- `pass-transport`: sync protocol contract structs.
- `pass-csvio`: CSV site normalization helpers.
- `pass-core-ffi`: minimal C ABI exports.

## Local validation
```bash
cd core/pass_core
cargo test

cd /Users/x/code/pass/apps/app_macos
swift build

cd /Users/x/code/pass/apps/extension_chrome
node --check background.js
node --check popup.js
node --check options.js
```
