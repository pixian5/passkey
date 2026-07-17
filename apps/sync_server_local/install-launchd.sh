#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHD_PLIST="com.pass.sync-server.plist"
LAUNCHD_DIR="${HOME}/Library/LaunchAgents"
DATA_DIR="${HOME}/Library/Application Support/PassSync"
LOG_DIR="${HOME}/Library/Logs"

# 确保目录存在
mkdir -p "${LAUNCHD_DIR}"
mkdir -p "${DATA_DIR}"
mkdir -p "${LOG_DIR}"

# 生成随机 Token
TOKEN=$(openssl rand -base64 32 | tr -d '=+/')

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
    <string>default=${TOKEN}</string>
    <key>PASS_SYNC_LOG_LEVEL</key>
    <string>INFO</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
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
echo "  http://${LOCAL_IP}:53333/v1/sync/payload"
echo ""
echo "访问令牌 (Bearer Token):"
echo "  ${TOKEN}"
echo ""
echo "客户端配置:"
echo "  服务器地址: http://${LOCAL_IP}:53333"
echo "  访问令牌:   ${TOKEN}"
echo "========================================"
