---
status: accepted
summary: A read-only inventory classifies every container, init and ephemeral container image running in the catalog-managed platform namespaces and checks their Policy Controller enrollment; the per-environment `imageInventory` mode (`audit` or `enforce`) decides whether findings fail bootstrap and keep the application admission gate closed.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0056: Inventory running platform images before the gate opens

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership)

Refines: [ADR 0033](0033-platform-image-mirror.md) (seed
exceptions must be empty before success) and
[ADR 0054](0054-application-admission-gate-closed-at-foundation.md) (what must
hold before the gate opens).

## Context

The image policy only judges pods admitted after it exists, so the seeds and
anything started earlier keep running unchecked. The plan requires that no
seed, external, tag-only, unsigned, or unauthorized image remains before
bootstrap succeeds. Local has no mirror and deliberately runs approved upstream
digests (ADR 0044), so a blanket failure would make `kore local up` never
converge, while managed environments must not accept them (audit before
enforce).

## Decision

`platformStatus` adds an `image-inventory` row (omitted from a filtered query,
like the gate). It runs only `kubectl get` against the configured context and
reads every non-finished pod in the catalog's platform namespaces, classifying
each container, init container and ephemeral container image as:

- `internal-digest`: under the environment's `platformMirror` or registry
  address, pinned by `@sha256`, and listed in the approved list;
- `approved-upstream-digest`: an approved, non-seed image at its upstream digest;
- `seed`: a seed exception still running;
- `tag-only`: no digest;
- `unknown`: any other digest, including an internal one that is not approved.

It also reports platform namespaces that lack `policy.sigstore.dev/include=true`,
except those in the schema-validated `environment.enrollmentExemptions` (each
with a reason): `cosign-system`, because enrolling the verifier's own namespace
deadlocks its webhook, and `kore-registry`, because the registry serves the
signatures the verifier needs, so enrolling it would make a registry restart
depend on the registry. Validation rejects an exemption for a namespace the
catalog does not manage or without a reason. The exemption covers enrollment
only; those namespaces' images are still inventoried and must be approved digests.

The optional, schema-validated `environment.imageInventory` selects the mode.
`audit` (the default, and `local`) reports findings with a `ready` row;
`enforce` (`managed-example`) makes the row `degraded` for every image that is
not `internal-digest` and every unenrolled namespace, naming each
namespace/pod/container/image. A cluster that cannot be read is `degraded` in
both modes. `openApplicationAdmission` stays the only gate opener and already
refuses on any non-ready row, so an enforce finding keeps the gate closed.
`--json` carries the full inventory; plain output prints only the summary row.

## Consequences

- Managed bootstrap succeeds only with no seed and no external image, which
  closes the "no active seed exception" criterion for managed environments.
- Local still shows its seeds and upstream digests on every `platform status`
  without failing.
- Widening the exemption is an explicit, reviewed edit to the environment file.
- Enrollment is built (see Amendment); an `enforce` environment's namespaces
  are labelled before the inventory reads them.
- `app up` ignores this row after the gate is open; the gate is the record.

## Amendment: enrollment follows the inventory mode

Enrollment is the mutation that makes the check above pass, and it follows the
same `environment.imageInventory` value, so there is one switch:

- `enforce` (`managed-example`): `kore platform up` labels every
  catalog-managed platform namespace except `enrollmentExemptions` with
  `policy.sigstore.dev/include=true`, before the inventory runs and before the
  gate decision.
- `audit` (`local`): no namespace is labelled. Local runs approved upstream
  digests that its policies would reject without a mirror, so labelling would
  deny its own pods. The check keeps reporting unenrolled namespaces.

The schema documents the rule on `imageInventory`, and validation already
rejects any other value and any exemption for a namespace the catalog does not
manage or without a reason.

**Owner.** Helm keeps creating the namespaces (`--create-namespace`, and the
`platform-config` chart for `kore-system`); neither renders the label, so Helm
never claims it. kore applies a minimal Namespace with server-side apply under
its own field manager, `kore-enrollment`, and so owns exactly that one label.
Server-side apply makes removal exact: dropping the field from a later apply
releases it. Each run reads the namespaces with their managed fields, applies
only those that differ, and re-applies without the label to any namespace that
`kore-enrollment` owns the label on but that is no longer desired, because it
left the catalog, became exempt, or the environment moved to `audit`. A label
owned by another manager (application namespaces belong to `kore-app`) is never
touched. A desired namespace that does not exist fails the run, naming it.

**Order.** `platformUp` enrolls after every phase, so Policy Controller and the
image policies are ready and its own release (and the verifier's namespace,
exempt anyway) is never verified by itself, and immediately before
`openApplicationAdmission` reads the inventory. A rerun upgrades releases in
already-enrolled namespaces, so their images must already be signed approved
digests; an unsigned image is denied there, which is the intent.

The runner never labels in audit, never labels an exemption, and issues no
change on a second run; `enrollment.spec.ts` and
`platform.enrollment-order.spec.ts` fake the runner to prove it.
