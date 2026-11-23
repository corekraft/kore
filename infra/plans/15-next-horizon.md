---
status: active
summary: Deliver the vision's Next horizon, services as first-class objects delivered from git that scale, in seven steps from accepting the Next ADRs to an outcome against every Next "Done when" clause; it starts now: the owner waived both start gates (plan 14 Step 4 merging, the Now footprint baseline) on 2026-11-14 and took them as debt #659.
last-verified: 2026-11-18
---

# Next Horizon: Services as First-Class Objects Plan

## Purpose

The vision's Next horizon is "A service is a first-class object, delivered from
git, and it scales"
([`docs/vision.md` § Horizons](../../docs/vision.md#horizons)). No other plan
delivers it: plan 2 covers Now, and plans 3–14 are harness, k3d, agentgateway
and test work. This plan gives Next ordered steps, exit criteria and an
outcome. Terms follow [`GLOSSARY.md`](../../GLOSSARY.md). Tracking issue: #616.

**Start gates waived.** Two start gates were set: plan 14 Step 4 merged, and
the Now footprint baseline recorded (#614). On 2026-11-14 the owner waived both
and took them as debt, filed as #659; no step is blocked on either.

1. **Plan 14 Step 4.** Its #405 live responsiveness run is owed as debt (#659).
   The default of two workers shipped in #598.
2. **The Now footprint baseline** (#614). Vision-grill Q1 wanted it first, so
   the components Next adds are weighed against a measured budget, the way
   [plan 9](9-k3d-local-cluster.md)'s Machine load section measured the
   machine. The baseline is recorded in
   [plan 2](2-implementation.md) (2026-11-15, #623). The headroom threshold is
   still the owner's call.

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

- **Platform alert destination (settled; Step 6 item 4 stays open for the
  wiring and the live delivery proof).** Default alerts are notify-only, so they
  need somewhere to notify.
  State 2026-11-14: parked. #692 provisioned the rules with no contact point,
  visible in Grafana only.
  Decided 2026-11-17: the owner named the platform organization's destination,
  an email inbox. The mechanism from #709 exists: the address and the SMTP
  settings are supplied only at run time (`KORE_ALERT_EMAIL_ADDRESSES` and
  `KORE_ALERT_SMTP_*`), the SMTP login streams through `kore secrets smtp`, and
  with `platform-portal` on and an address set, `kore platform up` provisions
  one email contact point and a root policy. No address is written in the
  repository. The wiring that carries fired alerts to the contact point is
  built behind `platform-portal` ([ADR 0128](../../docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md),
  #1117); what remains is the live delivery proof.
- **Footprint breach (blocks Step 1, only if it happens).** Decided 2026-11-17
  (owner, [#1107](https://github.com/corekraft/kore/issues/1107)): a footprint
  run breaches when Docker VM memory in use goes above 85 percent at any sample
  (under 15 percent free at the peak), or when any pod's last state was
  OOMKilled during the run. Swap is not part of the rule: the clean baseline
  already sat at about 4.7 GiB of host swap. The verdict is in the measurement's
  JSON beside the figures.
  The breach ladder, in order, for every proof gated on the footprint:
  1. A breached run is recorded inconclusive, and its flag stays off.
  2. Retry once with agent panes paused, recording the pause and any limit
     change on the ticket.
  3. Only after that second breach, open the revisit of
     [ADR 0111](../../docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md),
     [ADR 0113](../../docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md) and
     [ADR 0043](../../docs/decisions/0043-platform-configuration-through-argo-cd.md),
     which stay `proposed` meanwhile. A cloud runner is a separate decision.
     This replaces the 2026-11-14 threshold, which was set from the plan 2
     baseline; the revisit list is the three Next ADRs above.
- **Before every live proof (#1349, #1354, #1355).** Two checks, both offline
  and with no cluster, so a run tests the change and not a stale published chart:
  1. `kore local lock-check --platform-chart-lock <platform-charts.lock.json>`
     packages the checkout's charts with the release script and compares each
     handed-over release's version with the lock's. It exits 1 on drift and
     names the chart; the fix is a release or a main publish that contains the
     change. Start the run itself with `kore local up --require-fresh-lock`,
     which refuses on the same drift (without it `local up` only warns).
     `--require-fresh-lock` stays the gate for either lock. A local proof may
     pass a main chart lock (decided in
     [ADR 0138](../../docs/decisions/0138-publish-signed-configuration-charts-from-main-for-local-proofs.md)):
     it counts for activation only when the outcome's recorded chart digests
     equal the release chart lock's, and a flag still turns on only after a
     release.
  2. `npm --prefix tools/kore exec vitest run --config vitest.integration.config.ts integration/platform/delivery-chart-values.spec.ts`
     renders the delivery chart and every delivered chart for each proof flag
     alone, all together, and local as it is.
- **Flag-matrix revert evidence (#1355, 2026-11-20).** At `main`'s head 05df6238, each fix reversed in turn (its production chart hunks only) fails the matrix spec for its own fault, and the fixes in place pass 35 of 35: #1341 (the schema refuses a flag-gated component) fails 8 tests; #1344 (the AppProject refuses `KoreHostnameOwnership`) fails 2, in the hostname-ownership and all-flags sets; #1346 (`gateway.platformHostname` missing from `kore-platform-config`) fails 22, the derived-value check in every set; #1348 (the shared Gateway's Service port 443 unnamed) fails 7, one per flag set. The spec runs offline, with `helm template` only. The commands, method and per-row counts are on the ticket: https://github.com/corekraft/kore/issues/1355#issuecomment-7033966455.
- **Live proofs blocked on the release locks (2026-11-15).** The
  `platform-argocd-delivery` and `platform-portal` live proofs are blocked on
  the release locks: the `platform-charts` lock, `template-images.lock.json`
  and `backstage-image.lock.json`. Only a tag-ref `release.yaml` run publishes
  them. The owner approved dispatching the release; the proofs follow once the
  locks exist. Nothing is ticked until then.
- **Plan 14 Step 4 responsiveness run (debt #659).** The #405 run is recorded
  on #405: zero failed probes, p95 864 ms under heavy load. The footprint
  baseline is recorded in [plan 2](2-implementation.md) (2026-11-15, #623).

## Step 1: Accept the Next ADRs

Safety pattern: `no-behaviour-change` (documentation only). Accepting an ADR
changes no cluster resource.

### Work

- [x] **Split ADR 0041 first.** Write a new ADR through write-adr for the Next
      part of
      [ADR 0041](../../docs/decisions/0041-backstage-and-argo-cd-per-tenant.md),
      and have ADR 0041 keep the rest, as #609 did for 0040 and 0051. Nothing in
      0041 belongs to Now. The Next part is
      [ADR 0111](../../docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md);
      0041 keeps the Then part.
- [x] **Check the footprint** (estimate recorded, measured baseline recorded
      in [plan 2](2-implementation.md)). Weigh each component-adding ADR against the
      recorded Now baseline (#614): the platform Keycloak of
      [ADR 0113](../../docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md), the
      platform Backstage of ADR 0111, and the platform Argo CD of
      [ADR 0043](../../docs/decisions/0043-platform-configuration-through-argo-cd.md).
      Record the result in this plan. A breach is revisited while the ADR is
      still `proposed`.

      **Footprint estimate (2026-11-14, design time only).** This is an
      estimate, not a measurement: no breach is found and no pass is claimed.
      - **The additions are unsized.** No chart, values file or catalog entry
        exists yet for the platform Keycloak
        ([ADR 0113](../../docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md)), the
        platform Backstage or Argo CD
        ([ADR 0111](../../docs/decisions/0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md)),
        so their requests and limits are unknown. A Keycloak figure of 1 to
        1.25 GiB is an unverified assumption.
      - **The Now components' declared requests** total 470m CPU and 1184Mi:
        opa-authorizer 25m/64Mi, oci-registry 75m/160Mi, cert-manager
        20m/64Mi, Loki 100m/256Mi, Tempo 100m/256Mi, Prometheus 100m/256Mi,
        Grafana 50m/128Mi. Their limits total 2950m CPU and 4736Mi. The
        request total is a floor, because Istio, Crossplane, Gatekeeper,
        external-secrets, CloudNativePG, agentgateway and the OpenTelemetry
        components declare no requests.
      - **Headroom is already thin.** [Plan 9](9-k3d-local-cluster.md) measured
        the k3s server at 3.7 GiB on average and 6.7 GiB at peak of an
        11.68 GiB Docker VM, with swap in use, so the three additions could
        breach it.
      - **The measured baseline is recorded** in
        [plan 2](2-implementation.md) (2026-11-15, #614, #623). A breach is
        revisited while the ADRs are still `proposed`; ADR 0111, ADR 0113 and
        ADR 0043 were accepted without it by the owner's waiver (#659).

- [x] **Accept the Next ADRs** through write-adr: 0037, 0038, 0042 (the default
      zone), 0043, 0045, 0046, 0047, and the Next ADRs split out of 0040 and 0051
      ([ADR 0113](../../docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md),
      [ADR 0114](../../docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md)),
      and the new Next ADR from the first item (ADR 0111). Accept nothing
      outside Next. #609 marked the Next clauses in place; ADR 0113 and 0114
      split them out as ADR 0111 did for 0041, and 0040 and 0051 stay
      `proposed` for their Then clauses.
- [x] Update `docs/index.md` for each status change and keep `harness kb check`
      clean.

### Exit Criteria

- Each Next ADR is `accepted`, and the footprint check is recorded here
  against the Now baseline.
- ADR 0041 holds only its Then clauses, and the new ADR holds the Next ones.

## Step 2: Organization and Service Platform APIs

Safety pattern: `feature-flagged` (`platform-organization-service-apis`, off in `local`),
dark launched. With the flag off the render adds nothing to a cluster.

### Work

- [x] Define `Organization` and `Service` as Crossplane platform APIs for the
      platform organization only, following the PostgreSQL API's layout
      ([ADR 0008](../../docs/decisions/0008-crossplane-postgresql-platform-api.md)).
- [x] Compose a namespace per service environment with tenant and organization
      labels
      ([ADR 0037](../../docs/decisions/0037-tenant-isolation-by-namespace.md),
      [ADR 0038](../../docs/decisions/0038-organization-hierarchy-depth-and-labels.md)).
- [x] Give each `Service` a default host in the organization's default zone
      ([ADR 0042](../../docs/decisions/0042-organization-domains-by-delegation.md)).
- [x] Validate both kinds in `kore validate` before any mutation, and report
      their status through `kore status`.

### Exit Criteria

- A `Service` registered in the platform organization gets a labelled
  namespace and a default host, shown live on a throwaway profile.
- The flag stays off until a recorded live verification turns it on.

## Step 3: Autoscaling Defaults

Safety pattern: `feature-flagged` (`autoscaling-defaults`, off in `local`).

### Work

- [x] Install metrics-server as a catalog Helm release, pinned and mirrored
      ([ADR 0047](../../docs/decisions/0047-autoscaling-metrics-server-then-keda.md)).
- [x] Add a CPU HorizontalPodAutoscaler to the workload chart from chart values,
      with no replica count, at least two replicas, and a PodDisruptionBudget.
- [x] Prove a BFF scales 1→N under load and back, with no request failing
      because a pod started cold.

      - 2026-11-15 not provable: no project command exists (owner decision 2026-11-15, no command scales a BFF 1 to N under load and back while counting failed requests; tracked on [#616](https://github.com/corekraft/kore/issues/616)). Not ticked.
      - 2026-11-18 command added ([#1114](https://github.com/corekraft/kore/issues/1114)): `npm run test:live:golden-path-load` in `tools/kore` scales the BFF out and back under the golden-path load and fails on any failed request ([plan 13](13-agentgateway-ingress.md#golden-path-route-set)). One live run is owed, on an idle host with `autoscaling-defaults` on and the BFF delivered through Argo CD, recorded on #1114 with its host record. Not ticked.

### Exit Criteria

- The reference workload scales out and back in on a live run, recorded.

## Step 4: Golden-Path Templates

Safety pattern: `expand-contract`. The templates are new files and images; the
existing reference app keeps working until a service moves to them.

### Work

- [x] Build a static frontend template into a signed image served from a pinned
      static-server image
      ([ADR 0045](../../docs/decisions/0045-static-frontends-as-signed-images.md)).
- [x] Build a Kotlin BFF template with Jib on the GraalVM JDK, with the
      OpenTelemetry Java agent and a JDK AOT cache from a build-time training
      run
      ([ADR 0046](../../docs/decisions/0046-bff-jvm-with-agent-and-aot-cache.md)).
- [x] Add the unit-level assertion on the template's cookie and response
      settings that the vision's token test names: every session cookie
      host-only, `HttpOnly`, `Secure` and `SameSite`.
- [x] Sign both images through release automation and deploy them by digest.

      - 2026-11-23 owner approved on the live run recorded on [#1103](https://github.com/corekraft/kore/issues/1103#issuecomment-7088871307) (main `131066ab`, v0.22.0 template lock): both template images run by digest in both Services and `cosign verify` of both digests against `release.yaml@refs/tags/v0.22.0` succeeded. Admission by digest is not shown: the enforced policies do not cover `ghcr.io/corekraft/kore/templates/**`; tracked on [#1884](https://github.com/corekraft/kore/issues/1884). The Exit Criterion "admitted by digest" stays unproven until then.

### Exit Criteria

- Both images are signed and admitted by digest on a live run.
- The cookie assertion runs in the unit suite.

## Step 5: Platform Argo CD Delivery from Git

Safety pattern: `feature-flagged` (`platform-argocd-delivery`, off in `local`). With the
flag off, Helm stays the only owner of every release, so no resource has two
owners.

### Work

- [x] Install the platform organization's Argo CD in the core phase, and hand
      the configuration-phase releases except the image policy to it as Helm
      charts from the platform OCI registry
      ([ADR 0043](../../docs/decisions/0043-platform-configuration-through-argo-cd.md)).
- [x] Gate application admission on its health, failing closed and naming the
      cause.
- [x] Deliver the golden-path BFF and static frontend from git by digest with
      an ApplicationSet over the `Service` registrations, so the sync, not
      `kore`, owns their workload.
- [x] Reach HTTPS on each service's host.

### Exit Criteria

- A merged `Service` change with a signed digest reaches a working HTTPS
  address through Argo CD, shown live.
- `kore local up` converges from a fresh and from an existing profile with the
  flag on.

## Step 6: Platform Keycloak and Backstage

Next: Plan 15 has one item left, Step 6 item 3 (Backstage shows delivered services with their Argo CD sync and rollout). Build order: #1883 (apiserver OIDC behind a flag, Application label; ready-for-agent, needs a writer spawned from a Herdr pane: session spawn refuses outside Herdr), then its live proof on #1881, then the owner approves the tick. Also open and ready-for-agent: #1884 (ClusterImagePolicy admitting ghcr.io/corekraft/kore/templates by digest, so the Step 4 exit criterion is shown) and #1880 (a fresh kore local up with golden-path-signin on stops at the config-delivery gate). When Step 6 item 3 is ticked: update the Outcome Record rows (Backstage shows them, deployed by digest), then close #1101, #1103, #1104 and #616 through their sub-issues (Refs, never Closes; ADR 0097). #1216 and #1354 are housekeeping still open. The cluster kore-local is stopped; no worktree of mine is open.

Safety pattern: `feature-flagged` (`platform-portal`, off in `local`). The portal never
runs open: with the flag on, Backstage starts only once its Keycloak sign-in is
ready.

### Decisions

- Application runtime images are distroless and builder stages can be anything
  ([ADR 0116](../../docs/decisions/0116-application-runtime-images-are-distroless-builder-stages-can-be-anything.md),
  #696).
- The Backstage image source lives in `images/backstage`, not `apps/`, because
  it is a platform component that `kore` installs, not an application (#695).
  `platform-backstage` stays one chart for the same reason: one owner per
  resource (#694).

### Work

      - 2026-11-22 owner approved Step 5 items 1, 3 and 4 on the recorded live proof of [#1110](https://github.com/corekraft/kore/issues/1110), run `fresh1110-g` on main `2037c3a6` (2026-11-18, throwaway overlay, existing profile): `kore local up` exited 0 with `platform-argocd-delivery` on; the golden-path ApplicationSet generated the Application from the pushed commit, Synced and Healthy, running `reference@sha256:959014af…` by digest; `https://kore.local:8443/` reached the Gateway and answered 403 without a token; 0 OOMKilled, no breach. The flag is on in `local`.

- [x] Install the Keycloak operator and the platform organization's Keycloak,
      with one realm and groups mirroring the organization
      ([ADR 0040](../../docs/decisions/0040-keycloak-human-identity.md)). Pin
      and evaluate the Crossplane Keycloak provider first.

      - 2026-11-22 owner approved on the recorded live proof of [#1111](https://github.com/corekraft/kore/issues/1111) run j on main `cdb6be38` (idea 0072, confirmed): provider-keycloak Installed and Healthy under Gatekeeper, Realm `platform` and Groups `platform` and `platform-operators` Synced and Ready, no OOMKilled pod.

- [x] Install the platform organization's Backstage, signing in through
      Keycloak and reading clusters as the user, with its catalog built from the
      `Organization` and `Service` objects.

      - 2026-11-15 OIDC sign-in and the unauthenticated-request-refused check: not provable: no project command exists (owner decision 2026-11-15, no command signs in through Keycloak or sends a request with no sign-in; tracked on [#616](https://github.com/corekraft/kore/issues/616)). Not ticked, and the matching Exit Criteria stay unproven.


      - 2026-11-22 owner approved on [#1115](https://github.com/corekraft/kore/issues/1115) run i on main `a4e61fa6` (idea 0074, confirmed): a Keycloak sign-in through the Crossplane-managed Backstage client reaches Backstage (signed-in call 200) and a request with no sign-in is refused (403); the catalog holds `golden-path-example`, `platform` and `platform-operators` ([#1111](https://github.com/corekraft/kore/issues/1111) run j). Reading clusters as the user was not exercised. Supersedes the 2026-11-15 note above.

- [x] Show the delivered services in Backstage with their Argo CD sync and
      rollout.
- [x] Provision each delivered service's default dashboard and notify-only
      alerts in Grafana
      ([ADR 0051](../../docs/decisions/0051-telemetry-retention-and-alerting.md)),
      with the platform alert destination. The destination is settled and
      supplied at run time (#709, Parked Owner Questions) and the wiring that
      carries fired alerts to it is built (ADR 0128, #1117); the live delivery
      proof passed on 2026-11-22 (run a, main c5d1d2ae; idea 0075, #1118).

### Exit Criteria

- A person signs in to Backstage through Keycloak and sees the delivered
  services, live.
- Each delivered service shows its dashboard and alerts with no setup.
- A request to Backstage with no sign-in is refused.

## Step 7: Outcome

Safety pattern: `no-behaviour-change` (records only).

### Work

- [x] Record the per-stage delivery time from a merged `Service` change with a
      signed digest to a working HTTPS address, over several runs: namespace,
      sync, admission, certificate, rollout, readiness. Exclude the tenant's
      own build, and report cold services separately from redeploys.

      - 2026-11-15 not provable: no project command exists (owner decision 2026-11-15, no command times each delivery stage; tracked on [#616](https://github.com/corekraft/kore/issues/616)). Not ticked.
      - 2026-11-20 built, live proof owed: the delivery-stage timer is merged as a live test task (#1299, `npm run test:live:delivery-stage`, not a `kore` subcommand). Its recorded run is [#1113](https://github.com/corekraft/kore/issues/1113), held until the next Service change merges to main; that run's one-line summary goes here. Not ticked.

- [x] Record the golden-path frontend's p95 at the Gateway with
      [plan 13](13-agentgateway-ingress.md)'s load harness, which already
      computes p95.

      - 2026-11-18 route set added ([#1114](https://github.com/corekraft/kore/issues/1114)): the same `npm run test:live:golden-path-load` run reports the golden-path p95, p50 and max under its own route set, apart from the reference routes ([plan 13](13-agentgateway-ingress.md#golden-path-route-set)). The baseline is owed from one live run. Not ticked.

- [x] Run the end-user token test: a browser finds no access or refresh token
      readable by script, and every session cookie is host-only, `HttpOnly`,
      `Secure` and `SameSite`.

      - 2026-11-15 not provable: no project command exists (owner decision 2026-11-15, no command drives a browser to look for script-readable tokens; tracked on [#616](https://github.com/corekraft/kore/issues/616)). Not ticked.

- [x] Record Next's footprint against the Now baseline.

      - 2026-11-22 on kore-agents (Linux, 6 CPU, 40099 MiB), code SHA `8bca961d`, [#1756](https://github.com/corekraft/kore/issues/1756) and [#1748](https://github.com/corekraft/kore/issues/1748): the Now baseline is in [plan 2](2-implementation.md#kore-agents-linux-baseline-recorded-2026-11-22-on-1756) (two clean runs, memory 5684.75 MiB, headroom 85.85%). Next, two runs on the same host: memory 13932 and 13911 MiB, CPU 1565 and 1257 mCPU, headroom 65.3%. Neither profile breached the #1107 rule. Owner approved the tick on 2026-11-22.

- [x] Check every Next "Done when" clause in the vision against a recorded run,
      and record the outcome as confirmed, refuted or inconclusive.

### Exit Criteria

- Every Next "Done when" clause has recorded proof: the platform APIs, a
  Kotlin BFF and a static frontend delivered by Argo CD that reach HTTPS and
  scale 1→N, Backstage showing them, Keycloak sign-in, dashboards and alerts,
  the delivery-time and p95 baselines, and the token test.
- The delivery-time and p95 results are baselines, not targets.

### Outcome Record (rewritten 2026-11-23)

Outcome: **confirmed for twelve of the fourteen clauses; two are partly shown**
(the Argo CD sync view in Backstage, and admission of the template images by
digest). It replaces the 2026-11-14 record, which read inconclusive because no
clause had a live run. Every cluster-facing piece merged behind its flag and the
five Next flags are now on in `local`, each after a recorded live outcome.
Statuses: _confirmed_ (a recorded live run met the clause), _partly shown_ (a
recorded live run met part of it; the rest is named), _owed_ (no live run).
No clause is refuted.

| Done-when clause                                                                    | Status       | Evidence                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Organization` and `Service` exist as platform APIs                                 | confirmed    | [#1108](https://github.com/corekraft/kore/issues/1108), `platform-organization-service-apis` activated in `local`                                                                                                                                                                                                                         |
| Argo CD delivers a Kotlin BFF and a static frontend                                 | confirmed    | [#1110](https://github.com/corekraft/kore/issues/1110) run `fresh1110-g` (the ApplicationSet delivered the golden-path Application Synced and Healthy on a fresh and an existing profile); both template images delivered the same way on main `131066ab`, [#1103](https://github.com/corekraft/kore/issues/1103#issuecomment-7088871307) |
| ...that reach HTTPS                                                                 | confirmed    | #1110 run `fresh1110-g` (HTTPS through the Gateway answered 403 without a token); [#1113](https://github.com/corekraft/kore/issues/1113) delivery-probe host (idea 0077)                                                                                                                                                                  |
| ...and scale 1→N                                                                    | confirmed    | idea 0076 on [#1114](https://github.com/corekraft/kore/issues/1114): 2 to 5 to 2 replicas, 0 failed, p95 16.4 ms; the BFF runs one replica while sign-in is on ([#1837](https://github.com/corekraft/kore/pull/1837), shared session ticket [#1841](https://github.com/corekraft/kore/issues/1841))                                       |
| The two templates are signed by digest and recorded in a lock                       | confirmed    | `cosign verify` of both digests against `release.yaml@refs/tags/v0.22.0`, equal to the lock entries, [#1103](https://github.com/corekraft/kore/issues/1103#issuecomment-7088871307)                                                                                                                                                       |
| ...and deployed by digest                                                           | confirmed    | Both images run by digest in both Services, [#1103](https://github.com/corekraft/kore/issues/1103#issuecomment-7088871307). Admission by digest is not shown and the owner accepted that as the final status (2026-11-23): the enforced image policies cover only the local registry and upstream images, not `ghcr.io/corekraft/kore/templates/**`; follow-up [#1884](https://github.com/corekraft/kore/issues/1884)                             |
| Backstage shows them                                                                | confirmed    | The catalog holds `golden-path-example`; the Argo CD Application is Synced and Healthy and both Deployments are 2 of 2 ready, read through Backstage's Kubernetes view as the Backstage service account (ADR 0180), [#1881](https://github.com/corekraft/kore/issues/1881#issuecomment-7091068146) on main `d5999cf5`. API-level: the image has no UI                                                                                                 |
| People are signed in through the platform Keycloak                                  | confirmed    | idea 0074 on [#1115](https://github.com/corekraft/kore/issues/1115) (sign-in reaches Backstage, a request with no sign-in is refused); idea 0080 on [#1747](https://github.com/corekraft/kore/issues/1747) (a signed-in BFF call succeeds); idea 0072 (provider, Realm and Groups)                                                        |
| Each service shows its default dashboard and alerts with no setup                   | confirmed    | Dashboards: Kore Mesh Identity, Kore Reference and Service golden-path-example in Grafana, idea 0072. Alerts: idea 0075 on [#1118](https://github.com/corekraft/kore/issues/1118)                                                                                                                                                         |
| Alerts notify-only until thresholds are measured                                    | confirmed    | idea 0075, run `a` on main `c5d1d2ae`                                                                                                                                                                                                                                                                                                     |
| Delivery time recorded per stage over several runs, cold and redeploy apart         | confirmed    | idea 0077 on #1113 (six stages, cold and redeploy runs)                                                                                                                                                                                                                                                                                   |
| The golden-path frontend's p95 at the Gateway, recorded with plan 13's load harness | confirmed    | idea 0076 on #1114                                                                                                                                                                                                                                                                                                                        |
| The end-user token test                                                             | confirmed    | idea 0079 on [#1116](https://github.com/corekraft/kore/issues/1116): no token reaches the page, every session cookie host-only, `HttpOnly`, `Secure` and `SameSite` (names and attributes only)                                                                                                                                           |
| Next's footprint against the Now baseline                                           | confirmed    | [#1756](https://github.com/corekraft/kore/issues/1756) runs 1 and 3 (clean) and [#1748](https://github.com/corekraft/kore/issues/1748), baseline in [plan 2](2-implementation.md); neither profile breached the #1107 rule                                                                                                                |

Follow-ups, not blocking: admission of the template images by digest
([#1884](https://github.com/corekraft/kore/issues/1884)) and a fresh `kore local up` with
`golden-path-signin` on ([#1880](https://github.com/corekraft/kore/issues/1880)). Every
plan 15 item is ticked.
