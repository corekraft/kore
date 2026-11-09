---
status: accepted
summary: The application admission gate is one Gatekeeper constraint per environment, created closed for the current platform generation at the end of the internal foundation; only bootstrap automation may write it, activate namespaces, or read the local signing key, and kore app up refuses until the gate is open.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0054: The application admission gate, closed at the end of the foundation

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md) (admission gate and Cosign authority items, exit criterion) and [§ Platform Bootstrap Completion Gate](../../infra/plans/2-implementation.md#platform-bootstrap-completion-gate)

Refines: [ADR 0004](0004-fail-closed-application-admission-gate.md) (what the gate is), [ADR 0027](0027-bootstrap-installs-controllers-and-image-trust-only.md) (bootstrap ends before shared configuration), [ADR 0032](0032-application-namespace-image-admission.md) (a second namespace label), [ADR 0015](0015-local-signed-image-delivery.md) (who may read the local key).

## Context

ADR 0004 says the gate is generation-specific readiness state that only
bootstrap opens, but nothing yet created it, named a generation, or stopped
`kore app up` from deploying without it. Step 7 requires the gate to exist
closed when the foundation finishes. Steps 11 to 13 open it.

## Decision

- **The gate is a constraint.** One `KoreApplicationAdmission` constraint,
  `kore-application-admission`, whose `spec.parameters` hold `generation` and
  `state` (`closed` or `open`; anything else counts as closed), the platform
  namespaces it never gates, and the bootstrap groups. Gatekeeper evaluates it
  against the object in the request, so no namespace cache or extra read is
  needed. Alternatives rejected: a ConfigMap (Gatekeeper would need to sync every
  ConfigMap, and nothing but a naming convention would tie it to a policy) and a
  namespace label alone (a label cannot say the platform is ready).
- **A generation** is `g-` plus twelve hex digits of a SHA-256 over the
  environment name and the catalog's components. Any change to what the
  catalog installs moves the generation, so a gate or activation made earlier
  is stale until bootstrap revalidates. `kore` computes it; nothing is stored.
- **Born closed.** `kore platform up` applies the gate, closed and for the
  current generation, as its last step, server-side under the field manager
  `kore-bootstrap-gate`, which is its only writer. It never opens it, so a run
  that stops early or a rerun after a change leaves it closed. The gate is not in
  the constraints directory: its state is runtime state with one owner, not
  repository desired state.
- **What it refuses.** While closed (or for another generation): Pods,
  Deployments, StatefulSets, DaemonSets, Jobs, CronJobs and `PostgreSQLInstance`
  claims outside the platform namespaces, and any namespace activation. A
  non-bootstrap identity can never set, change, or remove the activation label
  `platform.kore.dev/activation-generation`; a label naming a generation other
  than the gate's is stale. RBAC cannot restrict a label, so this part is
  admission policy.
- **Who may write.** The `kore-admission-gate` chart binds only the group
  `kore:bootstrap` to a ClusterRole that creates the gate, updates or deletes it
  by name, and writes namespaces. Locally the kubeconfig identity is the
  Minikube admin certificate, so the constraint also admits `system:masters`;
  local therefore proves the mechanism, not the separation of identities.
- **The local signing key.** The same chart binds `kore:bootstrap` alone to
  the Role `kore-signing-key`, which reads the Secret by name. The `KoreRBAC`
  policy now audits any ClusterRole, or any Role in `kore-system`, that can read
  Secrets without `resourceNames` or by naming the key, and any `admin`/`edit`
  binding to a non-bootstrap subject in `kore-system` or cluster-wide. Allowed
  roles are the signing role and an explicit list of controller ClusterRoles
  (External Secrets today), so an exception is visible and reviewed.
- **`kore app up` refuses.** After the platform readiness check and before
  anything is verified, staged, or applied, it reads the gate and fails when it
  is absent, closed, or for another generation, naming the remedy. When the
  gate is open it activates the namespace with the label, read back like the
  other enrollment labels. The check supplements the cluster policy.
- **Audit before enforce.** The constraint ships `dryrun`, like its siblings.
  On the current tree it would report every application workload and claim and
  every namespace activation, and `kore app up` already refuses them. Promote it
  to `deny` only after the audit lists nothing but the intended refusals and the
  gate-open step (plan Step 13) has been run live and shown to admit an
  application, so that promotion cannot block the platform's own recovery.

## Consequences

- Until plan Step 13 opens the gate, `kore app up` and therefore the
  application step of `kore local up` stop with the closed-gate error.
- Gatekeeper's webhook fails open by default (`failurePolicy: Ignore`), so the
  cluster policy has teeth only after the audit period, once that policy is
  `Fail` with the platform namespaces exempt. Until then the `kore` check is the
  effective gate.
- A controller ClusterRole that can list Secrets cluster-wide can read the local
  key; the allowlist records which, and narrowing them needs upstream chart
  configuration.
- The completion gate's remaining items (a readiness manifest, closing the gate
  when a prerequisite degrades, auditable open evidence) stay open.
