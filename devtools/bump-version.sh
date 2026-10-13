#!/usr/bin/env bash
set -euo pipefail

# Keep the public entry point independent of the caller's working directory.
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$root_dir/devtools/bump-version.mjs" "$@"
