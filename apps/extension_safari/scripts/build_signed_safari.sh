#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="${ROOT_DIR}/PassSafari"
APP_NAME="PassSafari"
DERIVED_DATA="${PROJECT_DIR}/build_apple"
APP_PATH="${DERIVED_DATA}/Build/Products/Debug/${APP_NAME}.app"
INSTALL_PATH="/Applications/${APP_NAME}.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

pkill -9 -x "${APP_NAME}" >/dev/null 2>&1 || true
chmod -R u+w "${DERIVED_DATA}" 2>/dev/null || true
find "${DERIVED_DATA}" -depth -exec rm -rf {} + 2>/dev/null || true
rm -rf "${DERIVED_DATA}"

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

open "${INSTALL_PATH}"

echo "已构建、安装并启动: ${INSTALL_PATH}"
