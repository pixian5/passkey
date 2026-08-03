#!/usr/bin/env bash
# Build pass-core-ffi and stage the dylib for PassMac packaging / local runs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${APP_ROOT}/../.." && pwd)"
CORE_DIR="${ROOT_DIR}/core/pass_core"
VENDOR_DIR="${APP_ROOT}/Vendor/pass_core_ffi"
PROFILE="${PASS_CORE_FFI_PROFILE:-release}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required to build pass-core-ffi" >&2
  exit 1
fi

echo "[pass-core-ffi] building (${PROFILE})..."
cd "${CORE_DIR}"
if [[ "${PROFILE}" == "debug" ]]; then
  cargo build -p pass-core-ffi
  BUILT="${CARGO_TARGET_DIR:-${CORE_DIR}/target}/debug/libpass_core_ffi.dylib"
else
  cargo build -p pass-core-ffi --release
  BUILT="${CARGO_TARGET_DIR:-${CORE_DIR}/target}/release/libpass_core_ffi.dylib"
fi

if [[ ! -f "${BUILT}" ]]; then
  echo "missing built library: ${BUILT}" >&2
  exit 1
fi

mkdir -p "${VENDOR_DIR}"
cp -f "${BUILT}" "${VENDOR_DIR}/libpass_core_ffi.dylib"
# Stable install name for bundling under @rpath / Frameworks.
if command -v install_name_tool >/dev/null 2>&1; then
  install_name_tool -id "@rpath/libpass_core_ffi.dylib" "${VENDOR_DIR}/libpass_core_ffi.dylib" 2>/dev/null || true
fi

echo "[pass-core-ffi] staged: ${VENDOR_DIR}/libpass_core_ffi.dylib"
