---
status: accepted
summary: Local bootstrap issues the TLS certificate in its own kore-local-tls release, after an explicit kore trust install, before the Gateway release waits for readiness.
date: 2026-09-30
last-verified: 2026-11-08
---

# ADR 0013: Issue the local TLS certificate before installing the Gateway

Source: [`infra/plans/2-implementation.md` § Gateway Bootstrap Repair](../../infra/plans/2-implementation.md#gateway-bootstrap-repair)

Refines: [ADR 0006](0006-istio-ambient-gateway-api.md) and
[ADR 0011](0011-catalog-owned-releases-and-versions.md)

## Context

The clean-cluster run on 2026-09-13 stalled in `kore-platform-config`: the
Gateway's HTTPS listener reported `InvalidCertificateRef` because
`kore-system/kore-local-tls` did not exist yet, and the Helm wait for the
Gateway blocked the steps that would have produced it.

## Decision

- Host trust and the local issuer are set up by an explicit, trust-changing
  `kore trust install --environment local` operation. The ClusterIssuer must
  be Ready before certificate issuance is awaited; a missing setup reports the
  command to run.
- The certificate has its own catalog release, `kore-local-tls`, which waits
  for `Certificate Ready` and a TLS Secret containing `tls.crt` and
  `tls.key` without printing them.
- `kore-platform-config` depends on `kore-local-tls`, so the Gateway is
  created only after its certificate exists.
- Generally, configuration releases are split wherever a Helm wait would block
  the commands needed to satisfy its own prerequisites.

## Consequences

Existing installs had to migrate the Certificate out of the old release. Tunnel
supervision and address readiness remain separate open work in Step 8.
