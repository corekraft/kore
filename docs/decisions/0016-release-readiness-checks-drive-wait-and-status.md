---
status: accepted
summary: Catalog readiness entries are mandatory, and the same read-only checks drive both bootstrap waits and platform status, with failures naming the component, resource, condition, and reason.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0016: One set of readiness checks for waits and status

Source: [`infra/plans/2-implementation.md` § Progress Record](../../infra/plans/2-implementation.md#progress-record)
(Steps 7, 8 and 11)

## Context

Readiness lists could be empty, so some releases were "ready" once Helm said
deployed. Status never evaluated readiness at all, so a crash-looping Collector
showed ready. Gateway waits covered only `Programmed`, and a missing local
trust anchor surfaced only as a ClusterIssuer timeout.

## Decision

- Every catalog component declares at least one readiness check; both the
  schema (`minItems: 1`) and validation reject an empty list. Releases that
  only create cluster resources use existence checks (`storageclass/`,
  `clusterrole/`, `clusterrolebinding/`) or owned-CRD `crd/` checks.
- `kore status` evaluates each installed release's readiness checks read-only
  (get, wait, rollout status; never apply) with a 3s bound per check and
  reports `degraded` with the first failing check. Status writes no journal
  entry.
- Gateways are ready only when Accepted, the Gateway Service has a
  LoadBalancer address, Programmed, and every listener has ResolvedRefs. Each
  step is bounded and its failure includes the condition reason
  (`AddressNotAssigned`, `InvalidCertificateRef`).
- Before waiting on a Certificate, `kore` checks its ClusterIssuer and the
  issuer's CA Secret. If either is missing it fails immediately with
  `kore trust install --environment <name>` (or a managed-environment
  instruction), instead of timing out.
- Every readiness failure reads `<resource> not ready (<condition>) within
<timeout>: <reason>`, wrapped with the component name.

## Consequences

- `kore status` and `app up` now probe the cluster per component, so they are
  slower than a Helm-status-only check and need the same fakes in tests.
- Status uses a fixed bound; making it configurable is deferred.
