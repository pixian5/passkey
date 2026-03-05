#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_NAME="PassMac"
DIST_DIR="${APP_ROOT}/dist"
APP_BUNDLE="${DIST_DIR}/${APP_NAME}.app"
INSTALL_DIR="/Applications"
INSTALL_BUNDLE="${INSTALL_DIR}/${APP_NAME}.app"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
RUN_AFTER_INSTALL="${RUN_AFTER_INSTALL:-1}"

echo "[1/7] Building release binary..."
cd "${APP_ROOT}"
swift build -c release --product "${APP_NAME}"

echo "[2/7] Locating built binary..."
BIN_PATH="$(find "${APP_ROOT}/.build" -type f -path "*/release/${APP_NAME}" | head -n 1 || true)"
if [[ -z "${BIN_PATH}" ]]; then
  echo "Failed to locate release binary for ${APP_NAME}" >&2
  exit 1
fi

echo "[3/7] Creating app bundle..."
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources"
cp -f "${BIN_PATH}" "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
chmod +x "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"

cat > "${APP_BUNDLE}/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>PassMac</string>
  <key>CFBundleIdentifier</key>
  <string>com.pass.desktop</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>PassMac</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

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
