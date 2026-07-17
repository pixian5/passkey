#!/bin/bash
set -euo pipefail

LAUNCHD_PLIST="com.pass.sync-server.plist"
LAUNCHD_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${LAUNCHD_DIR}/${LAUNCHD_PLIST}"

if [[ -f "${PLIST_PATH}" ]]; then
  echo "正在卸载开机自启..."
  launchctl unload "${PLIST_PATH}" 2>/dev/null || launchctl bootout "gui/$(id -u)" "${PLIST_PATH}" 2>/dev/null || true
  rm -f "${PLIST_PATH}"
  echo "已卸载"
else
  echo "未找到 LaunchAgent 配置"
fi
