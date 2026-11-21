---
status: proposed
summary: Single-node capacity is one declared budget, the overlay's cpus, memory and disk minus a measured platform reserve, which per-suborg ResourceQuotas rendered from app records enforce at worst-case surge, with kubelet reserves and memory priority that favour the cluster over the agents VM.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: One-node capacity is a declared budget that quotas enforce, and memory favours the cluster

Source: [`infra/plans/15-next-horizon.md` § Step 3](../../infra/plans/15-next-horizon.md#step-3-autoscaling-defaults)

Refines [ADR 0141](0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md), whose priorities give k3s CPU and IO weight but no memory protection, and [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md), whose overlay declares what kore may plan for.

Status is `proposed`: settled in shape in the grilling of issue #1480 against the owner interview record of #1478 (decisions 3, 8, 11, 13 and the capacity gap). Each number below the owner has not decided is an open placeholder, never filled in.

## Context

kore-vps is one node of eight threads and about 64 GiB, shared with a 6-CPU, 40 GiB agents VM. The record asks for admission that refuses an app that cannot fit, surge headroom, and quotas per suborg (decision 13). Today:

- The overlay declares `cpus` 4 and `memoryMB` 20480 as the planning share, and the workload chart renders a CPU request only while autoscaling is on and no memory request or limit at all.
- No ResourceQuota or LimitRange exists in any chart, and k3s's config sets no kubelet reserved or eviction value.
- Plan 15 notes that many platform components declare no requests, so the platform's own reserve is unmeasured.
- The 300 GiB k3s volume holds images, the in-cluster registry, local volumes and logs, with no disk eviction value set. Images live only there.
- Memory is the real contention with the VM; ADR 0141 weights only CPU and IO, and it is unverified that pods sit under `k3s.service`'s cgroup, where the weights would apply.

## Decision

- **One budget.** The budget is the overlay's `cpus`, `memoryMB` and a disk figure (the k3s volume minus a measured registry and observability reserve), minus a platform reserve declared as a number in the overlay and set from a measurement on vps, not a guess. Requests committed to apps may not exceed a fraction of the remainder, so a rollout has surge headroom. **The fraction is an open owner decision; the recommendation is 80 percent.**
- **Every container declares its size.** CPU and memory requests and a memory limit equal to the memory request, so the OOM victim is predictable. A per-suborg LimitRange supplies a CPU request default only; a missing memory request is refused, never defaulted.
- **Quotas per suborg, from the app records.** A Kubernetes ResourceQuota per suborg namespace, rendered from the schema-checked app records (decision 11), counts requests at worst case: `requests x (HPA maxReplicas + maxSurge 1)` per workload, plus pods, persistent volume claim storage and ephemeral storage. A surge cannot exceed it.
- **Refusal in two layers; no scheduler is reimplemented.** A deterministic eval at the record bump refuses a record whose worst case exceeds the remaining budget summed over all suborg quotas, before anything reaches `main`. The native ResourceQuota is the admission backstop.
- **Priority.** A platform-critical PriorityClass covers the gateway proxy, platform DNS, the policy controller and the registry. Apps take the default class and may not set `priorityClassName`, so preemption never evicts a platform component for an app.
- **The kubelet protects the node first.** Ansible writes system-reserved, kube-reserved, a `memory.available` eviction threshold and `nodefs` and `imagefs` thresholds with image garbage collection into the k3s config, from the same measurement, so pressure evicts pods before the kernel's OOM killer or a full disk stops the node.
- **Memory favours the cluster.** k3s gets memory protection (`MemoryLow`) and the agents VM is the designated OOM victim (its process biased by `oom_score_adj`), since prod apps outrank agent panes. Which cgroup the pods sit under is a fact the live drill reads from the host; if they sit outside `k3s.service`, the CPU and IO weights move to where they do apply. **Lowering the VM's 40 GiB cap is an open owner decision; recommended only if the measurement shows 40 GiB plus the cluster budget plus the host does not fit 64 GiB.**

## Consequences

- The overlay gains the reserve and disk figures, and the environment schema gains a node count (see the runtime defaults ADR).
- An app record that does not fit is refused at the platform workflow, with the missing amount named, instead of failing at schedule time.
- The measurement on vps is a live run owed before any number is filled in; until then the placeholders stand and no quota is enforced.
- Raising a quota is a change to the app record and to the budget check together; a quota never grows by itself.
- The agents VM can be killed by the host under memory pressure. That is accepted: agent work resumes, an app outage does not.
