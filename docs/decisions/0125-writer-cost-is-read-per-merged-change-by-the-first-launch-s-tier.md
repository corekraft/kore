---
status: accepted
summary: Refines ADR 0119 and the #825 spec: writer cost is read per merged change by the first writer launch's tier, priced per request from a dated table with the 100K step; the randomized window, flag activation and default writer tier stay the owner's.
date: 2026-11-17
last-verified: 2026-11-18
---

# ADR 0125: Writer cost is read per merged change by the first launch's tier

Source: [`infra/plans/12-self-improving-loop.md`](../../infra/plans/12-self-improving-loop.md), and spec [#997](https://github.com/corekraft/kore/issues/997), which specifies [#994](https://github.com/corekraft/kore/issues/994).

Refines: [ADR 0119](0119-each-harness-idea-is-measured-on-a-primary-metric-only-it-moves.md) (the per-merged-change rule) and the #825 writer-tier spec (closed). Builds on [ADR 0117](0117-the-delivery-loop-s-role-set.md), which set the Haiku-or-Sonnet role tiers this measures.

## Context

The owner cannot say what a Haiku writer costs against a Sonnet writer per merged change. Issue #994 estimated a 25 to 30 percent saving per merged PR. The grilling outcome on #994 found that the estimate cannot be read as it stands:

- **The token ratio is not the cost ratio.** Per session, Haiku ran at about $0.70 against Sonnet's $1.10, about 64 percent, not 25 percent. The pricing page (read 2026-11-17) reprices the whole request, cache hits included, once its prompt passes 100,000 tokens. Above that step Haiku's input, cache write and output cost a quarter of Sonnet's, but its cache read costs half; below it, a tenth. The writer mix is cache-read heavy.
- **The attempt ratio is a noisy proxy.** The 1.2x against 1.5x break-even counted user messages less one per session. That counts interrupts, answers to a writer's question and plain nudges as rework, and drops a real follow-up whose first message starts with `<`.
- **The per-tier division is not per tier.** `writerCost` divides each tier's weighted tokens by all merged changes in the span, not by that tier's own, and no event joins a merged change to its writer. A tier that wrote fewer changes looks cheaper by construction.
- **Rescue is not joined.** A relaunch on a new branch is not linked to the work it continues, so any figure is a stated limit, never a zero.

## Decision

- **Unit.** Cost per merged change, not per token and not per attempt. A merged change takes the tier of the first writer launch that started its work (intention to treat). Rescue and rework are charged to that tier. A merged change with no joinable launch is counted as unjoinable, never read as zero.
- **Rework.** Rework is a send to a writer pane after a judge send-back. Any other follow-up message is not rework.
- **Price.** Each request is priced from a dated, pinned table with cache write (5 minute and 1 hour), cache read, input and output. Haiku's 100,000-token step applies to the whole request, cache hits included. Every figure shows the date its table was read.
- **Scope of cost.** The writer's tokens, the judge's and the orchestrating session's count against the merged change. The orchestrating session's model is an assumption, and the figure says so.
- **Dry run first.** The join is run over the existing ledger, and its joined and unjoined counts are posted on #994 before any window reads a tier figure.

This record decides how cost is read. It does not decide where the figures are written. Whether the reading is a ledger field written by the stop hook or an offline script over transcripts stays open for the owner (#994, question 1). Spec #997 recommends the ledger field.

### Left to the owner

This record does not decide, and does not change, the following. They stay the owner's:

- opening the randomized writer-tier window (`KORE_WRITER_EXPERIMENT_START`), its Sonnet share and its length, and whether opening it counts as an owner-approved act recorded on #994 (#994, questions 3 and 4);
- any flag activation, which only `harness flag activate` performs, after a confirmed live-run outcome;
- any change of the default writer tier, which #825 placed out of scope (#994, question 6);
- the headline figure (all-in cost per merged change, or writer cost alone), the pre-launch attribute that stratifies a window, and whether main-session cost becomes its own issue (#994, questions 2, 5 and 7).

## Alternatives

- **Per token.** The issue's 25 to 30 percent. Rejected: the price ratio depends on the 100,000-token step and on the cache-read mix, so a token ratio is not a cost ratio.
- **Per attempt.** The issue's 1.2x against 1.5x. Rejected: the attempt count includes interrupts, answers and nudges. Rework is defined by a send after a send-back instead.
- **An offline script over transcripts.** Not chosen as the default: the flow report reads only the ledger, and ADR 0119 wants the primary read from events the changed code does not write. Still open for the owner (#994, question 1).
- **A branch join.** A pull request joined to its writer by branch name. Rejected: the branch equals the session name only by default, and the launch does not record it. The link is written by `pr open` instead (spec #997).

## How this was decided

By recommendation in a grilling session on #994, answered on the owner's behalf by another session, not from data. The owner may overrule it. The figures it rests on (the 64 percent per-session ratio, the 100,000-token step and the cache-read mix) are the issue's and the grilling's; they were not re-run.

## Consequences

- The per-tier figure replaces the per-tier division. `perMergedChange` stayed, marked superseded, until the new field was read; #1011 removed it, with the report version bumped to 34 (expand and contract, spec #997).
- No tier figure can be read until the link event exists. Pull requests opened before it stay unjoinable and are counted.
- A tier figure below the minimum number of merged changes is reported as insufficient, never as zero.
- The tier figure is only as good as the join. Its unjoinable count is reported beside it, and a reader must not compare it with the issue's figure as if both measured the same thing.
