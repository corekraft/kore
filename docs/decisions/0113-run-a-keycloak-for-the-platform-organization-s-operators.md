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

**Closed 2026-11-20: the platform chart declares the `platform` Organization.**
See the refinement below.

The change is unproven live: the golden-path BFF image needs x86-64-v3, which
the 6 vCPU host lacks, so `kore local up` cannot pass the Application gate
there with the portal off. Turning `portal-staged-install` on needs a recorded
live run on a host that can.

## Refinement 2026-11-20: the platform chart declares the `platform` Organization (issue 1318)

The owner chose option A for the question left open above: the `platform-keycloak`
chart declares the `platform` Organization claim. Helm owns the claim, and the
Organization owns the realm and its groups, so membership keeps one owner. Rejected:
`kore` applying the claim, because desired state belongs in the repository and `kore`
does not reconcile resources itself; and moving the realm into `kore-platform-keycloak`,
which reverses this ADR's split of ownership. A separate `platform-organization` chart
waits until the Organization must exist without the portal.

- The claim exists only while `platform-portal` is on, so with the flag off the render
  is unchanged. Keycloak's release depends on `kore-platform-apis`, which owns the
  Organization kind, so the portal also needs the organization service APIs on;
  validation refuses the combination otherwise.
- Uninstalling the chart deletes the Organization, but the realm's management policies
  leave out Delete, so the realm and its users stay.
- The Keycloak release is ready only when the Organization's Ready condition is True,
  checked after the StatefulSet. A missing or failing realm ends the wait with the
  Organization's reason named, not a timeout in Backstage's sign-in proxy.

The live proof is still owed: the realm and its sign-in are proven by the live run that
gates `platform-portal` (issue 1111).

## Refinement 2026-11-22: the Crossplane provider owns the Backstage client (issue 1730)

The Backstage client in the `platform` realm is a Crossplane managed `Client`
(`openidclient.keycloak.m.crossplane.io/v1alpha1`) of the Keycloak provider, not a
`KeycloakOIDCClient` of the Keycloak operator. The operator path needed the
`client-admin-api:v2` preview feature on the Keycloak server and an operator-owned
label on the Secret, and the realm and groups already have one owner, the provider.
The Keycloak server keeps the operator install; it sets no preview feature.

- The Client reads its secret by reference from the Secret `backstage-oidc` in the
  `backstage` namespace, which kore streams (ADR 0034). No credential is in git.
- The platform-backstage release is ready only when the Client's Ready condition is
  True, and a missing client ends the wait with the reason Crossplane reports.
- Rejected: keeping the operator client with the preview feature, which left one
  client owned by two tools and failed on the operator's own internals.

## Refinement 2026-11-23: the golden-path sign-in waits for the portal (issue 1880)

A fresh `kore local up` with `golden-path-signin` on stopped at the delivery gate.
Each golden-path Service renders a Crossplane `Client` against the `keycloak`
ClusterProviderConfig, which the platform Keycloak chart renders, and that chart
starts after the gate while `portal-staged-install` is on. The Client reconciles
against that Keycloak server, so it cannot connect until the server starts, and its
`<service>-oidc` secret, which the BFF reads, is not written until then. The gate
waited on those Applications, so it could not pass. Moving the ClusterProviderConfig
earlier would not have been enough: the Client still needs the server.

- **While both `golden-path-signin` and `portal-staged-install` are on, the delivery
  gate waits only on the platform Applications, those without the
  `platform.kore.dev/service` label.** A labelled Application is a golden-path
  Service. The label scope never excuses an unlabelled Application, so a platform
  failure still blocks the gate.
- **The run then awaits the labelled Applications after `reconcileStagedConfigurations`,**
  within the platform Keycloak's catalog timeout, before enrollment and the gate. The
  ApplicationSet owns the Applications and Argo CD the sync, as before; only the set
  of Applications a wait reads changes.
- **With either flag off, the gate waits on every Application, as before.** With the
  portal disabled there is no platform Keycloak to wait for, so nothing is deferred.
- Rejected: installing the ClusterProviderConfig before the gate. The Client would
  still fail until the Keycloak server started, so the gate would still block.
- Rejected: turning `portal-staged-install` off in the local overlay. The staging
  exists to keep Keycloak's start off the burst of Argo CD's first sync (above), and
  the local host cannot pass the gate with the portal off.
- Unproven live: the change needs a live `kore local up` on a host that can run the
  golden-path BFF image before merge, because it alters the local gate's order.
