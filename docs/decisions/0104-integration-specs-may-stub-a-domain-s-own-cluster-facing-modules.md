---
status: accepted
summary: An integration spec may replace a domain's own modules that talk to the cluster with scripted replies, while still importing only through barrels and never stubbing another domain's internals; this refines ADR 0098.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0104: Integration specs may stub a domain's own cluster-facing modules

Source: [`infra/plans/14-test-tiers.md` § Purpose](../../infra/plans/14-test-tiers.md#purpose)

Refines: [ADR 0098](0098-unit-tests-mock-everything-outside-the-unit-and-integration-tests-gate-only-a-release.md)

## Context

ADR 0098 says an integration test runs real units from built domains together,
with no cluster. Some platform units, such as the readiness gate, need a
scripted cluster reply to be tested at all. The cluster reply comes from a
domain's own module, so the unit cannot run for real without a cluster. The
alternative was to rebuild each of these specs on a scripted-cluster fake
instead. The owner declined that rebuild, so the specs keep a stub of the
domain's own module and stay in the integration tier.

## Decision

- An integration spec may `vi.mock` a domain's own internal modules that talk
  to the cluster, so the unit under test gets a scripted reply.
- Imports stay barrel-only. A spec imports other domains through their
  `index.ts`, as ADR 0098 requires.
- A spec never stubs another domain's internals.
- Each spec that stubs an internal module says so in a header comment, naming
  the module and why it is replaced.

## Consequences

- Six platform integration specs (`platform.bootstrap`, `platform.up`,
  `platform.up-k3d`, `platform.second-run`, `platform.enrollment-order` and
  `platform.feature-gate`) and `platform.readiness` may stub their domain's own
  cluster-facing modules.
- No lint rule or kb check enforces the stub limits. Review and the header
  comment carry them, so a stub of another domain's internals can pass CI.
- A stubbed internal can drift from the real module without any test failing.
  Live tests remain the proof for cluster behaviour.
