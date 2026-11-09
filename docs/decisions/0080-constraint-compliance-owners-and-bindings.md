---
status: accepted
summary: Three audit-mode constraints are made accurate so they can be promoted, not excepted - Grafana's admin Secret and the local signing key each get one recognised owner, kore-rbac judges a ClusterRole by what is bound to it (Gatekeeper sync data), and kore-application-admission attributes label writers only on admission requests.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0080: Constraint compliance by ownership, bindings, and attribution

Refines: [ADR 0009](0009-encrypted-secrets-through-external-secrets.md),
[ADR 0015](0015-local-signed-image-delivery.md),
[ADR 0054](0054-application-admission-gate-closed-at-foundation.md),
[ADR 0061](0061-retained-volumes-are-discovered-by-storage-class.md).

## Context

On a converged `kore-local`, `kore-secrets` (2), `kore-rbac` (5) and
`kore-application-admission` (1) still reported audit violations, so none could
be promoted to enforce. Each was a platform fault or an imprecise policy, not a
case for a reviewed exception.

## Decision

- **Grafana's admin Secret is owned by an ExternalSecret.** The Grafana chart
  reads `admin.existingSecret: grafana-admin`. The `kore-observability-config`
  chart (a Grafana dependency) holds an External Secrets `Password` generator and
  an `ExternalSecret` with `refreshInterval: "0"`, so the password is generated
  once in the cluster and never touches git, values, or disk. The
  `platform-secrets` store is not used here because it arrives in the
  configuration phase, after Grafana is installed and awaited; a store-sourced
  Secret would deadlock a fresh `kore local up`.
  Grafana applies its environment password only when it first creates its
  database, so a profile whose PVC predates the Secret would reject the new
  credentials. `kore local up` therefore runs `grafana cli admin
reset-admin-password --password-from-stdin` in the pod right after Grafana is
  ready, fed from the pod's own `GF_SECURITY_ADMIN_PASSWORD`; the value never
  reaches kore, an argument, or a log, and a failure's output is withheld. Reading
  the old chart-made Secret through External Secrets was rejected: Helm deletes it
  when `existingSecret` is set, the config chart installs before Grafana, and it
  would need External Secrets to read Secrets in `observability`.
- **The local signing key has one recognised owner.** cosign creates
  `kore-system/kore-local-signing-key`; kore labels it
  `app.kubernetes.io/managed-by=kore-signing` on every signer run (so an
  existing profile converges). `kore-secrets` accepts only that exact name, in
  `signingKeyNamespaces`, with the label and exactly cosign's three keys. An
  unlabelled, other-namespace, other-name, or extra-key Secret is still flagged.
- **kore-rbac judges a ClusterRole by its bindings.** A secret-reading
  ClusterRole violates only if a ClusterRoleBinding, or a RoleBinding in
  `kore-system`, gives it to a subject that is not allowed: a bootstrap group or
  a ServiceAccount of a platform namespace in `exemptNamespaces`. The reverse
  holds too: such a binding of an existing role is refused. Roles come from
  Gatekeeper's sync cache (`constraints/sync/config.yaml`: ClusterRole,
  ClusterRoleBinding, RoleBinding). An unbound or aggregation-only role
  grants nothing; the built-in `admin`/`edit` that aggregate into it stay
  governed where they are bound. Without the sync the check sees no bindings,
  so the Config is part of the policy.
- **Activation writers are attributed on admission only.** `kore app up` sets
  `platform.kore.dev/activation-generation` as the `kore-activation` field
  manager, which is the sanctioned bootstrap path. The violation came from audit
  reviews, which carry no `userInfo` or `oldObject`: an activated namespace
  looked like an unattributed change. The writer rule now requires a request
  identity, while the closed-gate and stale-generation rules still apply to audit.

## Consequences

- The constraints stay `dryrun`; promotion is a separate step with live
  evidence (expected: 0 violations each).
- Every run resets the Grafana admin password to the Secret's value; this is
  idempotent and also corrects a password changed by hand in the UI.
- Gatekeeper caches three RBAC kinds, a small memory cost.

## Refinement: admin-equivalent groups (2026-11-09)

The first live audit with binding evaluation left two kore-rbac violations: the
Crossplane chart's `crossplane-admin` ClusterRoleBinding to Group
`crossplane:masters`. That group is Crossplane's cluster-admin convention, like
`system:masters`: it has no members unless a cluster admin issues a client
certificate or impersonation for it. kore-rbac now accepts groups listed in
`adminEquivalentGroups` (only `crossplane:masters`) for cluster-wide bindings,
through a helper separate from the platform-controller allowance. The
signing-namespace RoleBinding rule stays bootstrap-only. Gator cases prove a
lookalike group (`crossplane:viewers`) is still rejected.
