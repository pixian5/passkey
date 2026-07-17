#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 1. 获取提交说明
COMMIT_MSG="$1"
if [ -z "$COMMIT_MSG" ]; then
    echo "用法: ./scripts/commit.sh \"提交说明\""
    exit 1
fi

# 2. 升级版本号
CURRENT_VERSION=$(awk -F'"' '/"version":/ {print $4; exit}' "$ROOT_DIR/apps/extension_shared/package.json")

if [ -z "$CURRENT_VERSION" ]; then
    echo "Error: 无法读取当前版本号"
    exit 1
fi

IFS='.' read -r major minor patch <<< "$CURRENT_VERSION"

new_patch=$((patch + 1))
new_minor=$minor
new_major=$major

if [ $new_patch -ge 10 ]; then
    new_patch=0
    new_minor=$((minor + 1))
    if [ $new_minor -ge 10 ]; then
        new_minor=0
        new_major=$((major + 1))
    fi
fi

NEW_VERSION="${new_major}.${new_minor}.${new_patch}"

echo "版本号: $CURRENT_VERSION → $NEW_VERSION"

files_to_update=(
    "$ROOT_DIR/apps/extension_shared/content.js"
    "$ROOT_DIR/apps/extension_shared/manifest.json"
    "$ROOT_DIR/apps/extension_shared/package.json"
    "$ROOT_DIR/apps/extension_shared/background.js"
    "$ROOT_DIR/apps/extension_shared/webauthn_injected.js"
)

for file in "${files_to_update[@]}"; do
    if [ -f "$file" ]; then
        sed -i.bak "s/\"$CURRENT_VERSION\"/\"$NEW_VERSION\"/g" "$file"
        rm -f "${file}.bak"
    fi
done

if [ -f "$ROOT_DIR/apps/app_macos/project.yml" ]; then
    sed -i.bak "s/MARKETING_VERSION: \"$CURRENT_VERSION\"/MARKETING_VERSION: \"$NEW_VERSION\"/g" "$ROOT_DIR/apps/app_macos/project.yml"
    rm -f "$ROOT_DIR/apps/app_macos/project.yml.bak"
fi

if [ -f "$ROOT_DIR/apps/app_macos/project.autofill.yml" ]; then
    sed -i.bak "s/MARKETING_VERSION: \"$CURRENT_VERSION\"/MARKETING_VERSION: \"$NEW_VERSION\"/g" "$ROOT_DIR/apps/app_macos/project.autofill.yml"
    rm -f "$ROOT_DIR/apps/app_macos/project.autofill.yml.bak"
fi

# 3. git 提交并推送
cd "$ROOT_DIR"
git add .
git commit -m "版本号升级至 $NEW_VERSION: $COMMIT_MSG"
git push

echo ""
echo "✅ 已提交并推送: $NEW_VERSION - $COMMIT_MSG"
