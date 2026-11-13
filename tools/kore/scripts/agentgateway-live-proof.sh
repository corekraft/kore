#!/usr/bin/env bash
# Live proof for the flag-gated agentgateway install (issue #205).
#
# Opt-in: it creates a local k3d cluster, so it runs only with
# KORE_RUN_AGENTGATEWAY_PROOF=1, and only from a git worktree (see below).
# It never edits the committed local overlay: it copies infra/environments/local
# to a scratch environment, keeps that copy out of git through
# .git/info/exclude, and removes both on a clean exit.
#
#   KORE_RUN_AGENTGATEWAY_PROOF=1 tools/kore/scripts/agentgateway-live-proof.sh
#
# Phases, on one profile:
#   1. flag off: `kore local up`; there is no agentgateway release and no
#      agentgateway-system namespace.
#   2. flag on in the scratch overlay: `kore local up` on the same (existing)
#      profile; the controller rolls out, the CRDs exist, the namespace is
#      labelled ambient, platform status is clean.
#   3. rerun `kore local up`; no Helm release revision changes.
# Then a read-only measurement (kubectl top) is written to a results file
# outside git and printed.
#
# Environment:
#   KORE_PROOF_ENVIRONMENT  scratch environment name, ^[a-z0-9-]+$
#                           (default local-agentgateway-proof)
#   KORE_PROOF_KEEP=1       skip teardown, keep the cluster and the overlay
#   KORE_PROOF_RESULTS      results file (default under $TMPDIR)
#
# .kore/state is shared by every environment of a checkout (local-images
# lock, signing public key), so a scratch run would overwrite the state of a
# real kore-local cluster. The script therefore refuses to run in the main
# checkout: create a worktree first, for example
#   git worktree add .claude/worktrees/agentgateway-proof -b proof/agentgateway origin/main
set -euo pipefail

if [ "${KORE_RUN_AGENTGATEWAY_PROOF:-}" != "1" ]; then
  echo "skipped: set KORE_RUN_AGENTGATEWAY_PROOF=1 to create and destroy a local k3d cluster" >&2
  exit 0
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"

step() { printf '\n== %s\n' "$*" >&2; }
fail() { echo "FAIL: $*" >&2; exit 1; }
kore() { mise exec -- npm --prefix tools/kore run --silent kore -- "$@"; }
k() { mise exec -- kubectl --context "$context" "$@"; }

scratch="${KORE_PROOF_ENVIRONMENT:-local-agentgateway-proof}"
[[ "$scratch" =~ ^[a-z0-9-]+$ ]] || fail "KORE_PROOF_ENVIRONMENT '$scratch' must match ^[a-z0-9-]+$"
cluster="kore-$scratch"
context="k3d-$cluster"
scratch_dir="infra/environments/$scratch"
exclude="$(git rev-parse --git-path info/exclude)"
results="${KORE_PROOF_RESULTS:-${TMPDIR:-/tmp}/agentgateway-proof-$scratch.txt}"

# 3. Refuse the main checkout: .kore/state is shared with kore-local.
if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; then
  fail "this is the main checkout, and .kore/state (local-images.lock.json, local-signing.pub) is shared with the kore-local cluster, which this run would overwrite and delete. Run it from a worktree: git worktree add .claude/worktrees/agentgateway-proof -b proof/agentgateway origin/main"
fi

# 5. Only ever purge a cluster this run created.
if mise exec -- k3d cluster list -o json | grep -q "\"name\": *\"$cluster\""; then
  fail "k3d cluster $cluster already exists; this run would purge data it did not create. Remove it first: k3d cluster delete $cluster && rm -rf ~/.kore/k3d/$cluster"
fi

# 6. Host port 8443 is shared with the local environment.
if lsof -nP -iTCP:8443 -sTCP:LISTEN >/dev/null 2>&1; then
  fail "host port 8443 is in use, most likely by the kore-local cluster (its k3d load balancer). Free it with: kore local down --environment local"
fi

[ -e "$scratch_dir" ] && fail "$scratch_dir already exists; remove it or set KORE_PROOF_ENVIRONMENT"

remedy() {
  echo "teardown failed. The overlay $scratch_dir is kept. Remove the leftovers by hand:" >&2
  echo "  k3d cluster delete $cluster" >&2
  echo "  rm -rf ~/.kore/k3d/$cluster" >&2
  echo "  rm -rf $scratch_dir" >&2
}

# 7. The trap is set before anything is created; 4. a failed `down` is never ignored.
cleanup() {
  status=$?
  trap - EXIT
  if [ "${KORE_PROOF_KEEP:-}" = "1" ]; then
    step "KORE_PROOF_KEEP=1: keeping the cluster $cluster and $scratch_dir (status $status)"
    exit "$status"
  fi
  step "destroying the profile and the scratch overlay (status $status)"
  if [ -d "$scratch_dir" ] && kore local down --environment "$scratch" --prune --purge-data; then
    rm -rf "$scratch_dir"
    # 9. Remove the exclude line this run added.
    if [ -f "$exclude" ]; then
      grep -vxF "/$scratch_dir/" "$exclude" > "$exclude.proof" || true
      mv "$exclude.proof" "$exclude"
    fi
  elif [ -d "$scratch_dir" ]; then
    remedy
    [ "$status" -ne 0 ] || status=1
  fi
  exit "$status"
}
trap cleanup EXIT

