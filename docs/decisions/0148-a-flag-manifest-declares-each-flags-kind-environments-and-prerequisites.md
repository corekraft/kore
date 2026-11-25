---
status: proposed
summary: One flag manifest declares every flag's kind (feature, environment or harness), the environments it applies to and the flags it requires, replacing the hardcoded prerequisite check and the vps assertion that every flag is off, so that "all on" is computed from it and harness flags leave the vps overlay.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0148: A flag manifest declares each flag's kind, environments and prerequisites

Source: [issue #1479](https://github.com/corekraft/kore/issues/1479), grilled against the owner interview record in [issue #1478](https://github.com/corekraft/kore/issues/1478) (decisions 1 and 2).

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md), which makes the overlay's `features:` map the whole flag system, and [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md), which lists every flag, all off, in the vps overlay.

## Context

A flag today is a name in each overlay's `features:` map and a constant in code. Nothing says what kind of flag it is, where it applies, or what it needs:

- The vps overlay lists 34 flags. 14 are harness flags (tick, retro, advisor and the like) that only the local overlay reads, so they are inert in the production cluster and hide what "every flag on" means.
- Four flags (`in-cluster-ca`, `k3s-registry-trust`, `registry-tailnet-forward`, `local-image-reuse`) choose how an environment is built. They are not capabilities and will not retire.
- Prerequisites are hardcoded in `tools/kore/src/config/flag-dependencies.ts` (`registry-by-name` and `otlp-route` need `platform-shared-gateway`; `in-cluster-ca` is refused on k3d). Two owners would otherwise hold one fact.
- The vps integration spec asserts every flag is off, so the first activation would fail it.

## Decision

- **One manifest, JSON-compatible YAML.** One entry per flag: `name`, `kind` (`feature`, `environment`, `harness`), `applies` (the environments it applies to), `requires` (other flags) and, for an environment flag, the mark that it is never retired. `flag audit`, `flag activate`, validation and the retirement tool read it. Nothing about a flag's kind or reach lives anywhere else.
- **Prerequisites move into it.** `requires` replaces `flagDependencyErrors`. The two refusals that are provider facts rather than flag edges (`in-cluster-ca` and `acme-dns01` on a k3d environment) are not `requires`; they live in `tools/kore/src/config/provider-flag-errors.ts`, which configuration validation runs. `harness flag activate` refuses to turn a flag on in an environment where a required flag is off, so the vps order is computed: environment flags first (`in-cluster-ca`, `k3s-registry-trust`, `registry-tailnet-forward`), then `platform-argocd-delivery` and `platform-shared-gateway`, then the flags that need them.
- **Seed classification** (derived from the repository, not decided by the owner):
  - harness, absent from vps: the 14 harness flags in the vps overlay, and `role-tokens`, `owner-writer`, `tick-self-update`;
  - environment: `in-cluster-ca`, `k3s-registry-trust`, `registry-tailnet-forward` apply to vps only, `local-image-reuse` to local only;
  - feature, local and vps: `agentgateway-mesh-enrollment`, `autoscaling-defaults`, `gateway-class-change-release`, `gateway-rollback-order`, `ingress-agentgateway`, `platform-organization-service-apis`, `platform-argocd-delivery`, `platform-shared-gateway`, `database-routes`, `otlp-route`, `platform-hostname-ownership`, `platform-portal`, `portal-staged-install`. The two gateway migration guards apply to vps because a production cluster that later changes its GatewayClass needs them;
  - feature, local only for v1: `registry-tag-pruning`;
  - applicability pending the naming concept (#1480 to #1486): `platform-dns`, `registry-by-name`.
- **Harness flags leave the vps overlay now.** They are inert there. Moving them out of every overlay into a harness-only flags file is a follow-up.
- **The all-off assertion is replaced.** The vps spec instead requires that every flag in the vps overlay is declared in the manifest as applying to vps, and that every true flag has a recorded live-run outcome for vps. This is `flag audit` limited to vps, failing instead of warning. `flag audit` is a guardrail in audit mode, so enforcing it is a guardrail request that needs the owner's approval (ADR 0080); until then it stays a warning.

## Consequences

- "All on for vps" is a computation over the manifest, not a hand count, and a new flag without an entry fails validation.
- Environment flags still need their own live outcome and activation on vps (ADR 0142); they only stay out of the count of features.
- The hardcoded dependency check and the all-off spec are deleted in the change that adds the manifest.

## Owner decisions

Settled by the owner on 2026-11-20:

- Environment flags are activated but stay outside the "all on" count. The owner called it bookkeeping, and the recommendation stands.
- `registry-tag-pruning` is local only for v1: it prunes the tags `kore local up` makes, and pruning the vps registry on the shared disk is a capacity follow-up.
- Enforcing the vps flag audit goes through a guardrail request (ADR 0080). The owner said yes in principle; `harness guardrail activate` still needs the approving comment line on the idea's issue.

## Refinement: not-applicable marks and a reason (#1676)

Refines the seed classification above, decided on [issue #1676](https://github.com/corekraft/kore/issues/1676) from the owner's #1590 record (2026-11-23) and [ADR 0160](0160-vps-has-an-internal-gateway-on-the-tailnet-and-an-external-gateway-on-public-443.md).

- **A not-applicable mark.** An entry may list `notApplicable`: the environments of its `applies` where the flag does not apply in v1. Such an environment is left out of what applies there, so it stays out of the "all on" count. The overlay keeps the flag false, and turning it on there fails validation, naming the manifest and the reason.
- **A one-line reason.** Each not-applicable entry carries `reason`, one non-empty line that the progress report ([#1494](https://github.com/corekraft/kore/issues/1494)) prints. A missing or multi-line reason fails validation.
- **`database-routes`, `otlp-route` and `registry-by-name` are not applicable to vps** in v1, with their reasons in the manifest. `registry-by-name` stays pending for local until the naming concept settles.
- **`platform-dns` applies to vps.** Its pending mark is removed, as ADR 0158 decided it applies to vps. It stays off in the vps overlay.
- **`platform-keycloak-realm-wait`** (#1994) is declared a feature flag that applies to local, the one overlay that sets it.

Still open:

- `registry-by-name` stays pending for local until the naming concept settles whether a name-routed registry serves the tailnet.

## Refinement: a requires edge binds only where the required flag applies (#2055)

A `requires` edge is live only where the requiring flag applies, so an edge whose required flag does not apply there (not in its `applies`, or marked `notApplicable`) can never bind and is refused by validation, naming both flags and the environment, because such an edge would make "turn on" impossible there and hide a broken prerequisite until activation.
