#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="${ROOT_DIR}/apps/extension_shared"
TARGET_DIR="${ROOT_DIR}/apps/extension_chrome_web"

if [[ ! -f "${SOURCE_DIR}/dist/background.js" || ! -f "${SOURCE_DIR}/dist/options.js" ]]; then
  echo "缺少共享扩展构建产物，请先执行：cd ${SOURCE_DIR} && npm run build" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}/dist" "${TARGET_DIR}/icons"
cp -p "${SOURCE_DIR}"/dist/*.js "${TARGET_DIR}/dist/"
cp -p "${SOURCE_DIR}"/icons/icon-*.png "${TARGET_DIR}/icons/"

echo "Pass Web 预览扩展已刷新：${TARGET_DIR}"
