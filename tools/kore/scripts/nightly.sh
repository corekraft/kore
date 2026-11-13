#!/usr/bin/env bash
# Nightly live proof (issue #339): a clean `kore local up`, then every opt-in
# `test:integration*` suite in tools/kore/package.json against that one
# cluster, then teardown. Opt-in only: it creates and destroys a scratch
# profile (environment and cluster `kore-nightly`), so run it on a dedicated
# host (ADR 0093).
#
# Scratch environment (issue #363): the `local` overlay's SOPS secrets are
# encrypted to the owner's age key, which the runner does not have and must
# not be given. The job copies `local` to a scratch overlay of its own name,
# generates an age identity with `age-keygen`, replaces the overlay's recipient
# with its public half, and generates fresh values for the overlay's secrets,
# encrypting them with sops from stdin. The identity lives in the process
# environment (SOPS_AGE_KEY) and the plaintext in shell variables and pipes:
# neither touches disk and neither is uploaded. The committed `local` overlay
# is never edited. The suites follow KORE_INTEGRATION_ENVIRONMENT.
#
# Order: create the scratch overlay, purge any old profile, `local up`, check
# platform status, `local up` again (must converge), run the suites (lifecycle
# last, it tears the cluster down; the bare `test:integration` is skipped), and only
# then purge and remove the overlay. The teardown is an EXIT trap, so it always
# runs last, whatever failed. The job summary records duration and peak memory. A failing suite never
# hides the ones after it: every suite runs, failures are named, and the exit
# status is non-zero if any failed. If `local up` fails, the suites are skipped.
#
# Each stage runs under GNU `timeout --kill-after`, so a hung stage is stopped
# and named instead of holding the runner. GNU timeout is required: Linux has
# it; on macOS install coreutils (`brew install coreutils`, which provides
# `gtimeout`).
#
# Test seams: KORE_NIGHTLY_KORE and KORE_NIGHTLY_SUITE_CMD replace the commands,
# KORE_NIGHTLY_AGE_KEYGEN and KORE_NIGHTLY_SOPS replace age-keygen and sops,
# KORE_NIGHTLY_MEMINFO and KORE_NIGHTLY_MEM_INTERVAL the memory sampling,
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
environment=nightly
failed=()
started=$SECONDS

read -r -a kore_cmd <<<"${KORE_NIGHTLY_KORE:-mise exec -- npm --prefix tools/kore run --silent kore --}"
discover_cmd="${KORE_NIGHTLY_DISCOVER_CMD:-mise exec -- node -e 'const { scripts } = require(\"./tools/kore/package.json\"); console.log(Object.keys(scripts).filter((name) => name.startsWith(\"test:integration\")).join(\"\\n\"));'}"
read -r -a age_keygen_cmd <<<"${KORE_NIGHTLY_AGE_KEYGEN:-mise exec -- age-keygen}"
read -r -a sops_cmd <<<"${KORE_NIGHTLY_SOPS:-mise exec -- sops}"
meminfo="${KORE_NIGHTLY_MEMINFO:-/proc/meminfo}"
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

scratch_dir="infra/environments/$environment"
cluster="kore-$environment"
context="k3d-$cluster"
overlay_created=0
work="$(mktemp -d)"
sampler_pid=""

# Peak memory in use (MemTotal - MemAvailable, MiB), kept in a file because the
# sampler is a background process. Unmeasured where there is no /proc/meminfo.
sample_memory() {
  [ -r "$meminfo" ] || return 0
  local used
  used="$(awk '/^MemTotal:/ { total = $2 } /^MemAvailable:/ { avail = $2 } END { if (total > 0) printf "%d", (total - avail) / 1024 }' "$meminfo")"
  [ -n "$used" ] || return 0
  if [ "$used" -gt "$(cat "$work/peak" 2>/dev/null || echo 0)" ]; then
    echo "$used" >"$work/peak"
  fi
}

report_summary() {
  local duration=$((SECONDS - started)) peak="not measured"
  [ -s "$work/peak" ] && peak="$(cat "$work/peak") MiB"
  local text
  text="### nightly live proof ($environment)"$'\n'"- duration: ${duration}s"$'\n'"- peak memory: $peak"
  printf '\n%s\n' "$text" >&2
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '%s\n' "$text" >>"$GITHUB_STEP_SUMMARY"
  fi
}

teardown() {
  local status=$?
  if [ "$overlay_created" -eq 1 ]; then
    if run_stage "teardown: purge the profile" "${kore_cmd[@]}" local down --environment "$environment" --prune --purge-data; then
      rm -rf "$scratch_dir"
      if [ -n "${exclude:-}" ] && [ -f "$exclude" ]; then
        grep -vxF "/$scratch_dir/" "$exclude" >"$work/exclude" || true
        cat "$work/exclude" >"$exclude"
      fi
    else
      echo "the scratch overlay $scratch_dir is kept; remove it by hand once the cluster $cluster is gone: k3d cluster delete $cluster && rm -rf ~/.kore/k3d/$cluster $scratch_dir" >&2
    fi
  fi
  [ -z "$sampler_pid" ] || kill "$sampler_pid" 2>/dev/null
  sample_memory
  report_summary
  rm -rf "$work"
  printf '\n== nightly summary\n' >&2
  if [ "${#failed[@]}" -gt 0 ]; then
    printf 'failed: %s\n' "${failed[@]}" >&2
    exit 1
  fi
  [ "$status" -eq 0 ] && echo "all stages passed" >&2
  exit "$status"
}
trap teardown EXIT

