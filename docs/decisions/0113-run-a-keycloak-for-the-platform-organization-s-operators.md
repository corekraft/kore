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
install also failed twice for other reasons: `rollout status` on
`statefulset/keycloak` returned NotFound after 0.2 s, because the operator
creates it after the release is installed, and Backstage's sign-in proxy
crashed before the platform realm existed.

- **With `platform-portal` on, `kore-platform-keycloak` and
  `kore-platform-backstage` declare `startsAfterDelivery`.** `platform up`
  skips them in the configuration pass and reconciles them, Keycloak first,
  after the Argo CD delivery wait, so they start only once every Application is
  Synced and Healthy. With the flag off no release declares the stage and
  nothing changes. The Keycloak operator and provider stay in the core phase:
  they are small (the operator peaked at 0.7 cores) and the provider's
  credential is streamed right after them.
- **Keycloak is ready only when its realm is.** The release's readiness adds
  `realm.realm.keycloak.m.crossplane.io/platform`, which Crossplane creates
  from the Organization once Keycloak answers, so Backstage, which depends on
  Keycloak, starts after the realm its proxy needs. It needs
  `platform-organization-service-apis`; without it the wait names the realm
  and times out.
- **A StatefulSet and the realm are waited on to exist first.** A readiness
  entry that starts `statefulset/` or names the realm polls `kubectl get`
  within the release's bound before the rollout or Ready wait, so an object an
  operator creates a moment after Helm returns is not a failure.
- **Not changed:** the local observability footprint (the agents, Prometheus
  and Loki together peaked near 0.2 cores) and the Gatekeeper audit interval
  (0.4 to 0.8 cores every 60 s), which is a policy decision for its own change.

The change is unproven live: the golden-path BFF image needs x86-64-v3, which
the 6 vCPU host lacks, so `kore local up` cannot pass the Application gate
there with the portal off. Turning `platform-portal` on still needs a recorded
live run on a host that can.
