---
status: accepted
summary: A session's GitHub token is minted inside its launch wrapper from the identity store and never passes through a FIFO, an API environment or a message, so the wrapper fails closed and the agent never holds the store.
date: 2026-11-22
last-verified: 2026-11-22
---

# ADR 0179: A session's token is made inside its launch wrapper from the identity store

Source: [`infra/plans/16-hc-native-sessions.md` § Step 1](../../infra/plans/16-hc-native-sessions.md#step-1-pin-and-decide), Decisions 6, spec #1765

Supersedes: [ADR 0096](0096-role-tokens-reach-panes-through-a-fifo-handoff.md)

## Context

ADR 0096 gave writer and judge panes their GitHub token through a 0600 FIFO, because herdr had no argv-free channel. Its `pane split --env`, `send-text`, `run` and `agent prompt` all take their text as argv.

hc has no argv-free channel either. The options were tested with a dummy token. The API `env` on `terminal.run` reaches the program, but the value is written to `terminals.json` (mode 0644) for as long as the terminal lives. `hc send` shows the value in `ps` and in `hc read`. A FIFO leaves nothing on disk, but it exists only to carry the token from the harness to a pane, and the switch to hc removes the pane it served.

## Decision

Every role launches as `hc run … harness session exec --role <role> -- claude …`, and the token is made inside that terminal, not handed to it:

1. The wrapper runs from the main checkout's harness bundle, found the way `bundleMainRoot` finds it, and never from the worktree's. The spawner starts it by absolute path, and the wrapper refuses a bundle path inside the worktree.
2. It unsets any `GH_TOKEN` or `GITHUB_TOKEN` inherited from the core's login environment.
3. It reads only its role's items from the identity store (`~/.config/kore/identities.sops.json` on Linux, the keychain on macOS) through the existing role-token code. It then mints the hour-long installation token, or with `owner-writer` on it runs `gh auth token`.
4. On any failure it exits non-zero with an actionable message that names the item or the step. The spawner sees the message through `hc wait` and `hc read`, and no claude starts.
5. It execs claude with only `GH_TOKEN` added to the environment. The launch argv pins the permission mode and passes a settings file from the main checkout, so the worktree's own settings cannot loosen the guards.

A role with no identity of its own gets no token, and the inherited tokens are still scrubbed. No secret appears in an argv, a label, an `hc run` environment, an `hc send` or a file the harness writes.

The FIFO, its 0700 handoff directory and its ten-second read go with the pane they served. ADR 0096's fail-closed rule stays: a shell that cannot mint a token exits instead of falling back to the owner's login.

## Consequences

- The agent never holds the age key or the identity store, so the sandbox can deny `~/.config/sops` and `~/.config/kore` to claude outright when it is built.
- Nothing secret is at rest in hc, and nothing secret is in hc's stored argv or events.
- A failed mint is visible to the spawner as a terminal that exited with a message, not as a silent fallback.
- The token still lives in the agent's environment, so anything the agent runs can read it. The App token expires in an hour and is limited by its permissions. A machine user's PAT does not expire with the session, as ADR 0096 already recorded.
- The identity store and the wizard are unchanged. What moves is where the token is made.

## How this was decided

Owner decision 6 in plan 16, settled on 2026-11-22. The plan's Findings record the dummy-token test of each delivery method.
