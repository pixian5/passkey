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

# 留空即开放模式；只有用户显式设置时才启用 Bearer Token。
TOKEN_CONFIG="${PASS_SYNC_BEARER_TOKENS:-}"
TOKEN_CONFIG_XML=$(printf '%s' "${TOKEN_CONFIG}" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g")
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
    <string>0.0.0.0</string>
    <key>PASS_SYNC_PORT</key>
    <string>53333</string>
    <key>PASS_SYNC_DB_PATH</key>
    <string>${DATA_DIR}/pass_sync.sqlite3</string>
    <key>PASS_SYNC_BEARER_TOKENS</key>
    <string>${TOKEN_CONFIG_XML}</string>
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

# 获取本机 IP
LOCAL_IP=$(ifconfig en0 2>/dev/null | awk '/inet / {print $2}' | head -n 1)
if [[ -z "${LOCAL_IP}" ]]; then
  LOCAL_IP=$(ifconfig en1 2>/dev/null | awk '/inet / {print $2}' | head -n 1)
fi
if [[ -z "${LOCAL_IP}" ]]; then
  LOCAL_IP="127.0.0.1"
fi

echo "========================================"
echo "Pass 本地同步服务器已注册为开机自启"
echo "========================================"
echo "LaunchAgent: ${LAUNCHD_DIR}/${LAUNCHD_PLIST}"
echo ""
echo "局域网访问地址:"
echo "  http://${LOCAL_IP}:53333/v2/sync/state"
echo "  注意: 当前客户端只允许回环地址使用 HTTP；跨设备请配置 HTTPS 反向代理"
echo ""
if [[ -z "${TOKEN_CONFIG}" ]]; then
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
echo "  跨设备服务器地址: https://你的受信任域名"
echo "  访问令牌:   ${TOKEN_DISPLAY}"
echo "========================================"
