---
status: proposed
summary: An application's source lives in its own repository and holds no manifests; Kore holds one app record per service as two files, a human-reviewed spec file and a release file only the platform writes, in the environment overlay of the cluster that runs it, validated before any cluster is touched.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: An app is a service with a two-file record in Kore and its source in its own repository

Source: [issue #1484](https://github.com/corekraft/kore/issues/1484), under the platform v1 interview record [#1478](https://github.com/corekraft/kore/issues/1478) (decisions 11, 12, 14, 15).

Refines: [ADR 0043](0043-platform-configuration-through-argo-cd.md) and [ADR 0045](0045-static-frontends-as-signed-images.md), for services whose source is outside this repository.

## Context

Today a service is a `kind: Service` file in `infra/services/*.yaml`. Nothing applies it to a cluster; the golden-path ApplicationSet and the service-observability chart read the directory from git. It carries an organization (the XRD allows only `platform`) and a list of environments, and the workload deploys the platform's two template images, not an image built from an application's own source.

The owner decided on 2026-11-20 that applications live in their own repositories (one or many), that Kore keeps a schema-checked record per service, that the platform judges and apps never deploy past it, that the platform bumps the record so git stays desired state, and that the platform holds flag state while the application declares its flags.

## Decision

- **One owner per field.** The app record is two files. The **spec file** is `kind: Service` (`platform.kore.dev/v1alpha1`, JSON-compatible YAML), reviewed by people. The **release file** is `kind: ServiceRelease`, written only by the platform bot: the image digest of each component, the source commit, the attestation reference and the on or off state of each flag. A change that touches only a release file can merge on the judge's checks of the attestations; a spec change is an ordinary reviewed change.
- **The spec file** has the fields `organization` (the suborg, immutable), `repository`, `path`, `components` (`frontend` and `bff`, each optional, at least one, with `resources.requests`), `gateway` (`internal` by default, or `external`), `hostnames`, `allowFrom`, `backup` and `secrets` (names only). The schema rejects any other field. The shapes of `hostnames` and `backup` belong to the ingress and backup decisions; this ADR only reserves them.
- **The spec file is the existing Service kind**, extended by expand and contract: new fields first, then `environments` and the `<service>--<environment>` namespaces are dropped after the soak.
- **The cluster is the environment.** Each environment overlay holds its own records, `infra/environments/<env>/services/<service>.json` and `<service>.release.json`, so local and the vps deploy different sets and the platform bumps only the ones for the cluster it deploys to.
- **A second Argo CD Application in the platform project syncs each environment's services directory,** so the Service composition runs and derives per-service policy from the record. The workload ApplicationSet reads the spec and release files with its merge generator, keyed by service name (verify the generator against the pinned Argo CD version).
- **An app repository holds source, a build file and one declaration file** (flag names, default off, owner and safety pattern; the migrations directory; secret names). It holds no manifests or chart: the platform's workload template renders every service. One repository may hold several services, each record naming its `repository` and `path`.
- **Admission binds an image to its record.** The signature's source repository must equal the record's `repository`, so one application's workflow cannot sign an image another record deploys. This extends [ADR 0028](0028-image-trust-authority.md): only the platform workflow's identity is trusted.
- **v1 describes only the golden-path shape** ([ADR 0045](0045-static-frontends-as-signed-images.md), [ADR 0046](0046-bff-jvm-with-agent-and-aot-cache.md)). Workers, jobs and other shapes are later additive revisions.
- **Names are unique across the cluster in v1.** Loosening to per-suborg uniqueness later is an expand; tightening would not be.
- **Validation runs first.** `kore validate` checks the spec file against the Service XRD schema, read from the `platform-apis` chart and never copied, and the release file against a JSON Schema in `infra/catalog/schemas`. Cross-file rules: the suborg exists, the name is unique, every `allowFrom` grantee exists, requests fit the suborg quota, and only the release file carries digests and flag state. Nothing touches a cluster before it passes.
- **A release file reverts alone.** Rollback is a `git revert` of the record ([decision 7](https://github.com/corekraft/kore/issues/1478)), never a `helm rollback` under Argo CD. Digests and flag state sit only in the release file, so a revert of a release change never touches the spec file.
- **The platform is the only owner of flag state.** The application declares its flags and reads their state at run time; the release file holds the on or off state, and no overlay carries flag state for an application.
- **Deleting a record prunes workloads only.** It never removes a database, a retained volume, a Secret or the suborg namespace. Data removal is a separate explicit command with the second opt-in ([ADR 0003](0003-separate-claims-and-retain-data.md)).
- **The reference app stays outside the model.** It is a platform smoke app in the `reference` namespace that `kore app up` owns ([ADR 0025](0025-application-namespace-ambient-enrollment.md), [ADR 0063](0063-lifecycle-resume-and-release-only-app-up.md) unchanged).

## Consequences

- A new service or suborg needs no human approval (owner, 2026-11-20): a new suborg is a sandbox an agent can experiment in. What keeps that safe is the required quota, the checks of `kore validate`, the judge's checks like any change, and a clean teardown path (see the suborg tenancy decision).
- The two files make the judge's rule simple, but the split is this ADR's design, not part of the interview record.
- The ApplicationSet, the `service-observability` chart's service list (which also reads the `environments` list) and `service-registrations.ts` read the new per-environment paths; the old directory stays until the contract step. The existing `kore app up` path and the `golden-path-example--local` namespace migrate only on local, after a live outcome.
- The golden-path workload chart gains a Service named after the service, a ServiceAccount per service and a secret contract; each is additive.
- The release file needs a writer (the platform workflow's bump step) and an attestation check; both belong to the delivery decision.
