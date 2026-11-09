#!/usr/bin/env bash
# Clean-machine end-to-end test: tool installation through reference
# application verification (plan Step 13). Opt-in: it creates and destroys a
# Minikube profile, so it never runs unless KORE_RUN_CLEAN_MACHINE=1 is set.
# The profile is a throwaway of its own (kore-clean-machine), never kore-local,
# and the cluster half runs as the live spec `npm run test:integration:clean-machine`
# from a staged copy of the checkout, so a developer's kore-local is untouched.
#
# Run it on a host (or CI runner) with Docker and a checkout of this
# repository and nothing else installed:
#
#   KORE_RUN_CLEAN_MACHINE=1 tools/kore/scripts/clean-machine-e2e.sh
#
# It uses only the documented commands, each with an explicit --environment,
# reads no Secret value, and deletes only the throwaway profile it created.
set -euo pipefail

if [ "${KORE_RUN_CLEAN_MACHINE:-}" != "1" ]; then
  echo "skipped: set KORE_RUN_CLEAN_MACHINE=1 to create and destroy a local Minikube profile" >&2
  exit 0
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"
environment=local

kore() {
  mise exec -- npm --prefix tools/kore run --silent kore -- "$@"
}

step() { printf '\n== %s\n' "$*" >&2; }

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

step "preflight: doctor and validate (read-only)"
kore doctor --environment "$environment"
kore validate --environment "$environment"

step "create, verify and destroy the throwaway profile kore-clean-machine"
mise exec -- npm --prefix tools/kore run --silent test:integration:clean-machine

echo "clean-machine end-to-end test passed" >&2
