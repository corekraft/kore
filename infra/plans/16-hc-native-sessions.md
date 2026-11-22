---
status: proposed
summary: Rebuild the harness's session tools on hc's model (terminals with parents and children, labels, reported status, hc wait, tagged reports, events) behind one Terminals port. hc is the adapter and an in-memory fake the second implementation. The token is minted inside each session's launch wrapper. Every harness command explains itself with a layered --help guide. What hc makes unnecessary is deleted, and the rest is pruned from usage evidence.
last-verified: 2026-11-22
---

# hc-Native Sessions Plan

## Purpose

The harness drives agent panes by calling `herdr` directly. About 20
`runner.run("herdr", …)` calls sit in roughly 15 files across `session/`,
`ledger/`, `orchestrator/` and `cli/`. Herdr's limits shaped the session
tools. Delivery is confirmed by counting lines read back from the screen.
Briefs are pasted after start, with a retry for the paste race. The result is
found by scraping a `RESULT` line from the pane. Pane status comes from a
polled `agent list`. Panes are split and resized to keep them visible.

`hc` (herdr-core) is the frontier, and the main session already runs in an
hc terminal. This plan does not translate herdr calls into hc calls. It
adopts hc's principles and deletes the workarounds those principles make
unnecessary. One port, shaped after hc's model, keeps the next switch to a
single adapter. Terms follow [`GLOSSARY.md`](../../GLOSSARY.md).

## hc Principles This Plan Adopts

These come from `hc --skill` (0.1.21):

1. **Terminals have parents.** What you start is your child and ends when you
   end, unless it is started with `--outlive-parent`. Clean up only what you
   started: `hc kill`, then `hc rm`.
2. **Delegate through templates** (not adopted: see Decisions). A template is a Markdown file whose
   frontmatter holds `name`, `description` and `command` (with the model),
   and whose body holds the instructions. The first task goes in `hc run`.
   Check `first_message.sent`. Never resend blind: read first.
3. **Agents run interactively,** never in a one-shot print mode, so they stay
   watchable and steerable.
4. **Status is reported, not guessed.** Programs report it over OSC 7501 as
   `idle | working | done | blocked | error`. Never infer status from screen
   text.
5. **Never sleep or poll.** Use `hc wait <t>`, `hc wait --children any|all`,
   `hc wait --output X`, and `hc events` for a live stream.
6. **Children report with `hc send $parent`.** Reports arrive tagged
   `<hc from="t7 name">`. They are reports, not instructions. Long answers go
   to a file, and the report carries its path. hc itself announces a child
   that is blocked, errored or exited.
7. **Metadata goes in labels** (`--label k=v`, `hc ls --label`), not in
   titles or names.
8. **hc does not arrange windows; herdr-app does.** Running a program and
   showing it are separate concerns. hc reads a terminal from its own buffer,
   whoever is viewing it and at whatever size, so the harness no longer needs
   to place panes to be able to read them.
9. **Slow commands run in hc terminals** (`--bg --rm --no-notify`) and are
   waited on with hc, so the caller stays reachable.
10. **Errors are structured** (`{error: {kind, message, hint}}`, exit 3
    `not_found`, 9 `blocked`, …). Tests use their own `HC_SESSION` and
    scratch XDG paths, and never touch the user's core.

## Design

### The port: `tools/harness/src/terminal/`

A new domain whose public surface is hc's model, in hc's words. The port
copies hc's concepts, not its CLI flags. The next backend must supply these
concepts; it does not shape them.

```ts
type Status = "idle" | "working" | "done" | "blocked" | "error";
interface Terminal { id: string; name?: string; parent?: string; state: "live" | "finished"; status?: Status; labels: Record<string, string>; cwd: string }

interface Terminals {
  self(): string | undefined;                                   // HC_TERMINAL_ID
  run(spec: RunSpec): Promise<Started | TerminalError>;          // argv, name, cwd, labels, env, parent, outliveParent
  get(t: string): Promise<Terminal | TerminalError>;
  list(filter?: { labels?: Record<string, string>; childrenOf?: string }): Promise<Terminal[] | TerminalError>;
  read(t: string, lines: number): Promise<{ text: string; complete: boolean } | TerminalError>;
  send(t: string, text: string, opts?: { ifStatus?: "idle" | "working" }): Promise<Sent | TerminalError>;
  wait(target: { terminal: string } | { children: "any" | "all" }, timeoutMs: number): Promise<Waited | TerminalError>;
  interrupt(t: string): Promise<…>;
  kill(t: string): Promise<…>;  remove(t: string): Promise<…>;
  label(t: string, labels: Record<string, string>): Promise<…>;
  events(filter): AsyncIterable<TerminalEvent>;
}
type TerminalError = { error: { kind: string; message: string; hint?: string } };
```

