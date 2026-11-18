---
summary: pr check and the judge precheck report three mechanical review findings to the writer in audit mode, measured by send-backs per merged change
hypothesis: If pr check and the judge precheck report the mechanical review findings to the writer before it says done (file length by the reviewer's count, type casts in added lines, and a closing keyword where Refs is required), fewer changes are sent back per merged change.
expected-outcome: Send-backs per merged change fall over a 14-day window that opens in sequence after the windows of ideas 0010 and 0016 (ADR 0119), while the all-in cost per merged change and open-to-merge time of the Haiku and Sonnet tiers do not rise.
measurement: sendBacksPerMergedChange.current in harness flow report, read per writer tier once the per-tier report of #1024 exists. Guards: tokensPerMergedChange.current (all-in cost per merged change, Haiku and Sonnet) and leadTimePerMergedChange.current (open-to-merge time). Baseline source: the retro rerun of #1026. The checks must merge before the writer-tier window (#998) opens; each merge date is recorded under Merge dates in this record.
safety-pattern: no-behaviour-change
date: 2026-11-17
kind: harness
hypothesis-metric: sendBacksPerMergedChange.current
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0026: Catch the mechanical review findings in pr check, in audit mode

Part of #1025, the spec for the mechanical checks, which specifies #1021. Filed
by #1043. No GitHub issue is linked yet; `harness idea sync` creates one.

## Primary, guards and window

- **Primary:** `sendBacksPerMergedChange.current`, the per-merged-change form of
  `rework.sendBacksPerIdea` (ADR 0119), direction down, a window of 14 days or
  longer.
- **Guards:** `tokensPerMergedChange.current` (all-in cost per merged change,
  Haiku and Sonnet) and `leadTimePerMergedChange.current` (open-to-merge time).
  Neither may rise.
- **Shared primary.** The primary is shared with ideas 0010 and 0016 (ADR 0119).
  The qualifier warns that it is a shared metric; that warning is expected.
  This idea's window opens in sequence after theirs, by merge, and is not read
  beside them.

## Merge dates

The checks must merge before the writer-tier window (#998) opens. Each check's
merge date is written here when it merges, so a change in the rate can be read
around it (#998 story 22).

- File length by the reviewer's count: merged 2026-11-18 (#1061, 00:00Z).
- Type casts in added lines: merged 2026-11-18 (#1072, 00:24Z).
- Closing keyword where Refs is required: merged 2026-11-18 (#1075, 00:40Z).

## Baseline

Not read. The baseline source is the retro rerun of #1026: send-backs per merged
change, all-in cost per merged change and open-to-merge time per writer tier,
read before the first check merges.

## Target

Not set. The owner sets the number after the baseline is read.

## Owner-held

This idea turns no flag on, opens no window, changes no default writer tier and
sets no token-ceiling value. Those stay the owner's.
