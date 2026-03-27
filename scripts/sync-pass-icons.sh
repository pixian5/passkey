#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_PNG="${ROOT_DIR}/pass.jpeg"
EXTENSION_ICON_DIR="${ROOT_DIR}/apps/extension_shared/icons"
SAFARI_ROOT="${ROOT_DIR}/apps/extension_safari/PassSafari/PassSafari"
SAFARI_ICON_DIR="${SAFARI_ROOT}/Assets.xcassets/AppIcon.appiconset"
SAFARI_RESOURCE_ICON="${SAFARI_ROOT}/Resources/Icon.png"
APP_MACOS_RESOURCE_DIR="${ROOT_DIR}/apps/app_macos/Resources"
APP_MACOS_ICNS="${APP_MACOS_RESOURCE_DIR}/PassMac.icns"

if [[ ! -f "${SOURCE_PNG}" ]]; then
  echo "Missing icon source: ${SOURCE_PNG}" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

make_square_png() {
  local size="$1"
  local output="$2"
  sips -s format png "${SOURCE_PNG}" \
    --resampleHeightWidthMax "${size}" \
    --padToHeightWidth "${size}" "${size}" \
    --out "${output}" >/dev/null
}

mkdir -p "${EXTENSION_ICON_DIR}"
for size in 16 32 48 64 96 128; do
  make_square_png "${size}" "${EXTENSION_ICON_DIR}/icon-${size}.png"
done

mkdir -p "${SAFARI_ICON_DIR}"
make_square_png 512 "${SAFARI_RESOURCE_ICON}"

cat > "${SAFARI_ICON_DIR}/Contents.json" <<'EOF'
{
  "images" : [
    {
      "filename" : "icon_16x16.png",
      "idiom" : "mac",
      "scale" : "1x",
      "size" : "16x16"
    },
    {
      "filename" : "icon_16x16@2x.png",
      "idiom" : "mac",
      "scale" : "2x",
      "size" : "16x16"
    },
    {
      "filename" : "icon_32x32.png",
      "idiom" : "mac",
      "scale" : "1x",
      "size" : "32x32"
    },
    {
      "filename" : "icon_32x32@2x.png",
      "idiom" : "mac",
      "scale" : "2x",
      "size" : "32x32"
    },
    {
      "filename" : "icon_128x128.png",
      "idiom" : "mac",
      "scale" : "1x",
      "size" : "128x128"
    },
    {
      "filename" : "icon_128x128@2x.png",
      "idiom" : "mac",
      "scale" : "2x",
      "size" : "128x128"
    },
    {
      "filename" : "icon_256x256.png",
      "idiom" : "mac",
      "scale" : "1x",
      "size" : "256x256"
    },
    {
      "filename" : "icon_256x256@2x.png",
      "idiom" : "mac",
      "scale" : "2x",
      "size" : "256x256"
    },
    {
      "filename" : "icon_512x512.png",
      "idiom" : "mac",
      "scale" : "1x",
      "size" : "512x512"
    },
    {
      "filename" : "icon_512x512@2x.png",
      "idiom" : "mac",
      "scale" : "2x",
      "size" : "512x512"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF

make_square_png 16 "${SAFARI_ICON_DIR}/icon_16x16.png"
make_square_png 32 "${SAFARI_ICON_DIR}/icon_16x16@2x.png"
make_square_png 32 "${SAFARI_ICON_DIR}/icon_32x32.png"
make_square_png 64 "${SAFARI_ICON_DIR}/icon_32x32@2x.png"
make_square_png 128 "${SAFARI_ICON_DIR}/icon_128x128.png"
make_square_png 256 "${SAFARI_ICON_DIR}/icon_128x128@2x.png"
make_square_png 256 "${SAFARI_ICON_DIR}/icon_256x256.png"
make_square_png 512 "${SAFARI_ICON_DIR}/icon_256x256@2x.png"
make_square_png 512 "${SAFARI_ICON_DIR}/icon_512x512.png"
make_square_png 1024 "${SAFARI_ICON_DIR}/icon_512x512@2x.png"

mkdir -p "${APP_MACOS_RESOURCE_DIR}"
ICONSET_DIR="${TMP_DIR}/PassMac.iconset"
mkdir -p "${ICONSET_DIR}"
make_square_png 16 "${ICONSET_DIR}/icon_16x16.png"
make_square_png 32 "${ICONSET_DIR}/icon_16x16@2x.png"
make_square_png 32 "${ICONSET_DIR}/icon_32x32.png"
make_square_png 64 "${ICONSET_DIR}/icon_32x32@2x.png"
make_square_png 128 "${ICONSET_DIR}/icon_128x128.png"
make_square_png 256 "${ICONSET_DIR}/icon_128x128@2x.png"
make_square_png 256 "${ICONSET_DIR}/icon_256x256.png"
make_square_png 512 "${ICONSET_DIR}/icon_256x256@2x.png"
make_square_png 512 "${ICONSET_DIR}/icon_512x512.png"
make_square_png 1024 "${ICONSET_DIR}/icon_512x512@2x.png"
iconutil -c icns "${ICONSET_DIR}" -o "${APP_MACOS_ICNS}"

echo "Pass icons synced from ${SOURCE_PNG}"
