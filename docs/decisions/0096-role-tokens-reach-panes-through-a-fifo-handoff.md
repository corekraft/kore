---
status: accepted
summary: Refines ADR 0095: session spawn gives writer and judge panes their GitHub token through a 0600 FIFO, since herdr offers no argv-free environment; the orchestrator gets none.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0096: Role tokens reach panes through a FIFO handoff

Source: [`infra/plans/11-agent-delivery-loop.md` § Current Limits](../../infra/plans/11-agent-delivery-loop.md#current-limits)

Refines: [ADR 0095](0095-writer-panes-run-under-macos-sandbox-exec-with-a-writer-token-over-https.md)

## Context

ADR 0091 gives writers and the judge their own GitHub identities, and ADR 0095
has the writer push with a token in `GH_TOKEN`. The owner decided on #336 that
the writer is a GitHub App, `kore-writer`, whose short-lived installation token
`session spawn` mints, and that the judge is a machine user whose fine-grained
PAT sits in the keychain. Neither may be written to disk or put in argv.

Herdr 0.9.0 has no such channel. `pane split --env KEY=VALUE`,
`pane send-text`, `pane run`, `agent prompt` and `agent start -- <args>` all
take their text as argv, which any local process can read with `ps`, the
sandboxed writer included.

## Decision

- `session spawn` reads the role's identity from the macOS keychain before it
  touches herdr or git: a writer's App id, installation id and private key, or
  the judge's PAT. A missing item stops the spawn with a hint naming
  `tools/harness/wizards/identities.sh`. Every other role, the orchestrator
  included, gets no token and the keychain is not read.
- For a writer the harness signs the App JWT in its own process and requests an
  installation token narrowed to `kore` with contents:write,
  pull_requests:write and metadata:read. The JWT goes to `curl` on stdin.
- The token reaches the pane by FIFO. The harness creates a 0600 FIFO in a 0700
  directory under `<main checkout>/.kore/state/handoff/<name>`, tells the
  pane's shell to `export GH_TOKEN="$(cat <fifo>)"`, and writes the token to
  the FIFO from a process whose stdin carries it. Only the path is ever in
  argv. The directory is removed after the one read, on timeout (10 seconds)
  and on any failure. This happens before the agent starts, so `claude`
  inherits the variable.
- The wizard stores secrets in the keychain through the stdin of `security -i`.
  The one file that holds a secret is the App's `.pem`, which GitHub makes the
  owner download; the wizard deletes it.

## Consequences

- Nothing is at rest and nothing is in argv: a FIFO holds no data, and the
  token is on stdin of the writing process only.
- Limit: a FIFO is readable by any process with the same user id that opens it
  before the pane does. The 0700 directory and the short window narrow the
  race but cannot close it; whoever wins gets the token and the pane gets EOF,
  which shows as an empty `GH_TOKEN`.
- Limit: when the launcher later wraps the pane in `sandbox-exec` (ADR 0095),
  the profile must allow reading `.kore/state/handoff/<name>/token` for that
  pane, or the export must run before the wrap. Today the pane's shell is not
  sandboxed, so the read is unrestricted.
- Limit: the token stays in the pane's shell and the agent's environment, so
  anything the agent runs can read it. The App token expires in an hour and is
  limited by its permissions; the judge's PAT does not expire with the pane.
- Limit: `GH_CONFIG_DIR` pointing at an empty directory (ADR 0095) is still the
  sandbox wiring's job.
- Spawning a writer now needs network access to api.github.com and an unlocked
  login keychain.
- The `security -i` and keychain round trip was checked against a temporary
  keychain; creating the App and the machine user by the wizard is a live step
  the owner runs.
