#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/apps/extension_firefox/build"
XPI_PATH="${OUT_DIR}/pass-firefox.xpi"
STAGE_DIR="${OUT_DIR}/stage"

cd "${ROOT_DIR}/apps/extension_shared"
npm install
npm run build

mkdir -p "${OUT_DIR}"
rm -f "${XPI_PATH}"
rm -rf "${STAGE_DIR}"
rsync -aL \
  --exclude '.DS_Store' \
  --exclude 'node_modules' \
  --exclude 'build' \
  "${ROOT_DIR}/apps/extension_firefox/" \
  "${STAGE_DIR}/"
cd "${STAGE_DIR}"
zip -qr "${XPI_PATH}" .
rm -rf "${STAGE_DIR}"

echo "Firefox 扩展已构建: ${XPI_PATH}"
