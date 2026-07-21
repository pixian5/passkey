#!/usr/bin/env bash
# Smoke: load libpass_core_ffi and merge two minimal payloads.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="${ROOT}/core/pass_core"
DYLIB_RELEASE="${CORE}/target/release/libpass_core_ffi.dylib"
DYLIB_VENDOR="${ROOT}/apps/app_macos/Vendor/pass_core_ffi/libpass_core_ffi.dylib"

"${ROOT}/apps/app_macos/scripts/build_pass_core_ffi.sh" >/dev/null

DYLIB="${DYLIB_VENDOR}"
if [[ ! -f "${DYLIB}" ]]; then
  DYLIB="${DYLIB_RELEASE}"
fi
if [[ ! -f "${DYLIB}" ]]; then
  echo "dylib not found" >&2
  exit 1
fi

python3 - "${DYLIB}" <<'PY'
import ctypes, json, sys
path = sys.argv[1]
lib = ctypes.CDLL(path)
lib.pass_core_merge_sync_payloads_json.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
lib.pass_core_merge_sync_payloads_json.restype = ctypes.c_void_p
lib.pass_core_string_free.argtypes = [ctypes.c_void_p]
lib.pass_core_string_free.restype = None
lib.pass_core_last_error_message.argtypes = []
lib.pass_core_last_error_message.restype = ctypes.c_char_p

local = {
  "accounts": [{
    "id": "11111111-1111-1111-1111-111111111111",
    "recordId": "11111111-1111-1111-1111-111111111111",
    "accountId": "a1",
    "canonicalSite": "example.com",
    "usernameAtCreate": "u",
    "sites": ["example.com"],
    "username": "u",
    "password": "p1",
    "totpSecret": "",
    "recoveryCodes": "",
    "note": "",
    "passkeyCredentialIds": [],
    "usernameUpdatedAtMs": 1,
    "usernameUpdatedDeviceName": "L",
    "passwordUpdatedAtMs": 10,
    "passwordUpdatedDeviceName": "L",
    "totpUpdatedAtMs": 1,
    "totpUpdatedDeviceName": "L",
    "recoveryCodesUpdatedAtMs": 1,
    "recoveryCodesUpdatedDeviceName": "L",
    "noteUpdatedAtMs": 1,
    "noteUpdatedDeviceName": "L",
    "passkeyUpdatedAtMs": 1,
    "passkeyUpdatedDeviceName": "L",
    "isDeleted": False,
    "isPermanentlyDeleted": False,
    "deletedDeviceName": "",
    "createdAtMs": 1,
    "updatedAtMs": 10,
    "lastOperatedDeviceName": "L",
    "createdDeviceName": "L",
  }],
  "folders": [],
  "passkeys": [],
}
remote = json.loads(json.dumps(local))
remote["accounts"][0]["password"] = "p2"
remote["accounts"][0]["passwordUpdatedAtMs"] = 20
remote["accounts"][0]["updatedAtMs"] = 20
remote["accounts"][0]["lastOperatedDeviceName"] = "R"
remote["accounts"][0]["passwordUpdatedDeviceName"] = "R"

local_s = json.dumps(local).encode()
remote_s = json.dumps(remote).encode()
ptr = lib.pass_core_merge_sync_payloads_json(local_s, remote_s)
if not ptr:
    err = lib.pass_core_last_error_message()
    raise SystemExit(f"merge failed: {err!r}")
merged = ctypes.string_at(ptr).decode()
lib.pass_core_string_free(ptr)
obj = json.loads(merged)
pw = obj["accounts"][0]["password"]
assert pw == "p2", pw
print("smoke OK: Rust merge via pass-core-ffi prefers newer password")
print(f"dylib: {path}")
PY
