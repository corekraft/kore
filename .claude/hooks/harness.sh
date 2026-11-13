#!/bin/sh
# Launcher for the harness bundle (ADR 0092). Every hook in .claude/settings.json
# runs through it: `harness.sh hook guard`.
#
# The bundle is a build output, so a fresh worktree has none until
# `npm ci --prefix tools/harness && mise run harness-build`. Lookup order:
#   1. $KORE_HARNESS_BUNDLE, a read-only copy outside the worktree. When it is
#      set it is the only candidate: a path that points nowhere never falls back.
#   2. $CLAUDE_PROJECT_DIR/skills/bin/harness.mjs, built in this worktree.
# With no bundle the guard exits 2 (Claude Code blocks the tool call) so it
# fails closed; other hooks exit 1 so a missing build never traps a session,
# for example a Stop hook that would otherwise refuse to let it end.
if [ -n "${KORE_HARNESS_BUNDLE:-}" ]; then
  bundle="$KORE_HARNESS_BUNDLE"
  source="KORE_HARNESS_BUNDLE"
else
  root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
  bundle="$root/skills/bin/harness.mjs"
  source="the worktree"
fi

if [ ! -f "$bundle" ]; then
  echo "harness bundle not found at $bundle (from $source)." >&2
  echo "Fix: run \`npm ci --prefix tools/harness && mise run harness-build\`, or point KORE_HARNESS_BUNDLE at a built skills/bin/harness.mjs." >&2
  if [ "${1:-}" = "hook" ] && [ "${2:-}" = "guard" ]; then
    echo "Blocked: the guard hook cannot run without the bundle." >&2
    exit 2
  fi
  exit 1
fi
exec node "$bundle" "$@"
