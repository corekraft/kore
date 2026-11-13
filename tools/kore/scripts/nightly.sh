#!/usr/bin/env bash
# Nightly live proof (issue #339): a clean `kore local up` through the
# clean-machine end-to-end script, then every opt-in `test:integration*` suite
# in tools/kore/package.json. A failing suite never hides the ones after it:
# every suite runs, the failures are named, and the exit status is non-zero if
# any failed. Each stage runs under `timeout` with SIGKILL escalation, so a hung
# stage is killed and reported by name instead of holding the runner until the
# job limit. Opt-in only: it creates and destroys a k3d cluster.
set -uo pipefail

if [ "${KORE_RUN_NIGHTLY:-}" != "1" ]; then
  echo "skipped: set KORE_RUN_NIGHTLY=1 to create and destroy the local k3d cluster" >&2
  exit 0
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"

stage_limit="${KORE_NIGHTLY_STAGE_TIMEOUT:-45m}"
kill_after="${KORE_NIGHTLY_KILL_AFTER:-60s}"
failed=()

run_stage() {
  local name="$1"
  shift
  printf '\n== %s\n' "$name" >&2
  local start=$SECONDS
  timeout --kill-after="$kill_after" "$stage_limit" "$@"
  local status=$?
  if [ "$status" -eq 124 ]; then
    echo "FAILED: $name hung past $stage_limit and was stopped by timeout; see the log above for the last output" >&2
    failed+=("$name (timed out)")
  elif [ "$status" -eq 137 ]; then
    echo "FAILED: $name was killed by SIGKILL (exit 137): it ignored SIGTERM at the $stage_limit limit, or the host killed it (out of memory?)" >&2
    failed+=("$name (killed)")
  elif [ "$status" -ne 0 ]; then
    echo "FAILED: $name exited $status after $((SECONDS - start))s" >&2
    failed+=("$name")
  fi
}

run_stage "clean local up (clean-machine e2e)" \
  env KORE_RUN_CLEAN_MACHINE=1 bash tools/kore/scripts/clean-machine-e2e.sh

suites="$(mise exec -- node -e '
  const { scripts } = require("./tools/kore/package.json");
  console.log(Object.keys(scripts).filter((name) => name.startsWith("test:integration")).join("\n"));
')"
while IFS= read -r suite; do
  [ -n "$suite" ] || continue
  run_stage "$suite" mise exec -- npm --prefix tools/kore run --silent "$suite"
done <<<"$suites"

printf '\n== nightly summary\n' >&2
if [ "${#failed[@]}" -gt 0 ]; then
  printf 'failed: %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "all stages passed" >&2
