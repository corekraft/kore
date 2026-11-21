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
- **Prerequisites move into it.** `requires` replaces `flagDependencyErrors`. `harness flag activate` refuses to turn a flag on in an environment where a required flag is off, so the vps order is computed: environment flags first (`in-cluster-ca`, `k3s-registry-trust`, `registry-tailnet-forward`), then `platform-argocd-delivery` and `platform-shared-gateway`, then the flags that need them.
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

Still open:

- `platform-dns` and `registry-by-name` stay pending until the naming concept settles whether the platform DNS and a name-routed registry serve the tailnet.
