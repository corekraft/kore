#!/usr/bin/env bash
# Nightly live proof (issue #339): a clean `kore local up`, then every opt-in
# `test:integration*` suite in tools/kore/package.json against that one
# cluster, then teardown. Opt-in only: it destroys and purges the `local`
# profile (cluster `kore-local`), so run it on a dedicated host (ADR 0093).
#
# Order: purge any old profile, `local up`, check platform status, `local up`
# again (must converge), run the suites, and only then purge. The teardown is
# an EXIT trap, so it always runs last, whatever failed. A failing suite never
# hides the ones after it: every suite runs, failures are named, and the exit
# status is non-zero if any failed. If `local up` fails, the suites are skipped.
#
# Each stage runs under GNU `timeout --kill-after`, so a hung stage is stopped
# and named instead of holding the runner. GNU timeout is required: Linux has
# it; on macOS install coreutils (`brew install coreutils`, which provides
# `gtimeout`).
#
# Test seams: KORE_NIGHTLY_KORE and KORE_NIGHTLY_SUITE_CMD replace the commands,
# KORE_NIGHTLY_SUITES (even empty) replaces the discovered suite list, one per
# line; KORE_NIGHTLY_DISCOVER_CMD replaces the discovery command.
set -uo pipefail

if [ "${KORE_RUN_NIGHTLY:-}" != "1" ]; then
  echo "skipped: set KORE_RUN_NIGHTLY=1 to create, purge and destroy the local k3d cluster" >&2
  exit 0
fi

if command -v timeout >/dev/null 2>&1; then
  timeout_bin=timeout
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_bin=gtimeout
else
  echo "GNU timeout is required so a hung stage is killed and named; on macOS run: brew install coreutils (provides gtimeout)" >&2
  exit 2
fi

script_dir="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
cd "$script_dir/../../.."

stage_limit="${KORE_NIGHTLY_STAGE_TIMEOUT:-45m}"
kill_after="${KORE_NIGHTLY_KILL_AFTER:-60s}"
environment=local
failed=()

read -r -a kore_cmd <<<"${KORE_NIGHTLY_KORE:-mise exec -- npm --prefix tools/kore run --silent kore --}"
discover_cmd="${KORE_NIGHTLY_DISCOVER_CMD:-mise exec -- node -e 'const { scripts } = require(\"./tools/kore/package.json\"); console.log(Object.keys(scripts).filter((name) => name.startsWith(\"test:integration\")).join(\"\\n\"));'}"
read -r -a suite_cmd <<<"${KORE_NIGHTLY_SUITE_CMD:-mise exec -- npm --prefix tools/kore run --silent}"

run_stage() {
  local name="$1"
  shift
  printf '\n== %s\n' "$name" >&2
  local start=$SECONDS
  "$timeout_bin" --kill-after="$kill_after" "$stage_limit" "$@"
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
  return "$status"
}

teardown() {
  local status=$?
  run_stage "teardown: purge the profile" "${kore_cmd[@]}" local down --environment "$environment" --prune --purge-data
  printf '\n== nightly summary\n' >&2
  if [ "${#failed[@]}" -gt 0 ]; then
    printf 'failed: %s\n' "${failed[@]}" >&2
    exit 1
  fi
  [ "$status" -eq 0 ] && echo "all stages passed" >&2
  exit "$status"
}
trap teardown EXIT

if [ -n "${KORE_NIGHTLY_SUITES+set}" ]; then
  suites="$KORE_NIGHTLY_SUITES"
elif ! suites="$(bash -c "$discover_cmd")"; then
  echo "FAILED: suite discovery failed (see the error above); the night cannot prove anything without suites" >&2
  failed+=("suite discovery failed")
  exit 1
fi
if [ -z "${suites//[[:space:]]/}" ]; then
  echo "FAILED: found no test:integration suites in tools/kore/package.json; a night with nothing to run must not pass" >&2
  failed+=("found no test:integration suites")
  exit 1
fi

run_stage "clean start: purge any old profile" "${kore_cmd[@]}" local down --environment "$environment" --prune --purge-data
if run_stage "clean local up" "${kore_cmd[@]}" local up --environment "$environment" &&
  run_stage "platform status: every component ready" "${kore_cmd[@]}" platform status --environment "$environment" &&
  run_stage "second local up converges" "${kore_cmd[@]}" local up --environment "$environment"; then
  while IFS= read -r suite; do
    [ -n "$suite" ] || continue
    run_stage "$suite" "${suite_cmd[@]}" "$suite"
  done <<<"$suites"
else
  echo "local up did not converge: skipping the suites" >&2
fi
