---
status: accepted
summary: Agent sessions follow hc's model behind one Terminals port: hc is the adapter, an in-memory fake the second implementation, and a child's result is its report file read through hc wait.
date: 2026-11-22
last-verified: 2026-11-22
---

# ADR 0178: Agent sessions follow hc's model behind a Terminals port

Source: [`infra/plans/16-hc-native-sessions.md` § Step 1](../../infra/plans/16-hc-native-sessions.md#step-1-pin-and-decide), spec #1765

Refines: [ADR 0078](0078-agent-roles-run-as-herdr-panes.md) and [ADR 0123](0123-the-main-session-waits-and-sends-through-harness-tools-not-guards.md), and the AGENTS.md sender-line rule.

## Status

Accepted on 2026-11-22 by the owner's decisions in plan 16 (Decisions, 2026-11-22), under spec #1765.

## Context

The harness drives agent panes by calling `herdr` directly, about twenty calls in roughly fifteen files. Herdr's limits shaped the session tools. Delivery is confirmed by counting lines read back from the screen, briefs are pasted after start with a retry for the paste race, the result is scraped from a `RESULT` line, status comes from a polled agent list, and panes are split and resized to stay visible.

`hc` (herdr-core) is the frontier, and the main session already runs in an hc terminal. Its principles remove most of those workarounds: terminals have parents, status is reported and not guessed, waits do not poll, children report by message, and metadata goes in labels.

## Decision

1. **One port, shaped after hc's model.** A `terminal/` domain in `tools/harness/src/terminal/` exposes hc's concepts in hc's words, not its CLI flags: a terminal with a parent, labels and a live or finished state; a reported status (`idle`, `working`, `done`, `blocked`, `error`); the operations `run`, `get`, `list`, `read`, `send`, `wait`, `interrupt`, `kill`, `remove`, `label` and `events`; and structured errors with a `kind`, a message and a hint. The port has no layout and no split.
2. **Two implementations.** `HcTerminals` calls the `hc` CLI with `--json` through the injected runner, and uses `hc connect` only where a spawn needs a per-terminal environment. It compares `hc --version` with the pin once per process and fails closed. `FakeTerminals` is an in-memory model of parents, statuses, reports and events; every unit test of a session mocks the port with it (ADR 0098), and it is the second implementation that keeps the port honest. Roles launch with the claude command line itself: `.claude/agents/` stays the only role definition, and no hc template is used.
3. **herdr gets no adapter.** Emulating parents, reported status and tagged reports on herdr would rebuild the workarounds this decision removes. herdr keeps the old path until the live proof on hc, and the flip deletes it.
4. **Terminals have parents.** A session is a child of the terminal that spawned it and ends with it, unless it is started with `--outlive-parent`, which only long-lived helpers such as `ledger watch` use. The harness cleans up only what it started: `hc kill`, then `hc rm`. A worktree and its branch survive a parent's crash.
5. **Status is reported, and waits do not poll.** The harness reads a terminal's status from hc and waits with `hc wait` and `hc events`. It never infers status from screen text and never sleeps.
6. **A child's result is a report file.** An `hc send` reaches the parent as its next input and never ends an `hc wait`. So `harness session report` writes the result to `.kore/report/<session>.json` first, and then sends a one-line notice that names the file. The notice has a fixed shape and never carries the summary. `session wait` reads the report. A stopped terminal with no report is `blocked`, "stopped without a report".
7. **Labels carry identity.** `kore-session`, `role`, `model`, `group` and the delivery and attended markers are labels, set at spawn or with `hc label`, not names or titles. The harness adds no typed sender line: hc's tag `<hc from="t7 name">` is the provenance. The AGENTS.md rule is rewritten to name that tag when the switch lands.
8. **No layout.** The harness neither splits, places nor resizes terminals. hc reads a terminal from its own buffer whatever the view, and the owner sees every terminal in herdr-app or with `hc attach`.
9. **Role terminals start only through `session spawn`.** The guard refuses a bare `hc run` of a role agent, as it refuses `herdr agent start` today. A role's `session send` reaches only its parent, its own children and its group siblings. A raw `hc send`, `hc label`, `hc run` and `hc exec` stay refused for role agents.
10. **The switch is one flag.** The `hc-sessions` flag is declared off in every overlay. The herdr path runs unchanged until the live proof on hc, and the flip deletes the herdr call sites and the workarounds listed in plan 16.
11. **Pin and fail closed.** hc is pinned by its exact `--version`, because mise cannot pin it. Both hosts run the same hc, since the core protocol differs by version, and a mismatch or a missing binary stops the adapter and names the install command.

## Consequences

- The herdr workarounds go: pane splitting and equalizing, the paste-race and start retries, the `RESULT` scrape, the polled agent list and the pane-title parsing. Each removal is its own PR after the live proof.
- Results no longer depend on the screen. A reader of a report does not need its pane to be visible.
- New ledger events carry `source: "terminal"`. Readers keep accepting `"herdr"` for the history, and the schema keeps it.
- A later backend is an adapter written against the port and run through the shared contract spec. The port does not bend to hc's CLI.
- Both hosts must run the same hc version, and a mismatch fails closed. Where hc releases are published, and whether they carry checksums, is still open in the plan.

## How this was decided

The owner's decisions 1 to 5 in plan 16 and the grilled decisions of the same plan, settled on 2026-11-22. Decision 6 of the plan, the token, is recorded in [ADR 0179](0179-a-session-s-token-is-made-inside-its-launch-wrapper-from-the-identity-store.md).
