#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROOT_DIR="$(cd "${APP_ROOT}/../.." && pwd)"
APP_NAME="PassMac"
DIST_DIR="${APP_ROOT}/dist"
APP_BUNDLE="${DIST_DIR}/${APP_NAME}.app"
INSTALL_DIR="/Applications"
INSTALL_BUNDLE="${INSTALL_DIR}/${APP_NAME}.app"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
RUN_AFTER_INSTALL="${RUN_AFTER_INSTALL:-1}"

"${ROOT_DIR}/scripts/sync-pass-icons.sh"

cd "${APP_ROOT}"
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required to generate the App and AutoFill extension project." >&2
  exit 1
fi

echo "[1/9] Building pass-core-ffi for macOS merge..."
"${SCRIPT_DIR}/build_pass_core_ffi.sh"

echo "[2/9] Generating Xcode project with the AutoFill extension..."
xcodegen generate --spec "${APP_ROOT}/project.autofill.yml"

echo "[3/9] Building app bundle with Xcode..."
xcodebuild \
  -project "${APP_ROOT}/PassMac.xcodeproj" \
  -scheme "${APP_NAME}" \
  -configuration Release \
  -derivedDataPath "${APP_ROOT}/build/DerivedData" \
  CODE_SIGNING_ALLOWED="${CODE_SIGNING_ALLOWED:-NO}" \
  build

echo "[4/9] Locating built app bundle..."
BUILT_APP="${APP_ROOT}/build/DerivedData/Build/Products/Release/${APP_NAME}.app"
if [[ ! -d "${BUILT_APP}" ]]; then
  echo "Failed to locate release app bundle for ${APP_NAME}: ${BUILT_APP}" >&2
  exit 1
fi

echo "[5/9] Copying app bundle to dist and embedding pass-core-ffi..."
rm -rf "${APP_BUNDLE}"
mkdir -p "${DIST_DIR}"
ditto "${BUILT_APP}" "${APP_BUNDLE}"
FFI_DYLIB="${APP_ROOT}/Vendor/pass_core_ffi/libpass_core_ffi.dylib"
if [[ ! -f "${FFI_DYLIB}" ]]; then
  echo "missing ${FFI_DYLIB}; build_pass_core_ffi.sh should have created it" >&2
  exit 1
fi
mkdir -p "${APP_BUNDLE}/Contents/Frameworks"
cp -f "${FFI_DYLIB}" "${APP_BUNDLE}/Contents/Frameworks/libpass_core_ffi.dylib"
if command -v install_name_tool >/dev/null 2>&1; then
  install_name_tool -id "@rpath/libpass_core_ffi.dylib" \
    "${APP_BUNDLE}/Contents/Frameworks/libpass_core_ffi.dylib" 2>/dev/null || true
fi

