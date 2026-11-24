# Workload Defaults at Admission

The Gatekeeper constraint `kore-workload-defaults` audits application workloads
against the runtime defaults of [ADR 0154](../decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md),
so the guarantee holds whatever rendered the workload. Decided on issue
[#1526](https://github.com/corekraft/kore/issues/1526) (comment 7126300541).

It is behind the feature flag `workload-defaults-admission`, which is `false` in
every overlay. With the flag off nothing is installed. It ships in **dryrun**:
it reports violations and refuses nothing. Promotion to enforce follows
[ADR 0072](../decisions/0072-constraint-promotion-procedure.md) and
[policy-changes.md](policy-changes.md).

## Where it applies

App namespaces only: the constraint matches namespaces that carry the activation
label `platform.kore.dev/activation-generation` (ADR 0054), with the platform's
system namespaces listed as a second line of defence. Platform charts are not
application workloads, so an observability or kube-system workload is never
checked.

## What it checks

| Rule           | Refuses                                                                                                            | Default it protects             | Kinds                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------ |
| Replicas       | `spec.replicas` present and below 2, except the sign-in BFF (below)                                                | two replicas (ADR 0154)         | Deployment, StatefulSet                          |
| Rolling update | `strategy.rollingUpdate.maxUnavailable` that is not `0` or `"0%"`; an absent field means 25 percent and is refused | `maxUnavailable: 0` (ADR 0154)  | Deployment                                       |
| Memory         | a container whose memory request is absent or differs from its memory limit                                        | request equals limit (ADR 0152) | Deployment, StatefulSet, DaemonSet, Job, CronJob |
| Priority       | any `priorityClassName`, the kore-owned class included                                                             | the default class (ADR 0152)    | Deployment, StatefulSet, DaemonSet, Job, CronJob |

Each message names the default that is broken and the fix. The tests live beside
the policy in `infra/policies/gatekeeper/tests/workloaddefaults.yaml`.

## The sign-in BFF exemption

While `golden-path-signin` is on, the chart writes the label
`platform.kore.dev/single-replica: sign-in-bff` on the BFF Deployment, and only
then. The BFF is the one single-replica app workload while sign-in is on
(ADR 0154, [#1747](https://github.com/corekraft/kore/issues/1747) option D).

The replica rule skips a workload only when all three hold: the label has
exactly that value, the name ends in `-bff`, and `spec.replicas` is exactly 1.
The exemption covers the replica rule alone. The rollout, memory and priority
rules still apply to the BFF.

A hand-written manifest can copy the label, because admission cannot see who
rendered it. The exemption is narrow and visible in the manifest, and the
follow-up below may count the labelled workloads.

## Not covered yet

- **PodDisruptionBudget: not checked.** ADR 0154 requires one per workload, and
  this constraint does not yet refuse its absence. It needs an inventory the
  constraint cannot read: a shared Gatekeeper `Config` that also carries
  HorizontalPodAutoscaler minimums. Follow-up
  [#2004](https://github.com/corekraft/kore/issues/2004), under
  [#1511](https://github.com/corekraft/kore/issues/1511).
- **An absent replica count passes (known gap).** An autoscaled chart omits
  `spec.replicas`, and the HorizontalPodAutoscaler owns the count, so the rule
  allows an absent field. A hand-written manifest with no replica count and no
  autoscaler also passes, although Kubernetes then runs one replica. The test
  `admits-absent-replicas-known-gap` pins this.
  #2004 closes it by reading the autoscaler's `minReplicas`.
- **Init containers are not checked.** The memory rule covers `containers`, as
  the container-security rule does. The golden-path BFF's truststore init
  container sets no resources, so it would not be caught.
- **Memory is compared as text.** `1Gi` and `1024Mi` are equal quantities but
  differ as text, so the rule refuses the pair. The refusal is conservative; a
  manifest can write the same text on both sides.

## Promotion

Do not promote until these hold:

1. #2004 has landed. Its audit would otherwise lack the PDB rule and the
   absent-replica gap, so the evidence would be incomplete.
2. The golden-path chart renders memory requests equal to limits. Today it sets
   none, so the memory rule refuses every golden-path workload on the current
   tree. That is a finding, not a regression: the constraint is in audit mode.
3. A recorded audit shows zero violations for the environment, as ADR 0072
   requires, and the flag's live outcome is recorded before `workload-defaults-admission`
   turns on (AGENTS.md, _It just works_).

This change ran no live audit: the cluster was not reachable from the writer's
environment. Its evidence is the gator suite (`mise run test-gatekeeper`) and the
overlay validation (`mise run validate`).
