#!/usr/bin/env bash
# Live proof for the flag-gated agentgateway install (issue #205).
#
# Opt-in: it creates a local k3d cluster, so it runs only with
# KORE_RUN_AGENTGATEWAY_PROOF=1. It never edits the committed local overlay:
# it copies infra/environments/local to a scratch environment with
# `ingress-agentgateway` on, keeps that copy out of git through
# .git/info/exclude, and removes it on exit.
#
#   KORE_RUN_AGENTGATEWAY_PROOF=1 tools/kore/scripts/agentgateway-live-proof.sh
#
# Proves, in order: the flag off installs nothing; the flag on installs the
# CRDs and controller in dependency order and waits on readiness; the
# agentgateway-system namespace is enrolled in the ambient mesh; a rerun
# changes no Helm release revision.
#
# The k3d host port (8443) is shared with the local environment: run
# `kore local stop --environment local` first if that cluster is up.
set -euo pipefail

if [ "${KORE_RUN_AGENTGATEWAY_PROOF:-}" != "1" ]; then
  echo "skipped: set KORE_RUN_AGENTGATEWAY_PROOF=1 to create and destroy a local k3d cluster" >&2
  exit 0
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"
scratch="${KORE_PROOF_ENVIRONMENT:-local-agentgateway-proof}"
scratch_dir="infra/environments/$scratch"
exclude="$(git rev-parse --git-path info/exclude)"

kore() {
  mise exec -- npm --prefix tools/kore run --silent kore -- "$@"
}
step() { printf '\n== %s\n' "$*" >&2; }
fail() { echo "FAIL: $*" >&2; exit 1; }

revisions() {
  mise exec -- helm list --all-namespaces --kube-context "$context" -o json |
    mise exec -- node -e '
      let s = "";
      process.stdin.on("data", (c) => { s += c; });
      process.stdin.on("end", () => {
        for (const r of JSON.parse(s)) console.log(`${r.namespace}/${r.name} ${r.revision}`);
      });' | sort
}

cleanup() {
  status=$?
  step "destroying the profile and the scratch overlay (status $status)"
  kore local down --environment "$scratch" --prune --purge-data || true
  rm -rf "$scratch_dir"
  exit "$status"
}

step "scratch overlay: copy of local with ingress-agentgateway on (never committed)"
[ -e "$scratch_dir" ] && fail "$scratch_dir already exists; remove it or set KORE_PROOF_ENVIRONMENT"
grep -qxF "/$scratch_dir/" "$exclude" || echo "/$scratch_dir/" >> "$exclude"
cp -R infra/environments/local "$scratch_dir"
trap cleanup EXIT
# Own name, cluster and context: the proof never touches a real kore-local.
cluster="kore-$scratch"
context="k3d-$cluster"
sed -i.bak \
  -e 's/"ingress-agentgateway": false/"ingress-agentgateway": true/' \
  -e "s/\"name\": \"local\"/\"name\": \"$scratch\"/" \
  -e "s/\"kubeContext\": \"k3d-kore-local\"/\"kubeContext\": \"$context\"/" \
  -e "s/\"clusterName\": \"kore-local\"/\"clusterName\": \"$cluster\"/" \
  "$scratch_dir/environment.yaml"
rm -f "$scratch_dir/environment.yaml.bak"
grep -q "\"kubeContext\": \"$context\"" "$scratch_dir/environment.yaml" ||
  fail "could not rename the context in $scratch_dir/environment.yaml"
grep -q '"ingress-agentgateway": true' "$scratch_dir/environment.yaml" ||
  fail "could not set the flag in $scratch_dir/environment.yaml"
git status --porcelain -- infra | grep -q . && fail "scratch overlay is visible to git"

step "validate before touching a cluster"
kore validate --environment "$scratch"

step "flag on: kore local up converges (dependency order, readiness waits)"
kore local up --environment "$scratch"

step "controller and CRDs are present and ready"
mise exec -- kubectl --context "$context" -n agentgateway-system rollout status deploy --timeout=120s
mise exec -- kubectl --context "$context" get crd agentgatewayparameters.agentgateway.dev

step "agentgateway-system is enrolled in the ambient mesh"
dataplane="$(mise exec -- kubectl --context "$context" get ns agentgateway-system -o jsonpath='{.metadata.labels.istio\.io/dataplane-mode}')"
[ "$dataplane" = "ambient" ] || fail "agentgateway-system dataplane-mode is '$dataplane', expected ambient"

step "platform status: no component missing or degraded"
kore platform status --environment "$scratch" --json |
  mise exec -- node -e '
    let s = "";
    process.stdin.on("data", (c) => { s += c; });
    process.stdin.on("end", () => {
      const bad = JSON.parse(s).filter((r) => ["missing", "degraded"].includes(r.status));
      if (bad.length) { console.error(bad.map((r) => `${r.name}: ${r.status}`).join("\n")); process.exit(1); }
    });'

step "rerun changes no release"
before="$(revisions)"
kore local up --environment "$scratch"
after="$(revisions)"
[ "$before" = "$after" ] || { diff <(echo "$before") <(echo "$after") >&2 || true; fail "a rerun changed a Helm release revision"; }

echo "agentgateway live proof passed" >&2
