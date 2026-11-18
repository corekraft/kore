---
status: proposed
summary: A writer's idea is read from its pull request when pr open links it, and recorded on the pr.linked event under the existing idea field, with none as the explicit value; no spawn-time stamp and no read-time ticket walk are added.
date: 2026-11-17
last-verified: 2026-11-17
---

# ADR 0126: A writer's idea is read from its pull request and recorded on pr.linked

Source: spec [#1086](https://github.com/corekraft/kore/issues/1086), which specifies [#1083](https://github.com/corekraft/kore/issues/1083) (gap 1: writer cost cannot be read per idea), and ticket [#1089](https://github.com/corekraft/kore/issues/1089).

Builds on: [ADR 0125](0125-writer-cost-is-read-per-merged-change-by-the-first-launch-s-tier.md), which reads writer cost through the `pr.linked` join. Amends spec [#997](https://github.com/corekraft/kore/issues/997) and its ticket #1019, through spec #1086. The proposed ADR text in #1086 is this record.

## Context

Writer cost cannot be read per idea. A writer is spawned for a ticket, but the ledger holds no ticket for a writer session, and the writers spawned with `--no-idea` or with no stamp carry no idea at all. So the writing share of a merged change, about 117k of 283k tokens per merged change, falls outside every idea's figure.

The join from a pull request to its writer session already works: `pr open` writes a `pr.linked` event with the pull request number and the writer's session name. A pull request's `Idea:` line is the one place a writer already declares the idea its work serves, and the link does not record it. Three ways to get the idea onto the writing were on the table:

- stamp the idea when the writer is spawned;
- walk from the ticket, to its spec, to the idea, when a report runs;
- read the idea from the pull request when it is linked, and record it on the link.

## Decision

- **The idea is read from the pull request, at link time.** `pr open` records the idea it was given on the `pr.linked` event it writes, under the event's existing `idea` field, as the writer named it. `--idea none`, and no `--idea` at all, record the explicit value `none`, and render no `Idea:` line. The `Idea:` line is still rendered by the tool, never written by hand.
- **The ledger keeps the value as written.** The schema's name rule already applies to `idea` on every kind, so it applies to `pr.linked`: a malformed value is refused, and a link event from before the field existed still reads with no idea.
- **No spawn-time stamp, and no read-time walk.** Neither is added. A re-parented ticket does not freeze a stale mapping, and no flow report needs live GitHub reads.

## Alternatives

- **A spawn-time stamp.** A `--ticket` field on `session spawn`, or the idea stamped at launch. Rejected for now: the spawn has no ticket field, a writer is launched before its pull request exists, and the stamp would be wrong for a relaunch on a new session. Revisit only if the pull requests with no link stay over 20 percent of writer tokens after one 14-day window (spec #1086).
- **A read-time walk.** From the ticket, to its spec, to the idea, when a report runs. Rejected: it needs live GitHub reads in every flow report, and it reads whatever the ticket points at today, not what the writer delivered.
- **A separate `linkedIdea` field.** One schema field, which leaves the existing `idea` reading of events exactly as it is. Not chosen by default, because the ticket puts the idea under `idea`. The owner may choose it (spec #1086, decided in the owner's place).

## Trade-offs

- The idea sits on a link event, not on the launch. That is surprising to a reader who looks for it on the writer's session, and the flow report must join through the pull request to find it.
- The ledger is append-only, so a link written with a wrong idea cannot be corrected in place. The idea is only what the writer declared in the pull request, so a wrong `Idea:` line misattributes the writing it links.
- The value is stored as the writer named it. A harness idea is named by its number as written (`0030`), and the ledger keys ideas as they are recorded (`docs/guides/contributor.md`, the idea states). A session spawn stores an issue idea as `#n`. The flow report that joins on this field must reconcile the two forms.

## Consequences

- **Flow readers see a real link's idea.** The flow report reads an event's `idea` (`tools/harness/src/flow/attribution.ts`), so a link event with a real idea attributes that writer session's events with no idea of their own to the idea. That is the join this record is for, but it lands before the report's two named buckets (writing with no idea above it, and writing in sessions that opened no pull request), so the per-idea figures move until those buckets are reported.
- **`none` is never an idea in the flow.** `attribute()` (`tools/harness/src/flow/attribution.ts`) treats a `pr.linked` idea of `none` as no idea: the link itself and the writer's events with no idea of their own stay unattributed, so no idea named `none` appears in the per-idea groups, the selection or the report's totals. The owner-time idea numbers (`tools/harness/src/flow/outcomes.ts`) read the same rule, so a pull request whose link names `none` does not put its number among the idea numbers. A real idea on a link is read as before.
- **Pull requests opened before this change have no idea on their link.** They are never back-filled, and a reader must not read them as having no writing.
- **`none` is explicit.** A link with `none` is a pull request that serves no idea, not one whose idea was never recorded.

## Left to the owner

This record does not decide, and does not change, the following. They stay the owner's:

- whether the link uses `idea` (this record and the ticket) or the separate `linkedIdea` field, which keeps the existing reading of events clean (spec #1086, decided in the owner's place);
- the 20 percent bar for adding a spawn-time field, and the 14-day window that tests it;
- the per-idea report, its buckets and the stored form it joins on, which the flow ticket decides.

## How this was decided

By recommendation in the grilling outcome on #1083, carried into spec #1086 under "Decided in the owner's place". The owner has not answered it. The owner may overrule it. The figures it rests on (83 percent of writer tokens linked since 2026-11-17, and 16 percent unlinked) are the spec's own reading of the ledger and were not re-run for this record.

## Notes

- The safety pattern is `no-behaviour-change`: one ledger field value and one accepted flag value, with no feature flag and nothing turned on. The judge's precheck decides whether it accepts that reading.