if command -v codesign >/dev/null 2>&1; then
  echo "[6/9] Applying ad-hoc signature..."
  APP_ENTITLEMENTS="${APP_ROOT}/PassMac.entitlements"
  EXTENSION_ENTITLEMENTS="${APP_ROOT}/AutofillExtension/AutoFillExtension.entitlements"
  TEMP_ENTITLEMENTS_DIR=""
  if [[ "${CODE_SIGNING_ALLOWED:-NO}" == "NO" ]]; then
    # Ad-hoc signatures cannot satisfy a keychain access group containing an
    # AppIdentifierPrefix. Keep production entitlements in the source plist,
    # but remove that one entitlement from local development bundles.
    TEMP_ENTITLEMENTS_DIR="$(mktemp -d)"
    trap '[[ -n "${TEMP_ENTITLEMENTS_DIR}" ]] && rm -rf "${TEMP_ENTITLEMENTS_DIR}"' EXIT
    APP_ENTITLEMENTS="${TEMP_ENTITLEMENTS_DIR}/PassMac.entitlements"
    EXTENSION_ENTITLEMENTS="${TEMP_ENTITLEMENTS_DIR}/AutoFillExtension.entitlements"
    # The development app must launch the system ssh/scp binaries. macOS
    # rejects Process launches from a sandboxed parent, so use the dev
    # entitlement set without app-sandbox while keeping the app group.
    cp "${APP_ROOT}/PassMac.dev.entitlements" "${APP_ENTITLEMENTS}"
    cp "${APP_ROOT}/AutofillExtension/AutoFillExtension.entitlements" "${EXTENSION_ENTITLEMENTS}"
    if plutil -extract keychain-access-groups raw -o /dev/null "${APP_ENTITLEMENTS}" >/dev/null 2>&1; then
      plutil -remove keychain-access-groups "${APP_ENTITLEMENTS}"
    fi
    if plutil -extract keychain-access-groups raw -o /dev/null "${EXTENSION_ENTITLEMENTS}" >/dev/null 2>&1; then
      plutil -remove keychain-access-groups "${EXTENSION_ENTITLEMENTS}"
    fi
  fi
  if [[ -f "${APP_BUNDLE}/Contents/Frameworks/libpass_core_ffi.dylib" ]]; then
    codesign \
      --force \
      --sign - \
      "${APP_BUNDLE}/Contents/Frameworks/libpass_core_ffi.dylib" >/dev/null 2>&1 || true
  fi
  if [[ -d "${APP_BUNDLE}/Contents/PlugIns/PassAutoFillExtension.appex" ]]; then
    codesign \
      --force \
      --sign - \
      --entitlements "${EXTENSION_ENTITLEMENTS}" \
      "${APP_BUNDLE}/Contents/PlugIns/PassAutoFillExtension.appex" >/dev/null 2>&1 || true
  fi
  codesign \
    --force \
    --sign - \
    --entitlements "${APP_ENTITLEMENTS}" \
    "${APP_BUNDLE}" >/dev/null 2>&1 || true
else
  echo "[6/9] codesign not found, skipping signature step."
fi

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister"
if [[ -x "${LSREGISTER}" ]]; then
  "${LSREGISTER}" -f -R -trusted "${APP_BUNDLE}" >/dev/null 2>&1 || true
fi

if [[ "${SKIP_INSTALL}" != "1" ]]; then
  echo "[7/9] Closing existing ${APP_NAME} instance ..."
  osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
  pkill -x "${APP_NAME}" >/dev/null 2>&1 || true
  pkill -f "${INSTALL_BUNDLE}/Contents/MacOS/${APP_NAME}" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if ! pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done

  if pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
    pkill -9 -x "${APP_NAME}" >/dev/null 2>&1 || true
    sleep 0.2
  fi

  echo "[8/9] Installing app bundle to ${INSTALL_BUNDLE} ..."
  mkdir -p "${INSTALL_DIR}"
  rm -rf "${INSTALL_BUNDLE}"
  if ! ditto "${APP_BUNDLE}" "${INSTALL_BUNDLE}"; then
    echo "Install failed. You may need elevated permissions for ${INSTALL_DIR}." >&2
    exit 1
  fi
  echo "Installed: ${INSTALL_BUNDLE}"

  if [[ "${RUN_AFTER_INSTALL}" == "1" ]]; then
    echo "[9/9] Launching ${INSTALL_BUNDLE} ..."
    open -na "${INSTALL_BUNDLE}" || true

    for _ in {1..25}; do
      if pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
        break
      fi
      sleep 0.2
    done

    if ! pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
      echo "open launch not detected, fallback to direct binary launch..."
      nohup "${INSTALL_BUNDLE}/Contents/MacOS/${APP_NAME}" >/tmp/passmac-launch.log 2>&1 &
      sleep 0.5
    fi

    if pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
      echo "Launch success: ${APP_NAME} is running."
    else
      echo "Launch failed: ${APP_NAME} is not running." >&2
      exit 1
    fi
  else
    echo "[9/9] RUN_AFTER_INSTALL=0, skip launch."
    echo "[9/9] Done."
  fi
else
  echo "[7/9] SKIP_INSTALL=1, skip installation."
  echo "[8/9] Skip close old process because app is not installed in this run."
  echo "[9/9] Skip launch because app is not installed in this run."
fi

echo "Build artifact: ${APP_BUNDLE}"