fail_setup() {
  echo "FAILED: $1" >&2
  failed+=("scratch environment setup")
  exit 1
}

# The scratch overlay: a copy of `local` with its own name, cluster and context,
# kept out of git, re-encrypted to a key made for this run.
create_scratch_overlay() {
  [ -z "$(git ls-files -- "$scratch_dir")" ] || fail_setup "$scratch_dir is committed; the nightly only creates and removes scratch overlays"
  local secret known=sops-canary.enc.yaml
  for secret in infra/environments/local/secrets/*.enc.yaml; do
    [ -e "$secret" ] || continue
    [ "${secret##*/}" = "$known" ] ||
      fail_setup "infra/environments/local/secrets/${secret##*/} is a secret the nightly does not know how to generate; teach nightly.sh to generate a fresh value for it (it cannot decrypt the owner's)"
  done

  [ ! -e "$scratch_dir" ] || fail_setup "$scratch_dir already exists; the nightly will not delete a directory it did not create. Remove it (and any cluster $cluster) by hand, then rerun"
  cp -R infra/environments/local "$scratch_dir" || fail_setup "could not copy the local overlay to $scratch_dir"
  overlay_created=1
  if exclude="$(git rev-parse --git-path info/exclude 2>/dev/null)"; then
    grep -qxF "/$scratch_dir/" "$exclude" 2>/dev/null || echo "/$scratch_dir/" >>"$exclude"
  fi
  local env_file="$scratch_dir/environment.yaml"
  sed -i.bak \
    -e "s/\"name\": \"local\"/\"name\": \"$environment\"/" \
    -e "s/\"kubeContext\": \"k3d-kore-local\"/\"kubeContext\": \"$context\"/" \
    -e "s/\"clusterName\": \"kore-local\"/\"clusterName\": \"$cluster\"/" \
    "$env_file" && rm -f "$env_file.bak"
  local want
  for want in "\"name\": \"$environment\"" "\"kubeContext\": \"$context\"" "\"clusterName\": \"$cluster\""; do
    grep -qF "$want" "$env_file" || fail_setup "could not rewrite $env_file: missing $want"
  done
  # Nothing in the copy is decryptable here: drop every encrypted document.
  rm -f "$scratch_dir"/secrets/*.enc.yaml

  local identity recipient
  identity="$("${age_keygen_cmd[@]}" | grep '^AGE-SECRET-KEY-')" || fail_setup "age-keygen did not produce an identity"
  recipient="$(printf '%s\n' "$identity" | "${age_keygen_cmd[@]}" -y)" || fail_setup "age-keygen -y could not derive the recipient"
  [ -n "$recipient" ] || fail_setup "age-keygen -y printed no recipient"
  # Tell the Actions runner to mask the identity in every later log line.
  echo "::add-mask::$identity"
  export SOPS_AGE_KEY="$identity"
  unset identity

  cat >"$scratch_dir/.sops.yaml" <<YAML
creation_rules:
  - path_regex: .*\.enc\.yaml\$
    encrypted_regex: '^(data|stringData)\$'
    age: $recipient
YAML

  local canary manifest
  canary="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
  [ "${#canary}" -eq 32 ] || fail_setup "could not generate a canary value from /dev/urandom"
  manifest="apiVersion: v1
kind: Secret
metadata:
  name: kore-sops-canary
  labels:
    platform.kore.dev/secret-source: \"true\"
type: Opaque
stringData:
  canary: $canary"
  unset canary
  local target="$scratch_dir/secrets/sops-canary.enc.yaml"
  printf '%s\n' "$manifest" | "${sops_cmd[@]}" --encrypt --config "$scratch_dir/.sops.yaml" \
    --filename-override "$target" --input-type yaml --output-type yaml /dev/stdin >"$target" ||
    fail_setup "sops could not encrypt the generated secret $target to the ephemeral recipient"
  unset manifest
}

printf '\n== scratch environment %s: overlay, ephemeral age key, generated secrets\n' "$environment" >&2
create_scratch_overlay
export KORE_INTEGRATION_ENVIRONMENT="$environment"

sample_memory
(
  while sleep "${KORE_NIGHTLY_MEM_INTERVAL:-5}"; do sample_memory; done
) &
sampler_pid=$!

if [ -n "${KORE_NIGHTLY_SUITES+set}" ]; then
  suites="$KORE_NIGHTLY_SUITES"
elif ! suites="$(bash -c "$discover_cmd")"; then
  echo "FAILED: suite discovery failed (see the error above); the night cannot prove anything without suites" >&2
  failed+=("suite discovery failed")
  exit 1
fi
# Only `test:integration:<name>` suites are nightly suites. The bare
# `test:integration` task also runs the unit suite and the OPA tests (its
# platform spec bootstraps them), and its cluster spec stops and deletes the
# night's cluster. The lifecycle suite destroys and recreates the cluster, so it
# runs last, whatever order discovery gives.
suites="$(printf '%s\n' "$suites" | grep -E '^test:integration:.' | grep -vxF 'test:integration:lifecycle'; printf '%s\n' "$suites" | grep -xF 'test:integration:lifecycle')"
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
