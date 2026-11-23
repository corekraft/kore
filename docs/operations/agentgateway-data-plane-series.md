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
- The Prometheus scrape seam is the `extraScrapeConfigs` string in
  `infra/environments/local/values/prometheus.yaml`. It holds the two Collector
  jobs and, from #1514, the `agentgateway-data-plane` job. The chart's default
  `kubernetes-pods` job is not replaced (`platform.telemetry-proofs.spec.ts`).
  The Prometheus chart is 29.45.1 and its server is `prometheus-server`, the
  Grafana datasource URL (`infra/environments/local/values/grafana.yaml`).
- Each golden-path service's HTTPRoute is named after the service and parented
  on a Gateway by the service's name (`infra/charts/golden-path-workload/templates/ingress.yaml`).
  If a series' `route` label carries the HTTPRoute name, it carries the service
  key for those services.
- ADR 0174 picks request series "by the gateway route" and the service "by a
  label from the app record". No such label exists yet.
- The ztunnel pods carry `prometheus.io/scrape` and port 15020, which the
  default `kubernetes-pods` job picks up (ADR 0062). Whether agentgateway's
  proxy pods carry the same annotation is **unverified**; if they do, the
  default job already scrapes them and the new job is a second, labelled copy.

## The scrape added by #1514

Job `agentgateway-data-plane`, 30 s, in `local` only (the overlay where
`ingress-agentgateway` is on). It keeps the pods of `kore-system` whose
`gateway.networking.k8s.io/gateway-name` label is `kore-gateway` and that
declare container port `15020`, and sets the `namespace` and `pod` labels.

- **Unverified:** that the proxy pod carries the `gateway.networking.k8s.io/gateway-name`
  label, and that it declares container port `15020` as its metrics port. If
  either is false the job scrapes no target and `up` is absent. The live query
  below shows which.
- The gate is the overlay, not a code-level flag check. A Helm argument for
  this job would replace the `extraScrapeConfigs` string and drop the Collector
  jobs, so the overlay is the only place that can add it without changing the
  seam. Vps and managed-example never layer the local values, so they never
  render it. The spec `platform.agentgateway-scrape.spec.ts` pins this.

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
   label. The smallest change is a `metric_relabel_configs` rule in the
   `agentgateway-data-plane` job that copies `route` to a `service` label, with
   no change to the chart.
2. **The `route` label carries a value that is not the service** (a per-rule or
   generated name). Then the smallest change is to make the HTTPRoute name the
   service key, or to add a label to the data plane through its
   AgentgatewayParameters, if v1.7.0 accepts custom metric labels. That is
   unverified.
3. **No series carries any service-identifying label.** Then the request series
   cannot select a service, the window stays availability-only, and the smallest
   change is the one in outcome 2 plus a recording rule per service, as ADR 0174
   describes for the `service-observability` chart.

Until the live query runs, the evidence set stays availability, restarts and
readiness (ADR 0174), and any outcome names that set.

## Live query (coordinator, after merge)

Read-only. Use the configured context `k3d-kore-local`, never the current one
(`infra/environments/local/environment.yaml`). Run one step at a time.

1. **Does the data plane carry the label, and which ports does it declare?**

   ```sh
   kubectl --context k3d-kore-local -n kore-system get pods --show-labels
   kubectl --context k3d-kore-local -n kore-system get pods \
     -l gateway.networking.k8s.io/gateway-name=kore-gateway \
     -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{range .spec.containers[*].ports[*]}  {.name} {.containerPort}{"\n"}{end}{end}'
   ```

   If the second returns nothing, the label is absent: record the labels the
   first command shows and go to step 2 anyway, using the pod name.

2. **Which series and labels does the data plane emit?** Forward the port of
   one data-plane pod (`POD` from step 1) and read `/metrics`:

   ```sh
   kubectl --context k3d-kore-local -n kore-system port-forward pod/POD 15020:15020
   curl -s http://127.0.0.1:15020/metrics | grep -v '^#' | sed -E 's/[{ ].*//' | sort | uniq -c
   curl -s http://127.0.0.1:15020/metrics | grep '^agentgateway_requests_total' | head -5
   ```

   If `15020` refuses, the port is wrong: list the container ports from step 1
   and retry on the port that serves `/metrics`.

3. **Does Prometheus scrape it, and with which labels?** Forward the Prometheus
   server (`prometheus-server` in `observability`) and query its API:

   ```sh
   kubectl --context k3d-kore-local -n observability port-forward svc/prometheus-server 9090:80
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=up{job="agentgateway-data-plane"}'
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=count by (__name__) ({job="agentgateway-data-plane"})'
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=count by (route) (agentgateway_requests_total{job="agentgateway-data-plane"})'
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=count by (job) ({__name__=~"agentgateway.*"})'
   ```

   The last query shows whether the chart's default `kubernetes-pods` job
   already scrapes the proxy pods too.

4. **After traffic:** send a few requests through the gateway to one golden-path
   service, wait one scrape interval (30 s), then:

   ```sh
   curl -sG http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=sum by (route, status) (agentgateway_requests_total{job="agentgateway-data-plane"})'
   ```

   A non-empty result with `route` equal to the service name answers the service
   key (outcome 1). A result with `route` but not the service name is outcome 2.
   An empty result with no series at all is outcome 3, or a scrape that never
   reached the pod (`up` is 0 or absent).

## Live result

Not yet run. The coordinator records, for each step: the command, the output
that matters (series names, labels, `up`, the `route` values), the outcome
(1, 2 or 3 above), and the commit it ran against. The live proof is recorded
on the issue (ADR 0097) before #1514 closes.
