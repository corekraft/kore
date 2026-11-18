#!/usr/bin/env bash
# Probe for agentgateway v1.7.0 (issue #1218, part of #1195): can one Gateway
# serve a TLS passthrough listener and an HTTPS terminating listener on one
# port, told apart by hostname, and can a listener set add one of them?
#
# Opt-in: it creates a throwaway k3d cluster, so it runs only with
# KORE_RUN_AGENTGATEWAY_PROBE=1:
#
#   KORE_RUN_AGENTGATEWAY_PROBE=1 tools/kore/scripts/agentgateway-listener-probe.sh
#
# It installs only the Gateway API definitions and the agentgateway controller.
# It does not run `kore local up`, so it needs no worktree, no overlay and no
# age key, and it touches neither .kore/state nor any other Kore cluster.
# Certificates and the stub backend's files live in a temporary directory
# outside git, removed on exit.
#
# Phases, on one cluster:
#   preflight  refuse an existing cluster of the same name and a taken host port.
#   phase 1    create the cluster, with the host port on node port 30443.
#   phase 2    install the Gateway API definitions and the agentgateway charts,
#              at the versions pinned in infra/catalog/versions.yaml.
#   phase 3    make two certificates from a throwaway CA and start a stub TLS
#              backend that presents the passthrough certificate.
#   phase 4    one Gateway, port 443: an HTTPS listener that terminates
#              terminate.probe.test with the terminate certificate and a TLS
#              passthrough listener for passthrough.probe.test. Connect once
#              with each name and compare the certificate that comes back.
#   phase 5    the same, but the passthrough listener comes from a listener set
#              on a Gateway that carries only the HTTPS listener.
#   results    write what each variant did, with the certificate seen for each
#              name, to a file outside git, and print it.
# A variant that does not work is a result, not an error: it is recorded and the
# run continues. Only a refusal or a broken setup exits non-zero.
#
# Environment:
#   KORE_PROBE_CLUSTER   cluster name, ^[a-z0-9-]+$ (default kore-probe-agentgateway)
#   KORE_PROBE_PORT      host port the cluster listens on (default 18443)
#   KORE_PROBE_KEEP=1    skip teardown, keep the cluster
#   KORE_PROBE_RESULTS   results file (default under $TMPDIR)
set -euo pipefail

if [ "${KORE_RUN_AGENTGATEWAY_PROBE:-}" != "1" ]; then
  echo "skipped: set KORE_RUN_AGENTGATEWAY_PROBE=1 to create and destroy a throwaway k3d cluster" >&2
  exit 0
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$repo"

