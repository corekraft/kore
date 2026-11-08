---
status: accepted
summary: kore app up is the single owner of application namespaces and labels them istio.io/dataplane-mode ambient; Gatekeeper audits that contract.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0025: Application namespaces are created and enrolled by `kore app up`

Source: [`infra/plans/2-implementation.md` § Step 9](../../infra/plans/2-implementation.md)

Refines: [ADR 0017](0017-gatekeeper-policy-families-audit-first.md) (the
`KoreMeshEnrollment` rule) and [ADR 0007](0007-workload-identity-and-layered-authorization.md).

## Context

Workloads set `istio.io/dataplane-mode: ambient` on their Pod templates, but
application namespaces carried no label, so the live audit reported mesh
enrollment violations. The namespace was created implicitly by
`helm upgrade --install --create-namespace`, which cannot set labels or
annotations. Platform namespaces come from the `platform-config` chart or the
controller installs.

## Decision

- **One owner.** `kore app up` creates each application namespace with a
  server-side apply (field manager `kore-app`) before either Helm release
  installs, and no release passes `--create-namespace`. The application's
  charts stay provider-neutral and never declare their own Namespace.
- **The contract.** Every application namespace carries
  `istio.io/dataplane-mode: ambient`. The apply is idempotent, so a rerun
  repairs a namespace that lost the label.
- **Audit.** `KoreMeshEnrollment` stays in `dryrun` and flags any Namespace
  without that label. Its exemptions are the minimal system namespaces plus the
  platform-owned namespaces (`kore-system`, `kore-registry`, `observability`,
  `opa-system`), which stay exempt until each is enrolled deliberately with live
  evidence. Promotion to `deny` follows ADR 0017.
- **Teardown.** `kore app down` still leaves the namespace, as before.

## Consequences

- Namespace creation is a separate, visible mutation in `kore app up`.
- Namespaces created earlier by Helm gain the label on the next `app up`.
- Enrolling platform namespaces, and the Sigstore Policy Controller enrollment
  label, are separate decisions that will extend this contract.
