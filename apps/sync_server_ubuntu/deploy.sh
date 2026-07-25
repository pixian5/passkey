#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "deploy.sh 必须以 root 运行" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${PASS_SYNC_INSTALL_DIR:-/opt/pass-sync-server}"
DATA_DIR="${PASS_SYNC_DATA_DIR:-/var/lib/pass-sync}"
CONFIG_DIR="${PASS_SYNC_CONFIG_DIR:-/etc/pass-sync}"
DB_PATH="${PASS_SYNC_DB_PATH:-${DATA_DIR}/pass_sync.sqlite3}"
HEALTH_URL="${PASS_SYNC_HEALTH_URL:-https://127.0.0.1:5443/healthz}"
STAMP="$(date +%Y%m%d-%H%M%S)"
PRE_DEPLOY_DIR="${DATA_DIR}/backups/${STAMP}-pre-deploy"
ROLLBACK_DIR="${PRE_DEPLOY_DIR}/installed"
DB_BACKUP="${PRE_DEPLOY_DIR}/pass_sync.sqlite3"

if ! getent group pass >/dev/null 2>&1; then
  groupadd --system pass
fi
if ! id -u pass >/dev/null 2>&1; then
  useradd --system --gid pass --home-dir /nonexistent --shell /usr/sbin/nologin pass
fi

install -d -m 0755 "${INSTALL_DIR}" "${CONFIG_DIR}" "${DATA_DIR}" "${DATA_DIR}/backups"
install -d -m 0700 "${PRE_DEPLOY_DIR}" "${ROLLBACK_DIR}"

managed_paths=(
  "${INSTALL_DIR}/pass_sync_server.py"
  "${INSTALL_DIR}/backup_sync_db.sh"
  "/etc/systemd/system/pass-sync-server.service"
  "/etc/systemd/system/pass-sync-server-backup.service"
  "/etc/systemd/system/pass-sync-server-backup.timer"
  "${CONFIG_DIR}/pass-sync-server.env"
  "${CONFIG_DIR}/tls/server.crt"
  "${CONFIG_DIR}/tls/server.key"
)

for target in "${managed_paths[@]}"; do
  if [[ -e "${target}" ]]; then
    backup_path="${ROLLBACK_DIR}${target}"
    install -d -m 0700 "$(dirname "${backup_path}")"
    cp -a "${target}" "${backup_path}"
  fi
done

service_was_active=0
timer_was_enabled=0
systemctl is-active --quiet pass-sync-server && service_was_active=1 || true
systemctl is-enabled --quiet pass-sync-server-backup.timer && timer_was_enabled=1 || true

restore_previous_installation() {
  trap - ERR
  set +e
  systemctl stop pass-sync-server
  for target in "${managed_paths[@]}"; do
    backup_path="${ROLLBACK_DIR}${target}"
    if [[ -e "${backup_path}" ]]; then
      install -d -m 0755 "$(dirname "${target}")"
      cp -a "${backup_path}" "${target}"
    else
      rm -f "${target}"
    fi
  done
  if [[ -f "${DB_BACKUP}" ]]; then
    rm -f "${DB_PATH}-wal" "${DB_PATH}-shm"
    cp -f "${DB_BACKUP}" "${DB_PATH}"
    chown pass:pass "${DB_PATH}"
  fi
  systemctl daemon-reload
  if [[ "${service_was_active}" -eq 1 ]]; then
    systemctl restart pass-sync-server
  else
    systemctl disable --now pass-sync-server
  fi
  if [[ "${timer_was_enabled}" -eq 1 ]]; then
    systemctl enable --now pass-sync-server-backup.timer
  else
    systemctl disable --now pass-sync-server-backup.timer
  fi
  echo "部署失败，已恢复部署前的程序、配置和数据库" >&2
}

trap restore_previous_installation ERR

systemctl stop pass-sync-server 2>/dev/null || true
if [[ -f "${DB_PATH}" ]]; then
  python3 - "${DB_PATH}" "${DB_BACKUP}" <<'PY'
import sqlite3
import sys

source_path, backup_path = sys.argv[1:]
with sqlite3.connect(source_path) as source, sqlite3.connect(backup_path) as backup:
    source.backup(backup)
    result = backup.execute("PRAGMA integrity_check").fetchone()[0]
if result != "ok":
    raise SystemExit(f"pre-deploy backup integrity check failed: {result}")
print(f"pre-deploy backup integrity: {result}")
PY
fi

if [[ -f /etc/pass-sync-server.env && ! -f "${CONFIG_DIR}/pass-sync-server.env" ]]; then
  install -m 0600 /etc/pass-sync-server.env "${CONFIG_DIR}/pass-sync-server.env"
fi
if [[ -f /etc/bz/certs/server.crt && -f /etc/bz/certs/server.key ]]; then
  install -d -m 0750 -o pass -g pass "${CONFIG_DIR}/tls"
  install -m 0644 -o pass -g pass /etc/bz/certs/server.crt "${CONFIG_DIR}/tls/server.crt"
  install -m 0600 -o pass -g pass /etc/bz/certs/server.key "${CONFIG_DIR}/tls/server.key"
  if [[ -f "${CONFIG_DIR}/pass-sync-server.env" ]]; then
    sed -i \
      -e 's#^PASS_SYNC_TLS_CERT=.*#PASS_SYNC_TLS_CERT=/etc/pass-sync/tls/server.crt#' \
      -e 's#^PASS_SYNC_TLS_KEY=.*#PASS_SYNC_TLS_KEY=/etc/pass-sync/tls/server.key#' \
      "${CONFIG_DIR}/pass-sync-server.env"
  fi
fi

install -m 0644 "${SCRIPT_DIR}/pass_sync_server.py" "${INSTALL_DIR}/pass_sync_server.py"
install -m 0755 "${SCRIPT_DIR}/backup_sync_db.sh" "${INSTALL_DIR}/backup_sync_db.sh"
install -m 0644 "${SCRIPT_DIR}/pass-sync-server.service" /etc/systemd/system/pass-sync-server.service
install -m 0644 "${SCRIPT_DIR}/pass-sync-server-backup.service" /etc/systemd/system/pass-sync-server-backup.service
install -m 0644 "${SCRIPT_DIR}/pass-sync-server-backup.timer" /etc/systemd/system/pass-sync-server-backup.timer
chown -R pass:pass "${DATA_DIR}"

systemctl daemon-reload
systemctl enable --now pass-sync-server
systemctl enable --now pass-sync-server-backup.timer

healthy=0
for _attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --insecure "${HEALTH_URL}" >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "${healthy}" -ne 1 ]]; then
  echo "新版本健康检查失败：${HEALTH_URL}" >&2
  false
fi

trap - ERR
find "${DATA_DIR}/backups" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + || true
echo "Pass 同步服务器部署完成：${PASS_SYNC_SOURCE_REVISION:-unknown}"
