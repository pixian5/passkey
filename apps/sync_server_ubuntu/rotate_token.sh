#!/usr/bin/env bash
set -euo pipefail

DEST="${1:-/etc/pass-sync/tokens.conf}"
SCOPE="${2:-default}"
TOKEN="$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)"
mkdir -p "$(dirname "$DEST")"
touch "$DEST"
chmod 600 "$DEST"
TMP="${DEST}.tmp.$$"
awk -F= -v scope="$SCOPE" '$1 != scope { print }' "$DEST" > "$TMP"
printf '%s=%s\n' "$SCOPE" "$TOKEN" >> "$TMP"
chmod 600 "$TMP"
mv -f "$TMP" "$DEST"
printf '已轮换 scope=%s，令牌仅显示一次：\n%s\n' "$SCOPE" "$TOKEN"
printf '请执行 systemctl restart pass-sync-server 使服务读取新令牌。\n'
