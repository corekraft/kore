#!/usr/bin/env bash
# Fail when skills/bin/harness.mjs is stale: rebuild it and compare with the
# committed copy. Needs `npm ci --prefix tools/harness`. Run via `mise run harness-check`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
bundle="$root/skills/bin/harness.mjs"
before="$(mktemp)"
trap 'rm -f "$before"' EXIT

if [ -f "$bundle" ]; then
  cp "$bundle" "$before"
else
  : >"$before"
fi
npm --prefix "$root/tools/harness" run build --silent

if ! cmp -s "$before" "$bundle"; then
  echo "skills/bin/harness.mjs is stale: it differs from a fresh build of tools/harness/src." >&2
  echo "Run \`mise run harness-build\` and commit the rebuilt skills/bin/harness.mjs." >&2
  exit 1
fi
