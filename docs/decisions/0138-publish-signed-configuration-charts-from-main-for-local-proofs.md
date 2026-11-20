---
status: proposed
summary: A charts-main job publishes the platform charts signed with the release.yaml main identity and keeps the main chart lock as a 30-day artifact that feeds local proofs only, while flag activation still needs the release chart lock with equal chart digests.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0138: Publish signed configuration charts from main for local proofs

Source: [`infra/plans/15-next-horizon.md` § Step 1](../../infra/plans/15-next-horizon.md#step-1-accept-the-next-adrs), under [GitHub issue #1356](https://github.com/corekraft/kore/issues/1356) (ticket #1368).

Refines: [ADR 0043](0043-platform-configuration-through-argo-cd.md) (a main chart lock may feed a local proof), [ADR 0044](0044-managed-platform-images-from-the-mirror.md) (where the lock comes from, and how long it is kept), [ADR 0028](0028-image-trust-authority.md) (a second signing identity, local only, and a per-job gate), [ADR 0077](0077-live-proof-gates-activation-not-merge.md) (only the release chart lock counts for activation, with digests compared).

## Context

A live proof of a chart change needs a published, signed chart. Today only a
tag-ref `release.yaml` run publishes the platform charts, so a chart fix
reaches a local proof only after a release. The chart path of a release costs
about 2.4 minutes (charts 2.3, attach-chart-lock 0.1), but the whole tag run
took 18, 14 and 5 minutes for v0.10.0, v0.9.0 and v0.10.1. Publishing from
`main` would save about 15.6, 11.6 and 2.6 minutes of those runs (87%, 83% and
52%). Main pushes already run a 2 to 3 minute gate. The owner-merge wait and the
time from a fix merge to a proof start are not measured yet; #1369 records
that baseline.

Two facts shape the decision:

- **No kore code verifies a chart signature at run time.** The cosign steps in
  the release job are the only check. `chart-delivery.ts` checks the digest
  pattern, the OCI path and the image-policy exclusion; each Argo CD
  Application pins a digest. A second signer therefore weakens nothing that is
  enforced at run time today. It does weaken the stated reason in ADR 0028
  that accepting `refs/heads/main` would weaken the exact-tag guarantee.
- **Digest equality between a main run and a release holds by reuse, not by
  reproducible builds.** The release job skips the push when the chart version
  already exists, so a tag run reuses the digest a main run pushed. Nothing
  normalises timestamps. The proof outcome today records no chart version or
  digest.

## Decision

- **A separate `charts-main` job publishes from `main`.** It packages the same
  charts with the same script and pushes each content-addressed version only
  when it does not exist. The tag-only `charts` job stays as it is. `charts-main`
  has no `needs`, so it runs on every push to `main`.
- **A second signing identity, local only.** `charts-main` signs with the
  `release.yaml@refs/heads/main` identity. Kore trusts it for a local proof and
  nowhere else. A kore chart-signature check must exist before any managed
  environment reads a main chart lock; until then managed environments stay
  tag-only by convention, not by enforcement.
- **The signer guard gate becomes per job.** The guard admits `id-token` and
  `packages` for a named job only with that job's own ref gate: the tag gate
  for `release`, `mirror` and `charts`, the `main` gate for `charts-main`. A
  main-gated `charts-main` is accepted; `charts-main` without its gate and an
  ungated main job under any other name are refused. The edit changes an
  existing guard and adds none; the owner reviews that PR (#1370).
- **The main chart lock is a workflow artifact.** It is named by commit sha,
  kept for 30 days, and never attached to a release. A bot-committed lock stays
  rejected (ADR 0044). The release chart lock is the one attached to the
  release.
- **Publishes are serialised per commit.** Both `charts` and `charts-main`
  join the concurrency group `charts-${{ github.sha }}` with
  `cancel-in-progress: false`, so a main run and a tag run on the same commit
  cannot both miss the version and both push. A shared group is not used: a
  pending run replaces an older pending one, so a tag run could be dropped.
- **A local proof may pass a main chart lock.** `--platform-chart-lock` already
  accepts any lock path, and `--require-fresh-lock` stays the gate: it compares
  versions, so a main lock with equal versions passes and a stale one is
  refused before any cluster work.
- **A main-lock proof counts for activation only by digest.** `harness flag
activate` still needs the release chart lock. The proof outcome records the
  chart versions and digests, and activation compares them with the release
  lock. Equal digests count; any difference means re-prove (#1373). The loop
  gets faster, but a flag-on PR still follows a release.
- **No new flag, no pruning, no new retention policy.** No kore code checks
  chart signers, so a flag for accepting a second signer would gate nothing.
  The change declares `no-behaviour-change` under ADR 0105. Storage grows with
  chart content changes, not with commits, because a main push that changes no
  chart pushes nothing. Nothing is pruned until the owner sets a storage figure.

### Alternatives recorded

- **Push to the in-cluster registry with a temporary lock.** It works offline
  and iterates fast. It is not chosen: it adds a second publisher to the
  registry that is also the application registry (one owner per resource);
  Argo CD reaching the in-cluster registry is unproven (ADR 0043 lists it as
  needing a live run); and its proof covers a chart no release will contain
  byte for byte, so it could never count for activation.
- **The lock in an OCI registry (GHCR).** Not chosen. It is a watch item.
- **A bot-committed lock.** Already rejected in ADR 0044, and still rejected.
- **Add `main` to the `charts` job's gate.** Rejected: the guard's gate check
  is a substring match, so `tag || main` on `charts` would pass and defeat its
  intent.

### Watch items

Each has a trigger and no ticket:

- Kore verifies chart signatures when it loads a lock. Trigger: a managed
  environment reads a main lock, or the owner accepts the second identity.
- Push to the in-cluster registry. Trigger: main-publish minutes or registry
  cost prove too high.
- The lock in GHCR. Trigger: a proof run cannot find a lock through expiry or
  missing `gh` authentication.
- GHCR storage and pruning. Trigger: the owner sets a figure, such as 1 GB or
  500 versions. Pruning then keeps every version named in a release lock, in a
  recorded proof outcome, or in the newest N main locks.

### Not verified

Argo CD's own OCI signature verification; whether Helm normalises timestamps;
GHCR retention and storage limits; whether `workflow_ref` can supply the main
identity; GitHub's pending-run cancellation; the artifact retention default.

## Consequences

- A chart fix reaches a local proof in about 2.4 minutes of chart work plus the
  2 to 3 minute gate, instead of a 5 to 18 minute release run. The owner-wait
  baseline (#1369) is measured before the owner accepts this ADR.
- `charts-main` holds `id-token` and `packages: write` on every push to
  `main`, behind pull request review.
- The publish race between a main run and a tag run on one commit is closed by
  the concurrency group.
- Activation still waits for a release; the proof record gains versions and
  digests, and activation gains a comparison.
- Storage grows with chart content changes and is not pruned yet.
- This ADR stays `proposed`. The owner accepts it after the baseline is
  recorded; the follow-up tickets #1370 to #1373 are filed under #1356, and
  the four ADRs above gain a refinement note when it is accepted.
