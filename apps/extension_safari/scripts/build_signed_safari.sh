#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="${ROOT_DIR}/PassSafari"
SHARED_DIR="$(cd "${ROOT_DIR}/../extension_shared" && pwd)"
APP_NAME="PassSafari"
DERIVED_DATA="${PROJECT_DIR}/build_apple"
APP_PATH="${DERIVED_DATA}/Build/Products/Debug/${APP_NAME}.app"
INSTALL_PATH="/Applications/${APP_NAME}.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
BUILD_APPEX_PATH="${DERIVED_DATA}/Build/Products/Debug/${APP_NAME} Extension.appex"

"${ROOT_DIR}/../../scripts/sync-pass-icons.sh"

pkill -9 -x "${APP_NAME}" >/dev/null 2>&1 || true
pkill -9 -x "Safari" >/dev/null 2>&1 || true
chmod -R u+w "${DERIVED_DATA}" 2>/dev/null || true
find "${DERIVED_DATA}" -depth -exec rm -rf {} + 2>/dev/null || true
rm -rf "${DERIVED_DATA}"

cd "${SHARED_DIR}"
npm install
npm run build

cd "${PROJECT_DIR}"
xcodebuild \
  -project PassSafari.xcodeproj \
  -scheme PassSafari \
  -configuration Debug \
  -derivedDataPath "${DERIVED_DATA}" \
  build

if [[ ! -d "${APP_PATH}" ]]; then
  echo "构建产物不存在: ${APP_PATH}"
  exit 1
fi

rm -rf "${INSTALL_PATH}"
cp -R "${APP_PATH}" "${INSTALL_PATH}"
"${LSREGISTER}" -f -R -trusted "${INSTALL_PATH}"
"${LSREGISTER}" -u "${APP_PATH}" >/dev/null 2>&1 || true
rm -rf "${APP_PATH}" "${BUILD_APPEX_PATH}"

open "${INSTALL_PATH}"

echo "已构建、安装并启动: ${INSTALL_PATH}"
