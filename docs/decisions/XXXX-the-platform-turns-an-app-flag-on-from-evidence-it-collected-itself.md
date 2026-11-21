---
status: proposed
summary: The platform turns an app flag on only after an activation window over platform-produced series, never series the app pushes; the window's verdict and an evidence summary are recorded in a platform-written outcome bound to the signed image digest, availability-only until request metrics are proven, and a missing series makes a window inconclusive, not confirmed.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: The platform turns an app flag on from evidence it collected itself

Source: [GitHub issue #1486](https://github.com/corekraft/kore/issues/1486), under #1478 (decisions 12, 14 and 15).

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md), which makes a recorded live proof the gate for turning a flag on, and [ADR 0127](0127-an-owner-waiver-recorded-in-an-outcome-counts-as-proof-for-a-flag.md), which names the sources an outcome may carry. Builds on [ADR 0140](0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md) and [ADR 0128](0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md).

## Context

On kore-vps the platform decides when an app's flag turns on, from live
evidence and a recorded outcome (#1478 decisions 12, 14, 15). Three facts
shape what that evidence can be:

- The collector's OTLP receivers have no authentication and `k8s_attributes`
  associates telemetry by the sender's own `k8s.pod.uid` first (ADR 0140), so
  an app can forge any series it pushes. An app must not be able to fake what
  the platform accepts.
- Request-level series have no source for a golden-path app. The Service
  dashboard and `ServiceHighErrorRatio` read `istio_requests_total`, which
  needs an ambient waypoint, and the `golden-path-workload` chart creates none.
  The repository configures no agentgateway metrics and no scrape for them.
- The vps overlay layers none of local's observability values, so Prometheus,
  Loki, Tempo and Grafana run as chart defaults there. Nothing yet proves a
  scrape, a rule or a datasource on vps.

A harness outcome closes a numbered idea in `docs/ideas`, once. An app flag is
activated far more often than that, so the same shape cannot carry it.

## Decision

- **Evidence is platform-produced.** An activation window reads only series
  the platform produces: kube-state-metrics (available replicas, restarts,
  rollout), the gateway or mesh (when proven), and the node. Series an app
  sends over OTLP are diagnostic and never evidence.
- **`otlp-route` is not needed and stays off on vps.** Pods already send to
  `otel-collector.observability.svc:4318`. ADR 0140 stands: no route on a
  Gateway reachable from a network without OTLP authentication, and none on
  the external Gateway.
- **The evidence set is fixed by the platform.** Per window: available replicas
  never below the app's declared minimum, no container restart and no failed
  rollout, readiness never failing, and, once request series are proven, the
  server-error ratio and p95 latency against the app's baseline. There is no
  per-app override in v1.
- **Availability only until request series are proven.** A spike proves which
  agentgateway data-plane series carry a service label and adds their scrape.
  Until then the set is availability, restarts and readiness, and the outcome
  names its evidence set so nobody reads it as covering errors or latency. The
  set grows by expand-contract.
- **Fail closed on missing evidence.** A window is `inconclusive`, never
  `confirmed`, when Prometheus did not scrape through the whole window, the
  collector was down, dropping or refusing data in it, or a required series
  is absent. The summary names which.
- **Evidence is read over the configured context.** The judge queries
  Prometheus through `kubectl port-forward` on the environment's kube context,
  as ADR 0143 does for the registry. Prometheus, Loki, Tempo and Grafana stay
  unrouted.
- **The outcome carries its evidence.** At the end of a window the platform
  writes an app flag outcome with the queries, values, window and baseline, so
  the decision survives metrics retention and a lost box. Its fields mirror
  `harness outcome record` (`Result`, `Kind: verification`, `Source`, `Flag`,
  `Environment`, `Evidence`, `Recorded`) plus the app and the signed image
  digest.
- **A new source, `platform-window`.** `OUTCOME_SOURCES` gains it by
  expand-contract. `findProof` counts it only for an app flag. `live-run` and
  `owner-waiver` stay valid, and a waiver stays visible in `flag audit`
  (ADR 0127).
- **Evidence is bound to the artifact.** The outcome names the image digest and
  the app record commit it observed. Activation refuses when the app record's
  current digest differs, as chart locks bind evidence to charts (ADR 0138).
- **The delivery loop judges.** In v1 a command run by the delivery loop on the
  delivery host reads the evidence and writes the flag state and the outcome as
  a git change the judge merges. There is no in-cluster controller.
- **No flag service.** An app's flag state is a map in its app record in git.
  Argo renders it into a ConfigMap the app mounts and re-reads; "reads at run
  time" means reading that file. ADR 0077's statement that there is no runtime
  flag service stands. A flag change is a git commit, so a git revert rolls it
  back (#1478 decision 7).
- **A bad window leaves the flag off.** The platform records a refuted outcome
  and emails the owner through the ADR 0128 path. After activation a regression
  only alerts (notify-only, ADR 0114). Turning a flag off automatically is an
  enforcing guardrail and needs the owner's approval (ADR 0080).
- **Low traffic is inconclusive.** A window that reads request series needs a
  minimum request count, one platform default; below it the result is
  `inconclusive`. An availability-only window is exempt.
- **The evidence signals have one owner.** The `service-observability` chart
  defines each signal once as a recording rule per service. The dashboard, the
  alert rules and the judge read those recorded series, and an evidence summary
  quotes their names, never free-typed queries.
- **A service is selected by a platform label, not by namespace.** The chart
  builds a service's namespace as `<service>--<environment>`, but #1478
  decision 13 makes the namespace a suborg with no environment in it, so one
  namespace holds several services. Evidence selects a service by a label from
  the app record, exported through kube-state-metrics' label allowlist, and
  request series by the gateway route. The old namespace key stays until the
  move (expand-contract).
- **The baseline is the service's own prior window.** It is the equal-length
  window before the release rolled out. A first release has no baseline and is
  judged against absolute limits only (the 5 percent error ratio of
  `ServiceHighErrorRatio`, zero restarts, readiness never failing). A baseline
  that itself breaks those limits is not used.
- **Disk is evidence.** A window also requires free node disk above a platform
  floor, so an app is not activated on a node about to fill. Notify-only alerts
  for node filesystem and PVC fill go through the ADR 0128 path; their
  threshold values are owner decisions.
- **Owners read evidence from the outcome.** Grafana stays unrouted: the owner
  reads the outcome and its quoted series, and reaches Grafana by
  `kubectl port-forward` on the `kore-vps` context. A route to it belongs to the
  Gateway concept, behind its own authentication decision.

## Consequences

- The vps observability stack must be set up and proven before any flag
  activates from evidence: a scrape, loaded rules and a working datasource.
  The vps overlay layers none of local's observability values today, so
  Prometheus has no collector scrape and no platform rule file, Loki has no
  single-binary setting, Grafana has no datasource, and `k8s.cluster.name` is
  the placeholder `REQUIRED`.
- Nothing alerts on disk today: no filesystem series exists on vps.
- Quiet apps cannot confirm on request evidence until a platform probe exists;
  that probe is a follow-up, not v1.
- The margin and factor over baseline, the minimum request count, the window
  lengths, the disk thresholds, the metrics retention, the outcome record's
  location and whether a preview inside prod is the live proof of an app flag
  (it adds capacity use on one node) are owner decisions, recorded in #1486
  and not decided here.
- Platform flags are proven as before, by a live run or an owner waiver in
  `docs/ideas`.
