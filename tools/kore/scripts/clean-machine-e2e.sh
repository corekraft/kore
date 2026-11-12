#!/usr/bin/env bash
# Clean-machine end-to-end test: tool installation through reference
# application verification (plan Step 13). Opt-in: it creates and destroys a
# local cluster, so it never runs unless KORE_RUN_CLEAN_MACHINE=1 is set.
#
# Run it on a host (or CI runner) with Docker and a checkout of this
# repository and nothing else installed:
#
#   KORE_RUN_CLEAN_MACHINE=1 tools/kore/scripts/clean-machine-e2e.sh
#
# It uses only the documented commands, each with an explicit --environment,
# reads no Secret value, and always destroys the profile it created.
set -euo pipefail

if [ "${KORE_RUN_CLEAN_MACHINE:-}" != "1" ]; then
  echo "skipped: set KORE_RUN_CLEAN_MACHINE=1 to create and destroy the local k3d cluster" >&2
  exit 0
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"
environment=local

kore() {
  mise exec -- npm --prefix tools/kore run --silent kore -- "$@"
}

step() { printf '\n== %s\n' "$*" >&2; }

cleanup() {
  status=$?
  step "destroying the profile (status $status)"
  kore local down --environment "$environment" --prune --purge-data || true
  exit "$status"
}

step "install the pinned toolchain"
if ! command -v mise >/dev/null 2>&1; then
  echo "mise is required first: https://mise.jdx.dev/getting-started.html" >&2
  exit 1
fi
mise install
mise exec -- npm --prefix tools/kore ci

step "unit tests and policy tests need no cluster"
mise exec -- npm --prefix tools/kore test
mise run test-opa

step "preflight: doctor and validate"
kore doctor --environment "$environment"
kore validate --environment "$environment"

trap cleanup EXIT

step "one command creates and validates the complete local platform"
kore local up --environment "$environment"

step "platform status: every component ready, admission gate open"
platform_json="$(kore platform status --environment "$environment" --json)"
if grep -q '"status": "\(missing\|degraded\)"' <<<"$platform_json"; then
  echo "platform reports a missing or degraded component" >&2
  echo "$platform_json" >&2
  exit 1
fi

step "app status reports digest, signer, registry and enforcement"
app_json="$(kore app status reference --environment "$environment" --json)"
for field in '"digest"' '"signer"' '"registry"' '"namespaceImageEnforcement": "enrolled"' '"matchesLock": true'; do
  grep -q "$field" <<<"$app_json" || {
    echo "app status is missing $field" >&2
    exit 1
  }
done

step "reference application smoke test (mTLS, health, HTTPS route, database, token)"
mise exec -- npm --prefix tools/kore run --silent build
mise exec -- node --input-type=module -e '
  const { loadRepository } = await import("./tools/kore/dist/src/config/index.js");
  const { ProcessRunner } = await import("./tools/kore/dist/src/runtime/index.js");
  const { assertReferenceSmoke } = await import(
    "./tools/kore/dist/src/platform/platform.reference-smoke.integration.spec.js"
  );
  const repository = await loadRepository("local");
  await assertReferenceSmoke(repository, new ProcessRunner());
'

step "idempotency: a second up changes no release"
kore local up --environment "$environment"

echo "clean-machine end-to-end test passed" >&2
