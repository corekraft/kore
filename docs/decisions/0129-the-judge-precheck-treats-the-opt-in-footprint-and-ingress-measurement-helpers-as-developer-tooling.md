---
status: proposed
summary: Six named measurement helpers under tools/kore/src/platform, imported only by specs or by each other, count as developer tooling in the precheck; the judge still reads the diff.
date: 2026-11-18
last-verified: 2026-11-18
---

# ADR 0129: The judge precheck treats the opt-in footprint and ingress measurement helpers as developer tooling

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 5](../../infra/plans/11-agent-delivery-loop.md#step-5-judge-and-merge)

Refines: [ADR 0099](0099-the-judge-precheck-treats-developer-tooling-as-no-behaviour-change.md)

## Context

[ADR 0099](0099-the-judge-precheck-treats-developer-tooling-as-no-behaviour-change.md)
accepts a file under `tools/kore/src` as tooling only by name: `src/testing/`,
`*.fixtures.ts`, `*-fixtures.ts`, `*-support.ts` and `*.live.ts`. The opt-in
footprint and ingress measurement helpers sit beside production code in
`tools/kore/src/platform` and match none of those names. A change that touches
only them and their specs (PRs #1271 for #1107 and #1272 for #1112) declared
`no-behaviour-change`, which is true, and the precheck rejected it as
behavioural. No other declared pattern fits.

The owner chose to amend narrowly on 2026-11-18: add the named files to the
list and record it here.

## Decision

The precheck counts these six files as developer tooling, by exact path:

- `tools/kore/src/platform/footprint-measurement.ts`
- `tools/kore/src/platform/footprint-parse.ts`
- `tools/kore/src/platform/footprint-verdict.ts`
- `tools/kore/src/platform/ingress-host-parse.ts`
- `tools/kore/src/platform/ingress-host.ts`
- `tools/kore/src/platform/ingress-rated-measurement.ts`

Every one is imported only by a spec (a live spec, `*.live.spec.ts`, or a unit
spec) or by another file on this list; no production file imports one. The check, run on the heads of PRs #1271 and
#1272 (`footprint-measurement.ts`, `footprint-parse.ts` and
`ingress-rated-measurement.ts` are already on `main`; `footprint-verdict.ts`,
`ingress-host.ts` and `ingress-host-parse.ts` are new in those PRs): list each PR's changed files with
`gh pr diff --name-only`, then `git grep` the tree for every import of each
non-spec file, by its `./<name>.js` specifier. The results:

- `footprint-measurement.ts`: `footprint-measurement.live.spec.ts` and
  `footprint-measurement.spec.ts`.
- `footprint-parse.ts`: `footprint-parse.spec.ts`, `footprint-measurement.spec.ts`,
  `footprint-measurement.ts`, `ingress-host.spec.ts` and `ingress-host.ts`
  (the last two are new in #1272).
- `footprint-verdict.ts`: `footprint-verdict.spec.ts`,
  `footprint-measurement.spec.ts` and `footprint-measurement.ts`.
- `ingress-host-parse.ts`: `ingress-host-parse.spec.ts`, `ingress-host.spec.ts`
  and `ingress-host.ts`.
- `ingress-host.ts`: `ingress-host.spec.ts`, `ingress-measurement.live.spec.ts`,
  `ingress-rated-measurement.spec.ts` and `ingress-rated-measurement.ts`.
- `ingress-rated-measurement.ts`: `ingress-measurement.live.spec.ts` and
  `ingress-rated-measurement.spec.ts`.

The only other mention is the `test:live:footprint` script in
`tools/kore/package.json`, which names the compiled live spec, not a helper.

No generic suffix matches: not `-parse.ts`, `-verdict.ts` or `-measurement.ts`.
A neighbouring production file such as `footprint-summary.ts`,
`ingress-measurement.ts` or `ingress-metrics.ts` stays product, and so does a
file with a listed name in another directory. The judge keeps reading the diff
as the backstop. No other precheck rule changes.

## Consequences

- A change to only these helpers and their specs can declare
  `no-behaviour-change` truthfully and pass the precheck.
- The list is closed. A later measurement helper is product until a new
  decision adds it, with its own import check.
- If production code later imports one of these files, it is no longer tooling.
  The precheck does not read imports; the judge's reading of the diff and a
  review of this list are the backstop.
- The status is `proposed` until the owner accepts it.
