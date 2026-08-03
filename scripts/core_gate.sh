#!/usr/bin/env bash
# Gate for shared-core work: merge parity, domain FFI, unit tests, extension tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
  configured_target_dir="${CARGO_TARGET_DIR}"
  if [[ "${configured_target_dir}" = /* ]]; then
    mkdir -p "${configured_target_dir}"
    CARGO_TARGET_DIR="$(cd "${configured_target_dir}" && pwd)"
  else
    mkdir -p "${ROOT}/${configured_target_dir}"
    CARGO_TARGET_DIR="$(cd "${ROOT}/${configured_target_dir}" && pwd)"
  fi
  export CARGO_TARGET_DIR
  CLEAN_TARGET_DIR=0
else
  CARGO_TARGET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pass-core-gate.XXXXXX")"
  export CARGO_TARGET_DIR
  CLEAN_TARGET_DIR=1
fi
cleanup() {
  if [[ "${CLEAN_TARGET_DIR}" == "1" ]]; then
    rm -rf "${CARGO_TARGET_DIR}"
  fi
}
trap cleanup EXIT
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
