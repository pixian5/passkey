#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
compose_file="$repo_root/apps/pass-web/docker-compose.yml"
project_name="pass-web-lifecycle-${GITHUB_RUN_ID:-$$}"
test_port="${PASS_WEB_LIFECYCLE_PORT:-53336}"
crash_port="$((test_port + 1))"
crash_container="${project_name}-crash-probe"

cleanup() {
  docker rm -f "$crash_container" >/dev/null 2>&1 || true
  PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_healthy_at() {
  local port="$1"
  for _attempt in $(seq 1 60); do
    if curl --fail --silent "http://127.0.0.1:${port}/healthz" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_healthy() {
  if wait_healthy_at "$test_port"; then
    return 0
  fi
  PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" ps
  PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" logs --tail=100 pass-web
  return 1
}

PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" build pass-web
PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" up -d pass-web
wait_healthy

PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" restart pass-web
wait_healthy

docker run -d \
  --name "$crash_container" \
  --restart unless-stopped \
  -p "127.0.0.1:${crash_port}:53335" \
  -e PASS_WEB_TRUSTED_LOOPBACK_PROXY=1 \
  --entrypoint /bin/sh \
  pass-web:latest \
  -c '/usr/local/bin/pass-web & child=$!; echo "$child" >/tmp/pass-web-child.pid; wait "$child"' >/dev/null
wait_healthy_at "$crash_port"
restart_count_before="$(docker inspect "$crash_container" --format '{{.RestartCount}}')"
docker exec "$crash_container" sh -c 'kill -9 "$(cat /tmp/pass-web-child.pid)"' || true
for _attempt in $(seq 1 60); do
  restart_count_after="$(docker inspect "$crash_container" --format '{{.RestartCount}}')"
  if (( restart_count_after > restart_count_before )) && curl --fail --silent "http://127.0.0.1:${crash_port}/healthz" >/dev/null; then
    break
  fi
  sleep 1
done
restart_count_after="$(docker inspect "$crash_container" --format '{{.RestartCount}}')"
if (( restart_count_after <= restart_count_before )); then
  echo "pass-web 进程异常终止后容器未发生真实重启（重启次数 ${restart_count_before} -> ${restart_count_after}）" >&2
  exit 1
fi
wait_healthy_at "$crash_port"
docker rm -f "$crash_container" >/dev/null

PASS_WEB_PORT="$test_port" docker compose -p "$project_name" -f "$compose_file" up -d --force-recreate pass-web
wait_healthy

echo "PASS_WEB_CONTAINER_LIFECYCLE_OK"
