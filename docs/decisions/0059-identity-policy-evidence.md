---
status: accepted
summary: A constraint leaves dryrun only through its own promotion record with recent zero-violation audit evidence per environment, an image signer is trusted only if the environment's image policy lists it (a managed environment can never trust the local key), and OPA bundle failure and staleness semantics are proven offline and live.
date: 2026-11-08
last-verified: 2026-11-08
last-verified: 2026-11-09
---

# ADR 0059: Evidence for identity and policy enforcement

Source: [`infra/plans/2-implementation.md` § Step 9](../../infra/plans/2-implementation.md#step-9-workload-identity-application-image-trust-and-policy)
Refines: [ADR 0007](0007-workload-identity-and-layered-authorization.md),
[ADR 0014](0014-native-identity-before-opa.md),
[ADR 0017](0017-gatekeeper-policy-families-audit-first.md),
[ADR 0028](0028-image-trust-authority.md)

## Context

Step 9 says constraints are promoted "only after the platform complies" and
that local identities are never trusted by managed environments, but nothing
checked either. An application lock was verified against its own
`authorizedSigners`, so a managed environment would only fail in cosign on a
`local-kore-key` entry. Stale and invalid OPA bundle behavior was described in
ADR 0018 but not proven.

## Decision

- **Promotion.** Every constraint is committed in `dryrun`. Setting another
  `enforcementAction` requires
  `infra/policies/gatekeeper/promotions/<constraint>.json`: `from: dryrun`, the
  target action, and per environment `observedAt` and `totalViolations` taken
  from the constraint's own audit status. `kore validate` rejects a promotion
  with no record, a count above zero, no evidence for the validated
  environment, or evidence older than 14 days. Promotion is per constraint. This
  ADR builds the mechanism; no constraint is promoted by it.
- **Signer trust.** `trustedSigners` derives from the environment's image trust
  authority: the local key for `type: key`, the exact release subjects for
  `keyless`. Validation rejects a key authority in a managed environment, and
  `kore app up` rejects an image whose signer is not listed before verifying.
- **OPA bundle.** An invalid bundle or one outside its manifest roots fails to
  load, so the authorizer never becomes ready and the provider stays
  `failOpen: false`. A missing decision denies. Bundles are not polled (ADR
  0018), so staleness means a pod whose `checksum/bundle` differs from its
  Deployment; the live spec checks it.
- **Principals.** ADR 0014 stands: Istio 1.30 sends OPA no principals. A live
  spec records whether OPA's input carries them, so the day it does the
  finding is a test result rather than a guess.

## Consequences

Promotion is reviewable evidence in git. A lock signed by the local key can no
longer reach a managed cluster at all. Evidence is entered by a person from
`kubectl get` output (`auditEvidence` extracts it); a collection command is a
later option. `npm run test:integration:identity` proves the live items.

## Live audit evaluation

Promotion is per constraint, so the live audit spec (`evaluateAudit`) fails only
on constraints that already enforce (`deny` or `warn`) and have violations. A
`dryrun` constraint never fails the suite: its count and its first five
violating resources (kind, namespace, name; no messages) are printed as
promotion evidence. `KoreRBAC` reads Secrets only through rules that cover the
core API group, and its `allowedSecretRoles` lists each upstream controller or
Kubernetes bootstrap role it leaves out, with a reason and a gator case.
