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
PROJECT_TEAM="$(awk -F ' = ' '/DEVELOPMENT_TEAM =/{gsub(/;/, "", $2); print $2; exit}' "${PROJECT_DIR}/PassSafari.xcodeproj/project.pbxproj")"
BUILD_UNSIGNED=false

if [[ "${1:-}" == "--unsigned" ]]; then
  BUILD_UNSIGNED=true
elif [[ $# -ne 0 ]]; then
  echo "用法: $0 [--unsigned]" >&2
  exit 64
fi

if [[ -z "${PROJECT_TEAM}" ]]; then
  echo "无法从 Xcode 项目读取 DEVELOPMENT_TEAM。" >&2
  exit 1
fi

has_signing_identity_for_team() {
  local identity certificate_team
  while IFS= read -r identity; do
    # 证书名称末尾是开发者标识，团队标识应读取证书主题的 OU 字段。
    certificate_team="$(security find-certificate -c "${identity}" -p 2>/dev/null \
      | openssl x509 -noout -subject -nameopt sep_multiline 2>/dev/null \
      | sed -n 's/^[[:space:]]*OU[[:space:]]*=[[:space:]]*//p')" || continue
    if [[ "${certificate_team}" == "${PROJECT_TEAM}" ]]; then
      return 0
    fi
  done < <(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*\"\(Apple Development:.*\)\"/\1/p')
  return 1
}

if ! ${BUILD_UNSIGNED} && ! has_signing_identity_for_team; then
  cat >&2 <<EOF
无法执行带签名安装：钥匙串中没有团队 ${PROJECT_TEAM} 的 Apple Development 证书及私钥。
请登录该 Apple Developer 团队并在 Xcode 下载/创建开发证书，再重新运行本脚本。
仅验证源代码能否编译可使用：$0 --unsigned
无签名 .app 不会安装到 /Applications，不能据此确认原团队扩展已更新。
独立临时扩展测试需另行加载资源，并单独记录结果。
EOF
  exit 1
fi

"${ROOT_DIR}/../../scripts/sync-pass-icons.sh"

chmod -R u+w "${DERIVED_DATA}" 2>/dev/null || true
find "${DERIVED_DATA}" -depth -exec rm -rf {} + 2>/dev/null || true
rm -rf "${DERIVED_DATA}"

cd "${SHARED_DIR}"
npm ci
npm run build

cd "${PROJECT_DIR}"
build_args=(
  -project PassSafari.xcodeproj \
  -scheme PassSafari \
  -configuration Debug \
  -derivedDataPath "${DERIVED_DATA}" \
)
if ${BUILD_UNSIGNED}; then
  build_args+=(CODE_SIGNING_ALLOWED=NO)
fi
xcodebuild "${build_args[@]}" build

if [[ ! -d "${APP_PATH}" ]]; then
  echo "构建产物不存在: ${APP_PATH}"
  exit 1
fi

if ${BUILD_UNSIGNED}; then
  echo "无签名编译成功: ${APP_PATH}"
  exit 0
fi

codesign --verify --deep --strict "${APP_PATH}"
# 构建成功后再结束旧程序；确认退出才允许替换安装包。
pkill -TERM -x "${APP_NAME}" >/dev/null 2>&1 || true
sleep 1
if pgrep -x "${APP_NAME}" >/dev/null; then
  pkill -KILL -x "${APP_NAME}" >/dev/null 2>&1 || true
  sleep 1
fi
if pgrep -x "${APP_NAME}" >/dev/null; then
  echo "旧 ${APP_NAME} 仍在运行，已停止替换安装包。" >&2
  exit 1
fi

rm -rf "${INSTALL_PATH}"
cp -R "${APP_PATH}" "${INSTALL_PATH}"
"${LSREGISTER}" -f -R -trusted "${INSTALL_PATH}"
"${LSREGISTER}" -u "${APP_PATH}" >/dev/null 2>&1 || true
rm -rf "${APP_PATH}" "${BUILD_APPEX_PATH}"

open "${INSTALL_PATH}"

echo "已构建、安装并启动: ${INSTALL_PATH}"
