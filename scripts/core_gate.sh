#!/usr/bin/env bash
# Gate for shared-core work: merge parity, domain FFI, unit tests, extension tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "${ROOT}/scripts/version.mjs" check
cd "${ROOT}/core/pass_core"
cargo test --workspace --quiet
cargo build -p pass-merge --bin pass-merge-cli --quiet
node js/check_merge_parity.mjs
"${ROOT}/scripts/check_domain_ffi.sh"
cd "${ROOT}/apps/extension_shared"
if [[ -d node_modules ]]; then
  npm test
else
  npm ci
  npm test
fi
echo "CORE_GATE_OK"
