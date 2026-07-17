#!/bin/bash
set -euo pipefail

PID_FILE="/tmp/pass-sync-server.pid"

if [[ ! -f "${PID_FILE}" ]]; then
  echo "未找到运行中的同步服务器进程"
  exit 0
fi

PID=$(cat "${PID_FILE}")

if kill -0 "${PID}" 2>/dev/null; then
  echo "正在停止同步服务器 (PID: ${PID})..."
  kill "${PID}" 2>/dev/null || true
  sleep 1
  if kill -0 "${PID}" 2>/dev/null; then
    echo "强制终止进程..."
    kill -9 "${PID}" 2>/dev/null || true
  fi
  echo "同步服务器已停止"
else
  echo "进程已不存在"
fi

rm -f "${PID_FILE}"
