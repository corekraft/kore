---
status: accepted
summary: Retained-data discovery also lists PersistentVolumes of the kore-retained class, because deleting a retained claim leaves an unlabeled Released volume that claim and PVC queries cannot see.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0061: Discover retained volumes by storage class

Source: [`infra/plans/2-implementation.md` § Step 10](../../infra/plans/2-implementation.md#step-10-storage-and-postgresql-platform-api)

Refines: [ADR 0020](0020-postgresql-api-scoped-rbac-status-and-retention.md), [ADR 0003](0003-separate-claims-and-retain-data.md)

## Context

ADR 0020 found retained data through labeled `PostgreSQLInstance` claims and
labeled PVCs. A `Retain` volume outlives its claim: once the claim and PVCs are
deleted, the PersistentVolume stays as `Released`, carries no retention label,
and has no claim to find it by. Discovery then reported nothing, so
`cluster destroy` and `app down` would treat surviving data as absent.

## Decision

- `retainedResources` also lists PersistentVolumes whose `storageClassName` is
  `kore-retained`, as `persistentvolume/<name>`. Scoped to a namespace, it keeps
  volumes whose last claim (`spec.claimRef.namespace`) was in that namespace.
- A PersistentVolume list that cannot be read or parsed refuses, as the other
  queries do; it never counts as no data.
- Purge is unchanged: it deletes labeled claims, and profile deletion removes
  the volumes. Deleting a Released volume by hand stays an explicit act.
- Least-privilege Crossplane RBAC stays as ADR 0020 left it. Binding per
  namespace needs the namespace to exist when the role is bound, which belongs
  to namespace enrollment, so the default stays cluster-wide until that design
  lands.

## Consequences

Destroy is blocked, and `app down` reports data, after a retained claim has been
deleted. Discovery trusts the class name, so a retained volume provisioned
under another class is not found. Proven live by
`npm run test:integration:storage`; unproven until that run.
