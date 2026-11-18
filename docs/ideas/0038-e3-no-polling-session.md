---
summary: Main-session cost per merged change falls when no session polls: the wait and notify tools replace it
hypothesis: If the main session waits with harness wait on an idea's state change and is told by session notify, with no session polling panes or the idea state, main-session cost per merged change falls.
expected-outcome: Main-session cost per merged change (a window ratio) falls over a 14-day window that opens after the control window, while none of the six guards worsens past its margin.
measurement: writerCost.current in harness flow report, read as the orchestrate bucket's weighted tokens per merged change (the main session's cost, a window ratio, never assigned to one pull request). Guards and margins are in the record body.
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: writerCost.current
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0038: E3: run the main session with no polling session

Part of #1031, the spec for #1016 (cut the main session's cost); filed by
#1049. No GitHub issue is linked yet; `harness idea sync` creates one. The
grilling outcome is on #1016.

## Primary and window

- **Primary:** main-session cost per merged change, read from `writerCost.current`
  as the orchestrate bucket's weighted tokens per merged change. It is a window
  ratio: the span's main-session cost over the span's merged changes. It is
  never assigned to one pull request (**Main-session cost** in the glossary).
  Direction down, window 14 days.
- **Safety pattern:** `no-behaviour-change`. This record and its docs change no
  behaviour; the tools it uses are their own tickets.
- **The arm:** no session polls. The main session waits with
  `harness wait --idea` on an idea's state change, and a finished session
  reaches it through `harness session notify`. A session reads its own prompt
  size with `harness session prompt-size`, which is read against the
  **Compaction cap** in the brief; the cap is an instruction, not a guard
  (ADR 0091 freezes new guards).

## Guards

Each guard is read over the same window as the primary and must not worsen
past its margin.

- share of one week's ceiling per merged change (must not rise); see **Share of
  one week's ceiling** and **Weekly token ceiling** in the glossary
- send-backs per merged change
- stalled panes
- owner overturns of advisor decisions
- main-session follow-ups per writer session
- handover count; a **Handover** is a pane message from a cheap session to the
  stronger one that names the reason

## Rules

- The guard margins and baselines are fixed from the control window before the
  arm opens, and are written into this record then. No margin is chosen after a
  result is seen. None is set here.
- A guard breach stops the arm.
- A guard with too little data is insufficient, never passed, and blocks the arm
  from being judged.
- E3 runs after the control window and never overlaps the writer-tier window,
  so the tier effect and the orchestrator effect are not mixed (ADR 0119).
- The owner opens the window. Filing this record opens none, and no ticket that
  files it starts a measurement.
- E2 (early compaction) and E1 (Haiku under the cap) are filed after E3's
  recorded outcome, and the owner decides whether they run.

## Baseline

Not read. Each guard's baseline comes from the control window.

## Target

Not set. The owner sets the number after the baseline is read.

## Owner-held

This idea turns no flag on, opens no window, changes no default tier and sets no
value for the weekly token ceiling. Those stay the owner's.
