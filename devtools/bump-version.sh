#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: devtools/bump-version.sh <version>
       devtools/bump-version.sh --check
       devtools/bump-version.sh -h | --help

Bump the tikzc project version in one shot, across every file that must
stay in sync:

  - VERSION
  - package.json                       (root)
  - package-lock.json                  (root)
  - vscode-extension/package.json
  - vscode-extension/package-lock.json

<version> must be a semver string (e.g. 0.1.2). A leading "v" is stripped
if present.

--check reports version mismatches across those same files without
changing anything (exit 0 if consistent, exit 1 if a mismatch is found).

Note: vscode-extension/tikzc-editor/** is a vendored library with its own
independent version and is intentionally left untouched.

Example:
  devtools/bump-version.sh 0.1.2
  devtools/bump-version.sh --check
EOF
}

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

json_field() {
  node -p "JSON.parse(require('fs').readFileSync('$1', 'utf8'))$2" 2>/dev/null || echo "<missing>"
}

# Rewrites only the top-level "version" field, leaving the rest of the file
# byte-for-byte untouched (avoids `npm version`'s side effect of reformatting
# hand-edited JSON, e.g. collapsing multi-line arrays into one line).
set_package_json_version() {
  local file="$1" new_version="$2"
  node -e "
    const fs = require('fs');
    const file = process.argv[1];
    const version = process.argv[2];
    const text = fs.readFileSync(file, 'utf8');
    const pattern = /^(\s*\"version\":\s*\")[^\"]*(\")/m;
    if (!pattern.test(text)) throw new Error('version field not found in ' + file);
    const updated = text.replace(pattern, \`\\\$1\${version}\\\$2\`);
    fs.writeFileSync(file, updated);
  " "$file" "$new_version"
}

# package-lock.json is always npm-generated (2-space indent, one key per
# line), so a full JSON.parse -> edit -> JSON.stringify round-trip is
# byte-for-byte safe here (unlike hand-edited package.json files).
set_package_lock_version() {
  local file="$1" new_version="$2"
  node -e "
    const fs = require('fs');
    const file = process.argv[1];
    const version = process.argv[2];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.version = version;
    if (data.packages && data.packages[''] !== undefined) {
      data.packages[''].version = version;
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  " "$file" "$new_version"
}

check_versions() {
  local expected
  expected="$(tr -d '[:space:]' < "$root_dir/VERSION")"
  local mismatch=0

  report() {
    local label="$1" actual="$2"
    if [ "$actual" = "$expected" ]; then
      echo "  OK    $label: $actual"
    else
      echo "  MISMATCH $label: $actual (expected $expected)"
      mismatch=1
    fi
  }

  echo "Canonical version (VERSION file): $expected"
  report "package.json#version"                              "$(json_field "$root_dir/package.json" ".version")"
  report "package-lock.json#version"                          "$(json_field "$root_dir/package-lock.json" ".version")"
  report "package-lock.json#packages[\"\"].version"           "$(json_field "$root_dir/package-lock.json" '.packages[""].version')"
  report "vscode-extension/package.json#version"               "$(json_field "$root_dir/vscode-extension/package.json" ".version")"
  report "vscode-extension/package-lock.json#version"          "$(json_field "$root_dir/vscode-extension/package-lock.json" ".version")"
  report "vscode-extension/package-lock.json#packages[\"\"].version" "$(json_field "$root_dir/vscode-extension/package-lock.json" '.packages[""].version')"

  if [ "$mismatch" -eq 0 ]; then
    echo "All versions consistent."
    return 0
  else
    echo "Versioning mistake found." >&2
    return 1
  fi
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ "${1:-}" = "--check" ]; then
  check_versions
  exit $?
fi

if [ $# -ne 1 ]; then
  usage >&2
  exit 1
fi

version="${1#v}"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "ERROR: '$version' is not a valid semver version." >&2
  exit 1
fi

echo "Bumping version to $version"

echo "$version" > "$root_dir/VERSION"
echo "  updated VERSION"

set_package_json_version "$root_dir/package.json" "$version"
set_package_lock_version "$root_dir/package-lock.json" "$version"
echo "  updated package.json / package-lock.json"

set_package_json_version "$root_dir/vscode-extension/package.json" "$version"
set_package_lock_version "$root_dir/vscode-extension/package-lock.json" "$version"
echo "  updated vscode-extension/package.json / vscode-extension/package-lock.json"

cat <<EOF

Note: vscode-extension/tikzc-editor/** is a vendored library with its own
independent version and was intentionally left untouched.

Next steps:
  1. Add a "## [$version] - $(date +%Y-%m-%d)" entry to CHANGELOG.md
  2. Review the diff: git diff
  3. Commit
EOF
