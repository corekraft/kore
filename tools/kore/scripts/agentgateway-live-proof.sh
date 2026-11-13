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
#      The gateway is reported ready by `kore platform status --json`, and the
#      Istio ingress proxy (deploy and svc kore-gateway-istio) is gone.
#   3. rerun `kore local up`; no Helm release revision changes.
#   4. flag off again, `kore local up`: rollback. The Gateway is ready on the
#      istio class, and the agentgateway proxy (deploy and svc kore-gateway)
#      is gone. If a Service keeps NodePort 30443 across a class change, this
#      phase fails and names which one, so the owner of its removal is known.
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

step "preflight: an age identity must decrypt the overlay's sops-canary (fails in seconds, not minutes into phase 1)"
if ! mise exec -- sops --decrypt "$scratch_dir/secrets/sops-canary.enc.yaml" >/dev/null 2>&1; then
  fail "no age identity decrypts $scratch_dir/secrets/sops-canary.enc.yaml, so secret sync would fail minutes into phase 1. Set SOPS_AGE_KEY_FILE to your age key file (see infra/environments/local/secrets/README.md) and rerun"
fi

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
gateway_state() { # prints the status of the kore-gateway component, or nothing
  kore platform status --environment "$scratch" --json |
    mise exec -- node -e '
      let s = "";
      process.stdin.on("data", (c) => { s += c; });
      process.stdin.on("end", () => {
        const r = JSON.parse(s).find((c) => c.name === "kore-platform-config");
        if (r) console.log(r.status);
      });'
}
[ "$(gateway_state)" = "ready" ] || fail "platform status does not report kore-platform-config (the Gateway) ready: '$(gateway_state)'"
gone() { # kind name: fail unless the object is absent
  if k -n kore-system get "$1" "$2" >/dev/null 2>&1; then
    fail "$1/$2 still exists after the class change; remove it with: kubectl --context $context -n kore-system delete $1 $2 (and record who should remove it)"
  fi
}
gone deploy kore-gateway-istio
gone svc kore-gateway-istio
echo "phase 2 ok: rollout, CRDs, ambient label, status, gateway ready and Istio proxy gone" >&2

step "phase 3: rerun kore local up, no Helm revision may change"
before="$(revisions)"
kore local up --environment "$scratch"
after="$(revisions)"
# The local reference image gets a new digest on every run, so reference/reference
# moves a revision on every `up` (known issue, #344). Every other release must hold.
changed="$(diff <(echo "$before") <(echo "$after") | sed -n 's/^> \([^ ]*\) .*/\1/p' || true)"
unexpected="$(printf '%s\n' "$changed" | grep -v '^$' | grep -vx 'reference/reference' || true)"
if [ -n "$unexpected" ]; then
  diff <(echo "$before") <(echo "$after") >&2 || true
  fail "a rerun changed the Helm revision of: $(echo $unexpected)"
fi
if printf '%s\n' "$changed" | grep -qx 'reference/reference'; then
  echo "known issue (#344): reference/reference changed revision; the local reference image gets a new digest every run. Not an agentgateway problem." >&2
fi
echo "phase 3 ok: no platform release changed" >&2

step "phase 4: flag off again, kore local up (rollback)"
sed -i.bak 's/"ingress-agentgateway": true/"ingress-agentgateway": false/' "$env_file"
rm -f "$env_file.bak"
grep -qF '"ingress-agentgateway": false' "$env_file" || fail "could not turn the flag off in $env_file"
kore local up --environment "$scratch"
[ "$(gateway_state)" = "ready" ] || fail "after rollback platform status does not report the Gateway ready: '$(gateway_state)'"
k -n kore-system get deploy kore-gateway-istio >/dev/null || fail "rollback: Istio did not recreate deploy/kore-gateway-istio"
gone deploy kore-gateway
gone svc kore-gateway
echo "phase 4 ok: Gateway ready on the istio class, agentgateway proxy gone" >&2

step "measurement (read-only) -> $results"
{
  echo "# agentgateway measurement, $(date -u +%Y-%m-%dT%H:%M:%SZ), context $context"
  echo; echo "## pods in agentgateway-system"
  k top pods --containers -n agentgateway-system || echo "(metrics unavailable)"
  echo; echo "## agentgateway proxy pods (all namespaces)"
  proxies="$(k get pods -A -l 'gateway.networking.k8s.io/gateway-class-name=agentgateway' -o name 2>/dev/null || true)"
  if [ -z "$proxies" ]; then
    echo "(none: no Gateway uses the agentgateway class yet)"
  else
    k top pods -A --containers -l 'gateway.networking.k8s.io/gateway-class-name=agentgateway' || echo "(metrics unavailable)"
  fi
  echo; echo "## ztunnel"
  k top pods --containers -n istio-system -l app.kubernetes.io/name=ztunnel || echo "(metrics unavailable)"
  echo; echo "## nodes"
  k top nodes || echo "(metrics unavailable)"
} 2>&1 | tee "$results" || echo "measurement failed; see above" >&2

echo "agentgateway live proof passed; results in $results" >&2
