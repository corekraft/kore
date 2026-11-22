---
summary: The writer sandbox denies the hc socket and, on Linux, the credential directories once it is wired into session spawn
hypothesis: Once the writer sandbox is wired into session spawn and built for Linux, a probe writer started inside it reaches none of the three denied targets, the hc socket (HC_SOCKET), ~/.config/kore and ~/.config/sops
expected-outcome: The sandbox probe reports 0 of 3 denied targets reachable from a spawned writer on macOS and on Linux, and the spawned writer still completes a commit inside its worktree
measurement: The sandbox probe in tools/harness/tests/writer-sandbox-support.ts, run from inside a writer spawned by session spawn on each host, counts denied targets it can open (the hc socket, ~/.config/kore, ~/.config/sops); target 0 of 3 on each host
safety-pattern: no-behaviour-change
date: 2026-11-22
---

# Idea 0078: Writer sandbox denies the hc socket and credentials

## What is true today

- No writer sandbox is in force, on macOS or on Linux. The only profile is
  `tools/harness/tests/writer-sandbox-support.ts`, and
  [ADR 0095](../decisions/0095-writer-panes-run-under-macos-sandbox-exec-with-a-writer-token-over-https.md)
  says wiring it into spawn is pending.
- [#337](https://github.com/corekraft/kore/issues/337) is the issue that
  tracked the sandbox. It is closed, while ADR 0095 still lists the wiring as
  pending, so this idea cites it and does not reopen it.
- Until the sandbox lands, the AGENTS.md line "hands them their token and sandbox" is not true.
  Role panes start without a sandbox.

## What the sandbox must deny once it lands

When the sandbox is built and wired into spawn, it denies:

1. the hc socket (`HC_SOCKET`), so a sandboxed writer cannot escape with
   `hc run` or `hc exec` as the owner;
2. on Linux, `~/.config/kore`, where the identity store lives;
3. on Linux, `~/.config/sops`, where the age key lives.

This idea does not build the sandbox. It records the target and the
measurement, so the build has a test to pass.

## Hypothesis and measurement

The hypothesis is measurable: a probe writer spawned under the sandbox reaches
none of the three targets. The sandbox probe counts, from inside a spawned
writer on each host, how many of the three it can open. The target is 0 of 3
on macOS and on Linux, and a commit inside the worktree still succeeds.

## Owner-held

Filing this idea changes no behaviour, turns no flag on and wires nothing into
spawn. Building the sandbox, and wiring it into spawn, are separate work under
plan 16 step 1 and ADR 0095.
