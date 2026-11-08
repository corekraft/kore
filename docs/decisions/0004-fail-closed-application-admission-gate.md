---
status: accepted
summary: Bootstrap installs infrastructure in phases and opens a platform-owned, generation-specific application admission gate only after every prerequisite is ready and enforcing.
date: 2026-09-12
last-verified: 2026-11-07
---

# ADR 0004: Gate application admission on complete, fail-closed bootstrap

Source: [`infra/plans/1-initialize.md` § Initialization Lifecycle](../../infra/plans/1-initialize.md#initialization-lifecycle)
and [§ Infrastructure Installation Phases](../../infra/plans/1-initialize.md#infrastructure-installation-phases)

## Context

Applications depend on identity, image trust, secrets, storage, networking, and
telemetry. If a claim or workload is applied while any of them is missing or
not yet enforcing, it can run outside the platform's guarantees, and a
partial bootstrap can look successful.

## Decision

- Platform initialization is one bootstrap lifecycle that never installs
  applications. Internal phases never publish platform readiness on their own.
- Infrastructure installs in dependency-aware phases: bootstrap seed (with
  Gatekeeper in audit mode), trust closure and core capabilities,
  observability, then policy enforcement.
- The application admission gate is platform-owned, generation-specific
  readiness state. Only bootstrap automation opens it, after every release and
  capability check passes. Application namespaces are created or activated only
  after that.
- Cluster-side RBAC and admission reject application claims and workloads while
  the gate is absent, stale, or closed. The `kore app` check supplements this
  and does not replace it. Developers cannot change the gate, namespace
  activation, admission policy, or deployment identity.
- New policy starts in audit mode so bootstrap cannot block its own
  dependencies.

## Consequences

`kore platform up` cannot report success until the gate is open. An unhealthy
prerequisite closes the gate for new application mutations. Bootstrap needs a
versioned readiness manifest covering every required component; see the
[Platform Bootstrap Completion Gate](../../infra/plans/2-implementation.md#platform-bootstrap-completion-gate).
