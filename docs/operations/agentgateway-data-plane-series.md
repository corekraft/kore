# agentgateway data-plane series and the service key

Finding for [#1514](https://github.com/corekraft/kore/issues/1514), under
[#1510](https://github.com/corekraft/kore/issues/1510) and ADR 0174. It answers
which agentgateway data-plane series give request count, error ratio and
latency per service or route, and whether any carries the service key.

**Status: the live run found the series and their labels, and the Prometheus
scrape failed. The repository now carries the scrape fix behind the flag
`agentgateway-data-plane-metrics`. The fix is unverified until the coordinator
reruns the live proof after merge.** Each claim the live run did not check is
marked **unverified**. The coordinator runs the queries in "Live query" and
records the answers in "Live result" before the evidence set grows past
availability (ADR 0174).

## Verified in the repository

- The agentgateway chart and its CRDs are pinned at v1.7.0 from
  `oci://cr.agentgateway.dev/charts` (`infra/catalog/components.yaml`,
  `infra/catalog/compatibility.md`). The controller and proxy images are pinned
  by digest in `infra/environments/common/values/agentgateway.yaml`.
- Istio is pinned at 1.31.4 in ambient profile (`infra/catalog/compatibility.md`).
  Ztunnel keeps identity and mTLS for enrolled workloads.
- The flag `ingress-agentgateway` is on in `local` and off in `vps` and
  `managed-example` (`infra/environments/*/environment.yaml`). The flag
  `agentgateway-mesh-enrollment` is on in `local`, so the data-plane pod is an
  ambient workload there.
- The platform Gateway is `kore-gateway` in namespace `kore-system`, with
  GatewayClass `agentgateway` when the flag is on
  (`infra/charts/platform-config/templates/gateway.yaml`). agentgateway
  generates the data-plane pod for that Gateway, copies its infrastructure
  labels and annotations onto it, and runs it under a ServiceAccount named after
  the Gateway. So the data plane lives in `kore-system`, not in
  `agentgateway-system`, which holds only the controller.
- `kore-system` has a STRICT default PeerAuthentication, a default-deny
  AuthorizationPolicy, and an ALLOW policy for the Gateway's listener port only;
  the listener port alone is PERMISSIVE (`infra/charts/platform-config/templates/mesh-policy.yaml`).
- Each golden-path service's HTTPRoute is named `<service>-shared` on the shared
  route (see the live result below), and parented on a Gateway
  (`infra/charts/golden-path-workload/templates/ingress.yaml`).
- ADR 0174 picks request series "by the gateway route" and the service "by a
  label from the app record". No such label exists yet.

## The data-plane scrape and its fix (#1514)

The scrape is the chart's own pod scrape, switched on by annotations on the
data-plane pods. Nothing changes in the Prometheus values.

- The flag is `agentgateway-data-plane-metrics`, declared in the three overlays
  and **off in all of them** (`infra/environments/*/environment.yaml`). It turns
  on only through `harness flag activate`, after a recorded live outcome
  (AGENTS.md, "It just works").
- With the flag on and the GatewayClass `agentgateway`, the Gateway's
  `spec.infrastructure.annotations` carry three annotations, and agentgateway
  copies them onto the data-plane pods:
  - `prometheus.io/scrape: "true"` and `prometheus.io/port: "15020"`, the chart's
    default pod scrape (verified live, below);
  - `ambient.istio.io/bypass-inbound-capture: "true"`, the ambient fix (see the
    next section).

  The template is `infra/charts/platform-config/templates/gateway.yaml`, helper
  `platform-config.agentgatewayMetrics` in `_helpers.tpl`.

### Why the scrape failed, and the chosen fix

The live run showed the scrape fails with `Get "http://<pod>:15020/metrics": EOF`
on the ambient-enrolled data-plane pods (`ambient.istio.io/redirection: enabled`).
The cause is **unverified**. The likely cause is ambient's inbound capture of the
pod, together with `kore-system`'s STRICT default and its default-deny policy,
neither of which covers port 15020 for a plaintext scrape from Prometheus. The
fix below does not depend on which of the two it is.

Istio 1.31.4 offers these options (its annotations reference and ambient docs):

- **Chosen: `ambient.istio.io/bypass-inbound-capture: "true"` on the pod.** Istio
  describes it as alpha and "when specified on a Pod enrolled in ambient mesh,
  only outbound traffic will be captured", meant for workloads that "only receive
  traffic from out-of-the-mesh clients, such as third party ingress controllers".
  The gateway is that kind of workload. It is the smallest change: one annotation
  in the existing block, under the existing flag, with no new resource.
- Not chosen: `traffic.sidecar.istio.io/excludeInboundPorts`, which a sidecar
  reads. Ambient has no per-port inbound exclusion in 1.31.
- Not chosen: a port-level PERMISSIVE PeerAuthentication for 15020 in
  `kore-gateway-listener`. The ambient docs say ztunnel supports peer
  authentication but do not document port-level modes for ambient. It would also
  need an ALLOW AuthorizationPolicy for 15020, because `default-deny` applies.
  Two new resources, both unverified in ambient.
- Not chosen: scrape through the mesh, by enrolling the `observability` namespace
  or the Prometheus pod in ambient. That changes another chart's namespace and is
  not behind this flag.

**Trade-off the judge and the coordinator must accept before the flag turns on.**
With the bypass, ztunnel stops capturing inbound traffic to the gateway pod, so
`kore-system`'s STRICT default, its default-deny and the Gateway's allow-listener
policy no longer gate the pod's inbound, on any of its ports. Outbound traffic
from the gateway to its backends stays captured. The gateway's TLS termination
and routing are unchanged. Before the flag turns on, in-mesh callers of the
gateway must be checked: none is known in this repository, and Istio's own
guidance says the annotation is for out-of-mesh callers only. Both points are
**unverified** until the live run.

**Unverified until the live run:**

- that the bypass lets the plaintext scrape reach `/metrics` on port 15020;
- that the policies in `kore-system` stop gating the gateway pod's inbound, as
  described above;
- that the bypass annotation is copied to the pod, as the scrape annotations were
  (the same copy path, so likely).

Verified by the live run (writer comment on #1514, origin/main `7fedd2de`,
agentgateway v1.7.0, flag on in a throwaway overlay copy):

- both data-plane pods carry `prometheus.io/scrape: "true"`,
  `prometheus.io/port: "15020"` and `prometheus.io/path: /metrics`, and declare
  a container port named `metrics` on 15020, so the annotation copy and the port
  are right;
- `up{job="kubernetes-pods"}` is 0 for both pods, so the default job selects
  them; the scrape error is the EOF above.

## Series from the live run

The data plane's `/metrics` on port 15020 serves these series (verified live):

- `agentgateway_requests_total` (counter): request count, the source of the
  error ratio.
- `agentgateway_request_duration_seconds_{bucket,sum,count}` (histogram): latency.
- `agentgateway_response_bytes_total`, `agentgateway_downstream_connections_total`,
  `agentgateway_requests_shed_total`, plus build, cgroup and config series.

After a few requests through the gateway, the request series carry these labels:
`backend`, `protocol`, `method`, `status`, `reason`, `bind`, `gateway`,
`listener`, `route`, `route_rule`. **None carries a `service` label.**

Observed values:

- `route` is `<namespace>/<HTTPRoute name>`, for example
  `delivery-probe--local/delivery-probe-shared`,
  `golden-path-example--local/golden-path-example-shared`, `keycloak/keycloak`.
  The shared-route HTTPRoute is named `<service>-shared`.
- `backend` is the Kubernetes Service's FQDN and port, for example
  `delivery-probe-frontend.delivery-probe--local.svc.cluster.local:80`.
- `route_rule` is `unknown`. TCP routes (registry) show `method` and `status`
  as `unknown`.

The "Candidate series" table in earlier revisions named series from recall. The
names above replace it; `agentgateway_tcp_*` was not seen in the run and stays
unknown.

## What carries the service key

**The live run: no series carries a service label. Two labels name the service
by convention, so the service key is derivable but not emitted.** That is
outcome 2 of the three below, with a derivation:

1. **`route` carries the service name.** Not as observed. `route` carries the
   namespace and the HTTPRoute name, and the shared route's name is
   `<service>-shared`.
2. **`route` carries a value that is not the service, and the service is
   derivable from it.** This is the observed case. Stripping the namespace and
   the `-shared` suffix from `route` gives the service key for shared-route
   services. A recording rule that keeps `route` as it is keys the route, not
   the service; the rule must apply the derivation below to key the service.
3. **No series carries any service-identifying label.** Not the case: `route`
   and `backend` both carry the name.

Two derivations, and they disagree for the same app in the run. From `route`,
`delivery-probe-shared` gives `delivery-probe`. From `backend`,
`delivery-probe-frontend` is the Kubernetes Service. So the service key cannot
be read from either label's name alone. ADR 0174 names the app record as the
source of the service key; the next ticket picks which label the app record maps
to the service. Until then the evidence set stays availability, restarts and
readiness (ADR 0174), and the service-keyed series are **unverified**.

The derivation the live query below uses, in PromQL:

```
label_replace(agentgateway_requests_total, "service", "$1", "route", "^[^/]+/(.+)-shared$")
```

It keys the service only for shared-route services; a route without the
`-shared` suffix does not match and gets no `service` label.

## Live query (coordinator, after merge)

Read-only except for the flag turn-on in step 0. Use the configured context
`k3d-kore-local`, never the current one (`infra/environments/local/environment.yaml`).
Run one step at a time.

0. **Turn the scrape on for the proof, without touching the tracked overlay.**
   The flag is off in `infra/environments/local/environment.yaml`. Set
   `agentgateway-data-plane-metrics` to `true` in a scratch copy of the local
   overlay (a worktree copy, never the tracked file), and apply it the way the
   proof scripts do. Record the outcome. Only then `harness flag activate` turns
   it on in the tracked overlay.

1. **Do the data-plane pods carry the annotations, including the bypass, and which ports do they declare?**

   ```sh
   kubectl --context k3d-kore-local -n kore-system get pods \
     -l gateway.networking.k8s.io/gateway-name=kore-gateway \
     -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{.metadata.annotations}{"\n"}{range .spec.containers[*].ports[*]}  {.name} {.containerPort}{"\n"}{end}{end}'
   ```

   Expect `ambient.istio.io/bypass-inbound-capture: "true"` beside the
   `prometheus.io/*` annotations. If it is absent, the infrastructure annotation
   was not copied: record that and stop. Labels are `kubectl get pods --show-labels`
   in the same namespace.

2. **Does the data plane serve `/metrics` on 15020, and which series does it emit?**

   ```sh
   kubectl --context k3d-kore-local -n kore-system port-forward pod/POD 15020:15020
   curl -s http://127.0.0.1:15020/metrics | grep -v '^#' | sed -E 's/[{ ].*//' | sort | uniq -c
   curl -s http://127.0.0.1:15020/metrics | grep '^agentgateway_requests_total' | head -5
   ```

   `POD` is one pod from step 1. If `15020` refuses, the port is wrong: list the
   container ports from step 1 and record the port that serves `/metrics`.

3. **Does Prometheus scrape the data-plane pods now?** This is the check the
   bypass must pass. Forward the Prometheus server and query its API:

   ```sh
   kubectl --context k3d-kore-local -n observability port-forward svc/prometheus-server 9090:80
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=up{job="kubernetes-pods"}'
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=count by (__name__) ({__name__=~"agentgateway.*"})'
   curl -s 'http://127.0.0.1:9090/api/v1/targets?state=active'
   ```

   The data-plane pods must show `up` 1. If `up` is still 0, the
   `lastError` of the target in the third query is the answer (an EOF means the
   bypass did not reach the pod). The label name that separates the data plane
   from other pods (for example `kubernetes_namespace`) is a chart detail,
   unverified here: read it from the first result.

4. **After traffic, which label carries the route and the service?** Send a few
   requests through the gateway to one golden-path service, wait one scrape
   interval, then:

   ```sh
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=sum by (route, status) (agentgateway_requests_total)'
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=sum by (backend, status) (agentgateway_requests_total)'
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=sum by (service, status) (label_replace(agentgateway_requests_total, "service", "$1", "route", "^[^/]+/(.+)-shared$"))'
   ```

   Record whether `route` and `backend` still carry the names above, and whether
   the derived `service` matches the Service the request went to. A
   recording rule on `route` alone keys the route; the derivation in the third
   query keys the service for shared routes only.

## Live result

Run 1, live-proof-combined2 (writer comment on #1514, origin/main `7fedd2de`,
v0.27.0 locks, flag on in a throwaway overlay copy, before the bypass): the
annotations, the port and the series were confirmed; no series carries a
`service` label; `route` and `backend` carry the names above; `up` is 0 with the
EOF scrape error. Not a pass for AC 2 (Prometheus scrapes the data plane).
Outcome recorded for the flag: none, and the flag is not activated.

Run 2 (the fix, the coordinator's rerun after merge): **not yet run.** The
coordinator records, for each step: the command, the output that matters
(annotations, ports, series names, labels, `up`, the `route` and `backend`
values, the derived `service`), the outcome, and the commit it ran against. The
recorded proof is on the issue (ADR 0097) before #1514 closes, and the flag is
activated only after that outcome is recorded.
