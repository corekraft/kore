---
status: proposed
summary: Four more named files under tools/kore/src/platform, imported only by specs, the test-support barrel or each other, count as developer tooling; the list stays closed and the judge still reads the diff.
date: 2026-11-18
last-verified: 2026-11-18
---

# ADR 0130: The judge precheck also counts the golden-path load helpers and the ingress measurement as developer tooling

Source: [`infra/plans/13-agentgateway-ingress.md` § Golden-Path Route Set](../../infra/plans/13-agentgateway-ingress.md#golden-path-route-set)

Refines: [ADR 0129](0129-the-judge-precheck-treats-the-opt-in-footprint-and-ingress-measurement-helpers-as-developer-tooling.md)

## Context

[ADR 0129](0129-the-judge-precheck-treats-the-opt-in-footprint-and-ingress-measurement-helpers-as-developer-tooling.md)
closed a list of six measurement helpers that count as developer tooling and
left `ingress-measurement.ts` product. #1114 extends that harness with a
golden-path route set and a scale check. The change has to edit
`ingress-measurement.ts` (a route set option, and the shared load code moved out
of it) and adds three files beside it. It is test tooling only and declares
`no-behaviour-change`, which is true, but the precheck would read all four as
product.

## Decision

The precheck counts four more files as developer tooling, by exact path, in
`tools/kore/src/platform`:

- `ingress-measurement.ts`
- `route-load.ts`
- `golden-path-routes.ts`
- `golden-path-scale-check.ts`

The import check, a `git grep` of the tree for each file's specifier:

- `ingress-measurement.ts`: `ingress-latency.spec.ts`,
  `ingress-measurement.fixtures.ts`, `ingress-measurement.live.spec.ts`,
  `ingress-measurement.spec.ts`, `ingress-rated-measurement.spec.ts`,
  `ingress-rated-measurement.ts` (already on the list), and the test-support
  barrel `src/testing/index.ts` with its spec.
- `route-load.ts`: its spec, `ingress-measurement.ts` and
  `golden-path-scale-check.ts`.
- `golden-path-routes.ts`: its spec, `golden-path-scale-check.ts` and
  `golden-path-load.live.spec.ts`.
- `golden-path-scale-check.ts`: its spec and `golden-path-load.live.spec.ts`.

No production file imports any of them; `src/testing/` is test support under
ADR 0099. The new script is `test:live:golden-path-load`, which `nightly.sh` excludes
like `test:live:footprint`, so the night never runs it. The list stays closed, no generic
suffix matches, and the judge keeps reading the diff as the backstop.

## Consequences

- A change to only these helpers and their specs can declare
  `no-behaviour-change` and pass the precheck.
- If production code later imports one of them it is no longer tooling. The
  precheck does not read imports; the judge's reading of the diff and a review
  of this list are the backstop.
- Proposed: the owner has not confirmed the four additions.
