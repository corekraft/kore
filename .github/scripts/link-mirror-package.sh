#!/usr/bin/env bash
# Makes sure a mirror package exists and is linked to this repository before the
# first image is copied into it (ADR 0033). GHCR lets a repository's GITHUB_TOKEN
# create only packages linked to that repository, and it links a package from the
# org.opencontainers.image.source label of the first image pushed. A bit-identical
# upstream copy has no such label, so the first push would be denied.
#
# If <repo>:kore-link already exists the script does nothing. Otherwise it builds
# a one-empty-layer image, labels it, and pushes it as <repo>:kore-link. The image
# is never signed and never enters the platform image lock.
#
# crane mutate only edits a pushed image, and the first push to the package must
# already carry the label, so the image is built in a throwaway local registry
# and then copied (digest preserved) into the package.
#
# Usage: link-mirror-package.sh <repo>   e.g. ghcr.io/corekraft/kore/mirror/<name>
# Environment: CRANE (default "crane"; may be several words, e.g. "mise exec -- crane").
set -euo pipefail

[ "$#" -eq 1 ] || { echo "usage: $0 <repo>" >&2; exit 2; }
repo="$1"
read -r -a crane <<< "${CRANE:-crane}"

if "${crane[@]}" digest "$repo:kore-link" > /dev/null 2>&1; then
  echo "$repo: already linked (kore-link exists)" >&2
  exit 0
fi

work="$(mktemp -d)"
log="$work/registry.log"
server=""
cleanup() {
  if [ -n "$server" ]; then
    kill "$server" 2> /dev/null || true
    wait "$server" 2> /dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

"${crane[@]}" registry serve --address 127.0.0.1:0 > "$log" 2>&1 &
server=$!
port=""
for _ in $(seq 1 50); do
  port="$(sed -n 's/.*serving on port \([0-9][0-9]*\).*/\1/p' "$log" | head -n 1)"
  [ -z "$port" ] || break
  sleep 0.2
done
[ -n "$port" ] || { echo "$repo: staging registry did not start" >&2; cat "$log" >&2; exit 1; }

stage="127.0.0.1:$port/kore-link:kore-link"
tar -cf "$work/empty.tar" -T /dev/null
"${crane[@]}" append --new_layer "$work/empty.tar" --new_tag "$stage" > /dev/null
"${crane[@]}" mutate "$stage" \
  --label "org.opencontainers.image.source=https://github.com/corekraft/kore" \
  --label "org.opencontainers.image.description=Created only to link this package to the corekraft/kore repository; it is not a platform image, is never signed, and is not in the lock." \
  --tag "$stage" > /dev/null
"${crane[@]}" copy "$stage" "$repo:kore-link"
echo "$repo: created and linked (kore-link)" >&2
