---
status: accepted
summary: Because Istio 1.30 ambient ExtAuthz requests omit workload principals, native Istio policy enforces caller identity before OPA, which decides only on request context.
date: 2026-09-30
last-verified: 2026-11-08
---

# ADR 0014: Enforce workload identity natively before OPA

Source: [`infra/plans/2-implementation.md` § Step 9](../../infra/plans/2-implementation.md#step-9-workload-identity-application-image-trust-and-policy)
and [§ Progress Record](../../infra/plans/2-implementation.md#progress-record)

Refines: [ADR 0007](0007-workload-identity-and-layered-authorization.md)

## Context

ADR 0007 expected OPA to receive authenticated source and destination
principals. Captured Istio 1.30 ambient waypoint ExtAuthz requests omit them,
so OPA cannot make identity decisions on its own.

## Decision

- A Service-targeted waypoint carries Layer 7 policy. Istio L4 policy requires
  the waypoint identity, and a native Istio `ALLOW` policy checks the calling
  workload's principal before the `CUSTOM` OPA check runs.
- OPA decides only on request context, such as the
  `x-kore-authenticated-role` header set by the authenticated path. A
  caller-supplied `x-kore-role` header grants nothing.
- Direct Pod-IP access that bypasses the waypoint is rejected.

## Consequences

Identity stays enforced cryptographically by Istio. The Step 9 item to verify
that OPA receives principals stays open; when a supported Istio version passes
principals, OPA can add identity context and this ADR is superseded.
