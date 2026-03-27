#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

"${ROOT_DIR}/scripts/sync-pass-icons.sh"

cd "${ROOT_DIR}/apps/extension_shared"
npm install
npm run build

echo "Chrome 扩展共享构建完成: ${ROOT_DIR}/apps/extension_chrome"
