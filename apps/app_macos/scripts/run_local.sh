#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_NAME="PassMac"
APP_BUNDLE="${APP_ROOT}/dist/${APP_NAME}.app"
RUN_LOG="${RUN_LOG:-/tmp/passmac-local.log}"

echo "[1/5] Closing existing ${APP_NAME} ..."
pkill -x "${APP_NAME}" >/dev/null 2>&1 || true

for _ in {1..25}; do
  if ! pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

if pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
  pkill -9 -x "${APP_NAME}" >/dev/null 2>&1 || true
  sleep 0.2
fi

echo "[2/5] Deleting old local app bundle ..."
rm -rf "${APP_BUNDLE}"

echo "[3/5] Building local app bundle ..."
cd "${APP_ROOT}"
SKIP_INSTALL=1 RUN_AFTER_INSTALL=0 "${APP_ROOT}/scripts/package_app.sh"

if [[ ! -d "${APP_BUNDLE}" ]]; then
  echo "Failed to locate app bundle: ${APP_BUNDLE}" >&2
  exit 1
fi

echo "[4/5] Launching ${APP_BUNDLE} ..."
open -na "${APP_BUNDLE}" >"${RUN_LOG}" 2>&1 || true
sleep 1

if pgrep -x "${APP_NAME}" >/dev/null 2>&1; then
  echo "Launch success. PID(s): $(pgrep -x "${APP_NAME}" | tr '\n' ' ' | sed 's/ *$//')"
else
  echo "Launch failed. Check log: ${RUN_LOG}" >&2
  exit 1
fi

echo "[5/5] Done."
