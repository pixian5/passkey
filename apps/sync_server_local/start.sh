#!/bin/bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_PY="${SCRIPT_DIR}/../sync_server_ubuntu/pass_sync_server.py"
DATA_DIR="${HOME}/Library/Application Support/PassSync"
LOG_DIR="${HOME}/Library/Logs"
LOG_FILE="${LOG_DIR}/pass-sync-server.log"
PID_FILE="/tmp/pass-sync-server.pid"
PORT="${PASS_SYNC_PORT:-53333}"
HOST="${PASS_SYNC_HOST:-127.0.0.1}"

# 确保数据目录存在
mkdir -p "${DATA_DIR}"
chmod 0700 "${DATA_DIR}"
mkdir -p "${LOG_DIR}"

# 如果已经有进程在运行，则提示并退出
if [[ -f "${PID_FILE}" ]]; then
  OLD_PID=$(cat "${PID_FILE}")
  if kill -0 "${OLD_PID}" 2>/dev/null; then
    echo "同步服务器已在运行 (PID: ${OLD_PID})"
    echo "访问地址: http://127.0.0.1:${PORT}/v2/sync/state"
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
case "${PASS_SYNC_ALLOW_OPEN:-0}" in
  1|true|TRUE|yes|YES) allow_open=1 ;;
  *) allow_open=0 ;;
esac
if [[ -z "${PASS_SYNC_BEARER_TOKENS:-}" && -z "${PASS_SYNC_BEARER_TOKENS_FILE:-}" && "${allow_open}" != "1" ]]; then
  echo "未配置 Bearer Token。请设置令牌，或明确设置 PASS_SYNC_ALLOW_OPEN=1 接受无认证访问。" >&2
  exit 1
fi

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
echo "本机客户端地址:"
echo "  http://127.0.0.1:${PORT}"
echo "同步接口: http://127.0.0.1:${PORT}/v2/sync/state"
echo "  跨设备请配置 HTTPS 反向代理和 Bearer Token；不要将无认证服务公开到公网"
echo ""
if [[ -z "${PASS_SYNC_BEARER_TOKENS:-}" && -z "${PASS_SYNC_BEARER_TOKENS_FILE:-}" && "${allow_open}" == "1" ]]; then
  echo "认证模式 : 开放（未配置 Bearer Token）"
  TOKEN_DISPLAY="（留空）"
else
  echo "认证模式 : 已使用显式 Bearer Token 配置"
  TOKEN_DISPLAY="（已配置，不显示）"
fi
echo "健康检查:"
echo "  curl http://127.0.0.1:${PORT}/healthz"
echo ""
echo "客户端配置示例:"
echo "  本机服务器地址: http://127.0.0.1:${PORT}"
echo "  跨设备服务器地址: https://你的受信任域名"
echo "  访问令牌:   ${TOKEN_DISPLAY}"
echo "========================================"
