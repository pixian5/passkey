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
HEALTH_URL="${PASS_SYNC_HEALTH_URL:-}"
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
current_runtime_environment=""
if [[ "${service_was_active}" -eq 1 ]]; then
  current_main_pid="$(systemctl show pass-sync-server -p MainPID --value)"
  if [[ -n "${current_main_pid}" && "${current_main_pid}" != "0" && -r "/proc/${current_main_pid}/environ" ]]; then
    current_runtime_environment="$(tr '\0' '\n' < "/proc/${current_main_pid}/environ" | sed -n '/^PASS_SYNC_\(HOST\|PORT\)=/p')"
  fi
fi

restore_previous_installation() {
  failure_status="${1:-1}"
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
  exit "${failure_status}"
}

trap 'failure_status=$?; restore_previous_installation "${failure_status}"' ERR

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

migrated_legacy_env=0
if [[ -f /etc/pass-sync-server.env && ! -f "${CONFIG_DIR}/pass-sync-server.env" ]]; then
  install -m 0600 /etc/pass-sync-server.env "${CONFIG_DIR}/pass-sync-server.env"
  migrated_legacy_env=1
fi

persist_runtime_setting() {
  setting_name="$1"
  settings_path="${CONFIG_DIR}/pass-sync-server.env"
  if [[ -z "${current_runtime_environment}" ]]; then
    return 0
  fi
  setting_value="$(printf '%s\n' "${current_runtime_environment}" | sed -n "s/^${setting_name}=//p" | tail -n 1)"
  if [[ -z "${setting_value}" ]]; then
    return 0
  fi
  if grep -q "^${setting_name}=" "${settings_path}" 2>/dev/null; then
    if [[ "${migrated_legacy_env}" -ne 1 ]]; then
      return 0
    fi
    sed -i "s#^${setting_name}=.*#${setting_name}=${setting_value}#" "${settings_path}"
  else
    printf '%s=%s\n' "${setting_name}" "${setting_value}" >> "${settings_path}"
  fi
}

# Preserve customized listen settings that older service units stored inline.
persist_runtime_setting PASS_SYNC_HOST
persist_runtime_setting PASS_SYNC_PORT
if [[ -f "${CONFIG_DIR}/pass-sync-server.env" ]]; then
  chown pass:pass "${CONFIG_DIR}/pass-sync-server.env"
  chmod 0600 "${CONFIG_DIR}/pass-sync-server.env"
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

if [[ -f "${CONFIG_DIR}/tls/server.crt" && -f "${CONFIG_DIR}/tls/server.key" ]]; then
  runuser -u pass -- python3 - "${CONFIG_DIR}/tls/server.crt" "${CONFIG_DIR}/tls/server.key" <<'PY'
import ssl
import sys

context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(sys.argv[1], sys.argv[2])
print("TLS certificate load check: ok")
PY
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

resolve_health_url() {
  if [[ -n "${HEALTH_URL}" ]]; then
    printf '%s\n' "${HEALTH_URL}"
    return 0
  fi
  main_pid="$(systemctl show pass-sync-server -p MainPID --value)"
  if [[ -z "${main_pid}" || "${main_pid}" == "0" || ! -r "/proc/${main_pid}/environ" ]]; then
    return 1
  fi
  process_environment="$(tr '\0' '\n' < "/proc/${main_pid}/environ")"
  actual_port="$(printf '%s\n' "${process_environment}" | sed -n 's/^PASS_SYNC_PORT=//p' | tail -n 1)"
  tls_cert="$(printf '%s\n' "${process_environment}" | sed -n 's/^PASS_SYNC_TLS_CERT=//p' | tail -n 1)"
  tls_key="$(printf '%s\n' "${process_environment}" | sed -n 's/^PASS_SYNC_TLS_KEY=//p' | tail -n 1)"
  actual_port="${actual_port:-53333}"
  if [[ -n "${tls_cert}" && -n "${tls_key}" ]]; then
    printf 'https://127.0.0.1:%s/healthz\n' "${actual_port}"
  else
    printf 'http://127.0.0.1:%s/healthz\n' "${actual_port}"
  fi
}

healthy=0
checked_health_url=""
for _attempt in $(seq 1 30); do
  checked_health_url="$(resolve_health_url || true)"
  if [[ -n "${checked_health_url}" ]] && curl --fail --silent --show-error --insecure "${checked_health_url}" >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "${healthy}" -ne 1 ]]; then
  echo "新版本健康检查失败：${checked_health_url:-无法读取运行进程环境}" >&2
  false
fi

trap - ERR
find "${DATA_DIR}/backups" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + || true
echo "Pass 同步服务器部署完成：${PASS_SYNC_SOURCE_REVISION:-unknown}（${checked_health_url}）"