There is no layout and no split in this port. Hooks recognize raw CLI use
through a `commands` descriptor that each adapter exports.

### Implementations

- **`HcTerminals`.** Short calls go through the CLI with `--json` and the
  injected `Runner`. A spawn that needs per-terminal `env`, which the CLI
  lacks but hc's API has, goes through `hc connect` (the JSON API over
  stdio), still behind the `Runner`.
- **`FakeTerminals`.** An in-memory model of parents, statuses, reports and
  events. Every harness unit test mocks the port with it (ADR 0098). It is
  the second implementation that keeps the port honest.
- **herdr.** Gets no adapter. Emulating parents, reported status and tagged
  reports on herdr would rebuild the workarounds this plan deletes. herdr
  keeps working on the old code path until Step 6 proves hc, and Step 7
  deletes it (expand and contract). A future backend gets an adapter written
  against the port and run through the shared contract spec.

### The session tools, rebuilt

| Tool                          | Today (herdr)                                                                                                                                                        | hc-native                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session spawn`               | split pane → `pane run` the token export → `agent start` with retries → `agent prompt` with paste-race retry                                                         | one `hc run --bg --name <name> --cwd <worktree> --label kore-session=<name> --label role=<role> --label model=<model> harness session exec --role <role> -- claude --agent <role> --model <model> --effort <effort> "<brief>"`. The brief is claude's own first-prompt argument, so there is no paste and no race. The wrapper makes the role's token inside the terminal (see Decisions 6), so no secret crosses between processes |
| Role definitions              | `.claude/agents/<role>.md` → `claude --agent`                                                                                                                        | unchanged: `.claude/agents/` stays the only definition, and claude reads it through `--agent`. No hc templates (decided 2026-11-22)                                                                                                                                                                                                                                                                                                 |
| `session send`                | `send-text` + `send-keys` + count lines read back                                                                                                                    | `hc send` (it waits out the person's draft). If not confirmed, `read`, never resend blind                                                                                                                                                                                                                                                                                                                                           |
| Sender line                   | the harness types `sender: <role> <session> (<command>)`                                                                                                             | hc's `<hc from="t7 name">` tag is the provenance (decided 2026-11-22). The harness adds no sender line; a role is looked up from the `role=` label                                                                                                                                                                                                                                                                                  |
| `session wait` / result       | poll and scrape the `RESULT` line                                                                                                                                    | `wait` until `done`, `blocked` or `error`, then take the child's report (`hc send $parent`). A long result goes to a file named in the report. The brief tells every role how to report                                                                                                                                                                                                                                             |
| `harness wait --pr --session` | a background job plus polling                                                                                                                                        | `gh run watch` in an hc terminal (`--bg --rm --no-notify`), then `wait --children any` across the PR watcher and the session                                                                                                                                                                                                                                                                                                        |
| Ledger events                 | `herdr-poll` + `herdr-stall` on a schedule                                                                                                                           | `harness ledger watch` runs in its own hc terminal and turns `hc events --label kore-session` into ledger events. Stalls are `blocked` or `error` events, not timing guesses                                                                                                                                                                                                                                                        |
| `session check`               | role from the pane title                                                                                                                                             | role from the `role=` label. An agent terminal with no `kore-session` label is unmanaged                                                                                                                                                                                                                                                                                                                                            |
| `session close`               | `pane close`, refused for others' panes                                                                                                                              | `kill` + `remove`, refused unless the terminal is the caller's child (hc's `parent` field)                                                                                                                                                                                                                                                                                                                                          |
| Model check                   | screen scrape after launch                                                                                                                                           | deleted: the model is set explicitly in the launch argv and recorded in the `model=` label and the launch event (decided 2026-11-22)                                                                                                                                                                                                                                                                                                |
| Layout, equalize, tabs        | `pane split` / `pane layout` / `pane resize`; a new tab per pane and grilling pairs in their own tab, because `herdr agent read` came back blank from shrunken panes | deleted. hc reads do not depend on the view, and results arrive as reports, not screen text. The owner sees every terminal in herdr-app (or with `hc attach`) without the harness arranging anything                                                                                                                                                                                                                                |

### What stays backend-neutral

- **Ledger `source`.** The ledger is append-only and holds
  `source: "herdr"`. Add `"terminal"` and write it for new events. Readers
  accept both, and `"herdr"` stays in the schema forever.
- **Hooks.** The recognizers match herdr lines (old transcripts) and hc
  lines. The guard refuses a bare `hc run` of a role agent, as it refuses
  `herdr agent start` today. Role terminals start only through
  `session spawn`.
- **Errors.** Error text carries hc's `kind` and `hint` with the harness's
  next step, so it stays actionable.

### Pruning

The plan already touches most of the session code. It removes what hc makes
unnecessary, and it reviews the rest from evidence, not from memory.

**Removed by the switch** (Step 7, after the live proof):

- `session equalize` and `equalize.ts`; pane splitting and placement in
  `spawn-pane.ts`
- `handoff.ts`, the FIFO (Decisions 6)
- the start retries in `agent-start.ts` and `checkModel`; the paste-race
  retry in `launch.ts`
- the read-back counting in `notify.ts` and `ansi.ts`; `session notify`,
  since the child reports with `hc send`
- the `RESULT` scraping in `wait.ts`, the orchestrator's `collect` and the
  review IO
- the pane-title parsing in `check.ts`; `live-sessions.ts`
- `ledger/herdr-poll*` and `herdr-stall`, and their start from `hook record`
- `guard-agent-start`'s herdr form, the herdr context hints, and the herdr
  test support
- the typed sender line in pane messages (Decisions 2)
- the retro's herdr transcript recognizers, once no transcript inside the
  retro window has herdr lines (30 days after the flip)

**Reviewed from evidence** (Step 7). A judgment session counts how often each
of the 77 commands was actually run over 30 days. It counts Bash tool calls in
session transcripts and the ledger, not mentions in briefs or usage text. Each
command or module then lands in one of three lists: keep, merge into another
command, or remove. A command is a removal candidate when it has had no real
run in 30 days, when another command or hc itself does the same job, or when
it serves a finished experiment or a flag that is already active. Candidates
to check include `session tier`, `session prompt-size`, the writer
experiment window (`spawn-experiment*`, `tier-source`) and the ledger
pollers. The owner approves the removal list once. Each removal is its own
PR, updates the help, skills and docs that name it, and keeps coverage from
dropping.

## Steps

### Step 1: Pin and decide

- [ ] Pin `hc` in mise (0.1.21 sits unpinned in `~/.local/bin`), with its
      compatibility evidence (pin-upgrade skill).
- [ ] ADR "Agent sessions follow hc's model behind a Terminals port".
      It supersedes ADR 0078's herdr pane mechanics and refines
      ADR 0123 (wait through `hc wait`; the result
      comes from the child's report) and the AGENTS.md sender-line rule (hc's
      tag carries provenance).
- [ ] ADR "A session's token is made inside its launch wrapper from the
      identity store". It supersedes ADR 0096: the FIFO handoff is removed.
- [ ] Fold the Findings into the ADR: labels for identity, the launch wrapper for the token, and no API `env` for secrets.

### Step 2: Port, fake, contract

- [ ] `terminal/` with the port, `TerminalError`, `FakeTerminals` and a
      shared contract spec.
- [ ] `HcTerminals`, passing the contract spec against recorded `--json`
      fixtures in unit tests.
- [ ] An integration test that drives a real `hc` core under a scratch
      `HC_SESSION` and XDG: run a plain program, wait, read, kill, remove,
      and a parent/child report. It never touches the user's core.

### Step 3: Help guide

- [ ] Extend `Command` (`runtime/command.ts`) with a `help` record:
      `purpose`, `when`, a description for every declared flag and operand,
      `examples` (each a command and what it shows), `exits`, `effects`
      (`read-only` or `mutates`, and what), and `seeAlso`. Each domain gets
      a short guide too: its purpose and its usual flow.
- [ ] `cli.ts` renders three levels, always to stdout, exit 0, with no root,
      no ledger write and no side effect: - `harness --help`: what the harness is, the domains in one line
      each, the common flows (spawn → wait → close; pr open → checks;
      flag audit → activate), and how to go deeper. - `harness <domain> --help`: the domain guide and its commands. - `harness <domain> <command> --help`: usage, purpose, flags,
      examples, exit codes, effects and related commands.

      `--help --json` gives the same content as one object for agents. A
      usage error prints the closest level's guide, not all 77 commands.

- [ ] Specs fail a command with no help, with a declared flag that has no
      description, or with no example. Flags therefore cannot drift from
      their help.
- [ ] Shrink each `summary` to one line, moving today's paragraph-long
      summaries into `help`. Point skills, session-start hints and
      `hook/context.ts` at `harness <domain> --help` instead of restating
      usage. kb-check fails a doc that names a command or flag that does not
      exist.

### Step 4: Reporting

- [ ] Every role's brief ends with the report contract: `hc send <parent>
    "RESULT <outcome> <summary or file path>"` when done or stuck. The parent
      address is passed in the brief (`$HC_TERMINAL_ID` of the spawner).
- [ ] `session wait` takes the report from the wait, and `hc read` is only a
      fallback for a child that exited without reporting.

### Step 5: Rebuild the tools (behind `KORE_TERMINAL=hc`)

One PR per tool, each test-first against `FakeTerminals`:

- [ ] (0) `harness session exec`: scrub, mint from the store, fail closed, exec. Specs cover a missing store item, an undecryptable store, a failed mint and an inherited `GH_TOKEN`, and check that none of them prints a value.
- [ ] (a) spawn; (b) send; (c) wait and result, including orchestrator
      `collect` and review IO; (d) close and check.
- [ ] (e) `ledger watch` from events; (f) `harness wait` on hc children.
- [ ] Neutral ledger source; hook recognizers; context hints.

Without the variable, today's herdr path runs unchanged. That makes this a
dark launch.

### Step 6: Live proof on hc

- [ ] From an hc terminal: spawn a writer in a worktree, send, then wait
      for its report. Run check, `ledger watch`, close, and `harness wait
    --pr`. Record the outcome on the tracking issue (Refs until green).
- [ ] Read a writer while herdr-app shows it in a small split, to prove that
      reads and reports do not depend on the view.
- [ ] With a decoy `GH_TOKEN` in the core's login environment, a spawned
      writer's `gh api /installation/repositories` shows the kore-writer App
      (with `owner-writer` off), never the decoy. A removed store item ends
      the terminal with a message naming the item, and no claude starts.
- [ ] Three writers at once, with one forced `blocked` (a permission
      prompt), to prove that hc announces it and the ledger records it.

### Step 7: Flip, contract and prune

- [ ] Make hc the only path. Delete the herdr call sites, `equalize`,
      `spawn-pane` splitting, the paste-race retries, `herdr-poll` and
      `herdr-stall`.
- [ ] Run the evidence review (Pruning), get the owner's approval of the
      removal list, then remove, one PR each.
- [ ] Add a guard test: nothing outside `terminal/` names a backend
      binary or reads its environment.
- [ ] Update AGENTS.md (role panes start through `session spawn`; read
      `hc --skill`), `skills/spawn-session`, the session hints, and the
      memories "panes in a new tab" and "grilling pairs get their own tab",
      which were workarounds for herdr reads.

## Decisions (owner, 2026-11-22)

1. **Lifetime: hc's default.** Spawned sessions are children of the terminal
   that spawned them and end with it. Only long-lived helpers such as
   `ledger watch` use `--outlive-parent`. Worktrees and branches survive a
   parent's crash.
2. **Provenance: hc's tag.** `<hc from="t7 name">` replaces the typed
   `sender:` line. The AGENTS.md rule _Every agent message names its sender_
   is rewritten in Step 7 to point at hc's tag.
3. **No templates.** Roles launch as `hc run claude --agent <role> --model
<model> --effort <effort> "<brief>"` (`hc run` takes a program and its
   arguments as well as a template name). `.claude/agents/` stays the only
   definition, and nothing lives outside git.
4. **No model screen check.** The launch argv sets the model, and the label
   and launch event record it.
5. **No window layout and no herdr-app integration.** The harness neither
   arranges nor shows terminals.
6. **The token is made inside the terminal** (supersedes ADR 0096). Every
   role launches as `hc run … harness session exec --role <role> -- claude …`.
   The wrapper, run from the main checkout's harness bundle and never the
   worktree's (`KORE_HARNESS_BUNDLE`), does this:
   1. unsets any `GH_TOKEN` or `GITHUB_TOKEN` inherited from the core's
      login environment;
   2. reads only its role's items from the identity store
      (`~/.config/kore/identities.sops.json` on Linux, the keychain on macOS)
      through today's `role-token.ts`, and mints the hour-long installation
      token (or, with `owner-writer` on, runs `gh auth token`);
   3. exits non-zero with an actionable message on any failure, and the
      spawner sees it through `hc wait` and `hc read`;
   4. execs claude with only `GH_TOKEN` added.

   The agent never holds the age key or the store, so a future sandbox can
   deny `~/.config/sops` and `~/.config/kore` to claude outright. A role
   with no identity of its own gets no token, and the inherited ones are
   still scrubbed.

## Findings (2026-11-22)

- **Labels.** `hc run` takes `--label` more than once, and `hc get` returns all
  of them. Labels replace the `KORE_AGENT`, `KORE_ROLE` and `KORE_IDEA` stamps.
  The ledger hook and the sender code read them once per session, from
  `hc get $HC_TERMINAL_ID`. Pane messages carry hc's tag. GitHub text keeps a
  sender line, filled from the labels.
- **Environment.** A caller prefix (`K=V hc run …`) does not reach the
  terminal: hc gives it the core's login environment plus `HC_TERMINAL_ID`,
  `HC_SESSION` and `HC_SOCKET`. `hc run env K=V …` works, but the argv is
  stored and shown by `hc get`, so it is only for values that are not secret.
- **Secrets, tested with a dummy token:**

  | Method                           | Arrives | In `hc get` / `ls` / events | In `hc read` | On disk                                                                |
  | -------------------------------- | ------- | --------------------------- | ------------ | ---------------------------------------------------------------------- |
  | FIFO, read by the launch command | yes     | no                          | no           | no                                                                     |
  | API `terminal.run` `env`         | yes     | no                          | no           | **yes**: `~/.local/state/herdr-core/default/terminals.json` while live |
  | `hc send` into `read -rs`        | no      | no                          | **yes**      | no                                                                     |

  None of these is used. The token is made inside the terminal instead (Decisions 6). The API `env` breaks
  _Secrets never touch disk_.

- **Sandbox.** No writer sandbox is in force today, on macOS or on Linux. The
  profile lives only in `tools/harness/tests/writer-sandbox-support.ts`, and
  ADR 0095 says wiring it into spawn is pending. So the switch to hc loses no
  sandbox. It does need these changes:
  1. A launch wrapper (Decisions 6) replaces herdr's `pane run` step.
  2. Spawn and the wrapper refuse to start a session with empty role or
     session labels.
  3. `session check` lists hc terminals. Otherwise it reports clean while hc
     writers run unmanaged.
  4. The read-only role guard allows hc's read commands (`hc get`, `ls`,
     `read`, `wait`) and `hc send` to the parent. Today it refuses
     `hc --help`, so a reader cannot report back.
  5. When the sandbox is built (separately, on both platforms), it denies the
     hc socket (`HC_SOCKET`). Otherwise a sandboxed writer can escape with
     `hc run` or `hc exec` as the owner. On Linux it must also deny
     `~/.config/kore` and `~/.config/sops`.
- **Launch.** The investigation flagged hc's `invalid_template` check on shell
  characters. Plain argv launches worked in every test here
  (`claude --agent reader --model … "<brief>"`). Confirm a brief with quotes
  and newlines in Step 6.

## Open Questions

1. **Building the writer sandbox** is real, new work on both platforms. It
   does not block this plan, but the AGENTS.md line "hands them their token
   and sandbox" is not true today. Track it as its own idea?

## Done When

From an hc terminal, `session spawn` starts a role with `hc run claude --agent <role>`.
The writer reports back through hc, and `session wait` returns that report.
The ledger records the writer's statuses from events. `session close`
removes only the caller's own children. `harness --help`, `harness <domain>
--help` and `harness <domain> <command> --help` guide a person or an agent
from where they ran it, and every flag is documented. The evidence-based
removal list is applied. The harness does no window layout.
No harness code polls, sleeps,
scrapes a status from the screen, or names a backend binary outside
`terminal/`.
