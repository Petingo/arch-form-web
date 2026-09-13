#!/usr/bin/env bash
set -eu

port="${1:-4173}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/../.." && pwd)"
workspace_dir="$(dirname -- "$repo_dir")"
printf 'Arch Form: http://localhost:%s/%s/web/\n' "$port" "$(basename -- "$repo_dir")"
python3 -m http.server "$port" --directory "$workspace_dir"
