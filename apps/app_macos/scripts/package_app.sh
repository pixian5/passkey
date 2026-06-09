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
  codesign --force --deep --sign - "${APP_BUNDLE}" >/dev/null 2>&1 || true
else
  echo "[4/7] codesign not found, skipping signature step."
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
