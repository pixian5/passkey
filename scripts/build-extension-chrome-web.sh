#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="${ROOT_DIR}/apps/extension_shared"
TARGET_DIR="${ROOT_DIR}/apps/extension_chrome_web"
TAURI_DIR="${ROOT_DIR}/apps/codex-tauri"

if [[ ! -f "${SOURCE_DIR}/dist/background.js" || ! -f "${SOURCE_DIR}/dist/options.js" ]]; then
  echo "缺少共享扩展构建产物，请先执行：cd ${SOURCE_DIR} && npm run build" >&2
  exit 1
fi

# Shared management UI comes only from Tauri/Web sources.
node "${TAURI_DIR}/scripts/sync-web-ui.mjs"

mkdir -p "${TARGET_DIR}/dist" "${TARGET_DIR}/icons" "${TARGET_DIR}/vendor"
cp -p "${SOURCE_DIR}"/dist/*.js "${TARGET_DIR}/dist/"
cp -p "${SOURCE_DIR}"/icons/icon-*.png "${TARGET_DIR}/icons/"

if [[ -f "${TAURI_DIR}/node_modules/jsqr/dist/jsQR.js" ]]; then
  cp -p "${TAURI_DIR}/node_modules/jsqr/dist/jsQR.js" "${TARGET_DIR}/vendor/jsQR.js"
elif [[ -f "${TAURI_DIR}/dist/vendor/jsQR.js" ]]; then
  cp -p "${TAURI_DIR}/dist/vendor/jsQR.js" "${TARGET_DIR}/vendor/jsQR.js"
fi

cp -p "${ROOT_DIR}/core/pass_core/js/sync_merge_core.js" "${TARGET_DIR}/sync_merge_core.js"
cp -p "${ROOT_DIR}/core/pass_core/js/sync_policy.js" "${TARGET_DIR}/sync_policy.js"

echo "Pass Web 预览扩展已刷新：${TARGET_DIR}"
