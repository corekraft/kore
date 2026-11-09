---
status: accepted
summary: What opens the application admission gate is a versioned readiness manifest evaluated in one run and recorded as evidence before the gate opens; `platform gate-check` can only close it; a closed gate spares the cluster's own controllers; promotion to deny stays a separate, live-proven change.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0067: Platform readiness manifest, evidence, and the closing gate

Source: [`infra/plans/2-implementation.md` § Platform Bootstrap Completion Gate](../../infra/plans/2-implementation.md#platform-bootstrap-completion-gate)

Refines: [ADR 0054](0054-application-admission-gate-closed-at-foundation.md) (the gate), [ADR 0056](0056-platform-image-inventory.md) (inventory as a prerequisite).

## Context

ADR 0054 opens the gate when every catalog component is ready, but "every
prerequisite" was implicit in the catalog, nothing recorded why the gate was
open, nothing closed it when a capability later degraded, and a closed gate
refused every new Pod, including the replacements the cluster's controllers
make for running workloads.

## Decision

- **One versioned manifest.** `infra/catalog/readiness.yaml` (version 1) lists
  requirements, each with a plan step (7 to 11), a capability, and the catalog
  components and platform checks (`registry-trust`, `image-inventory`) that
  must be ready. Validation requires every catalog component to be required by
  exactly one requirement, so a new component cannot be left out of what opens
  the gate.
- **Evidence before opening.** `platform up` evaluates the manifest against the
  status rows read in that run (a prerequisite with no row is missing), writes
  the result to the ConfigMap `kore-system/kore-platform-readiness`, opens the
  gate, then reads it back and reports success only if it is open for the
  current generation. If evidence cannot be written the gate is not opened. On
  failure the gate is closed first and closed evidence naming the failed
  prerequisites is recorded best effort.
- **Closing, never opening.** `kore platform gate-check` re-evaluates the
  manifest and closes the gate when a prerequisite is unhealthy. It writes only
  the gate and the evidence, so running workloads are untouched, and it exits
  non-zero naming the failures. Opening remains `platform up`'s alone.
  `platform status` exits non-zero while any prerequisite or the gate is not
  ready (CRD ownership stays audit-only).
- **Who writes evidence.** The `kore-admission-gate` chart adds a Role for that
  one ConfigMap bound to the bootstrap group only; no delete is granted.
- **A closed gate spares controllers.** The template exempts Kubernetes' own
  workload controllers by identity (`controllerIdentities`), never by owner
  reference, which anyone can forge. It also gates `ReplicaSet` and
  `ReplicationController`, which would otherwise be a way to create Pods.
  `PostgreSQLInstance` claims and namespace activation are never exempt.
- **Promotion stays separate.** The platform gate remains `dryrun`. The opt-in
  spec `npm run test:integration:gate` proves the same template denies
  workloads for a developer identity while closed, admits them when bootstrap
  opens it, and rejects a developer opening it, using a throwaway `deny`
  constraint on a throwaway namespace. Promote the platform gate only after
  that spec passes live and a full `kore local up` has run with the controller
  exemption in place.

## Consequences

- Managed clusters whose controllers use other identities must set
  `controllerIdentities`; today the list is the kubeadm default.
- Application resources that carry no PodSpec (Services, ConfigMaps) are not
  refused in an inactive namespace; namespace activation is.
- Evidence is overwritten per evaluation; an append-only audit trail is future
  work.
