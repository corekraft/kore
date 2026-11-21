---
status: proposed
summary: Single-node capacity is one budget, allocatable from the overlay's compute and the measured kubelet reserves minus the platform's pod requests, of which per-suborg ResourceQuotas rendered from app records may commit 80 percent at worst-case surge, with every pod sized and the agents VM the OOM victim.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: One-node capacity is a declared budget that quotas enforce, and memory favours the cluster

Source: [`infra/plans/15-next-horizon.md` § Step 3](../../infra/plans/15-next-horizon.md#step-3-autoscaling-defaults)

Refines [ADR 0141](0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md), whose priorities give k3s CPU and IO weight but no memory protection, and [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md), whose overlay declares what kore may plan for.

Status is `proposed`. It was settled in shape in the grilling of issue #1480 against the owner interview record of #1478 (decisions 3, 8, 11, 13 and the capacity gap); the owner then decided the parked numbers on #1480 (2026-11-20), and they are recorded below. The ADR stays `proposed` until the owner accepts it.

## Context

kore-vps is one node of eight threads and about 64 GiB, shared with a 6-CPU, 40 GiB agents VM. The record asks for admission that refuses an app that cannot fit, surge headroom, and quotas per suborg (decision 13). Today:

- The overlay declares `cpus` 4 and `memoryMB` 20480 as the planning share, and the workload chart renders a CPU request only while autoscaling is on and no memory request or limit at all.
- No ResourceQuota or LimitRange exists in any chart, and k3s's config sets no kubelet reserved or eviction value.
- Plan 15 notes that many platform components declare no requests, so the platform's own footprint is unmeasured. The PostgreSQL pods are BestEffort.
- The 300 GiB k3s volume holds images, the in-cluster registry, local volumes and logs, with no disk eviction value set. Images live only there.
- Memory is the real contention with the VM; ADR 0141 weights only CPU and IO, and it is unverified that pods sit under `k3s.service`'s cgroup, where the weights would apply.

## Decision

- **One budget.** Allocatable is the overlay's compute and memory less the kubelet's measured kube-reserved and system-reserved values and its eviction floor, with a disk figure for the k3s volume. The budget is allocatable minus the platform's pod requests, read from the rendered platform releases and not declared as a number. The sum of the suborg quotas may not exceed 80 percent of the budget, so a rollout has surge headroom. The fraction is the overlay's, default 0.8.
- **Every pod is sized.** App containers declare a CPU request, a memory request and a memory limit equal to the memory request, with no CPU limit. A per-suborg LimitRange supplies a CPU request default only; a missing memory request is refused, never defaulted. Every platform pod gets a memory request equal to its limit from the vps measurement, and a platform pod with no request makes the budget unjudgeable, so the verdict refuses to enforce rather than guess.
- **Quotas per suborg, from the app records.** A Kubernetes ResourceQuota per suborg namespace, rendered from the schema-checked app records (decision 11), counts requests at worst case: `requests x (HPA maxReplicas + maxSurge 1)` per workload, plus pods, persistent volume claim storage and ephemeral storage. A surge cannot exceed it.
- **Refusal in two layers; no scheduler is reimplemented.** A deterministic eval at the record bump refuses a record whose worst case exceeds the remaining budget summed over all suborg quotas, before anything reaches `main`. The native ResourceQuota is the admission backstop.
- **Guaranteed QoS and one kore-owned priority for the data path.** The gateway proxy, platform DNS, the policy controller and the registry run with requests equal to limits (CPU and memory), so their pods are Guaranteed, now and behind a flag. One kore-owned PriorityClass with a value below the built-in system classes, behind a flag, is set on the same four. Apps keep the default class and are refused the kore class by the admission constraint, audit first. QoS is what the OOM killer reads; priority orders scheduling and preemption.
- **The kubelet protects the node first.** Ansible writes system-reserved, kube-reserved, a `memory.available` eviction floor above the kubelet default, `nodefs` and `imagefs` thresholds and image garbage collection into the k3s config, from the same measurement, so pressure evicts pods before the kernel's OOM killer or a full disk stops the node.
- **Memory favours the cluster.** The agents VM keeps its 40 GiB cap until the measurement shows it does not fit 64 GiB. The cluster is protected by sizing (memory request equal to limit on every pod) and by the Incus `limits.memory.oom_priority` on the VM, so the kernel prefers the VM as the victim; prod apps outrank agent panes. Which cgroup the pods sit under is a fact the live drill reads from the host; if they sit outside `k3s.service`, the CPU and IO weights move to where they do apply.

## Consequences

- The overlay gains the kubelet reserves, the eviction floor, the disk figure and the fraction, and the environment schema gains a node count (see the runtime defaults ADR).
- An app record that does not fit is refused at the platform workflow, with the missing amount named, instead of failing at schedule time.
- The measurement on vps is a live run owed before the reserves are filled in; until then the budget is not judged and no quota is enforced.
- Raising a quota is a change to the app record and to the budget check together; a quota never grows by itself.
- The agents VM can be killed by the host under memory pressure. That is accepted: agent work resumes, an app outage does not.
- **Open conflict for the owner.** A memory limit equal to the request with a CPU request only leaves an app pod Burstable, not Guaranteed: Kubernetes needs CPU limits equal to requests as well, and a Burstable pod with a small request has an OOM score near 1000 rather than -997. Only the four data-path components get true Guaranteed QoS; for apps the VM's OOM priority is the protection that applies. Whether app pods should also carry CPU limits, accepting throttling, is raised on #1480.
