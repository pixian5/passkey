# pass_core

Shared Rust core for the cross-platform password manager.

Current crates:
- `pass-domain`: core data model types.
- `pass-merge`: operation comparison and merge rules.
- `pass-storage`: SQL schema embedding helpers.
- `pass-transport`: sync protocol data contracts.
- `pass-csvio`: CSV normalization helpers.
- `pass-core-ffi`: minimal C ABI entry points for host apps.

Shared JS modules:
- `js/sync_merge_core.js`: sync payload merge/conflict kernel used by extension sync flows.
