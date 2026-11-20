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
#   2. flags ingress-agentgateway, gateway-class-change-release,
#      gateway-rollback-order and agentgateway-mesh-enrollment on in the
#      scratch overlay (the second lets the reconcile delete and recreate the
#      Gateway for the class change, with a brief ingress outage): `kore local up` on the same (existing)
#      profile; the controller rolls out, the CRDs exist, the namespace is
#      labelled ambient, platform status is clean.
#      The gateway is reported ready by `kore platform status --json`, and the
#      Istio ingress proxy (deploy and svc kore-gateway-istio) is gone. A request
#      through the Gateway to the reference route (https://kore.internal:8443/livez)
#      must answer 200, so the proof no longer passes without sending traffic.
#   3. rerun `kore local up`; no Helm release revision changes.
#   4. ingress-agentgateway off again (the other flags stay on):
#      the first `kore local up` is EXPECTED to fail: it converges
#      platform-config (the Gateway back on the istio class, Kore's own
#      AgentgatewayParameters removed by Helm, the Istio proxy back) and then
#      refuses the gated-off agentgateway releases still installed, naming the
#      helm uninstall steps (ADR 0081). The script asserts that, checks no
#      Agentgateway custom resource remains, uninstalls the agentgateway and
#      agentgateway-crds releases on the throwaway context only, then
#      `kore local up` converges as a no-op: the agentgateway proxy
#      (deploy and svc kore-gateway) is gone, and a third run changes no
#      revision. If a Service keeps NodePort 30443 across a class change, this
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
  -e 's/"ingress-agentgateway": true/"ingress-agentgateway": false/' \
  -e 's/"gateway-class-change-release": true/"gateway-class-change-release": false/' \
  -e 's/"gateway-rollback-order": true/"gateway-rollback-order": false/' \
  -e 's/"agentgateway-mesh-enrollment": true/"agentgateway-mesh-enrollment": false/' \
  "$env_file"
rm -f "$env_file.bak"
# 8. Every rewritten value must be there.
for want in "\"name\": \"$scratch\"" "\"kubeContext\": \"$context\"" "\"clusterName\": \"$cluster\"" '"ingress-agentgateway": false' '"gateway-class-change-release": false' '"gateway-rollback-order": false' '"agentgateway-mesh-enrollment": false'; do
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

step "phase 2: all four flags on in the scratch overlay, kore local up on the same profile"
# gateway-class-change-release lets the reconcile delete and recreate the
# Gateway for the class change, and gateway-rollback-order defers the
# orphaned-release refusal until platform-config is re-rendered; both stay on
# through phase 4 so the rollback swaps the Gateway back to Istio the same way.
# agentgateway-mesh-enrollment enrols the gateway pod in the ambient mesh with a
# permissive exception for its listener port (ADR 0081 addendum).
sed -i.bak \
  -e 's/"ingress-agentgateway": false/"ingress-agentgateway": true/' \
  -e 's/"gateway-class-change-release": false/"gateway-class-change-release": true/' \
  -e 's/"gateway-rollback-order": false/"gateway-rollback-order": true/' \
  -e 's/"agentgateway-mesh-enrollment": false/"agentgateway-mesh-enrollment": true/' \
  "$env_file"
rm -f "$env_file.bak"
grep -qF '"ingress-agentgateway": true' "$env_file" || fail "could not set the flag in $env_file"
grep -qF '"gateway-class-change-release": true' "$env_file" || fail "could not set gateway-class-change-release in $env_file"
grep -qF '"gateway-rollback-order": true' "$env_file" || fail "could not set gateway-rollback-order in $env_file"
grep -qF '"agentgateway-mesh-enrollment": true' "$env_file" || fail "could not set agentgateway-mesh-enrollment in $env_file"
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
# A request through the Gateway: the enrolled gateway pod must reach the
# frontend over the mesh, so a 503 here is the failure this flag exists to fix.
ca_root="$(mise exec -- mkcert -CAROOT)"
status=""
for _ in 1 2 3 4 5 6; do
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' --connect-timeout 5 --max-time 20 --cacert "$ca_root/rootCA.pem" --resolve kore.internal:8443:127.0.0.1 https://kore.internal:8443/livez || true)"
  [ "$status" != "200" ] || break
  sleep 5
done
[ "$status" = "200" ] || fail "a request through the Gateway to https://kore.internal:8443/livez answered '$status', expected 200; check the gateway pod carries istio.io/dataplane-mode=ambient and PeerAuthentication kore-gateway-listener exists in kore-system"
dataplane_pod="$(k -n kore-system get pods -l gateway.networking.k8s.io/gateway-name=kore-gateway -o jsonpath='{.items[0].metadata.labels.istio\.io/dataplane-mode}')"
[ "$dataplane_pod" = "ambient" ] || fail "the kore-gateway pod's istio.io/dataplane-mode is '$dataplane_pod', expected ambient"
echo "phase 2 ok: rollout, CRDs, ambient label, status, gateway ready, Istio proxy gone and the reference route answers 200 through the Gateway" >&2

