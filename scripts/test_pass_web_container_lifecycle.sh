#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
compose_file="$repo_root/apps/pass-web/docker-compose.yml"
project_name="pass-web-lifecycle-${GITHUB_RUN_ID:-$$}"
test_port="${PASS_WEB_LIFECYCLE_PORT:-53336}"

cleanup() {
  PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_healthy() {
  for _attempt in $(seq 1 60); do
    if curl --fail --silent "http://127.0.0.1:${test_port}/healthz" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" ps
  PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" logs --tail=100 pass-web
  return 1
}

PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" build pass-web
PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" up -d pass-web
wait_healthy

PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" restart pass-web
wait_healthy

PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" exec -T pass-web sh -c 'kill -9 1' || true
wait_healthy

PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" up -d --force-recreate pass-web
wait_healthy

echo "PASS_WEB_CONTAINER_LIFECYCLE_OK"
