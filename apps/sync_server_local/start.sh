#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PY="${SCRIPT_DIR}/../sync_server_ubuntu/pass_sync_server.py"
DATA_DIR="${HOME}/Library/Application Support/PassSync"
LOG_DIR="${HOME}/Library/Logs"
LOG_FILE="${LOG_DIR}/pass-sync-server.log"
PID_FILE="/tmp/pass-sync-server.pid"
PORT="${PASS_SYNC_PORT:-53333}"
HOST="${PASS_SYNC_HOST:-0.0.0.0}"

# 确保数据目录存在
mkdir -p "${DATA_DIR}"
mkdir -p "${LOG_DIR}"

# 获取本机局域网 IP（优先 en0 的 IPv4）
LOCAL_IP=$(ifconfig en0 2>/dev/null | awk '/inet / {print $2}' | head -n 1)
if [[ -z "${LOCAL_IP}" ]]; then
  LOCAL_IP=$(ifconfig en1 2>/dev/null | awk '/inet / {print $2}' | head -n 1)
fi
if [[ -z "${LOCAL_IP}" ]]; then
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' | head -n 1)
fi
if [[ -z "${LOCAL_IP}" ]]; then
  LOCAL_IP="127.0.0.1"
fi

# 如果已经有进程在运行，则提示并退出
if [[ -f "${PID_FILE}" ]]; then
  OLD_PID=$(cat "${PID_FILE}")
  if kill -0 "${OLD_PID}" 2>/dev/null; then
    echo "同步服务器已在运行 (PID: ${OLD_PID})"
    echo "访问地址: http://${LOCAL_IP}:${PORT}/v1/sync/payload"
    exit 0
  else
    rm -f "${PID_FILE}"
  fi
fi

# 设置环境变量
export PASS_SYNC_HOST="${HOST}"
export PASS_SYNC_PORT="${PORT}"
export PASS_SYNC_DB_PATH="${DATA_DIR}/pass_sync.sqlite3"
export PASS_SYNC_LOG_LEVEL="${PASS_SYNC_LOG_LEVEL:-INFO}"

# 启动服务器
nohup python3 "${SERVER_PY}" > "${LOG_FILE}" 2>&1 &
PID=$!
echo "${PID}" > "${PID_FILE}"

# 等待服务器启动
sleep 1
if ! kill -0 "${PID}" 2>/dev/null; then
  echo "服务器启动失败，请查看日志: ${LOG_FILE}"
  rm -f "${PID_FILE}"
  exit 1
fi

echo "========================================"
echo "Pass 本地同步服务器已启动"
echo "========================================"
echo "进程 PID : ${PID}"
echo "监听地址 : ${HOST}:${PORT}"
echo "数据库   : ${DATA_DIR}/pass_sync.sqlite3"
echo "日志文件 : ${LOG_FILE}"
echo ""
echo "局域网访问地址:"
echo "  http://${LOCAL_IP}:${PORT}/v1/sync/payload"
echo ""
if [[ -z "${PASS_SYNC_BEARER_TOKENS:-}" ]]; then
  echo "认证模式 : 开放（未配置 Bearer Token）"
else
  echo "认证模式 : 已使用显式 Bearer Token 配置"
fi
echo "健康检查:"
echo "  curl http://${LOCAL_IP}:${PORT}/healthz"
echo ""
echo "客户端配置示例:"
echo "  服务器地址: http://${LOCAL_IP}:${PORT}"
echo "  访问令牌:   ${PASS_SYNC_BEARER_TOKENS:-（留空）}"
echo "========================================"
