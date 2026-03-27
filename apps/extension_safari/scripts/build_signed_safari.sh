#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="${ROOT_DIR}/PassSafari"
CERT_NAME="${PASS_SAFARI_CERT_NAME:-Pass Local Code Signing}"
APP_NAME="PassSafari"
DERIVED_DATA="${PROJECT_DIR}/build"
APP_PATH="${DERIVED_DATA}/Build/Products/Debug/${APP_NAME}.app"
APPEX_PATH="${DERIVED_DATA}/Build/Products/Debug/${APP_NAME} Extension.appex"

"${ROOT_DIR}/scripts/create_self_signed_cert.sh" "${CERT_NAME}"

CERT_HASH="$(
  security find-identity -v -p codesigning |
  awk -v cert="\"${CERT_NAME}\"" '$0 ~ cert { print $2; exit }'
)"

if [[ -z "${CERT_HASH}" ]]; then
  echo "未找到可用代码签名身份: ${CERT_NAME}"
  exit 1
fi

pkill -9 -x "${APP_NAME}" >/dev/null 2>&1 || true
rm -rf "${DERIVED_DATA}"

cd "${PROJECT_DIR}"
xcodebuild \
  -project PassSafari.xcodeproj \
  -scheme PassSafari \
  -configuration Debug \
  -derivedDataPath "${DERIVED_DATA}" \
  CODE_SIGNING_ALLOWED=NO \
  build

if [[ ! -d "${APP_PATH}" || ! -d "${APPEX_PATH}" ]]; then
  echo "构建产物不存在，签名中止。"
  exit 1
fi

codesign --force --deep --sign "${CERT_HASH}" --timestamp=none "${APPEX_PATH}"
codesign --force --deep --sign "${CERT_HASH}" --timestamp=none "${APP_PATH}"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

open -a "${APP_PATH}"

echo "已构建并启动: ${APP_PATH}"
