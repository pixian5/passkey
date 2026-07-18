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

echo "[1/7] Building app bundle with Xcode..."
cd "${APP_ROOT}"
xcodebuild \
  -project "${APP_ROOT}/PassMac.xcodeproj" \
  -scheme "${APP_NAME}" \
  -configuration Release \
  -derivedDataPath "${APP_ROOT}/build/DerivedData" \
  CODE_SIGNING_ALLOWED="${CODE_SIGNING_ALLOWED:-NO}" \
  build

echo "[2/7] Locating built app bundle..."
BUILT_APP="${APP_ROOT}/build/DerivedData/Build/Products/Release/${APP_NAME}.app"
if [[ ! -d "${BUILT_APP}" ]]; then
  echo "Failed to locate release app bundle for ${APP_NAME}: ${BUILT_APP}" >&2
  exit 1
fi

echo "[3/7] Copying app bundle to dist..."
rm -rf "${APP_BUNDLE}"
mkdir -p "${DIST_DIR}"
ditto "${BUILT_APP}" "${APP_BUNDLE}"

if command -v codesign >/dev/null 2>&1; then
  echo "[4/7] Applying ad-hoc signature..."
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
    cp "${APP_ROOT}/PassMac.entitlements" "${APP_ENTITLEMENTS}"
    cp "${APP_ROOT}/AutofillExtension/AutoFillExtension.entitlements" "${EXTENSION_ENTITLEMENTS}"
    if plutil -extract keychain-access-groups raw -o /dev/null "${APP_ENTITLEMENTS}" >/dev/null 2>&1; then
      plutil -remove keychain-access-groups "${APP_ENTITLEMENTS}"
    fi
    if plutil -extract keychain-access-groups raw -o /dev/null "${EXTENSION_ENTITLEMENTS}" >/dev/null 2>&1; then
      plutil -remove keychain-access-groups "${EXTENSION_ENTITLEMENTS}"
    fi
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
  echo "[4/7] codesign not found, skipping signature step."
fi

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister"
if [[ -x "${LSREGISTER}" ]]; then
  "${LSREGISTER}" -f -R -trusted "${APP_BUNDLE}" >/dev/null 2>&1 || true
fi

if [[ "${SKIP_INSTALL}" != "1" ]]; then
  echo "[5/7] Closing existing ${APP_NAME} instance ..."
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

  echo "[6/7] Installing app bundle to ${INSTALL_BUNDLE} ..."
  mkdir -p "${INSTALL_DIR}"
  rm -rf "${INSTALL_BUNDLE}"
  if ! ditto "${APP_BUNDLE}" "${INSTALL_BUNDLE}"; then
    echo "Install failed. You may need elevated permissions for ${INSTALL_DIR}." >&2
    exit 1
  fi
  echo "Installed: ${INSTALL_BUNDLE}"

  if [[ "${RUN_AFTER_INSTALL}" == "1" ]]; then
    echo "[7/7] Launching ${INSTALL_BUNDLE} ..."
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
    echo "[7/7] RUN_AFTER_INSTALL=0, skip launch."
    echo "[7/7] Done."
  fi
else
  echo "[5/7] SKIP_INSTALL=1, skip installation."
  echo "[6/7] Skip close old process because app is not installed in this run."
  echo "[7/7] Skip launch because app is not installed in this run."
fi

echo "Build artifact: ${APP_BUNDLE}"
