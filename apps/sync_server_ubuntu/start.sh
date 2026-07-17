#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PY="${SCRIPT_DIR}/pass_sync_server.py"
DATA_DIR="${SCRIPT_DIR}/data"
LOG_FILE="${SCRIPT_DIR}/pass-sync-server.log"
PID_FILE="/tmp/pass-sync-server.pid"
PORT="${PASS_SYNC_PORT:-53333}"
HOST="${PASS_SYNC_HOST:-0.0.0.0}"

mkdir -p "${DATA_DIR}"

# 如果未设置 Token，自动生成
if [[ -z "${PASS_SYNC_BEARER_TOKENS:-}" ]]; then
  TOKEN=$(openssl rand -base64 32 | tr -d '=+/')
  export PASS_SYNC_BEARER_TOKENS="default=${TOKEN}"
  GENERATED_TOKEN="${TOKEN}"
else
  GENERATED_TOKEN=""
fi

# 检查是否已在运行
if [[ -f "${PID_FILE}" ]]; then
  OLD_PID=$(cat "${PID_FILE}")
  if kill -0 "${OLD_PID}" 2>/dev/null; then
    echo "同步服务器已在运行 (PID: ${OLD_PID})"
    echo "访问地址: http://${HOST}:${PORT}/v1/sync/payload"
    if [[ -n "${GENERATED_TOKEN}" ]]; then
      echo "访问令牌: ${GENERATED_TOKEN}"
    fi
    exit 0
  else
    rm -f "${PID_FILE}"
  fi
fi

export PASS_SYNC_HOST="${HOST}"
export PASS_SYNC_PORT="${PORT}"
export PASS_SYNC_DB_PATH="${DATA_DIR}/pass_sync.sqlite3"
export PASS_SYNC_LOG_LEVEL="${PASS_SYNC_LOG_LEVEL:-INFO}"

nohup python3 "${SERVER_PY}" > "${LOG_FILE}" 2>&1 &
PID=$!
echo "${PID}" > "${PID_FILE}"

sleep 1
if ! kill -0 "${PID}" 2>/dev/null; then
  echo "服务器启动失败，请查看日志: ${LOG_FILE}"
  rm -f "${PID_FILE}"
  exit 1
fi

echo "========================================"
echo "Pass 同步服务器已启动"
echo "========================================"
echo "进程 PID : ${PID}"
echo "监听地址 : ${HOST}:${PORT}"
echo "数据库   : ${DATA_DIR}/pass_sync.sqlite3"
echo "日志文件 : ${LOG_FILE}"
echo ""
if [[ -n "${GENERATED_TOKEN}" ]]; then
  echo "访问令牌 (Bearer Token):"
  echo "  ${GENERATED_TOKEN}"
  echo ""
fi
echo "健康检查:"
echo "  curl http://127.0.0.1:${PORT}/healthz"
echo "========================================"
