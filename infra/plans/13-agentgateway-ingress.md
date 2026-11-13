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

Next: Paused for the test refactor (plan 14, #371): start nothing here until its `paused` label is removed. When it resumes: Run the #207 live proof (KORE_RUN_AGENTGATEWAY_PROOF=1 tools/kore/scripts/agentgateway-live-proof.sh, phases 1–4 in a throwaway profile; kore-local stopped, not destroyed). Then #208, then #212 measured against #320's baseline under the same load. #210 only if the median CPU or memory drop is at least 20% (owner decision on #126). Full state: #366.

### Work

- [ ] Install agentgateway as the GatewayClass for ingress, behind a feature
      flag, dark launched in `local`.
- [ ] Move the platform Gateway and routes to it, and remove Istio's ingress
      gateway once the flag is on.
- [ ] Keep ztunnel, mesh policy and tenant isolation unchanged.

### Exit Criteria

- The gateway integration suite passes with agentgateway serving ingress.

### Safety pattern and live proof (#207)

Pattern: `flag` (`ingress-agentgateway`, off in `local`). The flag-on render
swaps the Gateway class and publishes its Service through
`AgentgatewayParameters`; readiness waits for `deployment/kore-gateway-istio`
and `service/kore-gateway-istio` to be absent. Fast specs prove the render and
the readiness; the items above stay open until a live run on a throwaway
profile shows the gateway integration suite passing with the flag on and a
migration from an Istio-ingress profile that keeps the cluster. Whether Istio
removes the proxy by itself when the class changes is unproven: if it does not,
readiness times out naming the leftover resource.

## Step 3: Re-Prove the Identity Chain

### Work

- [ ] Prove that peer identity still reaches OPA (ADR 0066) and that the
      layered authorization of ADR 0007 still holds.
- [ ] Re-run the identity, authorizer and reference app suites.

### Exit Criteria

- The identity and admission suites pass live on k3d.

## Step 4: Outcome

### Work

- [ ] Measure ingress CPU and memory on k3d under the same routes and record it
      against the comparison point as the idea's outcome.

### Exit Criteria

- The outcome is recorded as confirmed, refuted or inconclusive.

## Measurement Method

The comparison point (Step 1) and the outcome (Step 4) run the same procedure,
`npm run test:integration:ingress-measure` in `tools/kore`, implemented by
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

## Results

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

Step 4 results will be added here against this table.
