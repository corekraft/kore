---
status: proposed
summary: Proposed, refines ADR 0119 and ADR 0120: ideas 0019 to 0021 add no guard rule; the main session waits with one background harness wait, session wait keeps the pane result summary while notify and the ledger stay outcome-only, a wrapped message is confirmed as delivered, each idea is measured from transcripts on its own flag, and whether the digest counts the main session's bare herdr sends is parked for the owner.
date: 2026-11-16
last-verified: 2026-11-16
---

# ADR 0123: The main session waits and sends through harness tools, not guards

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 6](../../infra/plans/11-agent-delivery-loop.md#step-6-orchestrator-and-concierge) and harness ideas 0019, 0020 and 0021 (retro of 2026-11-16)

Refines: [ADR 0119](0119-each-harness-idea-is-measured-on-a-primary-metric-only-it-moves.md) and [ADR 0120](0120-recommended-decisions-go-to-an-advisor-reserved-decisions-to-the-owner.md).

## Status

Proposed. Its questions were answered by delegation on 2026-11-16, by an
answering session on the owner's behalf; that reaches this record through a
tagged agent message, which is not approval (ADR 0120), so it becomes
accepted on the owner's own untagged comment. It contradicts no accepted
sentence of ADR 0091, 0101, 0119, 0120 or 0121.

## Context

Over 15 and 16 November the main session spent about 490 minutes in 669
foreground polls (sleep, until and seq loops, and 358 raw `gh pr checks`
against one `harness pr checks --wait`). Every message to it waits in one
queue while it polls: the owner's waited a median of 92 seconds and up to two
hours, and 1,600 background-task notices waited 8 minutes at p90. It read
finished panes 278 times with `herdr agent read`, because the session state
file keeps the outcome word and no summary. It typed into panes with raw
`herdr agent prompt` 40 times against 5 `session send` calls, and those
unsigned follow-ups are the retro scan's top four repeated-correction
clusters.

The retro filed three ideas: 0019 a guard against foreground polls, 0020
`session notify` writing a summary into the state file, 0021 a guard against
raw herdr sends. Three facts changed them. ADR 0091 and ADR 0101 freeze new
guard rules, and ADR 0120 says of the bare-herdr gap: no new guard rule. A
writer pane's sandbox (ADR 0095) cannot write the main checkout's state file.
And `session send` reports "Delivery not confirmed" on a message that arrived:
it looks for the whole signed message on one pane line, so a message wider
than the pane never matches, and the main session falls back to raw herdr.

## Decision

- **No guard rule.** Neither idea adds a guard, a deny rule or a rule family.
  The main session is helped by tools (ADR 0101) and an instruction line.
- **One background wait (0019).** `harness wait` takes any mix of `--pr <n>`
  and `--session <name>` targets, returns when the first settles (CI green or
  red, or a RESULT line) or its bound passes, and names the target and state,
  in `--json` too. Settled and bound-passed exit differently; a target already
  settled returns at once. The main session runs it as one background run and
  restarts it with the rest. It reuses `pr checks` and `session wait`. No
  Monitor wiring and no change to how the host queues notices.
- **`session wait` keeps the pane result (0020).** It stores the text the
  pane printed before its RESULT line as `result.summary` in the session
  state file, ANSI stripped and length capped, and returns it in `--json`.
  `session notify` and the `pane.finished` ledger event stay outcome-only; a
  test proves no summary reaches the ledger. The state file is under the
  ignored `.kore/`, so it stays local.
- **A wrapped message is delivered (0021).** `deliver()`, shared by
  `session send` and `session notify`, confirms on the pane text with wrapped
  lines rejoined, still excluding the input box, so typed but unsubmitted text
  is not taken as delivered. No other `session send` change until the window
  shows what else drives raw sends.
- **Primaries from transcripts.** Each primary is read by the retro scan from
  transcripts, which the changed code does not write (ADR 0119):

  | Idea | Primary                                                             | Direction | Baseline (15-16 Nov) |
  | ---- | ------------------------------------------------------------------- | --------- | -------------------- |
  | 0019 | main-session foreground poll minutes per merged change              | down      | 490 minutes          |
  | 0020 | main-session `herdr agent read` and `pane read` per `pane.finished` | down      | 278 reads            |
  | 0021 | signed share of main-session pane sends                             | up        | 5 of 45              |

  The signed share is `session send` over `session send` plus raw
  `herdr agent prompt`, `pane send-text` and `send-keys`. Owner minutes per
  merged change, the owner-message queue wait, tokens per merged change and
  repeated-correction clusters are guard metrics none of them claims. None of
  these counts goes into the owner digest.

- **One flag each, gating the main-session brief.** `main-session-wait`,
  `pane-result-summary` and `signed-main-sends` each gate one line of the
  main session's SessionStart brief naming the tool to use. `harness wait` and
  `result.summary` are additive and ship unflagged. The wrapped-line
  confirmation changes `session notify` exit codes for role panes too, so it
  sits behind `signed-main-sends`, and flag off keeps today's behaviour. Each
  flag lands off in every overlay; turning one on is the owner's call.
- **Windows apart from the tick.** The tick (ADR 0121) moves 0019's and
  0020's primaries, so their 14-day windows open only while
  `orchestrator-tick` is off; if it turns on mid-window, the window is
  reported insufficient and restarts with the tick on as its baseline. 0021 is
  exempt: the tick never types into a pane as the main session. Idea 0007's
  window records whether these two flags were on.

## Parked for the owner

Whether the retro scan counts the main session's bare herdr sends into the
owner digest, and whether that count learns `herdr agent prompt`, which it
misses today. ADR 0120 reserves the digest's content and leaves closing the
bare-herdr gap to the owner, so this is a non-blocking reserved question; the
ideas above do not depend on it.

## Consequences

- The main session holds one background wait instead of many foreground
  polls, and reads a pane's result from its record instead of scraping it.
- A failed send means a failed send again, which takes away the reason to
  type raw into a pane.
- The guard freeze holds: a later proposal to block these commands is a new
  guard and goes to the owner.

## How this was decided

By recommendation in a grilling session on ideas 0019 to 0021 on 2026-11-16,
answered on the owner's behalf by another session. The summary length cap
and the `harness wait` bound are placeholders.
