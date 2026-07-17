#!/bin/bash
set -euo pipefail

PID_FILE="/tmp/pass-sync-server.pid"
LOG_FILE="${HOME}/Library/Logs/pass-sync-server.log"

if [[ -f "${PID_FILE}" ]]; then
  PID=$(cat "${PID_FILE}")
  if kill -0 "${PID}" 2>/dev/null; then
    echo "状态: 运行中 (PID: ${PID})"
    # 获取监听端口
    lsof -Pan -p "${PID}" -i 2>/dev/null | grep LISTEN || true
  else
    echo "状态: 未运行 (PID 文件残留)"
    rm -f "${PID_FILE}"
  fi
else
  echo "状态: 未运行"
fi

if [[ -f "${LOG_FILE}" ]]; then
  echo ""
  echo "最近 10 行日志:"
  tail -n 10 "${LOG_FILE}"
fi
