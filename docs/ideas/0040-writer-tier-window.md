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
- No prompt-size mechanism merges inside the window (ADR 0119), so Haiku's cost
  does not shift partway through the comparison.
- The by-size table in #994 stays a hypothesis, never a finding.

## Owner's open items

Each of these stays the owner's. None is set here.

- the margin
- the share
- the length
- the stratifier (the issue's labels, or acceptance-criteria count)
- opening the window, recorded on #994 as the owner's decision
- the extra spend estimate, made and recorded before opening

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