assert_no_revision_change() { # label: rerun kore local up; no Helm release revision may change
  before="$(revisions)"
  kore local up --environment "$scratch"
  after="$(revisions)"
  # The local reference image gets a new digest on every run, so reference/reference
  # moves a revision on every `up` (known issue, #344). Every other release must hold.
  changed="$(diff <(echo "$before") <(echo "$after") | sed -n 's/^> \([^ ]*\) .*/\1/p' || true)"
  unexpected="$(printf '%s\n' "$changed" | grep -v '^$' | grep -vx 'reference/reference' || true)"
  if [ -n "$unexpected" ]; then
    diff <(echo "$before") <(echo "$after") >&2 || true
    fail "$1: a rerun changed the Helm revision of: $(echo $unexpected)"
  fi
  if printf '%s\n' "$changed" | grep -qx 'reference/reference'; then
    echo "known issue (#344): reference/reference changed revision; the local reference image gets a new digest every run. Not an agentgateway problem." >&2
  fi
}

step "phase 3: rerun kore local up, no Helm revision may change"
assert_no_revision_change "phase 3"
echo "phase 3 ok: no platform release changed" >&2

step "phase 4: ingress flag off again (the other two flags stay on), rollback"
sed -i.bak 's/"ingress-agentgateway": true/"ingress-agentgateway": false/' "$env_file"
rm -f "$env_file.bak"
grep -qF '"ingress-agentgateway": false' "$env_file" || fail "could not turn the flag off in $env_file"
# With gateway-rollback-order on, Kore reconciles every component first
# and only then refuses a gated-off release that is still installed (ADR 0081),
# so the first run converges platform-config (the Gateway back on the istio
# class, Kore's AgentgatewayParameters removed by Helm) and then exits non-zero.
# That failure is the expected result; success would mean the refusal is gone.
if up_out="$(kore local up --environment "$scratch" 2>&1)"; then
  printf '%s\n' "$up_out" >&2
  fail "rollback: kore local up succeeded while gated-off agentgateway releases are installed; it must refuse and name the helm uninstall steps"
fi
printf '%s\n' "$up_out" >&2
printf '%s\n' "$up_out" | grep -q "is gated off" || fail "rollback: the first kore local up failed, but not with the gated-off refusal"
printf '%s\n' "$up_out" | grep -q "helm uninstall agentgateway" || fail "rollback: the refusal does not name the helm uninstall steps"
class="$(k -n kore-system get gateway kore-gateway -o jsonpath='{.spec.gatewayClassName}')"
[ "$class" = "istio" ] || fail "rollback: gateway/kore-gateway is on class '$class' after the refused run, expected istio"
gone agentgatewayparameters.agentgateway.dev kore-gateway-service
k -n kore-system get deploy kore-gateway-istio >/dev/null || fail "rollback: Istio did not recreate deploy/kore-gateway-istio"
echo "phase 4 refusal ok: Gateway on istio, Kore's AgentgatewayParameters gone, Istio proxy back" >&2
# Removing the CRD release deletes the CRDs and every custom resource of those
# kinds, so check none exist. Kore never uninstalls CRDs: that consent stays with
# the operator. Guards independent of how $context was built: never the local
# environment, never the kore-local context, and the overlay must name this context.
[ "$scratch" != "local" ] || fail "rollback uninstalls refuse environment 'local'; use a throwaway KORE_PROOF_ENVIRONMENT"
[ "$context" != "k3d-kore-local" ] || fail "rollback uninstalls refuse context k3d-kore-local; use a throwaway KORE_PROOF_ENVIRONMENT"
grep -qF "\"kubeContext\": \"$context\"" "$env_file" || fail "rollback uninstalls refuse context '$context': $env_file does not name it as its kubeContext"
crds="$(k get crd -o name)" || fail "could not list CRDs on $context, so Agentgateway custom resources cannot be ruled out; nothing was uninstalled"
crs=""
for crd in $(printf '%s\n' "$crds" | sed -n 's|^customresourcedefinition.apiextensions.k8s.io/\(.*\.agentgateway\.dev\)$|\1|p'); do
  found="$(k get "$crd" --all-namespaces -o name)" || fail "could not list $crd on $context; nothing was uninstalled"
  [ -z "$found" ] || crs="$crs $found"
done
[ -z "$crs" ] || fail "Agentgateway custom resources exist and uninstalling the CRDs would delete them: $(echo $crs)"
mise exec -- helm uninstall agentgateway --namespace agentgateway-system --kube-context "$context"
mise exec -- helm uninstall agentgateway-crds --namespace agentgateway-system --kube-context "$context"
kore local up --environment "$scratch"
[ "$(gateway_state)" = "ready" ] || fail "after rollback platform status does not report the Gateway ready: '$(gateway_state)'"
gone deploy kore-gateway
gone svc kore-gateway
assert_no_revision_change "phase 4"
echo "phase 4 ok: refusal converged platform-config, uninstalls, then a no-op run and a third run that changed no revision" >&2

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
