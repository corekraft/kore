# agentgateway data-plane series and the service key

Finding for [#1514](https://github.com/corekraft/kore/issues/1514), under
[#1510](https://github.com/corekraft/kore/issues/1510) and ADR 0174. It answers
which agentgateway data-plane series give request count, error ratio and
latency per service or route, and whether any carries the service key.

**Status: the repository part is done; the live proof is owed after merge.**
Nothing in the "Candidate series" or "Live result" sections has been seen on a
cluster. Every such claim is marked **unverified**. The coordinator runs the
queries in "Live query" and records the answers in "Live result" before the
evidence set grows past availability (ADR 0174).

## Verified in the repository

- The agentgateway chart and its CRDs are pinned at v1.7.0 from
  `oci://cr.agentgateway.dev/charts` (`infra/catalog/components.yaml`,
  `infra/catalog/compatibility.md`). The controller and proxy images are pinned
  by digest in `infra/environments/common/values/agentgateway.yaml`.
- The flag `ingress-agentgateway` is on in `local` and off in `vps` and
  `managed-example` (`infra/environments/*/environment.yaml`).
- The platform Gateway is `kore-gateway` in namespace `kore-system`, with
  GatewayClass `agentgateway` when the flag is on
  (`infra/charts/platform-config/templates/gateway.yaml`). The template says
  agentgateway generates the data-plane pod for that Gateway, copies the
  Gateway's infrastructure labels onto it, and runs it under a ServiceAccount
  named after the Gateway. So the data plane lives in `kore-system`, not in
  `agentgateway-system`, which holds only the controller.
- Before #1514 the repository configured no agentgateway metrics and no
  data-plane scrape (ADR 0174, "Request-level series have no source").
- The chart's default `kubernetes-pods` job scrapes pods that carry
  `prometheus.io/scrape` and `prometheus.io/port`. The pinned ztunnel chart's
  pods carry them with port 15020, checked by the opt-in upstream spec
  `tools/kore/integration/platform/ztunnel-render.spec.ts` (ADR 0062). The
  Prometheus server is `prometheus-server` in `observability`, the Grafana
  datasource URL (`infra/environments/local/values/grafana.yaml`).
- Each golden-path service's HTTPRoute is named after the service and parented
  on a Gateway by the service's name (`infra/charts/golden-path-workload/templates/ingress.yaml`).
  If a series' `route` label carries the HTTPRoute name, it carries the service
  key for those services.
- ADR 0174 picks request series "by the gateway route" and the service "by a
  label from the app record". No such label exists yet.

## The data-plane scrape (#1514)

The scrape is the chart's own pod scrape, switched on by an annotation on the
data-plane pods. Nothing changes in the Prometheus values.

- The flag is `agentgateway-data-plane-metrics`, declared in the three overlays
  and **off in all of them** (`infra/environments/*/environment.yaml`). It turns
  on only through `harness flag activate`, after a recorded live outcome
  (AGENTS.md, "It just works").
- With the flag on and the GatewayClass `agentgateway`, the Gateway's
  `spec.infrastructure.annotations` carry `prometheus.io/scrape: "true"` and
  `prometheus.io/port: "15020"`
  (`infra/charts/platform-config/templates/gateway.yaml`, helper
  `platform-config.agentgatewayMetrics` in `_helpers.tpl`).
- Rendered output, checked with `helm template` on the local platform-config
  values: with the flag off, the chart renders exactly as `origin/main` does
  (193 lines, no difference). With the flag on, the only added lines are the
  annotation block.
- Specs: `tools/kore/integration/config/agentgateway-data-plane-metrics-chart.spec.ts`
  renders the Gateway with the flag on, off, and on with the Istio class, and
  reads its infrastructure block; `tools/kore/src/platform/platform.agentgateway-data-plane-metrics.spec.ts`
  pins the flag off in every overlay.

**Unverified until the live run:**

- that agentgateway copies Gateway `infrastructure.annotations` onto the
  data-plane pod (the template copies labels, and the Gateway API spec asks
  implementations to apply infrastructure annotations too);
- that the data plane serves its metrics on port 15020 (the ztunnel number,
  not checked for agentgateway);
- that the default job's `kubernetes-pods` relabelling selects these pods in
  this chart version, which the repository checks only for ztunnel.

If the pod is not annotated, or port 15020 is wrong, `up` is absent for the
pod. The live query below shows which.

## Candidate series (unverified)

These names come from the upstream agentgateway documentation as recalled. They
are not checked against v1.7.0 and must be read from the live `/metrics` output.

| Series (candidate)                      | Type      | What it would give         | Candidate labels                                                            | Status     |
| --------------------------------------- | --------- | -------------------------- | --------------------------------------------------------------------------- | ---------- |
| `agentgateway_requests_total`           | counter   | request count, error ratio | `gateway`, `listener`, `route`, `route_rule`, `backend`, `method`, `status` | unverified |
| `agentgateway_request_duration_seconds` | histogram | latency (p95 by `le`)      | the same set as the counter                                                 | unverified |
| `agentgateway_tcp_*`                    | counter   | connections, not requests  | none needed for this finding                                                | unverified |

Error ratio would be `status` 5xx over all requests on the same `route`,
numerator and denominator recorded, as ADR 0174 requires.

## What carries the service key

**Not known. Not live-verified.** Three outcomes are possible, and each has a
known next step:

1. **The `route` label carries the service name** (the HTTPRoute name, or
   `namespace/name` of it). Then the evidence set selects a service by that
   label. The smallest change is a recording rule per service, as the
   `service-observability` chart does for `istio_requests_total`, selecting on
   `route`; no change to the scrape.
2. **The `route` label carries a value that is not the service** (a per-rule or
   generated name). Then the smallest change is to make the HTTPRoute name the
   service key, or to add a label to the data plane through its
   AgentgatewayParameters, if v1.7.0 accepts custom metric labels. That is
   unverified.
3. **No series carries any service-identifying label.** Then the request series
   cannot select a service, the window stays availability-only, and the smallest
   change is the one in outcome 2 plus the per-service recording rule of
   outcome 1.

Until the live query runs, the evidence set stays availability, restarts and
readiness (ADR 0174), and any outcome names that set.

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

1. **Does the data plane carry the annotations and the label, and which ports does it declare?**

   ```sh
   kubectl --context k3d-kore-local -n kore-system get pods --show-labels
   kubectl --context k3d-kore-local -n kore-system get pods \
     -l gateway.networking.k8s.io/gateway-name=kore-gateway \
     -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{.metadata.annotations}{"\n"}{range .spec.containers[*].ports[*]}  {.name} {.containerPort}{"\n"}{end}{end}'
   ```

   If the second returns nothing, the pod label is absent: record the labels the
   first command shows and use the pod name for the next steps.

2. **Which series and labels does the data plane emit?** Forward the port of
   one data-plane pod (`POD` from step 1) and read `/metrics`:

   ```sh
   kubectl --context k3d-kore-local -n kore-system port-forward pod/POD 15020:15020
   curl -s http://127.0.0.1:15020/metrics | grep -v '^#' | sed -E 's/[{ ].*//' | sort | uniq -c
   curl -s http://127.0.0.1:15020/metrics | grep '^agentgateway_requests_total' | head -5
   ```

   If `15020` refuses, the port is wrong: list the container ports from step 1
   and retry on the port that serves `/metrics`, then record it as the answer.

3. **Does Prometheus scrape it, and with which labels?** Forward the Prometheus
   server and query its API:

   ```sh
   kubectl --context k3d-kore-local -n observability port-forward svc/prometheus-server 9090:80
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=up{job="kubernetes-pods"}'
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=count by (__name__) ({__name__=~"agentgateway.*"})'
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=count by (route) (agentgateway_requests_total)'
   ```

   `up{job="kubernetes-pods"}` lists every pod the default job scrapes; find the
   data-plane pod by its namespace or pod label. The label names of the default
   job are a chart detail and are unverified here: read them from the first
   result if the names differ.

4. **After traffic:** send a few requests through the gateway to one golden-path
   service, wait one scrape interval, then:

   ```sh
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=sum by (route, status) (agentgateway_requests_total)'
   ```

   A non-empty result with `route` equal to the service name answers the service
   key (outcome 1). A result with `route` but not the service name is outcome 2.
   An empty result with no series at all is outcome 3, or a scrape that never
   reached the pod (`up` is 0 or absent).

## Live result

Not yet run. The coordinator records, for each step: the command, the output
that matters (annotations, ports, series names, labels, `up`, the `route`
values), the outcome (1, 2 or 3 above), and the commit it ran against. The
recorded proof is on the issue (ADR 0097) before #1514 closes, and the flag is
activated only after that outcome is recorded.
