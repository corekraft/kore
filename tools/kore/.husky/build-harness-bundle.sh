#!/usr/bin/env sh
# Builds skills/bin/harness.mjs after a checkout or merge (ADR 0092), so a pull
# that stops tracking the bundle, or a fresh worktree, has hooks working at once.
# Usage: build-harness-bundle.sh always|if-missing
# Never fails the git operation: a failed build prints the fix and exits 0.
mode="${1:-if-missing}"
repo_root="$(git rev-parse --show-toplevel)"
bundle="$repo_root/skills/bin/harness.mjs"

if [ "$mode" != always ] && [ -f "$bundle" ]; then
  exit 0
fi
[ -f "$repo_root/tools/harness/package.json" ] || exit 0

. "$repo_root/tools/kore/.husky/pinned.sh"
fix="run 'npm ci --prefix tools/harness && mise run harness-build' in a terminal"
if [ ! -d "$repo_root/tools/harness/node_modules" ]; then
  (cd "$repo_root/tools/harness" && pinned npm ci --silent) || {
    echo "git hook: npm ci failed for tools/harness; $fix" >&2
    exit 0
  }
fi
(cd "$repo_root/tools/harness" && pinned npm run build --silent) || {
  echo "git hook: building skills/bin/harness.mjs failed; $fix" >&2
}
exit 0
