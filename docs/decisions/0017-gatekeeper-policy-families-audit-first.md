---
status: accepted
summary: Gatekeeper ships six constraint template families as two catalog manifests in dryrun mode, tested offline with a pinned gator.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0017: Gatekeeper policy families ship in audit mode, tested with gator

Source: [`infra/plans/2-implementation.md` § Step 9](../../infra/plans/2-implementation.md)

Refines: [ADR 0003](0003-separate-claims-and-retain-data.md) (retention
labels and StorageClasses) and [ADR 0007](0007-workload-identity-and-layered-authorization.md).

## Context

Only workload identity and container security templates existed. They were
installed by nothing, their suite (`tests/cases.yaml`) ran in no task, and
neither template parsed under Gatekeeper's Rego (`in` without its import, a
duplicated `podspec` rule, and an unset `automountServiceAccountToken` that was
never flagged).

## Decision

- Add `KoreMeshEnrollment` (Namespaces need `istio.io/dataplane-mode: ambient`),
  `KoreRetention` (PVCs and StatefulSet claim templates declare
  `platform.kore.dev/retention: Retain|Delete`; `Retain` and `kore-retained`
  must pair), `KoreRBAC` (no wildcard verbs or resources in Roles; no
  ServiceAccount bound to `cluster-admin`), and `KoreSecrets` (no literal
  values for credential-named env vars; Opaque Secrets must be owned by an
  `ExternalSecret`).
- Every constraint is `dryrun` with the same minimal system-namespace
  exemptions. Promotion to `deny` needs a clean audit on a live platform: zero
  violations outside the exempt namespaces, or each one recorded as a reviewed
  exception.
- Templates live in `infra/policies/gatekeeper/templates`, constraints in
  `constraints/`, and each is a catalog `manifest` component
  (`kore-policy-templates`, then `kore-policy-constraints`) because a
  constraint cannot be applied before Gatekeeper has generated its CRD.
- Suites run offline with `gator verify` (`mise run test-gatekeeper`, pinned
  in `.mise.toml`, run in CI).

## Consequences

When this was written the audit flagged the `oci-registry` PVC (on
`kore-retained` without the retention label) and application namespaces not yet
enrolled in ambient mesh. Both were fixed on 2026-11-08: the registry claim moved
to `kore-standard` with `retention=Delete`, because its contents are rebuildable
cache, and `kore app up` labels application namespaces (ADR 0025).
Only the ExternalSecret ownership of Secrets is a heuristic, since admission
cannot see the ExternalSecret that will fill a `secretKeyRef`.
