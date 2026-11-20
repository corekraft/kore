---
status: accepted
summary: The platform organization gets its own Keycloak in Next, with one realm and nested groups mirroring organizations, so the portal has a sign-in before any tenant exists.
date: 2026-11-14
last-verified: 2026-11-20
---

# ADR 0113: Run a Keycloak for the platform organization's operators

Source: [`infra/plans/15-next-horizon.md` § Step 1](../../infra/plans/15-next-horizon.md#step-1-accept-the-next-adrs)

Refines: ADR 0040

## Context

[ADR 0040](0040-keycloak-human-identity.md) mixes two horizons. A Keycloak per
tenant root needs the tenancy model, so it arrives in Then. The platform
organization's own Keycloak needs none: in Next only the platform organization
exists, and the portal needs a sign-in before any tenant does
([plan 15](../../infra/plans/15-next-horizon.md)). The split lets Next accept
its part without accepting tenant tooling that has no tenant to serve, as was
done for [ADR 0111](0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md)
and [ADR 0114](0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md).

## Decision

- **The platform organization gets its own Keycloak** for operators, installed
  through the Keycloak operator the platform installs once. It claims its
  database through the PostgreSQL platform API and gets a host under the
  platform base.
- **One realm, with groups mirroring organizations.** Each sub-organization is
  a nested group, and tokens carry the user's groups.
- **The `Organization` API owns the realm's organizations and groups,** through
  a Crossplane Keycloak provider, so membership has one owner.
- **The platform's tools trust only this issuer.** The platform Backstage, Argo
  CD and Grafana sign users in through OIDC against it and scope access by the
  groups claim.

ADR 0040 keeps the per-tenant clauses, which stay in Then.

## Consequences

- Next's footprint counts a Keycloak and its database for the platform
  organization.
- Operators get a sign-in before any tenant exists.
- ADR 0040's per-tenant design builds on this one rather than replacing it.

## Amendment: the portal workloads start after the Argo CD delivery (issue 1318)

A live read on a 6 vCPU host (portal on, nothing else changed) showed the load
peaking at 15.6 with CPU idle at 0 to 1%, while Argo CD's application
controller (peak 1.26 cores) was still syncing the handed-over Applications and
Keycloak's JVM started (peak 3.4 cores). The k3s container never restarted, so
the install did not saturate that host, but the two bursts overlapped. The
install also failed for other reasons: `rollout status` on
`statefulset/keycloak` returned NotFound after 0.2 s, because the operator
creates it after the release is installed, and Backstage's sign-in proxy
crashed.

- **Behind `portal-staged-install` (off in every overlay), `kore-platform-keycloak`
  and `kore-platform-backstage` start after the Argo CD delivery.** Both declare
  `startsAfterDelivery` in the catalog. With the flag on, `platform up` skips
  them in the configuration pass and reconciles them, Keycloak first, after the
  delivery wait, so they start only once every Application is Synced and
  Healthy. With the flag off nothing changes. The Keycloak operator and provider
  stay in the core phase: they are small (the operator peaked at 0.7 cores) and
  the provider's credential is streamed right after them. A separate flag lets
  the staging be proven and turned on without the portal's own flag moving.
- **The Keycloak StatefulSet's readiness waits for it to exist first.** The
  entry `statefulset/keycloak`, the one object an operator creates after Helm
  returns, polls `kubectl get` and then runs the rollout wait with whatever is
  left of the release's bound, so the two together never take longer than that
  bound. Keycloak exists only while `platform-portal` is on, and every other
  release's readiness is unchanged.
- **Not changed:** the local observability footprint (the agents, Prometheus
  and Loki together peaked near 0.2 cores) and the Gatekeeper audit interval
  (0.4 to 0.8 cores every 60 s), which is a policy decision for its own change.

**Open: Backstage still needs the platform realm.** The realm is composed by
the `Organization` API, and nothing in the repository creates the `platform`
Organization claim, so on a fresh profile the realm never exists and Backstage's
proxy cannot discover its issuer. Staging does not change that. A claim applied
by `kore` or by a chart, or the realm moved to `kore-platform-keycloak`, would
close it; that is a decision for the owner, taken before `platform-portal` is
turned on.

The change is unproven live: the golden-path BFF image needs x86-64-v3, which
the 6 vCPU host lacks, so `kore local up` cannot pass the Application gate
there with the portal off. Turning `portal-staged-install` on needs a recorded
live run on a host that can.
