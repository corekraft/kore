---
status: active
summary: Replace Istio ingress with agentgateway on k3d, keep ztunnel for identity and mTLS, re-prove the identity chain, and measure the resource outcome.
last-verified: 2026-11-12
---

# agentgateway Ingress Plan

## Purpose

agentgateway replaces Istio as Kore's Gateway API ingress
([ADR 0081](../../docs/decisions/0081-agentgateway-replaces-istio-ingress.md)),
adding first-class routes for agent and LLM traffic. Istio ambient ztunnel
stays for workload identity and mTLS. This plan starts after plan 9, because
the outcome is measured on k3d.

> **Resumed behind the flag (2026-11-12).** The #261 live proof paused this
> plan until the outcome was measured. The owner decided (#126) that it resumes
> with `ingress-agentgateway` off in `local`: the Gateway replacement (#207),
> its identity re-proof (#208) and the measurement (#212) proceed, and the
> measurement runs in a throwaway profile under the same load as the baseline.
> Turning the flag on in `local` (#210) waits for #212 to show at least a 20%
> drop in median ingress CPU or memory; otherwise the flag stays off.

## Step 1: Decide and Pin

### Work

- [x] Record the decision in ADR 0081.
- [x] Pin the agentgateway chart and images, mirror them, and add them to the
      platform image inventory, with compatibility evidence.
- [x] Record the current ingress resource use on k3d as the comparison point.

### Exit Criteria

- The pins validate and the images are signed by digest.

## Step 2: Replace the Gateway

### Work

- [x] Install agentgateway as the GatewayClass for ingress, behind a feature
      flag, dark launched in `local`.
- [x] Move the platform Gateway and routes to it, and remove Istio's ingress
      gateway once the flag is on.
- [x] Keep ztunnel, mesh policy and tenant isolation unchanged.

### Exit Criteria

- The gateway live suite passes with agentgateway serving ingress.

### Safety pattern and live proof (#207)

Pattern: `flag` (`ingress-agentgateway`, off in `local`). The flag-on render
swaps the Gateway class and publishes its Service through
`AgentgatewayParameters`; readiness waits for `deployment/kore-gateway-istio`
and `service/kore-gateway-istio` to be absent. Fast specs prove the render and
the readiness. The items above were ticked once a live run on a throwaway
profile showed the gateway passing with the flag on and a migration from an
Istio-ingress profile that keeps the cluster (see
[Step 2 and 3 live proofs](#step-2-and-3-live-proofs-agentgateway-on-k3d-2026-11-15)).
Istio did not remove the proxy by itself when the class changed, as the next
paragraph records.

The live proof (phase 2) showed it does not: `kore-gateway-istio` stayed and the
Gateway was never Programmed. So `kore-platform-config`'s reconcile now runs a
class-change step, gated by the new flag `gateway-class-change-release` (off in
every overlay; with it off the step reads and deletes nothing) before its Helm upgrade (`gateway-class-change.ts`). It reads
`gateway/kore-gateway` `.spec.gatewayClassName` on the named context; when it
differs from the class the flag derives, it deletes only that Gateway
(Kubernetes garbage collection removes the old proxy through its
ownerReference, so no deployment or service is deleted), waits until the
Gateway and the old proxy are gone (a timeout names the Gateway and the
leftover), and the Helm upgrade that follows recreates it in the new class. A
class change therefore deletes and recreates the Gateway with a brief ingress
outage. It prints one line before the delete. A matching class is a no-op, and so is an
absent Gateway with no old proxy (a fresh profile); an absent Gateway whose old
proxy remains (an interrupted change) still waits for the proxy. The flag off
changes nothing. Rollback is three steps. First turn `ingress-agentgateway` off and run
`kore local up`; with the flag `gateway-rollback-order` on (off in every committed overlay), the run reconciles every component first
(the class change releases the Gateway back to Istio, and Helm removes Kore's
own `AgentgatewayParameters/kore-gateway-service` when platform-config is
re-rendered), then refuses the gated-off releases that are still installed
(`agentgateway-crds is gated off ... run helm uninstall ...`) and exits non-zero.
That failure is expected. With `gateway-rollback-order` off the refusal stays up front, before
any mutation. The operator then removes the releases, in order:
`helm uninstall agentgateway --namespace agentgateway-system --kube-context <ctx>`,
then `helm uninstall agentgateway-crds --namespace agentgateway-system --kube-context <ctx>`.
Uninstalling `agentgateway-crds` deletes the CRDs and every custom resource of
those kinds, so it is the operator's explicit step (data destruction needs
consent), never Kore's; the proof checks no Agentgateway custom resource remains
before it. The second `kore local up` converges as a no-op. A one-command
rollback would be a separate, consented `kore` command if wanted. The refusal's
position moved later under its own flag, `gateway-rollback-order`
(decided on the live run 5 of #207, ADR 0081 addendum); `gateway-class-change-release`
keeps gating only the class-change step. Activation of both is for the live proof
profile: in the throwaway profile of `tools/kore/scripts/agentgateway-live-proof.sh`,
the script turns them on together with `ingress-agentgateway` in phase 2 and keeps
them on through phase 4; no committed overlay turns either on, and a committed
turn-on needs the flag activation command and a recorded live outcome.

Mesh enrollment of the data plane (2026-11-15, #208 live run 6, #126): with
`ingress-agentgateway` on, the `kore-gateway` pod ran in `kore-system` without
`istio.io/dataplane-mode`, `kore-system` uses STRICT mTLS, and ztunnel rejected
the gateway's plaintext connection to the frontend
(`explicitly denied by: istio-system/istio_converted_static_strict`), so the
gateway returned 503 (#208 identity 4 of 7 and reference 7 of 8 failed). The new
flag `agentgateway-mesh-enrollment` (off in every committed overlay; on only in
the live proof's throwaway overlay) enrols just the gateway pod: it adds the pod
label through `Gateway.spec.infrastructure.labels` and a second
`PeerAuthentication` that is permissive on the gateway's listener port only. The
live proof now also sends a request through the Gateway after phase 2 and
expects 200 on the reference route. The #208 identity suite was re-run with
the flag on and passes (see the live proofs section under Results).

## Step 3: Re-Prove the Identity Chain

### Work

- [x] Prove that peer identity still reaches OPA (ADR 0066) and that the
      layered authorization of ADR 0007 still holds. Passing spec: `authorizer.live.spec.ts`,
      "OPA's decision input carries the authenticated source and destination
      principals", with the fail-closed spec beside it. The one skip in the
      identity run is the default-ServiceAccount rejection
      (`kore-workload-identity` is still dryrun); it is not this path.
- [x] Re-run the identity, authorizer and reference app suites.

### Exit Criteria

- The identity and admission suites pass live on k3d.

## Step 4: Outcome

Next: First action: the owner approves the flag activation command for ingress-agentgateway, gateway-class-change-release, gateway-rollback-order and agentgateway-mesh-enrollment in local, one at a time, each after its recorded outcome (#207, #208 and #212 are recorded; #212 is confirmed on memory, CPU neutral). Then a fresh `kore local up` converges with agentgateway ingress and no Istio ingress proxy (#210), then tick the remaining items. Full state: #366.

### Work

- [x] Measure ingress CPU and memory on k3d under the same routes and record it
      against the comparison point as the idea's outcome.

### Exit Criteria

- The outcome is recorded as confirmed, refuted or inconclusive.

## Measurement Method

The comparison point (Step 1) and the outcome (Step 4) run the same procedure,
`npm run test:live:ingress-measure` in `tools/kore`, implemented by
`IngressMeasurement` in `tools/kore/src/platform/ingress-measurement.ts`. Its
values are fixed in `ingressMeasurementDefaults`; changing one invalidates the
comparison, so change it only with a new baseline.

- **Subject.** Two columns, each the total over its pods. _Ingress_: every pod
  labelled `gateway.networking.k8s.io/gateway-name=kore-gateway` in
  `kore-system`, the Istio ingress proxy now and the agentgateway data plane
  after Step 2. _ztunnel_: every pod labelled `app.kubernetes.io/name=ztunnel`
  in `istio-system`, which stays through the switch and is recorded in both the
  baseline and Step 4. Waypoints and istiod are not measured.
- **Routes.** The reference app's HTTPRoute (`kore.local`, `PathPrefix /`)
  through the platform Gateway, each checked for its status on every request:
  `/livez`, `/readyz` and `/api` answer 200; `/api/protected` is denied with 403. Any other status, or a request that does not complete, fails the run.
  Step 4 uses the same routes and statuses on agentgateway. The throwaway
  gateway proof route is not used: it needs a created namespace, and the
  measurement changes no cluster resource. The owner approved this
  substitution of #202's "reference app and gateway proof routes" (2026-11-12).
- **Load.** 200 HTTPS GET requests per route per round, 4 in flight, from the
  host to `https://kore.local:8443` through the k3d load balancer, verifying
  the mkcert CA, with `--connect-timeout 5 --max-time 60`. Rounds repeat for
  the whole sampling window, so the number of requests is not fixed. The
  result therefore records the completed requests, the elapsed time and the
  requests per second, and the Results table reports the rate; two runs are
  comparable only when their rates are close.
- **Target rate (optional).** `KORE_INGRESS_TARGET_RPS=<n>` (or the
  `targetRequestsPerSecond` option) replaces the closed loop with a paced load:
  each curl call sends one batch of about a second of the target
  (`min(requestsPerRoute, round(n))` requests), and the run sleeps out the rest
  of the batch's slot, so the offered rate stays near `n` unless the proxy
  answers slower than the slot allows. Unset is exactly the load above. The
  result records the target and the achieved rate in `rate`, with status
  `matched` when the achieved rate is within 10% of the target and
  `rate_mismatch` otherwise; the live test fails on `rate_mismatch`, and such a
  run is not a matched comparison. The result also reports `cpuPerRequest`
  (median millicores divided by the achieved requests per second, for ingress
  and ztunnel) and the existing p50/p95 latency. A matched-load remeasure runs
  both gateways at one target, below the lower of the two achievable rates.
- **Settle.** 60 seconds idle after the cluster is converged, before any load.
- **Sampling.** Six samples 20 seconds apart while the load runs, read from the
  metrics API (`kubectl get --raw /apis/metrics.k8s.io/v1beta1/…?labelSelector=…`)
  through the injectable runner. Each sample totals CPU and memory over the
  pods of each column, and records the host 1-minute load average at that
  moment; the result is the median and the peak of the six.
- **Preconditions.** The host 1-minute load average is below 10 at the start
  (the run refuses otherwise), the person running it has confirmed the cluster
  is converged (the code does not check), and nothing else drives the Gateway.
  The load average is recorded at every sample, and any rise above 10 during a
  run is reported with the results.
- **Host conditions.** The result's `host` holds, before the settle and after
  the load, the 1, 5 and 15 minute load average, swap used, the Docker VM's
  free memory (`MemAvailable` read in the k3d server container) and the agent
  pane count, read from `hc ls`. An hc that cannot be read is
  recorded by name with a null count, never as zero panes.
- **Baseline.** The mean of the two baseline runs' medians, per metric. The
  spread of a metric is the difference between the two runs' medians as a
  percentage of the baseline.
- **Expected outcome (owner-approved, 2026-11-12).** With the same routes and
  load, the ingress median CPU or median memory drops by at least 20% from the
  baseline, and by more than that metric's baseline spread. Confirmed: either
  metric does. Refuted: neither is lower than the baseline. Inconclusive:
  otherwise, including a drop no larger than the run-to-run spread. The
  ztunnel column is reported beside the ingress and does not decide the
  outcome. `judgeOutcome` in `ingress-metrics.ts` applies this rule.

## Golden-Path Route Set

The golden-path service gets its own route set, baseline and results, so a
golden-path number is never compared with a reference-route number
([#1114](https://github.com/corekraft/kore/issues/1114)). No load tool is
added: `RatedMeasurement` extends the harness above with `routeSet` and still
records p95 (nearest-rank, from sequential probes). Every other value of the
[Measurement Method](#measurement-method) is unchanged.
`npm run test:live:golden-path-load` in `tools/kore` runs both parts below, one run
at a time on an idle host (stop writer and challenger panes first).

- **Route set `golden-path`.** A delivered service's default host
  (`<service>.platform.kore.local`) at its own Gateway in the service
  namespace: `/` and `/healthz` answer 200 from the static frontend, `/api`
  answers 404 from the BFF (the unmodified kotlin-bff template maps no
  controller there; a BFF with a controller is a different baseline). The
  result names the set in `method.routeSet`; the reference set carries none.
  It reports p95, p50 and max of the sequential probes, the same way.
- **Reach.** The probes reach the golden path at the service's own Gateway when its Service publishes an address. A service with no Gateway of its own (`platform-shared-gateway` on: its namespace has no Service of that name) is reached through the shared Gateway, on loopback at the environment's gateway port, which the k3d load balancer maps. The run first checks that its HTTPRoute `<service>-shared` exists, and refuses by name when it does not. `method.gateway` names the Gateway reached, so the two cases are told apart in a result ([#1460](https://github.com/corekraft/kore/issues/1460)).
- **Scale check.** `GoldenPathScaleCheck` reads the HorizontalPodAutoscaler that targets the BFF and refuses before any load when none does: the chart creates one only while `autoscaling-defaults` is on (ADR 0047, [#1465](https://github.com/corekraft/kore/issues/1465)). It waits for the BFF to settle at the autoscaler's minimum, starts the golden-path load, and waits until it sees N ready replicas (`KORE_SCALE_PEAK_REPLICAS`, default 4, above the minimum and at most the maximum). It then stops the load and waits for the BFF to return to the minimum. The check writes nothing to the cluster: the autoscaler moves the replica count, and the chart omits `spec.replicas` while it is on, so Argo CD's self-heal has nothing to revert. Any request that fails or answers another status fails the check, as does a BFF that never reaches N or never settles at its minimum. The result records the start, the most ready replicas seen, and the end, with the autoscaler's bounds and the host record. The live run needs `autoscaling-defaults` on and the service delivered through Argo CD.
- **Self-heal (#1465).** The golden-path workload chart sets `replicas: 1` and
  creates no HorizontalPodAutoscaler, with or without `autoscaling-defaults`
  (`infra/charts/golden-path-workload`), and the delivery's ApplicationSet
  syncs with `selfHeal: true`, so Argo CD reverts a scale of the BFF. The 1114-d
  run found one ready replica (the chart's count, not the two the ticket
  expected). The check now reads the autoscalers first and refuses before its
  first write, naming the replica count it found, unless one targets the BFF.
  No route that survives self-heal is built yet. Choosing one is an owner
  decision: an autoscaler from the chart's values (ADR 0047), a delivered
  replica value, or an Argo CD ignore on `spec.replicas`. Each changes what
  runs in a cluster and needs its own live run. The scale proof stays owed on
  [#1114](https://github.com/corekraft/kore/issues/1114).
- **Host record.** Both results carry the ingress measurement's `host` record
  beside the numbers; the scale check refuses a host 1-minute load average of
  10 or more, as the ingress measurement does.
- **Baselines only.** There is no target; a baseline is read from the runs.
  k6 stays held behind its trigger ([#1151](https://github.com/corekraft/kore/issues/1151)):
  adopt it only if p95 across three clean runs spreads beyond the bound that
  spec sets, since sequential probes undercount queueing under overload and the
  load is paced batches, not a fixed arrival rate.

## Results

### Golden-path route set baseline

Not recorded yet: it needs one live run of `npm run test:live:golden-path-load`, to be
recorded as one JSON comment on #1114 with a plan 15 line.

The first attempt (`live-1114-a`, 2026-11-19, on main after #1313, with
`platform-argocd-delivery` on and portal off) failed on both tests with a curl
`SSL_ERROR_SYSCALL` to `golden-path-example.platform.kore.local:8443`: the
service's own Gateway publishes no address on k3d, so nothing mapped the port to
it. #1316 (merged in #1317) makes the run refuse by name in that case. [#1460](https://github.com/corekraft/kore/issues/1460) reaches the route through
the shared Gateway when the service has no Gateway of its own, so the rerun waits on
that merge. No
baseline exists until a rerun passes.

### Comparison point: Istio ingress on k3d (2026-11-12)

Subject: the single `kore-gateway-istio` pod (GatewayClass `istio`) serving
`kore-system/kore-gateway`, and the single `ztunnel` pod, on the `kore-local`
k3d cluster. Method: [Measurement Method](#measurement-method), defaults
unchanged. Every request returned its route's expected status.

An earlier recording of this table was withdrawn: its load repeated requests
with a `?n=` query string, which the Gateway and authorizer answer with 403 and
404 instead of the routes' statuses, so it measured denied traffic. The load
now repeats the exact path, and a wrong status fails the run.

| Run | Requests (rate)          | Host load: start, samples min–max | Ingress CPU median / peak (m) | Ingress memory median / peak (MiB) | ztunnel CPU median / peak (m) | ztunnel memory median / peak (MiB) |
| --- | ------------------------ | --------------------------------- | ----------------------------- | ---------------------------------- | ----------------------------- | ---------------------------------- |
| 1   | 3600 in 122.2 s (29.5/s) | 9.5, 5.2–7.7                      | 44.3 / 68.0                   | 58.5 / 58.9                        | 97.3 / 113.0                  | 9.4 / 10.3                         |
| 2   | 4200 in 123.4 s (34.0/s) | 9.6, 4.5–6.5                      | 43.5 / 53.8                   | 54.2 / 54.9                        | 96.9 / 116.0                  | 9.5 / 9.9                          |

The host load never rose above its start value in either run. The two runs'
request rates differ by 15%, because rounds repeat for the whole window; a
Step 4 rate far from 29.5–34.0 requests per second is not comparable.

**Baseline** (mean of the two runs' medians) and the exact thresholds for
Step 4 (a 20% drop, which exceeds each metric's spread):

| Column  | Metric       | Baseline | Spread | Confirmed at or below     |
| ------- | ------------ | -------- | ------ | ------------------------- |
| Ingress | CPU (m)      | 43.937   | 1.8%   | 35.15                     |
| Ingress | Memory (MiB) | 56.325   | 7.5%   | 45.06                     |
| ztunnel | CPU (m)      | 97.087   | 0.4%   | reported, does not decide |
| ztunnel | Memory (MiB) | 9.425    | 0.5%   | reported, does not decide |

Step 4 results are in [Step 4 outcome](#step-4-outcome-confirmed-on-memory-cpu-neutral-2026-11-15), below.

### Step 2 and 3 live proofs: agentgateway on k3d (2026-11-15)

Throwaway profile, flags on only there. Refs #126.

- #207, phases 1 to 4 and the Gateway request step (200 on the reference
  route): pass on live run 7, a retry after the first attempt overloaded the
  Docker VM in phase 4
  ([run 6](https://github.com/corekraft/kore/issues/207#issuecomment-6894865564),
  [run 7](https://github.com/corekraft/kore/issues/207#issuecomment-6897416287)).
- #208, `test:live:identity` 7 passed, 0 failed, 1 skipped; `test:live:reference`
  8 passed
  ([run 7](https://github.com/corekraft/kore/issues/208#issuecomment-6897416557)).
- #212, measured, outcome not set
  ([comment](https://github.com/corekraft/kore/issues/212#issuecomment-6897416867)):

| Metric       | Mean of two medians | Baseline  | Change | Request rate (baseline 29.5 and 34.0/s) |
| ------------ | ------------------- | --------- | ------ | --------------------------------------- |
| Ingress CPU  | 46.7 m              | 43.94 m   | +6.3%  | 42.2 and 40.5/s                         |
| Ingress mem. | 17.9 MiB            | 56.33 MiB | -68%   | 42.2 and 40.5/s                         |

The rates are not matched, so the outcome label stays undecided.

### Matched-load measurement support (2026-11-15)

The 42.2 and 40.5/s runs above were closed-loop, so their rate followed proxy
latency and the host. `IngressMeasurement` now takes an optional target rate
(`KORE_INGRESS_TARGET_RPS`), paces the load to it, and flags a `rate_mismatch`
when the achieved rate is outside 10% of the target. No live run was made for
this change. The matched remeasure and the outcome label followed on 2026-11-15
(superseded by [Step 4 outcome](#step-4-outcome-confirmed-on-memory-cpu-neutral-2026-11-15)).

### Step 4 outcome: confirmed on memory, CPU neutral (2026-11-15)

Owner label, recorded on #212
([decision](https://github.com/corekraft/kore/issues/212#issuecomment-6900331792)):
**confirmed on memory, CPU neutral.** The matched-rate remeasure
([comment](https://github.com/corekraft/kore/issues/212#issuecomment-6900314450))
ran both gateways in one cluster at a target of 22 requests per second.
Refs #126 #210 #212.

| Metric                      | Istio ingress (same cluster) | agentgateway              | Change                        |
| --------------------------- | ---------------------------- | ------------------------- | ----------------------------- |
| Memory, steady state (MiB)  | 74.7 to 74.85                | 19.2 to 19.6 (warm-up 48) | about -74%; -68% against #320 |
| CPU per request (m per r/s) | 1.756 and 1.918              | 1.710 to 2.034            | neutral, ranges overlap       |

The "confirmed" label rests on the same-cluster Istio comparison at a matched
rate, not on the #320 baseline method alone: that method (29.5 to 34 requests
per second) could not be reproduced: Istio could not sustain the earlier 30
requests per second target and reached 20.2 and 20.3 at the 22 target
([#212 comment](https://github.com/corekraft/kore/issues/212#issuecomment-6900314450)).

Limits that stay on record: neither gateway reached the 22 requests per second
target on this host (Istio 20.2 and 20.3, agentgateway 17.0 to 20.2, the 17.0 run having a tainted load sample), and no
agentgateway run was both matched and clean, so the conclusions rest on the five
runs together. The earlier +6.3% CPU came from a higher request rate. Turning
the flags on in `local` is not part of this outcome (#210).