step() { printf '\n== %s\n' "$*" >&2; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cluster="${KORE_PROBE_CLUSTER:-kore-probe-agentgateway}"
[[ "$cluster" =~ ^[a-z0-9-]+$ ]] || fail "KORE_PROBE_CLUSTER '$cluster' must match ^[a-z0-9-]+$"
port="${KORE_PROBE_PORT:-18443}"
[[ "$port" =~ ^[0-9]+$ ]] || fail "KORE_PROBE_PORT '$port' must be a port number"
context="k3d-$cluster"
results="${KORE_PROBE_RESULTS:-${TMPDIR:-/tmp}/agentgateway-listener-probe-$cluster.txt}"
versions="infra/catalog/versions.yaml"

k() { mise exec -- kubectl --context "$context" "$@"; }
pin() { # JSON path in versions.yaml, for example components.gateway-api
  mise exec -- node -e '
    const versions = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const value = process.argv[2].split(".").reduce((node, key) => node?.[key], versions);
    if (typeof value !== "string") { console.error(`${process.argv[2]} is not pinned in ${process.argv[1]}`); process.exit(1); }
    console.log(value);' "$versions" "$1"
}

work=""
created=0
remedy() {
  echo "teardown failed. Remove the leftovers by hand:" >&2
  echo "  k3d cluster delete $cluster" >&2
}

cleanup() {
  status=$?
  trap - EXIT
  [ -z "$work" ] || rm -rf "$work"
  if [ "$created" = 1 ] && [ "${KORE_PROBE_KEEP:-}" = "1" ]; then
    step "KORE_PROBE_KEEP=1: keeping the cluster $cluster (status $status)"
  elif [ "$created" = 1 ]; then
    step "deleting the cluster $cluster (status $status)"
    if ! mise exec -- k3d cluster delete "$cluster"; then
      remedy
      [ "$status" -ne 0 ] || status=1
    fi
  fi
  exit "$status"
}

step "preflight: refuse an existing cluster and a taken host port, before anything is created"
for tool in openssl lsof; do
  command -v "$tool" >/dev/null || fail "$tool is not installed; the probe needs it on the PATH"
done
if mise exec -- k3d cluster list -o json | grep -q "\"name\": *\"$cluster\""; then
  fail "k3d cluster $cluster already exists; this run would delete data it did not create. Remove it first with: k3d cluster delete $cluster, or set KORE_PROBE_CLUSTER"
fi
if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "host port $port is in use, most likely by another k3d load balancer or a forward. Free it, or set KORE_PROBE_PORT to a free port"
fi
gateway_api_version="$(pin components.gateway-api)"
agentgateway_version="$(pin components.agentgateway)"
k3s_image="$(pin images.k3s)"
backend_image="$(pin images.oci-registry-proxy)"

# The trap is set before the cluster is created.
trap cleanup EXIT
work="$(mktemp -d)"

step "phase 1: create the cluster $cluster (host port $port to node port 30443)"
created=1
mise exec -- k3d cluster create "$cluster" \
  --image "$k3s_image" \
  --servers 1 --agents 0 \
  --k3s-arg "--disable=traefik@server:*" \
  --k3s-arg "--disable=servicelb@server:*" \
  --port "$port:30443@loadbalancer" \
  --kubeconfig-update-default=true \
  --kubeconfig-switch-context=false \
  --wait --timeout 180s
k get nodes >/dev/null || fail "the new cluster does not answer on context $context"

step "phase 2: Gateway API $gateway_api_version definitions and agentgateway $agentgateway_version"
k apply --server-side -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/v$gateway_api_version/standard-install.yaml"
for crd in gateways httproutes listenersets tlsroutes; do
  k wait --for=condition=Established --timeout=60s "crd/$crd.gateway.networking.k8s.io" ||
    fail "Gateway API $gateway_api_version does not define $crd; the probe cannot test this feature"
done
mise exec -- helm upgrade --install agentgateway-crds oci://cr.agentgateway.dev/charts/agentgateway-crds --version "$agentgateway_version" --namespace agentgateway-system --create-namespace --kube-context "$context" --wait --timeout 5m
mise exec -- helm upgrade --install agentgateway oci://cr.agentgateway.dev/charts/agentgateway --version "$agentgateway_version" --namespace agentgateway-system --kube-context "$context" -f infra/environments/common/values/agentgateway.yaml --wait --timeout 5m
k -n agentgateway-system rollout status deploy/agentgateway --timeout=180s
k get gatewayclass agentgateway >/dev/null || fail "no GatewayClass named agentgateway after the install"

step "phase 3: certificates from a throwaway CA and the stub TLS backend"
# A CA of its own: nothing is added to any trust store, and the real mkcert CA is untouched.
export CAROOT="$work/ca"
mkdir -p "$CAROOT"
mise exec -- mkcert -cert-file "$work/terminate.crt" -key-file "$work/terminate.key" terminate.probe.test
mise exec -- mkcert -cert-file "$work/passthrough.crt" -key-file "$work/passthrough.key" passthrough.probe.test
fingerprint_of() { openssl x509 -in "$1" -noout -fingerprint -sha256 | sed 's/^.*=//'; }
terminate_fingerprint="$(fingerprint_of "$work/terminate.crt")"
passthrough_fingerprint="$(fingerprint_of "$work/passthrough.crt")"
[ "$terminate_fingerprint" != "$passthrough_fingerprint" ] || fail "the two certificates have the same fingerprint, so the probe could not tell them apart"
k create namespace probe
k -n probe create secret tls probe-terminate-tls --cert "$work/terminate.crt" --key "$work/terminate.key"
k -n probe create secret tls probe-passthrough-tls --cert "$work/passthrough.crt" --key "$work/passthrough.key"
k apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata: {name: probe-backend, namespace: probe}
data:
  default.conf: |
    server {
      listen 8080;
      location / { return 200 "probe backend over http\n"; }
    }
    server {
      listen 8443 ssl;
      ssl_certificate /certs/tls.crt;
      ssl_certificate_key /certs/tls.key;
      location / { return 200 "probe backend over tls\n"; }
    }
---
apiVersion: apps/v1
kind: Deployment
metadata: {name: probe-backend, namespace: probe}
spec:
  replicas: 1
  selector: {matchLabels: {app: probe-backend}}
  template:
    metadata: {labels: {app: probe-backend}}
    spec:
      containers:
        - name: nginx
          image: $backend_image
          ports: [{containerPort: 8080}, {containerPort: 8443}]
          volumeMounts:
            - {name: conf, mountPath: /etc/nginx/conf.d/default.conf, subPath: default.conf}
            - {name: certs, mountPath: /certs, readOnly: true}
      volumes:
        - {name: conf, configMap: {name: probe-backend}}
        - {name: certs, secret: {secretName: probe-passthrough-tls}}
---
apiVersion: v1
kind: Service
metadata: {name: probe-backend, namespace: probe}
spec:
  selector: {app: probe-backend}
  ports:
    - {name: http, port: 8080, targetPort: 8080}
    - {name: tls, port: 8443, targetPort: 8443}
---
apiVersion: agentgateway.dev/v1alpha1
kind: AgentgatewayParameters
metadata: {name: probe-service, namespace: probe}
spec:
  service:
    spec:
      type: NodePort
      ports:
        - {port: 443, nodePort: 30443}
EOF
k -n probe rollout status deploy/probe-backend --timeout=180s

seen_certificate() { # name: connect with SNI, print "<sha256 fingerprint> <subject>" of the certificate that came back, or nothing
  name="$1"
  out="$work/seen-$name.pem"
  : > "$out"
  # openssl has no timeout of its own; a watchdog bounds a hung connection.
  openssl s_client -connect "127.0.0.1:$port" -servername "$name" </dev/null >"$out" 2>"$out.err" &
  client=$!
  { sleep 15; kill "$client" 2>/dev/null; } &
  watchdog=$!
  wait "$client" 2>/dev/null || true
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  seen="$(openssl x509 -in "$out" -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//' || true)"
  [ -z "$seen" ] || echo "$seen $(openssl x509 -in "$out" -noout -subject 2>/dev/null | sed 's/^subject= *//')"
}

check_variant() { # label, detail file: 0 when each name returns the certificate it must carry
  label="$1"
  detail="$2"
  ok=1
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    ok=1
    : > "$detail"
    for kind in terminate passthrough; do
      name="$kind.probe.test"
      if [ "$kind" = terminate ]; then want="$terminate_fingerprint"; else want="$passthrough_fingerprint"; fi
      got="$(seen_certificate "$name")"
      echo "$name: want $want; got ${got:-no certificate}" >> "$detail"
      [ "${got%% *}" = "$want" ] || ok=0
    done
    [ "$ok" = 1 ] && break
    sleep 5
  done
  echo "$label: attempt $attempt, ok=$ok" >&2
  cat "$detail" >&2
  [ "$ok" = 1 ]
}

status_of() { # kind name: the status conditions the controller put on the object, one line each
  k -n probe get "$1" "$2" -o jsonpath='{range .status.listeners[*]}{.name}{": "}{range .conditions[*]}{.type}={.status}({.reason}) {end}{"\n"}{end}' 2>&1 || true
}

step "phase 4: one Gateway, one port: HTTPS terminating and TLS passthrough listeners"
k apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: {name: probe, namespace: probe}
spec:
  gatewayClassName: agentgateway
  infrastructure:
    parametersRef: {group: agentgateway.dev, kind: AgentgatewayParameters, name: probe-service}
  listeners:
    - name: terminate
      hostname: terminate.probe.test
      port: 443
      protocol: HTTPS
      tls:
        mode: Terminate
        certificateRefs:
          - {kind: Secret, name: probe-terminate-tls}
      allowedRoutes: {namespaces: {from: Same}}
    - name: passthrough
      hostname: passthrough.probe.test
      port: 443
      protocol: TLS
      tls:
        mode: Passthrough
      allowedRoutes: {namespaces: {from: Same}, kinds: [{kind: TLSRoute}]}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: {name: terminate, namespace: probe}
spec:
  parentRefs: [{name: probe, sectionName: terminate}]
  hostnames: [terminate.probe.test]
  rules:
    - backendRefs: [{name: probe-backend, port: 8080}]
---
apiVersion: gateway.networking.k8s.io/v1
kind: TLSRoute
metadata: {name: passthrough, namespace: probe}
spec:
  parentRefs: [{name: probe, sectionName: passthrough}]
  hostnames: [passthrough.probe.test]
  rules:
    - backendRefs: [{name: probe-backend, port: 8443}]
EOF
k -n probe wait --for=condition=Programmed --timeout=120s gateway/probe || echo "the mixed Gateway never became Programmed; recorded below" >&2
mixed_ok=0
check_variant "mixed listeners" "$work/mixed.txt" && mixed_ok=1 || true
status_of gateway probe > "$work/mixed-status.txt"
# Delete the Gateway and its routes; the next phase reuses the name.
k -n probe delete httproute,tlsroute --all
k -n probe delete gateway probe
k -n probe wait --for=delete --timeout=120s deploy/probe || true

step "phase 5: the passthrough listener comes from a listener set"
k apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: {name: probe, namespace: probe}
spec:
  gatewayClassName: agentgateway
  infrastructure:
    parametersRef: {group: agentgateway.dev, kind: AgentgatewayParameters, name: probe-service}
  allowedListeners: {namespaces: {from: Same}}
  listeners:
    - name: terminate
      hostname: terminate.probe.test
      port: 443
      protocol: HTTPS
      tls:
        mode: Terminate
        certificateRefs:
          - {kind: Secret, name: probe-terminate-tls}
      allowedRoutes: {namespaces: {from: Same}}
---
apiVersion: gateway.networking.k8s.io/v1
kind: ListenerSet
metadata: {name: probe-set, namespace: probe}
spec:
  parentRef: {group: gateway.networking.k8s.io, kind: Gateway, name: probe}
  listeners:
    - name: passthrough
      hostname: passthrough.probe.test
      port: 443
      protocol: TLS
      tls:
        mode: Passthrough
      allowedRoutes: {namespaces: {from: Same}, kinds: [{kind: TLSRoute}]}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: {name: terminate, namespace: probe}
spec:
  parentRefs: [{name: probe, sectionName: terminate}]
  hostnames: [terminate.probe.test]
  rules:
    - backendRefs: [{name: probe-backend, port: 8080}]
---
apiVersion: gateway.networking.k8s.io/v1
kind: TLSRoute
metadata: {name: passthrough, namespace: probe}
spec:
  parentRefs: [{group: gateway.networking.k8s.io, kind: ListenerSet, name: probe-set, sectionName: passthrough}]
  hostnames: [passthrough.probe.test]
  rules:
    - backendRefs: [{name: probe-backend, port: 8443}]
EOF
k -n probe wait --for=condition=Programmed --timeout=120s gateway/probe || echo "the Gateway with a listener set never became Programmed; recorded below" >&2
set_ok=0
check_variant "listener set" "$work/set.txt" && set_ok=1 || true
{ status_of gateway probe; status_of listenerset probe-set; } > "$work/set-status.txt"

step "results -> $results"
{
  echo "# agentgateway $agentgateway_version listener probe, $(date -u +%Y-%m-%dT%H:%M:%SZ), context $context, Gateway API $gateway_api_version"
  echo
  echo "expected: terminate.probe.test carries $terminate_fingerprint"
  echo "expected: passthrough.probe.test carries $passthrough_fingerprint"
  echo
  if [ "$mixed_ok" = 1 ]; then
    echo "mixed listeners: works"
  else
    echo "mixed listeners: fails"
  fi
  cat "$work/mixed.txt"
  echo "listener status:"; cat "$work/mixed-status.txt"
  echo
  if [ "$set_ok" = 1 ]; then
    echo "listener set: works"
  else
    echo "listener set: fails"
  fi
  cat "$work/set.txt"
  echo "listener status:"; cat "$work/set-status.txt"
  echo
  if [ "$mixed_ok" = 1 ]; then
    echo "decision: passthrough and HTTPS share one port, so the registry keeps the Gateway's port 443 and its own name (#1195)."
  else
    echo "decision: mixed listeners fail, so #1195's registry fallback applies: the registry gets its own loopback port beside 443, and only its URL carries a port."
  fi
  if [ "$set_ok" = 1 ]; then
    echo "decision: listener sets work, so the later per-organization design is possible."
  else
    echo "decision: listener sets do not work on this version; the per-organization design cannot rely on them."
  fi
} | tee "$results"

echo "agentgateway listener probe finished; results in $results" >&2
