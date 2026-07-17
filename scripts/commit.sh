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
"$SCRIPT_DIR/bump_version.sh"

# 3. git 提交并推送
cd "$ROOT_DIR"
git add .
NEW_VERSION=$(awk -F'"' '/"version":/ {print $4; exit}' "$ROOT_DIR/apps/extension_shared/package.json")
git commit -m "版本号升级至 $NEW_VERSION: $COMMIT_MSG"
git push

echo ""
echo "✅ 已提交并推送: $NEW_VERSION - $COMMIT_MSG"
