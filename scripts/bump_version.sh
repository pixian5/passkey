#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SHARED_DIR="$ROOT_DIR/apps/extension_shared"
PACKAGE_JSON="$SHARED_DIR/package.json"

CURRENT_VERSION=$(awk -F'"' '/"version":/ {print $4; exit}' "$PACKAGE_JSON")

if [ -z "$CURRENT_VERSION" ]; then
    echo "Error: Could not find current version"
    exit 1
fi

echo "Current version: $CURRENT_VERSION"

IFS='.' read -r major minor patch <<< "$CURRENT_VERSION"

new_patch=$((patch + 1))
new_minor=$minor
new_major=$major

if [ $new_patch -ge 10 ]; then
    new_patch=0
    new_minor=$((minor + 1))
    if [ $new_minor -ge 10 ]; then
        new_minor=0
        new_major=$((major + 1))
    fi
fi

NEW_VERSION="${new_major}.${new_minor}.${new_patch}"

echo "Updating version from $CURRENT_VERSION to $NEW_VERSION"

# Canonical source: extension_shared/package.json only.
# scripts/build.mjs regenerates extension_version.js and syncs extension_shared/manifest.json.
if [ -f "$PACKAGE_JSON" ]; then
    if command -v python3 >/dev/null 2>&1; then
        python3 - "$PACKAGE_JSON" "$NEW_VERSION" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
data["version"] = version
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
    else
        sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
        rm -f "${PACKAGE_JSON}.bak"
    fi
    echo "Updated: extension_shared/package.json"
fi

shell_packages=(
    "$ROOT_DIR/apps/extension_chrome/package.json"
    "$ROOT_DIR/apps/extension_firefox/package.json"
)
for file in "${shell_packages[@]}"; do
    if [ -f "$file" ]; then
        if command -v python3 >/dev/null 2>&1; then
            python3 - "$file" "$NEW_VERSION" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
data["version"] = version
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
        else
            sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$file"
            rm -f "${file}.bak"
        fi
        echo "Updated: $(basename "$(dirname "$file")")/package.json"
    fi
done

# Shell manifests still own their own version field for store packaging.
shell_manifests=(
    "$ROOT_DIR/apps/extension_chrome/manifest.json"
    "$ROOT_DIR/apps/extension_firefox/manifest.json"
)
for file in "${shell_manifests[@]}"; do
    if [ -f "$file" ]; then
        if command -v python3 >/dev/null 2>&1; then
            python3 - "$file" "$NEW_VERSION" <<'PY'
import json, sys
path, version = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)
data["version"] = version
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
        else
            sed -i.bak "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" "$file"
            rm -f "${file}.bak"
        fi
        echo "Updated: $(basename "$(dirname "$file")")/manifest.json"
    fi
done

if [ -f "$ROOT_DIR/apps/app_macos/project.yml" ]; then
    sed -i.bak "s/MARKETING_VERSION: \"$CURRENT_VERSION\"/MARKETING_VERSION: \"$NEW_VERSION\"/g" "$ROOT_DIR/apps/app_macos/project.yml"
    rm -f "$ROOT_DIR/apps/app_macos/project.yml.bak"
    echo "Updated: project.yml"
fi

if [ -f "$ROOT_DIR/apps/app_macos/project.autofill.yml" ]; then
    sed -i.bak "s/MARKETING_VERSION: \"$CURRENT_VERSION\"/MARKETING_VERSION: \"$NEW_VERSION\"/g" "$ROOT_DIR/apps/app_macos/project.autofill.yml"
    rm -f "$ROOT_DIR/apps/app_macos/project.autofill.yml.bak"
    echo "Updated: project.autofill.yml"
fi

# Regenerate extension_version.js + extension_shared/manifest version from package.json.
(
  cd "$SHARED_DIR"
  npm run build >/dev/null
)
echo "Rebuilt extension_shared dist with version $NEW_VERSION"

echo ""
echo "Version updated to $NEW_VERSION"
