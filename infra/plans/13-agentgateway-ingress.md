---
status: active
summary: Replace Istio ingress with agentgateway on k3d, keep ztunnel for identity and mTLS, re-prove the identity chain, and measure the resource outcome.
last-verified: 2026-11-11
---

# agentgateway Ingress Plan

## Purpose

agentgateway replaces Istio as Kore's Gateway API ingress
([ADR 0081](../../docs/decisions/0081-agentgateway-replaces-istio-ingress.md)),
adding first-class routes for agent and LLM traffic. Istio ambient ztunnel
stays for workload identity and mTLS. This plan starts after plan 9, because
the outcome is measured on k3d.

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

- [ ] Install agentgateway as the GatewayClass for ingress, behind a feature
      flag, dark launched in `local`.
- [ ] Move the platform Gateway and routes to it, and remove Istio's ingress
      gateway once the flag is on.
- [ ] Keep ztunnel, mesh policy and tenant isolation unchanged.

### Exit Criteria

- The gateway integration suite passes with agentgateway serving ingress.

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

- **Subject.** Every pod labelled `gateway.networking.k8s.io/gateway-name=kore-gateway`
  in `kore-system`: the Istio ingress proxy now, the agentgateway data plane
  after Step 2. ztunnel, waypoints and istiod are not part of the subject.
- **Routes.** The reference app's HTTPRoute (`kore.local`, `PathPrefix /`)
  through the platform Gateway: `/livez`, `/readyz`, `/api` and
  `/api/protected` (denied without a principal). The throwaway gateway proof
  route is not used: it needs a created namespace, and the measurement changes
  no cluster resource.
- **Load.** 200 HTTPS requests per route per round, 4 in flight, from the host
  to `https://kore.local:8443` through the k3d load balancer, verifying the
  mkcert CA. Rounds repeat for the whole sampling window.
- **Settle.** 60 seconds idle after the cluster is converged, before any load.
- **Sampling.** Six samples 20 seconds apart while the load runs, read from the
  metrics API (`kubectl get --raw /apis/metrics.k8s.io/v1beta1/…?labelSelector=…`)
  through the injectable runner. Each sample totals CPU and memory over the
  subject pods; the result is the median and the peak of the six.
- **Preconditions.** The host 1-minute load average is below 10 at the start
  (the run refuses otherwise; it is not re-checked during the run), the person
  running it has confirmed the cluster is converged (the code does not check),
  and nothing else drives the Gateway. Run it twice and record both.
- **Expected outcome.** With the same routes and load, the agentgateway ingress
  pods' median CPU and median memory are each at least 30% below the Istio
  baseline. Confirmed: both are. Refuted: either is not lower than the
  baseline. Inconclusive: both are lower but either by less than 30%, or the
  two baseline runs differ by more than the claimed saving.

## Results

### Comparison point: Istio ingress on k3d (2026-11-12)

Subject: the single `kore-gateway-istio` pod (GatewayClass `istio`) serving
`kore-system/kore-gateway`, on the `kore-local` k3d cluster with 40 pods
running. Method: [Measurement Method](#measurement-method), unchanged defaults.

| Run | Host load at start | CPU median (m) | CPU peak (m) | Memory median (MiB) | Memory peak (MiB) |
| --- | ------------------ | -------------- | ------------ | ------------------- | ----------------- |
| 1   | 9.13               | 60.2           | 114.0        | 47.7                | 48.3              |
| 2   | 8.07               | 57.3           | 65.8         | 48.5                | 49.2              |

The two runs agree within 5% on median CPU and 2% on median memory. Run 1's
first sample (114.0m) is a warm-up outlier; the median is unaffected. Host load
rose above 10 during both runs after the start check (the load guard checks
only at the start), so absolute CPU may include host contention; Step 4 must
apply the same condition. With the 30% rule in the method, agentgateway counts
as confirmed only if its median CPU is at most about 40m and its median memory
at most about 33 MiB.

Step 4 results will be added here against this table.
