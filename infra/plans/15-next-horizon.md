---
status: active
summary: Deliver the vision's Next horizon, services as first-class objects delivered from git that scale, in seven steps from accepting the Next ADRs to an outcome against every Next "Done when" clause; it starts only after plan 14 Step 4 merges and the Now footprint baseline is recorded.
last-verified: 2026-11-14
---

# Next Horizon: Services as First-Class Objects Plan

## Purpose

The vision's Next horizon is "A service is a first-class object, delivered from
git, and it scales"
([`docs/vision.md` § Horizons](../../docs/vision.md#horizons)). No other plan
delivers it: plan 2 covers Now, and plans 3–14 are harness, k3d, agentgateway
and test work. This plan gives Next ordered steps, exit criteria and an
outcome. Terms follow [`GLOSSARY.md`](../../GLOSSARY.md). Tracking issue: #616.

**Start gates.** No step's work begins until both hold:

1. **Plan 14 Step 4 has merged.** Its feature pause lifts then
   ([plan 14](14-test-tiers.md)).
2. **The Now footprint baseline is recorded** (#614). Vision-grill Q1 requires
   it first, so the components Next adds are weighed against a measured budget,
   the way [plan 9](9-k3d-local-cluster.md)'s Machine load section measured the
   machine.

The Next ADRs stay `proposed` until Step 1 accepts them (vision-grill Q2).
Every cluster-facing step declares a safety pattern and keeps its flag off
until a recorded live verification turns it on (AGENTS.md, _It just works_).

## Scope

In Next, only the platform organization exists.

**Left to Then:**

- Per-tenant Keycloak, Backstage and Argo CD, composed by the `Organization`
  API for each tenant root, with an AppProject per organization.
- Tenant repositories, namespaced tenant APIs, trust roots, secret stores and
  quotas.
- Tenant alert routing and per-tenant retention overrides
  ([ADR 0051](../../docs/decisions/0051-telemetry-retention-and-alerting.md)).

**Left to Later:** the 15-minute template check, from a Backstage template to a
working HTTPS address.

KEDA request-rate scaling follows the autoscaling defaults
([ADR 0047](../../docs/decisions/0047-autoscaling-metrics-server-then-keda.md))
and is not part of Next.

## Parked Owner Questions

- **Platform alert destination (blocks Step 6's alert delivery).** Default
  alerts are notify-only, so they need somewhere to notify. The owner names the
  platform organization's contact point, for example an email address or a chat
  webhook. Until then Step 6 provisions the rules with no contact point, and
  they show only in Grafana.
- **Footprint breach (blocks Step 1, only if it happens).** If the check shows
  Next's added components exceed the headroom, the owner decides which of
  [ADR 0040](../../docs/decisions/0040-keycloak-human-identity.md) or
  [ADR 0041](../../docs/decisions/0041-backstage-and-argo-cd-per-tenant.md) is
  revisited. The ADR stays `proposed` meanwhile.

## Step 1: Accept the Next ADRs

Safety pattern: `no-behaviour-change` (documentation only). Accepting an ADR
changes no cluster resource.

Next: Wait for both start gates (plan 14 Step 4 merged, #614 baseline recorded). Then split ADR 0041's Next part into its own ADR (first Work item), check the footprint, and accept the Next ADRs through write-adr.

### Work

- [ ] **Split ADR 0041 first.** Write a new ADR through write-adr for the Next
      part of
      [ADR 0041](../../docs/decisions/0041-backstage-and-argo-cd-per-tenant.md),
      and have ADR 0041 keep the rest, as #609 did for 0040 and 0051. Nothing in
      0041 belongs to Now. By clause:
  - _Next:_ the platform organization gets its own Backstage and Argo CD for
    operators; Argo CD syncs service workloads from git by digest, with image
    admission still deciding what runs; Backstage reads clusters as the user
    through OIDC; both run like any other service, with hosts, a PostgreSQL
    claim and telemetry.
  - _Then:_ one Backstage and one Argo CD per tenant root, composed by the
    `Organization` API; scoping by sub-organization groups and an AppProject
    per organization; a namespace-scoped Argo CD per tenant; the reserved
    service names in a tenant's base; one pinned version rolled across every
    tenant's instance.
- [ ] **Check the footprint.** Weigh each component-adding ADR against the
      recorded Now baseline (#614): the platform Keycloak of
      [ADR 0040](../../docs/decisions/0040-keycloak-human-identity.md), the
      platform Backstage from the Next part of 0041, and the platform Argo CD of
      [ADR 0043](../../docs/decisions/0043-platform-configuration-through-argo-cd.md).
      Record the result in this plan. A breach is revisited while the ADR is
      still `proposed`.
- [ ] **Accept the Next ADRs** through write-adr: 0037, 0038, 0042 (the default
      zone), 0043, 0045, 0046, 0047, the Next parts of 0040 and 0051 as split by
      #609, and the new Next ADR from the first item. Accept nothing outside
      Next.
- [ ] Update `docs/index.md` for each status change and keep `harness kb check`
      clean.

### Exit Criteria

- Each Next ADR is `accepted`, and the footprint check is recorded here
  against the Now baseline.
- ADR 0041 holds only its Then clauses, and the new ADR holds the Next ones.

## Step 2: Organization and Service Platform APIs

Safety pattern: `flag` (`platform-organization-service-apis`, off in `local`),
dark launched. With the flag off the render adds nothing to a cluster.

### Work

- [ ] Define `Organization` and `Service` as Crossplane platform APIs for the
      platform organization only, following the PostgreSQL API's layout
      ([ADR 0008](../../docs/decisions/0008-crossplane-postgresql-platform-api.md)).
- [ ] Compose a namespace per service environment with tenant and organization
      labels
      ([ADR 0037](../../docs/decisions/0037-tenant-isolation-by-namespace.md),
      [ADR 0038](../../docs/decisions/0038-organization-hierarchy-depth-and-labels.md)).
- [ ] Give each `Service` a default host in the organization's default zone
      ([ADR 0042](../../docs/decisions/0042-organization-domains-by-delegation.md)).
- [ ] Validate both kinds in `kore validate` before any mutation, and report
      their status through `kore status`.

### Exit Criteria

- A `Service` registered in the platform organization gets a labelled
  namespace and a default host, shown live on a throwaway profile.
- The flag stays off until a recorded live verification turns it on.

## Step 3: Autoscaling Defaults

Safety pattern: `flag` (`autoscaling-defaults`, off in `local`).

### Work

- [ ] Install metrics-server as a catalog Helm release, pinned and mirrored
      ([ADR 0047](../../docs/decisions/0047-autoscaling-metrics-server-then-keda.md)).
- [ ] Add a CPU HorizontalPodAutoscaler to the workload chart from chart values,
      with no replica count, at least two replicas, and a PodDisruptionBudget.
- [ ] Prove a BFF scales 1→N under load and back, with no request failing
      because a pod started cold.

### Exit Criteria

- The reference workload scales out and back in on a live run, recorded.

## Step 4: Golden-Path Templates

Safety pattern: `expand-contract`. The templates are new files and images; the
existing reference app keeps working until a service moves to them.

### Work

- [ ] Build a static frontend template into a signed image served from a pinned
      static-server image
      ([ADR 0045](../../docs/decisions/0045-static-frontends-as-signed-images.md)).
- [ ] Build a Kotlin BFF template with Jib on the GraalVM JDK, with the
      OpenTelemetry Java agent and a JDK AOT cache from a build-time training
      run
      ([ADR 0046](../../docs/decisions/0046-bff-jvm-with-agent-and-aot-cache.md)).
- [ ] Add the unit-level assertion on the template's cookie and response
      settings that the vision's token test names: every session cookie
      host-only, `HttpOnly`, `Secure` and `SameSite`.
- [ ] Sign both images through release automation and deploy them by digest.

### Exit Criteria

- Both images are signed and admitted by digest on a live run.
- The cookie assertion runs in the unit suite.

## Step 5: Platform Argo CD Delivery from Git

Safety pattern: `flag` (`platform-argocd-delivery`, off in `local`). With the
flag off, Helm stays the only owner of every release, so no resource has two
owners.

### Work

- [ ] Install the platform organization's Argo CD in the core phase, and hand
      the configuration-phase releases except the image policy to it as Helm
      charts from the platform OCI registry
      ([ADR 0043](../../docs/decisions/0043-platform-configuration-through-argo-cd.md)).
- [ ] Gate application admission on its health, failing closed and naming the
      cause.
- [ ] Deliver the golden-path BFF and static frontend from git by digest with
      an ApplicationSet over the `Service` registrations, so the sync, not
      `kore`, owns their workload.
- [ ] Reach HTTPS on each service's host.

### Exit Criteria

- A merged `Service` change with a signed digest reaches a working HTTPS
  address through Argo CD, shown live.
- `kore local up` converges from a fresh and from an existing profile with the
  flag on.

## Step 6: Platform Keycloak and Backstage

Safety pattern: `flag` (`platform-portal`, off in `local`). The portal never
runs open: with the flag on, Backstage starts only once its Keycloak sign-in is
ready.

### Work

- [ ] Install the Keycloak operator and the platform organization's Keycloak,
      with one realm and groups mirroring the organization
      ([ADR 0040](../../docs/decisions/0040-keycloak-human-identity.md)). Pin
      and evaluate the Crossplane Keycloak provider first.
- [ ] Install the platform organization's Backstage, signing in through
      Keycloak and reading clusters as the user, with its catalog built from the
      `Organization` and `Service` objects.
- [ ] Show the delivered services in Backstage with their Argo CD sync and
      rollout.
- [ ] Provision each delivered service's default dashboard and notify-only
      alerts in Grafana
      ([ADR 0051](../../docs/decisions/0051-telemetry-retention-and-alerting.md)),
      with the platform alert destination once the parked question is answered.

### Exit Criteria

- A person signs in to Backstage through Keycloak and sees the delivered
  services, live.
- Each delivered service shows its dashboard and alerts with no setup.
- A request to Backstage with no sign-in is refused.

## Step 7: Outcome

Safety pattern: `no-behaviour-change` (records only).

### Work

- [ ] Record the per-stage delivery time from a merged `Service` change with a
      signed digest to a working HTTPS address, over several runs: namespace,
      sync, admission, certificate, rollout, readiness. Exclude the tenant's
      own build, and report cold services separately from redeploys.
- [ ] Add a p95 measurement to [plan 13](13-agentgateway-ingress.md)'s load
      harness and record the golden-path frontend's p95 at the Gateway.
- [ ] Run the end-user token test: a browser finds no access or refresh token
      readable by script, and every session cookie is host-only, `HttpOnly`,
      `Secure` and `SameSite`.
- [ ] Record Next's footprint against the Now baseline.
- [ ] Check every Next "Done when" clause in the vision against a recorded run,
      and record the outcome as confirmed, refuted or inconclusive.

### Exit Criteria

- Every Next "Done when" clause has recorded proof: the platform APIs, a
  Kotlin BFF and a static frontend delivered by Argo CD that reach HTTPS and
  scale 1→N, Backstage showing them, Keycloak sign-in, dashboards and alerts,
  the delivery-time and p95 baselines, and the token test.
- The delivery-time and p95 results are baselines, not targets.
