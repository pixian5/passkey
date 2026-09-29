#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHD_PLIST="com.pass.sync-server.plist"
LAUNCHD_DIR="${HOME}/Library/LaunchAgents"
DATA_DIR="${HOME}/Library/Application Support/PassSync"
LOG_DIR="${HOME}/Library/Logs"

# 确保目录存在
mkdir -p "${LAUNCHD_DIR}"
mkdir -p "${DATA_DIR}"
chmod 0700 "${DATA_DIR}"
mkdir -p "${LOG_DIR}"

# 未配置 Bearer Token 时必须显式选择开放模式。
TOKEN_CONFIG="${PASS_SYNC_BEARER_TOKENS:-}"
TOKEN_CONFIG_XML=$(printf '%s' "${TOKEN_CONFIG}" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g")
case "${PASS_SYNC_ALLOW_OPEN:-0}" in
  1|true|TRUE|yes|YES) ALLOW_OPEN_CONFIG="1" ;;
  *) ALLOW_OPEN_CONFIG="0" ;;
esac
if [[ -z "${TOKEN_CONFIG}" && "${ALLOW_OPEN_CONFIG}" != "1" ]]; then
  echo "未配置 Bearer Token。请设置令牌，或明确设置 PASS_SYNC_ALLOW_OPEN=1 接受无认证访问。" >&2
  exit 1
fi
HOST_CONFIG="127.0.0.1"
ALLOW_PLAINTEXT_INPUT=$(printf '%s' "${PASS_SYNC_ALLOW_PLAINTEXT:-1}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')
case "${ALLOW_PLAINTEXT_INPUT}" in
  1|true|yes) ALLOW_PLAINTEXT_CONFIG="1" ;;
  0|false|no) ALLOW_PLAINTEXT_CONFIG="0" ;;
  *)
    echo "PASS_SYNC_ALLOW_PLAINTEXT 只接受 1/true/yes 或 0/false/no" >&2
    exit 2
    ;;
esac

# 生成 plist 文件
cat > "${LAUNCHD_DIR}/${LAUNCHD_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.pass.sync-server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>${SCRIPT_DIR}/../sync_server_ubuntu/pass_sync_server.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PASS_SYNC_HOST</key>
    <string>${HOST_CONFIG}</string>
    <key>PASS_SYNC_PORT</key>
    <string>53333</string>
    <key>PASS_SYNC_DB_PATH</key>
    <string>${DATA_DIR}/pass_sync.sqlite3</string>
    <key>PASS_SYNC_BEARER_TOKENS</key>
    <string>${TOKEN_CONFIG_XML}</string>
    <key>PASS_SYNC_ALLOW_OPEN</key>
    <string>${ALLOW_OPEN_CONFIG}</string>
    <key>PASS_SYNC_ALLOW_PLAINTEXT</key>
    <string>${ALLOW_PLAINTEXT_CONFIG}</string>
    <key>PASS_SYNC_LOG_LEVEL</key>
    <string>INFO</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/pass-sync-server.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/pass-sync-server.log</string>
</dict>
</plist>
EOF

# 加载并启动
launchctl load "${LAUNCHD_DIR}/${LAUNCHD_PLIST}" 2>/dev/null || launchctl bootstrap "gui/$(id -u)" "${LAUNCHD_DIR}/${LAUNCHD_PLIST}"

echo "========================================"
echo "Pass 本地同步服务器已注册为开机自启"
echo "========================================"
echo "LaunchAgent: ${LAUNCHD_DIR}/${LAUNCHD_PLIST}"
echo ""
echo "本机客户端地址:"
echo "  http://127.0.0.1:53333"
echo "  跨设备请配置 HTTPS 反向代理和 Bearer Token；不要将无认证服务公开到公网"
echo ""
if [[ -z "${TOKEN_CONFIG}" && "${ALLOW_OPEN_CONFIG}" == "1" ]]; then
  echo "认证模式 : 开放（未配置 Bearer Token）"
  TOKEN_DISPLAY="（留空）"
else
  echo "认证模式 : 已使用显式 Bearer Token 配置"
  TOKEN_DISPLAY="（已配置，不显示）"
fi
echo "明文同步 : $([[ "${ALLOW_PLAINTEXT_CONFIG}" == "0" ]] && echo "拒绝" || echo "允许")"
echo ""
echo "客户端配置:"
echo "  本机服务器地址: http://127.0.0.1:53333"
echo "  同步接口: http://127.0.0.1:53333/v2/sync/state"
echo "  跨设备服务器地址: https://你的受信任域名"
echo "  访问令牌:   ${TOKEN_DISPLAY}"
echo "========================================"
