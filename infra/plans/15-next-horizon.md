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

Next: Plan 15: Step 7 item 4 ticked (footprint, #1756 run 3 clean, #1866 merged); #1113, #1116, #1747 proven. Still unticked, each needs a recorded green live run then the owner's approval, one at a time: Step 4 item 4 (both images signed and admitted by digest), Step 5 items 1, 3, 4 (Argo CD, ApplicationSet, HTTPS; flag platform-argocd-delivery), Step 6 items 1-3 (Keycloak, Backstage sign-in and catalog, sync view; flag platform-portal), Step 7 items 1-2 may already be ticked (check). Then rewrite the Step 7 Outcome Record per clause, close #1101, #1103, #1104, #616 through their sub-issues, and #1216 and #1354 housekeeping. Start by asking the owner which clean live run to cite for Step 4 item 4. The cluster kore-local is stopped; no worktree of mine is open; the live-v022 overlay edit is gone.

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
- [ ] Sign both images through release automation and deploy them by digest.

### Exit Criteria

- Both images are signed and admitted by digest on a live run.
- The cookie assertion runs in the unit suite.

## Step 5: Platform Argo CD Delivery from Git

Safety pattern: `feature-flagged` (`platform-argocd-delivery`, off in `local`). With the
flag off, Helm stays the only owner of every release, so no resource has two
owners.

### Work

- [ ] Install the platform organization's Argo CD in the core phase, and hand
      the configuration-phase releases except the image policy to it as Helm
      charts from the platform OCI registry
      ([ADR 0043](../../docs/decisions/0043-platform-configuration-through-argo-cd.md)).
- [x] Gate application admission on its health, failing closed and naming the
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

- [ ] Install the Keycloak operator and the platform organization's Keycloak,
      with one realm and groups mirroring the organization
      ([ADR 0040](../../docs/decisions/0040-keycloak-human-identity.md)). Pin
      and evaluate the Crossplane Keycloak provider first.
- [ ] Install the platform organization's Backstage, signing in through
      Keycloak and reading clusters as the user, with its catalog built from the
      `Organization` and `Service` objects.

      - 2026-11-15 OIDC sign-in and the unauthenticated-request-refused check: not provable: no project command exists (owner decision 2026-11-15, no command signs in through Keycloak or sends a request with no sign-in; tracked on [#616](https://github.com/corekraft/kore/issues/616)). Not ticked, and the matching Exit Criteria stay unproven.

- [ ] Show the delivered services in Backstage with their Argo CD sync and
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

### Outcome Record (2026-11-14)

Outcome: **inconclusive**. Every cluster-facing piece merged behind its flag,
and every flag is still off. No clause below has recorded live proof, so none
is confirmed and none is refuted. Nothing here claims a live run. Statuses:
_met_ (merged, nothing owed), _merged, live proof owed_ (merged behind its
flag), _not provable_ (no project command exists), _not delivered_ (code still open).

| Done-when clause                                                                    | Status                  | Merged                                                         | What is owed                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Organization` and `Service` exist as platform APIs                                 | merged, live proof owed | #664, #668, #670, #673                                         | A live run on a throwaway profile with `platform-organization-service-apis` on; the flag stays off until then.                                                                                                                                             |
| Argo CD delivers a Kotlin BFF and a static frontend                                 | merged, live proof owed | #677, #679, #681, #683, #685, #686, #687, #700                 | A `platform-argocd-delivery` live run on a fresh and an existing profile; the flag stays off until it is activated after a recorded outcome. #700 merged the registrations directory and passes the lock from `kore local up` into the delivery values.    |
| ...that reach HTTPS                                                                 | merged, live proof owed | #682, #700                                                     | A live run per host. #700 passes `platformDomain` and `gatewayClassName` into the golden-path values; HTTPS stays behind the flag and is unproven (Step 5 items 1, 3 and 4 stay open until that run).                                                      |
| ...and scale 1→N                                                                    | not provable            | #665, #671                                                     | Not provable, no project command exists (owner decision 2026-11-15): the BFF 1→N load proof (Step 3 item 3); other `autoscaling-defaults` proofs remain.                                                                                                   |
| The two templates are signed by digest and recorded in a lock                       | merged, live proof owed | #666, #669, #672, #675, #680, #684                             | A live run that checks both signatures and the lock.                                                                                                                                                                                                       |
| ...and deployed by digest                                                           | merged, live proof owed | #700                                                           | A live run that admits both images by digest (Step 4 item 4). The lock wiring is merged behind `platform-argocd-delivery`, off in every overlay.                                                                                                           |
| Backstage shows them                                                                | merged, live proof owed | #694, #695, #698, #701 (install, image, catalog, Argo CD view) | A `platform-portal` live run that shows the delivered services with their Argo CD Application and workload (Step 6 item 3 stays open until then); the install itself is also unproven live. The route exists in the `platform-backstage` chart.            |
| People are signed in through the platform Keycloak                                  | merged, live proof owed | #688, #690, #691, #693, #694, #698                             | The Keycloak provider pod privileges run on a `platform-portal` live run. The in-app OIDC sign-in and the refused no-sign-in request are not provable, no project command exists (owner decision 2026-11-15).                                              |
| Each service shows its default dashboard and alerts with no setup                   | merged, live proof owed | #692                                                           | A live run that shows both for a delivered service.                                                                                                                                                                                                        |
| Alerts notify-only until thresholds are measured                                    | proven live, 2026-11-22 | #692, #709                                                     | The contact point mechanism exists, the destination is supplied at run time (Parked Owner Questions) and the wiring that carries fired alerts to it is built (ADR 0128, #1117). Run a passed on main c5d1d2ae (idea 0075, #1118); Step 6 item 4 is ticked. |
| Delivery time recorded per stage over several runs, cold and redeploy apart         | not provable            |                                                                | Not provable, no project command exists (owner decision 2026-11-15); Step 7 item 1.                                                                                                                                                                        |
| The golden-path frontend's p95 at the Gateway, recorded with plan 13's load harness | not delivered           |                                                                | Step 7 item 2: the harness already computes p95; record the golden-path frontend's p95 with it.                                                                                                                                                            |
| The end-user token test (clause names token and cookie settings)                    | not provable            | #672 (the unit-level cookie assertion)                         | Not provable, no project command exists (owner decision 2026-11-15): the browser run (Step 7 item 3).                                                                                                                                                      |
| Next's footprint against the Now baseline                                           | not delivered           |                                                                | At least two clean runs on an idle host (#623) against the Now baseline recorded in plan 2; the breach rule is decided (2026-11-17, #1107).                                                                                                                |

Not covered by a clause but still owed: Step 6 item 1 stays open until the
Keycloak provider pod privileges are verified live (#693).
