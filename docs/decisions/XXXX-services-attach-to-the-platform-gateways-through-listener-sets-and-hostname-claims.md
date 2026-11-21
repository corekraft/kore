---
status: proposed
summary: A service attaches to the platform Gateways through a ListenerSet and a route in its own suborg namespace, rendered from its record; hostnames are claimed in the record, first merged wins and exclusive, checked by validation and the judge, by the Gateway's own listener match and conflict rule, and by a Gatekeeper constraint that reads claims from the Service object, with a reserved-name file the owner reviews.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: Services attach to the platform Gateways through ListenerSets and hostname claims

Source: [issue #1482](https://github.com/corekraft/kore/issues/1482), under the platform v1 interview record [#1478](https://github.com/corekraft/kore/issues/1478) (decision 9, decision 13 and the naming section).

Refines: [ADR 0133](0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md) (charts own routes only), [ADR 0134](0134-the-shared-gateway-admits-routes-only-from-platform-labelled-namespaces.md) (the namespace label), [ADR 0042](0042-organization-domains-by-delegation.md) (one owner per hostname, inside the organization's zone).

## Context

The record says hostnames are claimed by applications and the platform serves them, with no human approval: the first claim wins, a claim is exclusive, and some names are reserved. The golden-path chart renders, per service, its own Gateway, Certificate and route in the service namespace, and a host outside the domain keeps that Gateway. On vps a per-service Gateway is a second proxy with no address.

The only enforcement today is the `platform-hostname-ownership` Gatekeeper constraint: `dryrun`, `HTTPRoute` only, a duplicate check that reads the Gatekeeper cache (two routes applied at once can both pass), and a rule that every host sits inside the owning organization's zone, which refuses the record's `login.example.com`. Gatekeeper's webhook defaults to `failurePolicy: Ignore`, and the repository does not change it, so a Gatekeeper outage admits everything.

Gateway API 1.7.0, which the platform pins, has `ListenerSet` in its standard channel and `kore-gateway-api` already installs the CRD. agentgateway v1.7.0 implements it: when two listeners claim one hostname the older wins and the later is rejected, and a Gateway admits ListenerSets only from the namespaces its `allowedListeners` names.

## Decision

- **A ListenerSet replaces the per-service Gateway.** The workload chart renders, per service, one `HTTPRoute`, and per claimed external name one ListenerSet listener and one Certificate, all in the suborg namespace. The Organization composition renders the suborg's internal wildcard ListenerSet and wildcard Certificate. Each Gateway's `allowedListeners` admits only namespaces carrying `platform.kore.dev/shared-gateway`, and a ListenerSet listener admits routes from its own namespace only. Platform names (registry, databases, telemetry, portal, Keycloak, Argo CD) stay listeners on the Gateway objects, because bootstrap needs them before Crossplane exists. The external Gateway has no wildcard listener: a route can attach only to a name its record opted into.
- **ADR 0133 changes.** Charts own routes and the ListenerSets for their own names; the platform owns the Gateway objects and the platform names.
- **Route attachment.** One `HTTPRoute` per service, with the internal Gateway as parent, and the external Gateway too when the record says `gateway: external`. A route attaches only where a listener's hostname matches one of its own, so it needs no per-Gateway copy.
- **Names.** Every service always has its internal name `<service>.<suborg>.<internalDomain>`. The default public name `<service>.<suborg>.<domain>` exists only for `gateway: external` and only when the record lists no hostnames; a `hostnames` list replaces the default public name, never the internal one, and may hold several names.
- **A claim is a name in `hostnames`.** The list holds lowercase FQDNs. A name inside the claimant's own suborg zone needs no claim. A name directly under the platform domain (`login.example.com`) is a claim: the first merged wins and holds it exclusively. Refused: wildcards, the apex, IP literals, punycode in v1, a label equal to an existing or reserved suborg name, and, in the other direction, a new suborg named like a held claim. A name inside another suborg's zone is refused. A suborg flagged sandbox may not claim outside its own zone. Deleting a record or tearing down a suborg frees its claims at once. Names under another domain are decided in ADR XXXX (names under another domain).
- **Reserved names** live in one schema-checked data file the owner reviews: `internal`, `www`, `mail`, `smtp`, `imap`, `autodiscover`, `ns1`, `ns2`, `acme`, `platform`, `kore`, and every name the app-model decision reserves for suborgs. `kore validate` and the cluster read the same file.
- **Layers, with the fail-closed ones first.** (1) `kore validate` and the judge precheck read every record in every suborg and refuse a duplicate, reserved or malformed claim; the check runs against the merge result at merge time, a pull request that touches `hostnames` must be up to date with main, and merge order on main is the claim order. (2) The Gateway's listener match: no external listener exists for a name no record opted in. (3) The data plane's older-listener-wins rule rejects a later listener for a held name. (4) The Gatekeeper constraint is the cluster-side detector and backstop.
- **What Gatekeeper reads.** Claims come from the Service object's `spec.hostnames`, synced by `kore-policy-sync` as the Organization's zone is today; reserved names come from one synced ConfigMap built from the file above. The constraint checks that every hostname on every hostname-carrying kind (`HTTPRoute`, `TLSRoute`, `GRPCRoute`, `ListenerSet`, a Certificate's `dnsNames`) in a suborg namespace is inside the suborg's two zones or listed by a Service of the same suborg, and not listed by a Service of another suborg. The owner granularity is the suborg, not the service, because the suborg is the trust boundary (the app-model decision: siblings can read each other's Secrets). It starts in `dryrun` and is promoted by ADR 0072.
- **Dark rollout.** One flag, `service-listener-sets`, false in every overlay, needs `platform-shared-gateway`; `platform-hostname-ownership` needs it too, and still needs `platform-organization-service-apis`. With it off the chart renders today's per-service Gateway path. The contract step that deletes that branch of `ingress.yaml`, ADR 0134's reference-namespace special cases and the foreign-host fallback waits for the soak, and for one recorded live outcome of `external-gateway`.
- **Failing fast.** `kore platform status` and the readiness checks show, per hostname, the chain: claim recorded, ListenerSet accepted (not the loser of a conflict), Certificate Ready with its issuer, DNS record present and answering. They name the first broken link and its remedy; a lost conflict names the suborg that holds the name.

## Consequences

- Hostnames never need a human approval, so the reserved-name file is the one reviewed control: a pull request that edits it is a human-reviewed change.
- Admission is not the only enforcement and is not fail closed on a Gatekeeper outage: layers 1 to 3 are. Whether a Gatekeeper outage may admit a route (rather than a webhook set to fail) is an open owner question, recommended as accepted.
- A suborg that opts one service into the external Gateway still exposes only the names its records claim.
- An app that creates its own ListenerSet could squat a name by being older than the legitimate one: the suborg's Argo CD project allows only the Kore repository as a source and no app repository holds manifests, so only the platform workload chart renders a ListenerSet. The Gatekeeper constraint is the detector if that ever fails.
- ADR 0042's rule that every host sits inside the organization's own zone no longer holds for names directly under the platform domain.
- The `sandbox` attribute of a suborg is not defined by the app-model decision yet; it is a dependency on that concept.
