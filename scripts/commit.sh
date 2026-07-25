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

# 2. 每次提交恰好升级一次版本号：若本轮已手动升级，只做一致性检查。
CURRENT_VERSION=$(node "$SCRIPT_DIR/version.mjs" current)
HEAD_VERSION=$(git -C "$ROOT_DIR" show HEAD:VERSION 2>/dev/null | tr -d '[:space:]' || true)
if [ -z "$HEAD_VERSION" ] || [ "$CURRENT_VERSION" = "$HEAD_VERSION" ]; then
    "$SCRIPT_DIR/bump_version.sh"
else
    node "$SCRIPT_DIR/version.mjs" check
fi

# 3. git 提交并推送
cd "$ROOT_DIR"
git add .
NEW_VERSION=$(node "$SCRIPT_DIR/version.mjs" current)
git commit -m "版本号升级至 $NEW_VERSION: $COMMIT_MSG"
git push

echo ""
echo "✅ 已提交并推送: $NEW_VERSION - $COMMIT_MSG"
