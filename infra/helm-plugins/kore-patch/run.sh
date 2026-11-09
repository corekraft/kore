#!/bin/sh
# Helm post-renderer entry (ADR 0081): the rendered manifests arrive on stdin,
# the catalog's probe patches as the one argument. The patcher is kore's own
# Node entry point, built into tools/kore/dist; it uses only the standard library.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
entry="$here/../../../tools/kore/dist/src/cli/post-render.js"
if [ ! -f "$entry" ]; then
  echo "kore-patch: $entry is missing; run 'npm run build' in tools/kore" >&2
  exit 1
fi
exec node "$entry" "$@"
