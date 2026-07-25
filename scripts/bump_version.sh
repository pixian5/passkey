#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

node "${SCRIPT_DIR}/version.mjs" bump

# Regenerate shared extension bundles and version constants from the canonical version.
(
  cd "${ROOT_DIR}/apps/extension_shared"
  npm run build >/dev/null
)

node "${SCRIPT_DIR}/version.mjs" check
echo "Version updated to $(node "${SCRIPT_DIR}/version.mjs" current)"
