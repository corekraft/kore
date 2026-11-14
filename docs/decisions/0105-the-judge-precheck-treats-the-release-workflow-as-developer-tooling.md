---
status: accepted
summary: The release workflow .github/workflows/release.yaml only ships the code, so a diff that edits it alone matches no-behaviour-change; other workflows and similarly named files stay product; this refines ADR 0099.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0105: The judge precheck treats the release workflow as developer tooling

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: [ADR 0099](0099-the-judge-precheck-treats-developer-tooling-as-no-behaviour-change.md)

## Context

ADR 0099 lists the developer tooling the precheck leaves out of the behavioural
paths, and says everything else is product, including `release.yaml`. The
release workflow tags a release with release-please and signs the reference
image with keyless Cosign. The owner decided that it is what ships the code, not
what a user or cluster runs, so it belongs with the other workflows ADR 0099
already lists. Without this ADR the precheck reads any change to it as product,
so a tooling-only change could never pass with its truthful declaration. The
release gate of [plan 14](../../infra/plans/14-test-tiers.md) (#404) is the work
that surfaced it.

## Decision

- `.github/workflows/release.yaml` is developer tooling. The precheck matches
  that one path, anchored, and nothing broader.
- No other workflow changes status. `deploy.yml`, `release.yml` and any other
  workflow file stay product until an ADR lists them. The same holds for
  `infra/release.yaml` and any file that only shares the name.

## Consequences

- A diff that edits `release.yaml` alone matches `no-behaviour-change` with its
  truthful declaration, and the judge no longer has to read it as product.
- The precheck no longer flags a change to what the release workflow signs or
  publishes, such as the signing identity that cluster image trust relies on
  ([ADR 0028](0028-image-trust-authority.md)).
  The judge's reading of the diff is the only backstop for that.
- Any other workflow that ships code still counts as product until an ADR adds
  it by name.
