#!/bin/sh
# Launcher for the harness bundle (ADR 0092). Every hook in .claude/settings.json
# runs through it: `harness.sh hook guard`.
#
# The bundle is a build output, so a worktree has none until
# `npm ci --prefix tools/harness && mise run harness-build`. Lookup order:
#   1. $KORE_HARNESS_BUNDLE, a read-only copy outside the worktree. When it is
#      set it is the only candidate: a path that points nowhere never falls back.
#   2. $CLAUDE_PROJECT_DIR/skills/bin/harness.mjs, built in this worktree.
#
# The guard fails closed. Claude Code blocks a tool call only on exit 2; any
# other non-zero exit is non-blocking, so for `hook guard` a missing bundle, a
# crash, a syntax error or a missing node (127) all become exit 2. Other hooks
# exit 1 on a missing bundle, so a missing build never traps a session (a
# blocking Stop hook would refuse to let it end), and pass the bundle's own
# exit code through.
if [ -n "${KORE_HARNESS_BUNDLE:-}" ]; then
  bundle="$KORE_HARNESS_BUNDLE"
  source="KORE_HARNESS_BUNDLE"
else
  root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
  bundle="$root/skills/bin/harness.mjs"
  source="the worktree"
fi

guard=0
if [ "${1:-}" = "hook" ] && [ "${2:-}" = "guard" ]; then
  guard=1
fi

if [ ! -f "$bundle" ]; then
  echo "harness bundle not found at $bundle (from $source)." >&2
  echo "Fix: in a terminal outside this session (a tool call inside it is blocked until the bundle exists), run \`npm ci --prefix tools/harness && mise run harness-build\`, or point KORE_HARNESS_BUNDLE at a built skills/bin/harness.mjs." >&2
  if [ "$guard" -eq 1 ]; then
    echo "Blocked: the guard hook cannot run without the bundle." >&2
    exit 2
  fi
  exit 1
fi

if [ "$guard" -eq 0 ]; then
  exec node "$bundle" "$@"
fi

node "$bundle" "$@"
status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then
  echo "Blocked: the guard hook failed with exit $status (bundle $bundle); a crashed guard must not allow the call. Rebuild it in a terminal outside this session: \`mise run harness-build\`." >&2
  exit 2
fi
exit "$status"
