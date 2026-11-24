---
status: proposed
summary: Every app workload, and the shared gateway proxy, runs at least two replicas, rolls out with maxUnavailable 0 and maxSurge 1, gates traffic on a readiness endpoint of its own, and keeps a PodDisruptionBudget, enforced at admission whatever tool rendered it, so a change never takes an app down.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0154: Workloads run two replicas, roll out one surge pod at a time and keep a disruption budget

Source: [`infra/plans/15-next-horizon.md` § Step 3](../../infra/plans/15-next-horizon.md#step-3-autoscaling-defaults)

Refines [ADR 0047](0047-autoscaling-metrics-server-then-keda.md), which promised at least two replicas and a PodDisruptionBudget but whose chart renders neither by default. Builds on [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md).

Status is `proposed`: it was settled in shape in the grilling of issue #1480 against the owner interview record of #1478 (decisions 3, 8, 11, 14), and the owner then decided the parked questions on #1480 (2026-11-20), recorded below. It stays `proposed` until the owner accepts it.

## Context

The owner's promise for kore-vps is that a change never takes an app down (record decision 3); infrastructure events can. The runtime defaults of decision 8 are the mechanism: at least two replicas, `maxUnavailable: 0` and `maxSurge: 1`, readiness gates, and a PodDisruptionBudget.

The code does not deliver them:

- The `golden-path-workload` chart renders `replicas: 1` while autoscaling is off, which is its default, and sets no rollout strategy. The Kubernetes default of 25 percent allows one unavailable pod once the autoscaler reaches four to seven replicas, exactly when load is high.
- It renders no PodDisruptionBudget. ADR 0047 and the ticked plan 15 step say it does; only the reference app's own chart has one.
- Readiness, liveness and startup probes share one path, so a pod that is alive but not ready cannot be told apart.
- The shared gateway proxy is on every app's data path and has the defaults of its upstream chart.
- Apps live in their own repositories (decision 11), so a default in our chart binds only apps that use it.

## Decision

- **Two replicas, always.** A workload renders at least two replicas whether or not autoscaling is on. The chart renders two, never `replicas: 1`, when autoscaling is off; an autoscaler minimum below two stays refused.
- **An explicit rollout strategy.** `RollingUpdate` with `maxUnavailable: 0` and `maxSurge: 1`, rendered in the chart, not left to the cluster default.
- **A PodDisruptionBudget per workload** with `maxUnavailable: 1`. It works at any replica count, where `minAvailable: 1` would allow four evictions at five replicas. It guards evictions, not rollouts, and maintenance never drains (see the rollback and maintenance ADR).
- **A readiness gate of its own.** Readiness uses an endpoint distinct from liveness (the BFF's readiness and liveness health groups). A workload sets `minReadySeconds` and `progressDeadlineSeconds`, and a `preStop` delay with a termination grace period, so the gateway drops a pod's endpoint before it receives SIGTERM. The exact numbers are implementation defaults, not owner decisions.
- **The gateway proxy gets the same defaults.** The shared gateway proxy runs two replicas with the same strategy, budget and readiness, because a change to it takes every app down. The policy controller and the registry stay single-replica and fail closed; this is recorded as accepted infrastructure risk, since an event there denies new pods but does not stop running ones.
- **Admission enforces it, whoever rendered it.** A Gatekeeper constraint refuses an app-namespace workload below these defaults, or one that names the kore-owned PriorityClass (or any other `priorityClassName`), by audit first and enforce after ([ADR 0072](0072-constraint-promotion-procedure.md)). The chart is the default, admission is the guarantee.
- **The rollout-feasibility check joins the platform workflow's evals.** [ADR 0036](0036-rollout-feasibility-and-container-smoke.md)'s check runs on an app's rendered chart. The vps overlay declares a node count of 1 as a schema field with an exact default for existing overlays (local is one node), replacing "local is treated as one node", so the check, the budget and the capacity ADR read one fact.
- **A database change is a change.** The PostgreSQL composition derives its CloudNativePG instance count from the claim's `serviceClass`: `standard` gets 2, `development` gets 1 with `enablePDB: false`. Every instance uses `primaryUpdateMethod: switchover`, so a supervised switchover keeps a primary up during an image or configuration change, and gets a memory request equal to its limit, which fixes database pods being BestEffort today. On one node this gives no node-loss safety, which the record accepts, and a second instance costs a second volume against the capacity budget. Today's hardcoded `instances: 1` makes a database restart an outage and ignores the service class.
- **Proof.** During the rollout window a probe through the shared gateway sees zero failed requests with no retries, and ready replicas never drop below the minimum. It is a live probe in the style of `golden-path-load`, worded as evidence and recorded as an outcome before any flag that depends on it turns on. The gateway's error ratio is recorded as a shadow metric until it is scraped.

## Consequences

- The chart, the gateway values and the PostgreSQL composition change behind flags, off until a live run on kore-vps and `harness flag activate`.
- ADR 0047 and the plan 15 step stay as they are until the PodDisruptionBudget lands; the plan's tick is corrected as missing work.
- A workload that cannot fit two replicas and a surge pod is refused by the capacity ADR, not silently run at one.
- Two replicas on one node protect against a crashing pod and a rollout, not against the node; a kernel reboot or a disk fault still takes both, by design.
- A rollout that misses its progress deadline is a failed release; the rollback ADR says what the platform does then.
- **Accepted infrastructure risk: the single-replica components.** The policy controller and the registry run one replica each and fail closed. While one is down or being replaced, new admissions or new image pulls are denied; pods already running keep running. The owner accepts this on a single node, so these two components are not given a second replica here. The shared gateway proxy is the one platform component the defaults raise to two replicas.
- **The shared proxy's defaults ship behind `gateway-proxy-defaults`** (issue 1529), off in every overlay. With it on, the proxy runs two replicas with the rolling update above, a readiness gate (`minReadySeconds`, `progressDeadlineSeconds`) and a PodDisruptionBudget of `maxUnavailable: 1`, for either GatewayClass. The Istio class carries the overlay in the gateway's ConfigMap `deployment` key, and agentgateway in its `AgentgatewayParameters` `deployment` overlay. The live run must confirm that the Istio ConfigMap `deployment` key takes effect before the flag turns on. The budget is kore's own and selects the proxy pods by their Gateway-name label.
- **The sign-in BFF is the one accepted single-replica app workload while golden-path-signin is set** (#1747 option D), and admission exempts it from the replica rule alone by the chart's `platform.kore.dev/single-replica: sign-in-bff` label, at exactly one replica ([issue 1526](https://github.com/corekraft/kore/issues/1526)).
- **The rollout-feasibility criterion for the proxy waits on issue 1523.** The check that a rendered workload rolls out on the declared node count is not built yet. This change's render and its declared node count are in place without it.
