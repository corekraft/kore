---
summary: A randomized window compares Haiku and Sonnet writers on all-in cost per merged change by first-launch tier, guarded by blocked share, send-backs and owner minutes
hypothesis: If a share of default-tier writer launches is drawn onto Sonnet for 14 days or longer, Haiku writers' all-in cost per merged change, by the tier of the first launch, is lower than Sonnet's by the margin the owner records.
expected-outcome: Over a window of 14 days or longer, Haiku's all-in cost per merged change is lower than Sonnet's by the owner's margin with the interval clear of zero, while blocked share, send-backs per merged change and owner minutes per merged change do not worsen past their margins.
measurement: writerArms.overall in harness flow report: Haiku minus Sonnet all-in cost per merged change with a seeded interval, overall and per stratum, by the tier of the first launch. Guards beside it: blocked share, send-backs per merged change, owner minutes per merged change. The margin, share, length and stratifier are the owner's and are filled in before the window opens.
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: writerArms.overall
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0040: Writer-tier window: Haiku against Sonnet on all-in cost per merged change

Ticket #1013 of spec #998, which specifies issue #994. It is a new idea that
cites the closed #825: the qualifier needed the arm comparison in the flow
report first (#1012, merged). No GitHub issue is linked yet; `harness idea sync`
creates one. Filing this record opens no window.

Ticket #1070 of spec #1065 (which specifies issue #1064 and amends spec #998)
adds the window effort, the scoped hypothesis, the exclusion rule, the spend
re-estimate, one open item and the gate list below. It changes no metric,
direction or window, sets no margin, opens no window and changes no tier or
flag.

## Primary, direction and window

- **Primary:** all-in cost per merged change by first-launch tier, read from
  `writerArms.overall` (and its per-stratum rows) in the flow report. Arms are
  compared by the tier of the first launch, so rescue and rework are charged to
  the tier that started the work.
- **Direction:** Haiku lower by the margin the owner records.
- **Window:** 14 days or longer.
- **Safety pattern:** `no-behaviour-change`. This record and its docs change no
  behaviour, and the window code is unset by default.

## Guards

Each guard is read beside the primary over the same window.

- blocked share
- send-backs per merged change
- owner minutes per merged change

## Reversal conditions (placeholders)

Decision D of #994 keeps Haiku the default meanwhile. Its reversal conditions
are written here before the window is read, and the owner fills in each margin
before the window opens.

- Sonnet becomes the default for a ticket class only if Haiku's all-in cost per
  merged change is not lower by the margin, or its blocked share or
  send-backs per merged change are worse by a margin.
- owner minutes per merged change break a tie.
- The margin and each guard's margin are not set here.

## Readings and sequence

- The Reviewer measurement (#817) is read split by writer tier, so its ratio
  and the window do not move each other.
- No prompt-size mechanism merges inside the window (the rule of spec #998,
  story 22), so Haiku's cost does not shift partway through the comparison.
- The by-size table in #994 stays a hypothesis, never a finding.

## Owner's open items

Each of these stays the owner's. None is set here.

- the margin
- the share
- the length
- the stratifier (the issue's labels, or acceptance-criteria count)
- opening the window, recorded on #994 as the owner's decision
- the extra spend estimate: re-made at the window effort and recorded in
  [Spend at the window effort](#spend-at-the-window-effort); the owner confirms
  it
- the window effort itself, recommended high and confirmed when opening (see
  [Window effort](#window-effort))

## Window effort

The effort both arms run at. The recommendation is **high**: it is what the main
session already runs and Haiku's best case (spec #1065, "Decided by the
grilling comment's recommendation"). The owner confirms it when opening the
window, by setting `KORE_WRITER_EXPERIMENT_EFFORT` (one of low, medium, high,
xhigh or max; required while `KORE_WRITER_EXPERIMENT_START` is a UTC date). The
owner accepted every recommendation on #1064
([comment](https://github.com/corekraft/kore/issues/1064#issuecomment-6966709345):
"I accept all the recommended"). The writer definition
(`.claude/agents/writer.md`, effort medium) and the default writer tier do not
change.

## Hypothesis scoped to the window effort

The hypothesis of this record reads as **Haiku at the window effort against
Sonnet at the window effort**, never as Haiku against Sonnet in general.

- A result at high says nothing about medium.
- A medium default needs its own window; nothing here supports reverting the
  effort for cost on the strength of this result.
- The effort is held equal by the draw, so tier is not confounded with effort.
  Effort is never a stratum.

## Exclusion rule

The primary figure, `writerArms.overall` and its per-stratum rows, covers only
**randomized launches at the window effort**: the window's drawn Sonnet and its
control Haiku, recorded at the window effort. The flow report counts every other
merged change whose first launch is left out, by reason, in `writerArms.excluded`
(#1069):

- `differentEffort`: a randomized launch at another effort.
- `missingEffort`: no recorded effort, including every launch from before effort
  was recorded.
- `notRandomized`: hand-picked, escalated or overridden.

The report takes the window effort from `--window-effort`, else the most common
effort among randomized launches, and prints which. It prints no verdict.

## Spend at the window effort

Re-estimated at the window effort, as the owner asked on #1064 (story 23 of
spec #1065). The earlier rough upper bound of near $100 on #998
([#998](https://github.com/corekraft/kore/issues/998), "Still the owner's"
decisions) did not assume Sonnet at high. The earlier Sonnet cost per merged
change at medium is not carried in as a baseline (story 24 of #1065).

Inputs, each from the issue named:

- **Volume.** #998's power check counts about 28 Sonnet PRs against about 250
  Haiku over 14 days, so about 280 writer PRs in 14 days at the draw #998
  assumed. If the owner draws half of default-tier launches onto Sonnet, about
  140 land on Sonnet. That half is an input to this estimate, not a value this
  record sets.
- **Haiku at high.** Mean $1.17 per merged PR since 2026-11-16 (#1064).
- **Sonnet at medium.** Mean $0.90 per merged PR over 21 PRs since 2026-11-16
  (#1064). There is no Sonnet-at-high cost: only 7 Sonnet PRs ran at high
  (#1021, [rerun for #1040](https://github.com/corekraft/kore/issues/1021#issuecomment-6963906608)).

Assumption, not a measurement: Sonnet at high costs between 1 and 2 times its
medium mean, so $0.90 to $1.80 per merged PR.

Extra spend is the Sonnet arm's cost minus what the same PRs would have cost on
Haiku at high, over about 140 PRs:

| Sonnet at high per PR | Gap to Haiku at high ($1.17) | Extra spend over 14 days |
| --------------------- | ---------------------------- | ------------------------ |
| $0.90 (1 times)       | -$0.27                       | about -$38 (a saving)    |
| $1.80 (2 times)       | +$0.63                       | about +$88               |

The extra spend is therefore **at most about $90** over the 14 days, inside the
earlier near-$100 bound, and could be nil or negative. The figure is a bound from
assumed inputs: the window's own Sonnet-at-high arm replaces it as it reads. The
owner confirms or replaces it.

The owner's note on #998
([comment](https://github.com/corekraft/kore/issues/998#issuecomment-6966159317))
states the window was opened on the owner's instruction on 2026-11-18 (UTC) on the
earlier near-$100 bound, with no fresh estimate recorded before opening. This
estimate is recorded now.

## Open item: effort or the same-day rules

Whether Haiku's drop in PRs with a failed review round, from 54 percent to 4
percent, came from effort or from the writer rules (#920) and the writer
`pr check` (#893) that shipped the same day (2026-11-16) is **open**.

- The comparison is Haiku PRs opened before 2026-11-16 (54 percent, 44 to 63)
  against those opened on or after (4 percent, 1 to 13), from the rerun for #1040
  on #1021
  ([comment](https://github.com/corekraft/kore/issues/1021#issuecomment-6963906608)).
- Every effort-high Haiku PR was opened on or after that day, so effort and
  period coincide.
- No Haiku-at-medium PR exists after that day, and Sonnet at medium also improved
  that day. The old table is therefore not proof that Haiku at medium loses.
- Nothing in this window separates the two, because both arms run at one effort.

## Gate list

The window opens only after each of these has merged. Opening it is the owner's
act, not a ticket. Dates are the merge time in UTC from GitHub; each lands in
the list as it merges.

| Ticket | What                                                                                | Merged by | Merged (UTC) |
| ------ | ----------------------------------------------------------------------------------- | --------- | ------------ |
| #1052  | audit file length in `pr check` and the precheck                                    | #1061     | 2026-11-18   |
| #1053  | audit type casts in added lines                                                     | #1072     | 2026-11-18   |
| #1054  | audit closing keywords in the PR body                                               | #1075     | 2026-11-18   |
| #1066  | the draw: writers launched with only an effort flag, both arms at the window effort | #1074     | 2026-11-18   |
| #1068  | the writer-spawn rule: the main session names no model while the window is open     | #1076     | 2026-11-18   |
| #1069  | the report: only randomized launches at the window effort, the rest counted         | #1169     | 2026-11-18   |

#1069 merged at 2026-11-18T04:38Z, after the owner's note on #998 that the window
opened (2026-11-18T01:25Z); the comparison reads only randomized launches at the
window effort, so it covers any earlier launch the same way.

## Default writer tier

The default writer tier changes only by an owner decision after the result.
Nothing in this record, the window or its outcome changes it.

## Baseline

Not read. The window's own Sonnet arm is the comparison; no earlier figure is a
baseline.

## Target

Not set. The owner sets the margin before the window opens.

## Owner-held

This idea turns no flag on, opens no window, changes no default tier and sets no
variable that opens the window. Those stay the owner's.
