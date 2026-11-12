#!/usr/bin/env bash
# Git merge driver for skills/bin/harness.mjs (driver name: harness-bundle).
# Git calls it as `merge-driver.sh %O %A %B %P %Y` and takes the merged file from
# %A. Instead of merging generated text, it rebuilds the bundle from the
# sources as they merge. Register it with `mise run setup-merge-driver`.
#
# While a merge runs, the working tree still holds the old sources, so this
# computes the merged tree itself with `git merge-tree` and builds from that.
set -euo pipefail

base_file="$1"
ours_file="$2"
theirs_file="$3"
root="$(git rev-parse --show-toplevel)"

# On any failure, fall back to a plain text merge so the bundle carries conflict
# markers. Git marks the path unmerged, and a stale copy of one side can never
# be committed by accident. Fix: resolve the sources, then `mise run harness-build`.
finish() {
  status=$?
  if [ "$status" -ne 0 ]; then
    git merge-file "$ours_file" "$base_file" "$theirs_file" >/dev/null 2>&1 || true
    echo "harness-bundle merge driver: left skills/bin/harness.mjs conflicted; resolve the sources, then run \`mise run harness-build\`." >&2
  fi
  rm -rf "${work:-}"
  exit "$status"
}
work=""
trap finish EXIT

if [ ! -d "$root/tools/harness/node_modules" ]; then
  echo "harness-bundle merge driver: tools/harness/node_modules is missing; run \`npm ci --prefix tools/harness\` and merge again." >&2
  exit 1
fi

# Git has not written MERGE_HEAD or REBASE_HEAD yet, but it passes the label of
# the side being merged in (%Y): a branch or commit name for a merge, and
# "<short sha> (<subject>)" for a rebase or cherry-pick step.
theirs_label="${5:-}"
base_args=()
case "$theirs_label" in
  *" ("*) commit_name="${theirs_label%% *}"; replay=1 ;;
  *) commit_name="$theirs_label"; replay=0 ;;
esac
theirs=""
if [ -n "$commit_name" ]; then
  theirs="$(git rev-parse -q --verify "$commit_name^{commit}" || true)"
fi
if [ -z "$theirs" ]; then
  echo "harness-bundle merge driver: cannot tell which commit is merging in (label '$theirs_label')." >&2
  echo "Run \`mise run harness-build\` and commit the rebuilt skills/bin/harness.mjs." >&2
  exit 1
fi
# A replayed commit merges against its own parent, not the branch merge base.
if [ "$replay" -eq 1 ]; then
  base_args=("--merge-base=$theirs^")
fi

# The recursive merge-tree must not call this driver again; `true` keeps ours.
set +e
tree_out="$(git -c merge.harness-bundle.driver=true merge-tree --write-tree --name-only ${base_args[@]+"${base_args[@]}"} HEAD "$theirs")"
tree_status=$?
set -e
tree="${tree_out%%$'\n'*}"
if [ -z "$tree" ] || [ "$tree_status" -gt 1 ]; then
  echo "harness-bundle merge driver: could not compute the merged sources." >&2
  exit 1
fi
# merge-tree exits 1 for a conflict anywhere; only one under tools/harness matters.
if [ "$tree_status" -eq 1 ] && printf '%s\n' "$tree_out" | grep -q '^tools/harness/'; then
  echo "harness-bundle merge driver: the harness sources conflict." >&2
  exit 1
fi

work="$(mktemp -d)"
git archive "$tree" tools/harness | tar -x -C "$work"
mkdir -p "$work/skills/bin"
if [ -d "$root/tools/harness/node_modules" ]; then
  ln -s "$root/tools/harness/node_modules" "$work/tools/harness/node_modules"
fi

npm --prefix "$work/tools/harness" run build --silent >&2
cp "$work/skills/bin/harness.mjs" "$ours_file"
