#!/usr/bin/env bash
set -euo pipefail
umask 077

DEST="${1:-/etc/pass-sync/tokens.conf}"
SCOPE="${2:-default}"
TOKEN="${PASS_SYNC_NEW_BEARER_TOKEN:-}"
if [[ -z "${TOKEN}" && -t 0 ]]; then
  read -r -s -p "请输入要写入的现有 Bearer Token（不会回显）: " TOKEN
  printf '\n'
fi
if [[ -z "${TOKEN}" ]]; then
  printf '未提供 Token。请设置 PASS_SYNC_NEW_BEARER_TOKEN 或在终端交互输入；项目不会自动生成 Token。\n' >&2
  exit 2
fi
if [[ "${TOKEN}" == *,* || "${TOKEN}" == *[[:space:]]* ]]; then
  printf 'Token 不能包含逗号或空白字符。\n' >&2
  exit 2
fi
if [[ ! "${SCOPE}" =~ ^[A-Za-z0-9._-]+$ ]]; then
  printf 'scope 只能包含字母、数字、点、下划线或连字符。\n' >&2
  exit 2
fi
mkdir -p "$(dirname "$DEST")"
touch "$DEST"
chmod 600 "$DEST"
TMP="${DEST}.tmp.$$"
awk -F= -v scope="$SCOPE" '$1 != scope { print }' "$DEST" > "$TMP"
printf '%s=%s\n' "$SCOPE" "$TOKEN" >> "$TMP"
chmod 600 "$TMP"
mv -f "$TMP" "$DEST"
printf '已更新 scope=%s 的 Token（内容不显示）。\n' "$SCOPE"
printf '请执行 systemctl restart pass-sync-server 使服务读取新令牌。\n'