step "scratch overlay: copy of local, flag off, own name, cluster and context (never committed)"
grep -qxF "/$scratch_dir/" "$exclude" || echo "/$scratch_dir/" >> "$exclude"
cp -R infra/environments/local "$scratch_dir"
env_file="$scratch_dir/environment.yaml"
sed -i.bak \
  -e "s/\"name\": \"local\"/\"name\": \"$scratch\"/" \
  -e "s/\"kubeContext\": \"k3d-kore-local\"/\"kubeContext\": \"$context\"/" \
  -e "s/\"clusterName\": \"kore-local\"/\"clusterName\": \"$cluster\"/" \
  "$env_file"
rm -f "$env_file.bak"
# 8. Every rewritten value must be there.
for want in "\"name\": \"$scratch\"" "\"kubeContext\": \"$context\"" "\"clusterName\": \"$cluster\"" '"ingress-agentgateway": false'; do
  grep -qF "$want" "$env_file" || fail "could not rewrite $env_file: missing $want"
done
[ -z "$(git status --porcelain -- infra)" ] || fail "the scratch overlay is visible to git"

json_names() { # stdin: JSON array of objects; prints one "namespace/name revision" per release
  mise exec -- node -e '
    let s = "";
    process.stdin.on("data", (c) => { s += c; });
    process.stdin.on("end", () => {
      for (const r of JSON.parse(s)) console.log(`${r.namespace}/${r.name} ${r.revision}`);
    });'
}
revisions() { mise exec -- helm list --all-namespaces --kube-context "$context" -o json | json_names | sort; }

step "validate before touching a cluster"
kore validate --environment "$scratch"

step "phase 1: flag off, kore local up"
kore local up --environment "$scratch"
if revisions | grep -qE '/agentgateway(-crds)? '; then
  fail "flag off, but an agentgateway release exists: $(revisions | grep agentgateway)"
fi
if k get ns agentgateway-system >/dev/null 2>&1; then
  fail "flag off, but namespace agentgateway-system exists"
fi
echo "phase 1 ok: no agentgateway release and no agentgateway-system namespace" >&2

step "phase 2: flag on in the scratch overlay, kore local up on the same profile"
sed -i.bak 's/"ingress-agentgateway": false/"ingress-agentgateway": true/' "$env_file"
rm -f "$env_file.bak"
grep -qF '"ingress-agentgateway": true' "$env_file" || fail "could not set the flag in $env_file"
kore local up --environment "$scratch"
k -n agentgateway-system rollout status deploy/agentgateway --timeout=180s
for crd in agentgatewaybackends agentgatewaymodels agentgatewayparameters agentgatewaypolicies; do
  k get crd "$crd.agentgateway.dev" >/dev/null || fail "CRD $crd.agentgateway.dev is missing"
done
dataplane="$(k get ns agentgateway-system -o jsonpath='{.metadata.labels.istio\.io/dataplane-mode}')"
[ "$dataplane" = "ambient" ] || fail "agentgateway-system istio.io/dataplane-mode is '$dataplane', expected ambient"
kore platform status --environment "$scratch" --json |
  mise exec -- node -e '
    let s = "";
    process.stdin.on("data", (c) => { s += c; });
    process.stdin.on("end", () => {
      const bad = JSON.parse(s).filter((r) => ["missing", "degraded"].includes(r.status));
      if (bad.length) { console.error(bad.map((r) => `${r.name}: ${r.status}`).join("\n")); process.exit(1); }
    });' || fail "platform status reports a missing or degraded component"
echo "phase 2 ok: rollout, CRDs, ambient label and status" >&2

step "phase 3: rerun kore local up, no Helm revision may change"
before="$(revisions)"
kore local up --environment "$scratch"
after="$(revisions)"
[ "$before" = "$after" ] || { diff <(echo "$before") <(echo "$after") >&2 || true; fail "a rerun changed a Helm release revision"; }
echo "phase 3 ok: no release changed" >&2

step "measurement (read-only) -> $results"
{
  echo "# agentgateway measurement, $(date -u +%Y-%m-%dT%H:%M:%SZ), context $context"
  echo; echo "## pods in agentgateway-system"
  k top pods --containers -n agentgateway-system || echo "(metrics unavailable)"
  echo; echo "## agentgateway proxy pods (all namespaces)"
  proxies="$(k get pods -A -l 'gateway.networking.k8s.io/gateway-name' -o name 2>/dev/null || true)"
  if [ -z "$proxies" ]; then
    echo "(none: no Gateway uses the agentgateway class yet)"
  else
    k top pods -A --containers -l 'gateway.networking.k8s.io/gateway-name' || echo "(metrics unavailable)"
  fi
  echo; echo "## ztunnel"
  k top pods --containers -n istio-system -l app=ztunnel || echo "(metrics unavailable)"
  echo; echo "## nodes"
  k top nodes || echo "(metrics unavailable)"
} | tee "$results"

echo "agentgateway live proof passed; results in $results" >&2
