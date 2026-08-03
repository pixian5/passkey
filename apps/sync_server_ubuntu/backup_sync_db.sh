#!/usr/bin/env bash
set -euo pipefail
umask 077

DB_PATH="${PASS_SYNC_DB_PATH:-/var/lib/pass-sync/pass_sync.sqlite3}"
BACKUP_ROOT="${PASS_SYNC_BACKUP_DIR:-/var/lib/pass-sync/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_ROOT}/${STAMP}"

install -d -m 0700 "${DEST}"
if command -v sqlite3 >/dev/null 2>&1; then
  # 在线备份保持 SQLite 一致性，不直接复制正在写入的主库。
  sqlite3 "${DB_PATH}" ".backup '${DEST}/pass_sync.sqlite3'"
else
  cp -a "${DB_PATH}" "${DEST}/pass_sync.sqlite3"
  [ -e "${DB_PATH}-wal" ] && cp -a "${DB_PATH}-wal" "${DEST}/" || true
  [ -e "${DB_PATH}-shm" ] && cp -a "${DB_PATH}-shm" "${DEST}/" || true
fi
find "${DEST}" -type f -exec chmod 0600 {} +

python3 - "${DEST}/pass_sync.sqlite3" <<'PY'
import sqlite3
import sys
path = sys.argv[1]
with sqlite3.connect(path) as connection:
    result = connection.execute("PRAGMA integrity_check;").fetchone()[0]
if result != "ok":
    raise SystemExit(f"backup integrity check failed: {result}")
print(f"backup integrity: {result}")
PY

find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
echo "同步数据库备份完成：${DEST}"
