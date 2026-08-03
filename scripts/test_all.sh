#!/usr/bin/env bash
# Run the repository's local verification baseline without depending on stale
# Cargo build artifacts. Optional integration suites are opt-in because they
# can build/download a Docker image or require Android SDK tooling.
set -u -o pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DOCKER=0
RUN_ANDROID=0
for argument in "$@"; do
  case "$argument" in
    --docker) RUN_DOCKER=1 ;;
    --android) RUN_ANDROID=1 ;;
    -h|--help)
      cat <<'USAGE'
用法：scripts/test_all.sh [--docker] [--android]

默认运行不需要下载的 JS、Python、Rust、命令矩阵和文档检查。
--docker 运行 Docker Web 生命周期测试，--android 运行 Android 单元测试。
USAGE
      exit 0
      ;;
    *)
      echo "未知参数：$argument" >&2
      exit 2
      ;;
  esac
done

failures=()
environment_unavailable=()
node_available=0

run_step() {
  local name="$1"
  shift
  printf '\n[%s]\n' "$name"
  if "$@"; then
    printf 'PASS %s\n' "$name"
  else
    local status=$?
    printf 'FAIL %s (exit %s)\n' "$name" "$status" >&2
    failures+=("$name:$status")
  fi
}

require_command() {
  local command_name="$1"
  local step_name="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'ENVIRONMENT_UNAVAILABLE %s：缺少命令 %s\n' "$step_name" "$command_name" >&2
    environment_unavailable+=("$step_name:missing-$command_name")
    return 1
  fi
  return 0
}

if require_command node "extension-js"; then
  node_available=1
fi
if [[ "$node_available" != "1" || ! -d "$ROOT/apps/extension_shared/node_modules" ]]; then
  if [[ -d "$ROOT/apps/extension_shared/node_modules" ]]; then
    :
  else
    printf 'ENVIRONMENT_UNAVAILABLE extension-js：apps/extension_shared/node_modules 不存在，请先安装锁定依赖\n' >&2
    environment_unavailable+=("extension-js:missing-node_modules")
  fi
else
  run_step "版本与内嵌同步服务器检查" node "$ROOT/scripts/version.mjs" check
  run_step "扩展共享层 Node 测试" npm --prefix "$ROOT/apps/extension_shared" test
fi

if require_command python3 "python"; then
  python_bin="$ROOT/apps/sync_server_ubuntu/.venv/bin/python"
  if [[ ! -x "$python_bin" ]]; then python_bin="$(command -v python3)"; fi
  run_step "同步服务器 Python 测试" "$python_bin" -m unittest discover -s "$ROOT/apps/sync_server_ubuntu/tests" -p 'test_*.py'
  run_step "脚本 Python 测试" "$python_bin" -m unittest discover -s "$ROOT/scripts/tests" -p 'test_*.py'
else
  python_bin=""
fi

if require_command cargo "rust"; then
  provided_target=0
  if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then provided_target=1; fi
  target_dir="${CARGO_TARGET_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/pass-test-all.XXXXXX")}"
  if [[ ! "$target_dir" = /* ]]; then
    target_dir="$(cd "$ROOT" && mkdir -p "$target_dir" && cd "$target_dir" && pwd)"
  fi
  export CARGO_TARGET_DIR="$target_dir"
  cleanup_target=$((1 - provided_target))
  run_step "pass-core Rust 测试" cargo test --manifest-path "$ROOT/core/pass_core/Cargo.toml" --workspace --locked
  run_step "pass-merge CLI 构建" cargo build --manifest-path "$ROOT/core/pass_core/Cargo.toml" -p pass-merge --bin pass-merge-cli --locked
  if [[ "$node_available" == "1" ]]; then
    run_step "JS 与 Rust 合并对拍" node "$ROOT/core/pass_core/js/check_merge_parity.mjs"
  fi
  run_step "Pass Web Rust 测试" cargo test --manifest-path "$ROOT/apps/pass-web/Cargo.toml" --locked
  run_step "Tauri Rust 测试" cargo test --manifest-path "$ROOT/apps/codex-tauri/src-tauri/Cargo.toml" --locked
  run_step "领域 FFI 对拍" bash "$ROOT/scripts/check_domain_ffi.sh"
else
  cleanup_target=0
fi

if [[ "$node_available" == "1" ]]; then
  run_step "命令矩阵检查" node "$ROOT/scripts/check_command_matrix.mjs"
  run_step "Markdown 链接检查" node "$ROOT/scripts/check_markdown_links.mjs"
fi

if [[ "$RUN_DOCKER" == "1" ]]; then
  if require_command docker "docker" && docker info >/dev/null 2>&1; then
    run_step "Docker Web 生命周期测试" bash "$ROOT/scripts/test_pass_web_container_lifecycle.sh"
  else
    printf 'ENVIRONMENT_UNAVAILABLE docker：Docker daemon 不可用\n' >&2
    environment_unavailable+=("docker:daemon-unavailable")
  fi
fi

if [[ "$RUN_ANDROID" == "1" ]]; then
  if [[ -x "$ROOT/apps/android_credential_provider/gradlew" ]]; then
    run_step "Android Provider 单元测试" bash -lc "cd '$ROOT/apps/android_credential_provider' && ./gradlew testDebugUnitTest"
  else
    printf 'ENVIRONMENT_UNAVAILABLE android：缺少 apps/android_credential_provider/gradlew\n' >&2
    environment_unavailable+=("android:missing-gradlew")
  fi
fi

if [[ "$cleanup_target" == "1" && -n "${target_dir:-}" && -d "$target_dir" ]]; then
  rm -rf "$target_dir"
fi

printf '\n=== 测试汇总 ===\n'
if ((${#failures[@]})); then printf '代码失败：%s\n' "${failures[*]}"; else printf '代码失败：无\n'; fi
if ((${#environment_unavailable[@]})); then printf '环境不可用：%s\n' "${environment_unavailable[*]}"; else printf '环境不可用：无\n'; fi

if ((${#failures[@]})); then exit 1; fi
if ((${#environment_unavailable[@]})); then exit 2; fi
exit 0
