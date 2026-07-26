# pass_core

Shared Rust core for the cross-platform password manager.

## Crates

| Crate | Role |
| --- | --- |
| `pass-domain` | Core data model types (incl. experimental op-log primitives) |
| `pass-merge` | **Production** `pass.sync.bundle.v2` field-LWW merge (`pass_merge::v2`) + legacy op-log helpers |
| `pass-storage` | Candidate normalized SQL schema embedding; current Tauri/Swift/Web runtimes do not execute it |
| `pass-transport` | Sync protocol data contracts |
| `pass-csvio` | CSV normalization helpers |
| `pass-core-ffi` | C ABI for host apps (includes merge entry points) |

## Production merge authority (`pass_merge::v2`)

Cross-client sync merge for accounts / folders / passkeys lives in:

```text
crates/merge/src/v2/
```

This is the **shared-core source of truth** for merge semantics. macOS now
prefers the C ABI (`pass_core_merge_sync_payloads_json`) at runtime and keeps
Swift merge only as fallback. Browser JS (`js/sync_merge_core.js`) still ships a
parallel implementation and must stay aligned via parity tests until WASM.

### Public API (Rust)

```rust
use pass_merge::v2::{
    merge_sync_payloads, evaluate_sync_safety, SyncPayload,
};

let merged = merge_sync_payloads(local, remote);
let report = evaluate_sync_safety(&local, Some(&remote), &merged, "merge");
```

### CLI

```bash
cd core/pass_core
cargo build -p pass-merge --bin pass-merge-cli

# Merge two payload JSON files (accounts/folders/passkeys objects)
./target/debug/pass-merge-cli merge --local local.json --remote remote.json

# Or stdin wrapper
echo '{"local":{...},"remote":{...}}' | ./target/debug/pass-merge-cli merge --stdin
```

### C ABI (`pass-core-ffi`)

```c
char *pass_core_merge_sync_payloads_json(const char *local_json, const char *remote_json);
char *pass_core_evaluate_sync_safety_json(const char *local_json, const char *remote_json,
                                          const char *merged_json, const char *mode);
char *pass_core_sync_alias_groups_json(const char *accounts_json, const char *device_name,
                                       int64_t now_ms);
char *pass_core_normalize_domain(const char *input);
char *pass_core_etld_plus_one(const char *input);
char *pass_core_stable_uuid_from_text(const char *input);
char *pass_core_export_macos_csv_json(const char *accounts_json);
void  pass_core_string_free(char *ptr);
const char *pass_core_last_error_message(void);
```

`pass_core_sync_alias_groups_json` accepts a JSON account array (or
`{"accounts":[...]}`) and returns `{"accounts":[...],"changed":bool}`.
### Tests

```bash
cd core/pass_core
cargo test -p pass-merge
# JS ↔ Rust parity against docs/sync-golden-vectors.json
node js/check_merge_parity.mjs
```

## Shared JS modules

- `js/sync_merge_core.js` — extension-side merge kernel (must stay aligned with `pass_merge::v2`)
- `js/sync_policy.js` — policy constants shared with Swift `PassSyncPolicy`
- `js/check_merge_parity.mjs` — CLI parity harness
- `js/credential_exchange_cxf.js` — Credential Exchange helpers
