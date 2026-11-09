---
status: accepted
summary: One constraint is promoted from dryrun to deny, or rolled back, by `kore policy record|promote|rollback`, which edit only the repository from recorded audit evidence; the live round trip is an opt-in spec and no committed constraint is promoted yet.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0072: A repeatable constraint promotion and rollback procedure

Source: [`infra/plans/2-implementation.md` § Step 9 and Step 15](../../infra/plans/2-implementation.md#step-9-workload-identity-application-image-trust-and-policy)
Refines: [ADR 0059](0059-identity-policy-evidence.md),
[ADR 0017](0017-gatekeeper-policy-families-audit-first.md)

## Context

ADR 0059 made `kore validate` reject a constraint that enforces without recent,
zero-violation evidence, but promotion itself was hand-editing a YAML file and a
JSON record, and rollback was prose with no test. Desired state lives in git, so
the procedure must change files, never the cluster.

## Decision

- `kore policy record <constraint> --environment <name> --audit <file|->` reads
  `kubectl get <kind>.constraints.gatekeeper.sh <name> --output json` and keeps
  only the audit timestamp and violation count in
  `promotions/<constraint>.json`. Violation messages never reach the repository.
  Other environments' evidence is preserved.
- `kore policy promote <constraint> --environment <name>` changes exactly one
  constraint from `dryrun` to the record's target (`deny`) and refuses, changing
  nothing, with no record, no evidence for the environment, any violation, or
  evidence older than 14 days. It reuses the checks `kore validate` applies, so
  the two cannot disagree.
- `kore policy rollback <constraint> --environment <name>` sets one constraint
  back to `dryrun` and keeps its evidence; promoting again still needs evidence
  that is recent.
- The commands run no `kubectl`, helm, or cluster call and are not journaled
  mutations of an environment; the change is a pull request, and
  `kore platform up` applies it.
- The live round trip (`npm run test:integration:policy`) promotes
  `kore-workload-identity`, proves a default-ServiceAccount Deployment is
  rejected, rolls back, and proves it is admitted. It probes a Deployment because
  the constraint matches workload kinds, not Pods. It restores the files in a
  `finally`.

## Consequences

No committed constraint is promoted by this change (audit before enforce). The
orchestrator decides after the live run passes. The round trip has not run live.
