---
status: active
summary: Rebuild the harness's session tools on hc's model (terminals with parents and children, labels, reported status, hc wait, tagged reports, events) behind one Terminals port. hc is the adapter and an in-memory fake the second implementation. The token is minted inside each session's launch wrapper. A child's report is a file the parent's wait reads, announced by a one-line notice. The switch is the hc-sessions flag. What hc makes unnecessary is deleted, and the rest is pruned from usage evidence. The layered --help guide moved to plan 17.
last-verified: 2026-11-23
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
The layered `--help` guide, once Step 3 of this plan, is
[plan 17](17-harness-help-guide.md).

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
  run(spec: RunSpec): Promise<Started | TerminalError>;          // argv, name, cwd, labels, env, parent (hc run --parent), outliveParent
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
  keeps working on the old code path until Step 5 proves hc, and Step 6
  deletes it (expand and contract). A future backend gets an adapter written
  against the port and run through the shared contract spec.

### The session tools, rebuilt

| Tool                          | Today (herdr)                                                                                                                                                        | hc-native                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session spawn`               | split pane → `pane run` the token export → `agent start` with retries → `agent prompt` with paste-race retry                                                         | one `hc run --bg --name <name> --cwd <worktree> --label kore-session=<name> --label role=<role> --label model=<model> harness session exec --role <role> -- claude --agent <role> --model <model> --effort <effort> "<brief>"`. The brief is claude's own first-prompt argument, so there is no paste and no race. The wrapper makes the role's token inside the terminal (see Decisions 6), so no secret crosses between processes                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Role definitions              | `.claude/agents/<role>.md` → `claude --agent`                                                                                                                        | unchanged: `.claude/agents/` stays the only definition, and claude reads it through `--agent`. No hc templates (decided 2026-11-22)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `session send`                | `send-text` + `send-keys` + count lines read back                                                                                                                    | `hc send` (it waits out the person's draft). If not confirmed, `read`, never resend blind. Allowed to the caller's parent, its own children and its siblings that share a `group=<name>` label set at spawn (a grilling pair), never to another terminal: hc has no access control, so the harness guard is the limit. Read-only roles may run `session send` under that rule; a raw `hc send` stays refused                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Sender line                   | the harness types `sender: <role> <session> (<command>)`                                                                                                             | hc's `<hc from="t7 name">` tag is the provenance (decided 2026-11-22). The harness adds no sender line; a role is looked up from the `role=` label                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `session wait` / result       | poll and scrape the `RESULT` line                                                                                                                                    | `hc wait <terminal>`, then read the child's report file (`.kore/report/<session>.json`, written by `session report`, Step 3). The `hc send` to the parent is a one-line notice only. No report means `blocked`, "stopped without a report". The brief tells every role how to report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `harness wait --pr --session` | a background job plus polling                                                                                                                                        | `gh pr checks <n> --watch --fail-fast -R <repo>` in an hc terminal (`--bg --rm --no-notify`, `--parent` the caller), then `wait --children any` across the PR watcher and the session. Each hc wait is capped at one checks interval, and a capped timeout re-reads the checks before the bound passes: a bounded wake, not a sleep, because hc reports only news that arrives during a wait and a child that finished between two reads would otherwise wait for the whole bound. On wake, one `readChecks` and one `settleSessionTarget` decide; the watcher's exit code is not trusted, and a watcher this wait started and still running is killed (a reused watcher is left to its owner). An idea target, or a `--pr` with no hc session, keeps today's loop. Behind `hc-sessions`. A PR has several workflow runs, so `gh run watch` is not used |
| Ledger events                 | `herdr-poll` + `herdr-stall` on a schedule                                                                                                                           | `harness ledger watch` runs in its own hc terminal (`--name ledger-watch --outlive-parent`; `session spawn` starts it and a name conflict means it already runs) and turns `hc events` into ledger events. hc 0.1.21 takes `--label` as `K=V` only, so the watch follows every event, reads each event's terminal with `get`, and records only the terminals that carry `kore-session`. Stalls are `blocked` or `error` events, not timing guesses                                                                                                                                                                                                                                                                                                                                                                                                      |
| `session check`               | role from the pane title                                                                                                                                             | role from the `role=` label. An agent terminal with no `kore-session` label is unmanaged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `session close`               | `pane close`, refused for others' panes                                                                                                                              | `kill` + `remove`, refused unless the terminal is the caller's child (hc's `parent` field)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Model check                   | screen scrape after launch                                                                                                                                           | deleted: the model is set explicitly in the launch argv and recorded in the `model=` label and the launch event (decided 2026-11-22)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Layout, equalize, tabs        | `pane split` / `pane layout` / `pane resize`; a new tab per pane and grilling pairs in their own tab, because `herdr agent read` came back blank from shrunken panes | deleted. hc reads do not depend on the view, and results arrive as reports, not screen text. The owner sees every terminal in herdr-app (or with `hc attach`) without the harness arranging anything                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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

**Removed by the switch** (Step 6, after the live proof):

- `session equalize` and `equalize.ts`; pane splitting and placement in
  `spawn-pane.ts`
- `handoff.ts`, the FIFO (Decisions 6)
- the start retries in `agent-start.ts` and `checkModel`; the paste-race
  retry in `launch.ts`
- the read-back counting in `notify.ts` and `ansi.ts`; `session notify`,
  replaced by `session report`
- the `RESULT` scraping in `wait.ts`, the orchestrator's `collect` and the
  review IO
- the pane-title parsing in `check.ts`; `live-sessions.ts`
- `ledger/herdr-poll*` and `herdr-stall`, and their start from `hook record`
- `guard-agent-start`'s herdr form, the herdr context hints, and the herdr
  test support
- the typed sender line in pane messages (Decisions 2)
- the retro's herdr transcript recognizers, once no transcript inside the
  retro window has herdr lines (30 days after the flip)

**Reviewed from evidence** (Step 6). A judgment session counts how often each
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

- [x] Pin `hc` without mise (it is not in the mise registry): `hc update`
      downloads "the latest release" from a source it does not print, and
      `--version X.Y.Z` is a floor, not an exact pin, so the pin is the exact
      `hc --version` check below plus a host-setup note (`hc update --version
X.Y.Z` as the floor, `hc update --from <file>` for an exact binary or
      signed app). Say in the pin record that mise cannot pin the macOS bundle.
      Compatibility evidence follows the pin-upgrade skill. Both hosts run
      0.1.21 today. `HcTerminals` compares `hc --version` exactly once per
      process and fails closed, naming the pinned version and the install
      command, on a mismatch or a missing binary. Both hosts must run the same
      hc: the core protocol differs by version. Keep the herdr pin
      (`.mise.toml`) until the flip PR. Where releases are published, and
      whether checksums exist, is an Open Question.
- [x] File the writer sandbox as its own idea (through the idea command),
      citing #337, which is closed while ADR 0095 says wiring is pending.
- [x] Declare the `hc-sessions` flag in the flag manifest, off in every
      overlay. Step 5 is its proof run; Step 6 retires it after a soak.
- [x] ADR "Agent sessions follow hc's model behind a Terminals port".
      It supersedes ADR 0078's herdr pane mechanics and refines
      ADR 0123 (wait through `hc wait`; the result
      comes from the child's report) and the AGENTS.md sender-line rule (hc's
      tag carries provenance).
- [x] ADR "A session's token is made inside its launch wrapper from the
      identity store". It supersedes ADR 0096: the FIFO handoff is removed.
- [x] Fold the Findings and the Grilled Decisions into the ADR: labels for
      identity, the launch wrapper for the token, no API `env` for secrets, the
      report file, the delivery terminal and the group label.

### Step 2: Port, fake, contract

- [x] `terminal/` with the port, `TerminalError`, `FakeTerminals` and
      `terminal/contract-support.ts` (not a spec file, so each source keeps its
      one spec): `terminalContract(make)`, the stateful contract (run, wait,
      read, kill, remove, parent and child, labels). `FakeTerminals.spec.ts`
      runs it, because the fake is shipped code and has nothing to mock.
- [x] `HcTerminals.spec.ts`: a unit over a mocked `Runner` and per-method
      recorded `--json` fixtures, each named with the hc version: argv built,
      JSON parsed, errors mapped. The stateful contract cannot run on a
      scripted runner, so it runs against the real `HcTerminals` below.
- [x] An integration tier over a real `hc` core under a scratch `HC_SESSION`
      and XDG dirs (`tools/harness/integration/terminal/`). `terminalContract`
      runs against the real `HcTerminals`, and each settled fact is asserted:
      a parent's exit ends its child (`die_with_parent`); `run --parent` from a
      caller that is not a terminal; `hc ls --all` lists a terminal that finished
      while nobody watched; a plain shell parent reports `status` null and
      `reported` false; a holder crash ends a live terminal as `finished` with
      reason `holder_lost` and no exit code. The tier never touches the owner's
      core. It skips, naming the reason, on a host without hc: CI has no hc, so
      the gate runs on hosts with the pinned hc (the Step 5 live proof).
- [ ] Owed, not settled by Step 2: a core restart keeps its terminals (the brief
      barred `hc server restart`, and `hc server stop` ends live terminals); an
      exit note reaches an agent parent and `--no-notify` keeps it out (needs a
      real claude parent); an agent parent reports a status object where a shell
      reports null (needs a real claude parent). Step 5 runs these on a host with hc.

### Step 3: Reporting

An `hc send` report reaches the parent as its next input, never as the output
of `hc wait` (`hc --skill`), so the report is a file and the send is only a
notice (Grilled Decisions 1).

- [x] `harness session report --outcome done|blocked (--summary <text> |
--file <path>)` writes `.kore/report/<session>.json` (`seq`, `outcome`,
      `summary`, `at`), then runs `hc send <parent> "<name> <outcome> seq <n>:
<path>"`, in that order, so a notice never names a missing file. The
      parent comes from `hc get "$HC_TERMINAL_ID"` (`.parent`). The file lives
      under the `cwd` the terminal was launched with (`hc get`, `.cwd`): the
      worktree for a writer, the main checkout for a reader or judge. Every
      role's brief ends with the command. It replaces `session notify`, and the
      role guard allows it for every role, while a raw `hc send` stays refused.
      The notice has a fixed shape and never carries the summary, so a child
      puts no free text into the parent's prompt and nothing reaches `ps`.
- [x] `session wait` is `hc wait <terminal>`, then reads the report with a
      `seq` above the last one it consumed. A wait that ends on `timeout` means
      still working. A terminal that stopped (done, idle or exit) with no unread
      report returns `blocked`, "stopped without a report", with the last
      `hc read` lines; `blocked` and `error` status return `blocked` at once.
      Only a report makes `done`. `session close` reads the file before it
      removes the worktree.

### Step 4: Rebuild the tools (behind the `hc-sessions` flag)

One PR per tool, each test-first against `FakeTerminals`:

- [x] (0) `harness session exec`: scrub, mint from the store, fail closed, exec. Specs cover a missing store item, an undecryptable store, a failed mint and an inherited `GH_TOKEN`, and check that none of them prints a value. It lists the exact claude argv: `--agent <role>` with `--agents <json>` (the role's definition read from the main checkout's `.claude/agents/<role>.md`, never the worktree's; a role with no file or no description is refused, naming it, #1867), `--model`, `--effort`, `--permission-mode bypassPermissions`, `--setting-sources user` with `--settings <main checkout>/.claude/settings.json` (`--settings` alone is additive, so the writer-editable worktree settings would still load), and the brief as the positional prompt. At start it fails closed, naming any flag that `claude --help` lacks (`--agents` included); an integration spec (it runs the real claude) fails the same way, and runs the reader and the writer with their definitions under `--setting-sources user`. claude has no pin (2.1.329 on the Mac, 2.1.330 on kore-agents): the launch event records its version. Code Mode is off for every launched role (#1872): claude has no flag for it, but it reads `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE` from the launched process's environment, where a `0` is an off that wins over the `1` in the user settings' env block, so `session exec` sets `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=0` and the role's session has the Bash tool the role guard reads, not the REPL. claude must be 2.1.330 or later. 2.1.330 is the only version tested (the integration spec runs the installed claude with the switch off and on), and the Mac runs 2.1.329, so the Mac must update claude before hc-sessions is on; an older one, or one whose `--version` prints no version, is refused, naming the switch. The guard refuses a read-only role's REPL call under role-read-only, since the guard cannot read its JavaScript.
- [x] `session report` derives the file from the session record matched by
      `HC_TERMINAL_ID`, never from an argument, and refuses when no record
      matches. The guard refuses an `HC_TERMINAL_ID=` prefix. `session close`
      reads the report, then deletes a main-checkout file after its ledger
      event; a writer's file goes with its worktree. `session check` lists a
      report file with no open record; no new cleanup command. This is
      correctness, not a security boundary, until the sandbox idea lands:
      merge decisions already come from pull request state, never from a
      report.
- [x] The tick's "needs a person" and reserved-question lines
      (`orchestrator/tick-notify.ts`, `tick-cli.ts` `attendedPane`) go to the
      one live local agent terminal labelled `kore-attended=1`, which the owner
      or main session sets with `hc label`, never to the idea's latest
      `callerPane` (today that is whichever pane spawned the idea's latest
      session, sometimes the tick's own shell). With none live nothing is typed
      and nothing is recorded, so the next pass tries again, as it does today
      with no pane; the dedupe stays keyed on idea and state, not on the
      terminal, so a relabelled or restarted terminal is not told twice. The
      owner digest lists reserved questions only, so it is not a fallback.
      `callerPane` is deleted from the record.
- [x] No brief names a terminal address. `session/brief.ts` stops naming
      `callerPane` and the notify command; a brief says "run `harness session
report`", and for a pair "run `harness session send <peer name>`", the
      peer's session name being a name and not an address. The RESULT spec
      also fails a shipped brief that contains `t\d+`, `kore-agents/t\d+` or
      `wN:pN`. `judge/review-run.ts` stops printing a pane id and passing it
      from wait to read.
- [x] A report file also holds an optional `plan` (the judgment briefs' PLAN-JSON), so one file per session carries the summary and the plan.
- [x] Replace every shipped mention of the `RESULT` line with `session report`: `.claude/agents/writer.md` and `principles-review.md` (check the other agent definitions' reporting text), `session/brief.ts`, `orchestrator/judgment-briefs.ts` (including its PLAN-JSON and SUMMARY markers), `retro-launch.ts`, `tick-branch-notice.ts`, `judge/review-run.ts` and `resample-run.ts`, `hook/context.ts` and `context-deps.ts`. A spec fails if a shipped brief or agent definition still names a `RESULT` line. Docs, ideas and retros are history and stay.
- [x] The notice goes only to a parent that is an agent terminal (`hc get`:
      `status` is not null; `agent` is null for both kinds, so it is not the
      test). A parent that has not reported yet looks like a shell and gets the
      file alone, which fails safe. A non-agent parent (the delivery shell) gets the file alone, because `hc send` types into the foreground program or, once it exits, into the shell. Children of the delivery terminal start with `--no-notify` for the same reason, and the tick reads the report files.
- [x] (a) spawn: parent is `HC_TERMINAL_ID`, else the one live local terminal
      labelled `kore-delivery=1` (none or two is an error with a hint, never
      `--outlive-parent` or `--no-parent`); a `group=<name>` label for a pair;
      names kept to hc's charset (the current session names already fit). A
      brief over 128 KiB goes to a file and the argv names its path. It also
      starts `ledger watch` (see (e)). The session record is written, in the
      main checkout, before the terminal starts (Grilled Decisions 5). Every
      tool routes by the record's `backend`, in one place: the Terminals
      factory (Grilled Decisions 6).
      (b) send, to the parent, children and group siblings only; (c) wait and
      result, including orchestrator `collect` and review IO, and the
      `callerPane` readers in `orchestrator/tick-cli.ts`, which move to
      `hc get` `.parent`. The tick's `state()` also reconciles on start: an
      unclosed record whose terminal is `finished` or absent (`hc ls --all`) is
      recorded `blocked`, "lost with its parent", the worktree is reused and
      nothing is respawned; a terminal that is only `error` is not lost. Today
      a gone pane makes the tick throw "Could not read the result". (d) close
      and check. `session close` writes its own
      ledger event before it removes a terminal.
- [x] (e) `ledger watch` from events: on start and reconnect it reconciles
      from `hc ls --all` (a terminal that finished in the gap still has its
      final status), writing an event for each terminal whose status differs
      from the last recorded one (key: terminal id, status, turn), then follows
      `hc events` (every event; the `kore-session` label is checked per terminal, see Ledger events). (f) a PR wait on hc children, the wait row's design: `gh pr checks <n> --watch --fail-fast` in an hc terminal, then `wait --children any`.
- [x] Neutral ledger source; hook recognizers; context hints. The role
      guard refuses raw `hc label`, `hc run` and `hc exec` beside raw
      `hc send`, because a label is mutable and an agent could rewrite its own
      role; the guard corpus gains each form.

With the `hc-sessions` flag off (it is off in every overlay), today's herdr path runs unchanged. That makes this a
dark launch.

### Step 5: Live proof on hc

Step 5 does not start before the outcomes of ideas 0009, 0010, 0012, 0019,
0020, 0021 and 0023 are recorded (due 2026-11-30): their measurements read
`session wait`, `pane.finished`, the `RESULT` line, the `KORE_*` stamps and
signed sends, and the loop's ledger has fed them since 2026-11-20. Steps 1 to
4 add code behind a flag that is off, so they change none of those events.
Before Step 5 the flow report splits every figure that reads these events by
ledger `source` (`herdr` or `terminal`) and never compares across.

The loop on any host reads `infra/environments/local/environment.yaml`
(`orchestrator/local-flag.ts` fixes the environment to `local`), so
activation is a merged change to that file, after which kore-agents pulls and
rebuilds. The proof runs on kore-agents; its outcome is recorded from the Mac
session, because kore-agents never records outcomes, and `harness flag
activate` runs once afterwards. The Mac needs only `session check` and the
small-split read.

- [x] From an hc terminal: spawn a writer in a worktree, send, then wait
      for its report. Run check, `ledger watch`, close, and `harness wait
--pr`. Record the outcome on the tracking issue (Refs until green).
- [x] Read a writer while herdr-app shows it in a small split, to prove that
      reads and reports do not depend on the view.
- [x] With a decoy `GH_TOKEN` in the core's login environment, a spawned
      writer's `gh api /installation/repositories` shows the kore-writer App
      (with `owner-writer` off), never the decoy. A removed store item ends
      the terminal with a message naming the item, and no claude starts.
- [x] A writer's guard hooks still fire under `--setting-sources user` and the
      main checkout's `--settings`, and its worktree `.claude/settings.json`
      cannot loosen them.
- [x] Three writers at once, with one forced `blocked` (a permission
      prompt), to prove that hc announces it and the ledger records it.

### Step 6: Flip, contract and prune

- [ ] Make hc the only path. Delete the herdr call sites, `equalize`,
      `spawn-pane` splitting, the paste-race retries, `herdr-poll` and
      `herdr-stall`.
- [ ] Run the evidence review (Pruning), get the owner's approval of the
      removal list, then remove, one PR each.
- [ ] Add a guard test: nothing outside `terminal/` names a backend
      binary or reads its environment.
- [ ] Update `GLOSSARY.md`. New terms: Terminal, Report, Delivery terminal,
      Group. Rewrite Pane result (Session result, with Pane result under
      Avoid), Rework, Unmapped event (a terminal with no role label), Silent
      session ("no report since", "its terminal"), Finish detection and
      Follow-up (hc's tag, not "always carrying a sender line"), and Branch
      update notice ("signed"). Meanings change with the source: finish
      detection from `hc events` notices almost at once and `pane.stalled`
      becomes a `blocked` or `error` event, so the terms say they are read per
      source. Ledger event names (`pane.finished`, `pane.stalled`) stay.
- [ ] Update AGENTS.md (role panes start through `session spawn`; read
      `hc --skill`), `skills/spawn-session`, the session hints, and the
      memories "panes in a new tab" and "grilling pairs get their own tab",
      which were workarounds for herdr reads. Fix the AGENTS.md line "hands
      them their token and sandbox" to name only the token until the sandbox
      idea lands. Document that the Mac main session reaches the delivery
      terminal with `hc send kore-agents/<id>`, replacing the ssh and herdr
      relay.
- [ ] The flip PR merges only when `session check` on the Mac and on
      kore-agents reports no live herdr session and `hc --version` on both
      hosts matches the pin; the run is recorded on the tracking issue. A live
      record with no terminal id after the flip is an error naming
      `session close --force-record`, which this step adds and which only
      removes the file and is refused while the record's terminal is live in
      hc. Closed old records stay readable.

## Decisions (owner, 2026-11-22)

1. **Lifetime: hc's default.** Spawned sessions are children of the terminal
   that spawned them and end with it. Only long-lived helpers such as
   `ledger watch` use `--outlive-parent`. Worktrees and branches survive a
   parent's crash.
2. **Provenance: hc's tag.** `<hc from="t7 name">` replaces the typed
   `sender:` line. The AGENTS.md rule _Every agent message names its sender_
   is rewritten in Step 6 to point at hc's tag.
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

## Grilled Decisions (2026-11-22)

Settled in the grilling of this plan. They bind the plan once the owner has
read it; none is an owner-reserved decision.

1. **A report is a file, the send is a notice.** An `hc send` to the parent
   arrives as the parent's next input and never ends or feeds an `hc wait`, so
   `session wait` cannot receive it. `session report` writes
   `.kore/report/<session>.json` with a rising `seq` first, then sends the one
   line `<name> <outcome> seq <n>: <path>`. The harness builds the path from
   the session name and rejects a `--file` outside the report directory, so
   the notice carries no free text. A report is the only thing that makes
   `done`; a stopped terminal with no unread report is `blocked`.
2. **Parent for a caller that is not a terminal.** `session spawn` uses
   `HC_TERMINAL_ID`, else the one live local terminal labelled
   `kore-delivery=1`, else it fails with a hint. The delivery loop
   (`orchestrate tick --loop`) is a plain shell terminal with that label and
   runs the tick inside it, so the tick has `HC_TERMINAL_ID` itself. A crash of
   the delivery terminal ends every session it started; worktrees survive.
3. **Pairs talk through a group label.** `session spawn` sets `group=<name>`;
   `session send` reaches the parent, children and siblings with the same
   group, nothing else.
4. **The help guide is plan 17,** not part of this plan.
5. **The session record** (main checkout, written before the terminal starts)
   holds worktree and branch, creation and close times, the terminal id, the
   `backend` (`herdr` when absent, so every old record routes to herdr), a
   schema `version`, the role, name and idea, and the last report `seq`
   consumed. Liveness, status, parent and model come from hc. A hook finds its
   role by `HC_TERMINAL_ID` in the record and cross-checks it with
   `hc get`; a guard still has its role when hc is down, because a writer's
   sandbox cannot write the main checkout and a hook cannot create a cache
   there. Identity is never read from the environment.
6. **Every tool routes by the record's `backend`,** never by the flag, in the
   one Terminals factory. A close, wait or check of an hc record with hc
   unreachable fails with a hint and never falls back to herdr. New spawns
   follow the flag at spawn time only.
7. **The switch is the `hc-sessions` flag,** off in every overlay, activated
   only after the Step 5 outcome and retired in Step 6.
8. **`ledger watch` is one terminal per core,** started by `session spawn`
   under the fixed name `ledger-watch`; a name conflict means it runs.
9. **No cross-machine spawn.** `Terminal.id` is opaque and may carry a machine
   prefix; spawn always runs on the caller's machine.
10. **A session lost with its parent is `blocked`.** hc ends a child with its
    parent (`die_with_parent`); a core restart or update keeps terminals, a
    reboot or holder crash does not. The tick records a finished or absent
    terminal as `blocked`, "lost with its parent", reuses the worktree and
    never respawns. The briefs must not say a session is never lost.

## Open Questions

1. **Where hc releases are published, and whether checksums exist.** `hc
update` names no source and its `--version` is a floor. Settle it with the
   hc vendor. Step 1 does not wait: it pins by the exact version check.

## Findings (2026-11-22)

- **Labels.** `hc run` takes `--label` more than once, and `hc get` returns all
  of them. Labels replace the `KORE_AGENT`, `KORE_ROLE` and `KORE_IDEA` stamps.
  The ledger hook and the sender code read the role, name and idea from the
  session record by `HC_TERMINAL_ID` and cross-check with `hc get` (Grilled
  Decisions 5). Pane messages carry hc's tag. GitHub text keeps a
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

- **Sandbox.** ([idea 0078](../../docs/ideas/0078-writer-sandbox-denies-the-hc-socket-and-credentials.md), citing the closed #337, is filed in Step 1.) No writer sandbox is in force today, on macOS or on Linux. The
  profile lives only in `tools/harness/tests/writer-sandbox-support.ts`, and
  ADR 0095 says wiring it into spawn is pending. So the switch to hc loses no
  sandbox. It does need these changes:
  1. A launch wrapper (Decisions 6) replaces herdr's `pane run` step.
  2. Spawn and the wrapper refuse to start a session with empty role or
     session labels.
  3. `session check` lists hc terminals. Otherwise it reports clean while hc
     writers run unmanaged.
  4. The read-only role guard allows hc's read commands (`hc get`, `ls`,
     `read`, `wait`) and `session report` and `session send`; a raw `hc send`,
     `hc label`, `hc run` and `hc exec` stay refused. Today it refuses
     `hc --help`, so a reader cannot report back.
  5. When the sandbox is built (separately, on both platforms), it denies the
     hc socket (`HC_SOCKET`). Otherwise a sandboxed writer can escape with
     `hc run` or `hc exec` as the owner. On Linux it must also deny
     `~/.config/kore` and `~/.config/sops`.
- **Launch.** The investigation flagged hc's `invalid_template` check on shell
  characters. Plain argv launches worked in every test here
  (`claude --agent reader --model … "<brief>"`). Confirm a brief with quotes
  and newlines in Step 5.

### Research round 2 (2026-11-22: Haiku researchers in hc terminals on kore-agents, and a session on the owner's Mac)

- **Launch argv.** `hc run` passes a multi-element argv byte for byte:
  quotes, newlines, `$VAR`, backticks, `;` and unicode all arrive unchanged,
  and nothing is expanded. A single element containing whitespace or a shell
  sign becomes `sh -c <line>`, so the adapter always passes separate
  elements. The kernel caps one argument at 128 KiB, so a longer brief goes to
  a file and the argv names its path.
- **Parent address.** On both hosts a child gets `HC_TERMINAL_ID`,
  `HC_TERMINAL_SOCKET` and `HC_SCOPE`, but no parent variable. It learns its
  parent from `hc get "$HC_TERMINAL_ID" --json`, field `.parent`.
- **Inherited herdr variables.** On the Mac, hc terminals inherit
  `HERDR_ENV`, `HERDR_PANE_ID` and the other `HERDR_*` variables from the
  core's start environment, so an hc terminal can look like a herdr pane. The
  adapter detects hc by `HC_TERMINAL_ID` alone, and the launch wrapper unsets
  every `HERDR_*` variable.
- **Secrets, confirmed on macOS.** The FIFO leaves no trace. The API `env`
  value is written to `terminals.json` (`restart_env`, mode 0644, so
  readable by every local user) for as long as the terminal exists.
  `hc send <t> <secret>` shows the value in `ps` while it runs.
- **Failed launch.** A program that prints a message and exits 3 shows up as
  `exit_code: 3` in `hc wait --json` and `hc get --json`, and its message is
  in `hc read`. The spawner can report a wrapper failure verbatim.
- **Permission mode.** On both hosts bypass mode comes only from
  `~/.claude/settings.json` (`defaultMode: bypassPermissions`). The wrapper
  pins it in claude's argv.
- **Trusted bundle.** Hooks in a writer's worktree run the worktree's own
  `.claude/hooks/harness.sh` and `skills/bin/harness.mjs`, both editable by
  the writer, and nothing sets `KORE_HARNESS_BUNDLE`. The wrapper is started
  by absolute path from the main checkout's bundle and finds the main root the
  way `bundleMainRoot` does (`runtime/main-root.ts`). It sets
  `KORE_HARNESS_BUNDLE` to the main bundle for claude, refuses a bundle path
  inside the worktree, and passes claude a settings file from the main
  checkout (check that the pinned Claude Code supports this).
- **Role guard.** The read allowlist is `readMayRun`
  (`hook/guard-role-allow.ts`), and hc is in no branch of it. The reader,
  principles-review and judgment roles get an `HC_READS` list: `hc get`,
  `ls`, `read`, `wait` and `--help`. The judge gets none. A raw `hc send`
  stays refused, and reports go through `session report`.
  `guard-agent-start` and the guard corpus gain the hc form of a bare role
  launch.
- **Identities.** On the Mac all twelve `kore.<role>.*` App items are in the
  keychain and `kore.judge.pat` is absent. With `owner-writer` on, the judge
  uses the minted kore-judge token, so the PAT matters only if the flag goes
  off. Both flags are on in local.
- **Command usage, 30 days.** These are Bash calls only; hooks, CI and
  background starts are not counted.
  - **kore-agents:** 39 of 76 commands ran.
  - **Mac:** 61 of 74 commands ran (2,334 transcripts). The delivery loop moved
    to kore-agents around 2026-11-20.
  - **Run on neither host:** `decision digest`, `decision route`,
    `guardrail activate`, `orchestrate plan`, `orchestrate run`,
    `queue escalate`, `queue send-backs`, `review resample` and
    `session check`.
  - **Run but obsolete under hc:** `session equalize` (38 runs on the Mac)
    and `ledger poll-herdr` (2).

  `hook feedback`, `hook record` and `hook statusline` run as hooks, and
  `orchestrate tick` ran twice. A command that has not run is a candidate
  only. The review also checks it against the workflows, settings hooks and
  mise tasks, and against whether it backs an approved but not yet activated
  mechanism (for example `guardrail activate` and `queue escalate`).

### Step 2 facts (2026-11-22: real hc 0.1.21 under a scratch HC_SESSION)

Settled by `tools/harness/integration/terminal/` (`hc-core.spec.ts` runs
`terminalContract` over the real `HcTerminals`; `hc-facts.spec.ts` asserts each
fact). The fixtures in `hc-0.1.21.fixtures.ts` are hc's own replies, recorded from
the same core. Where hc differed from this plan, the port or the adapter changed:

- **Parent exit ends the child.** `die_with_parent` is true for a child, and its
  parent's exit (or kill) ends it. Confirmed.
- **`run --parent` from a caller that is not a terminal** works; the scratch
  environment has no `HC_TERMINAL_ID`. Confirmed.
- **Errors are printed on stdout** with exit codes 1, 3, 7 and 11, not on stderr.
  `hcFailure` reads stdout first (the adapter read stderr only).
- **The listing carries no labels or exit codes** beyond `exit_code` on exited
  rows. `list` reads each terminal with `get` for its labels.
- **`read` returns the screen plus the history above it**, with `how`. Its
  `complete` flag is true for a 300-line output asked for 2 lines, so it does
  not mean "all the output". The port drops `complete`; `read` is "at least the
  lines asked for".
- **`run --parent` accepts a finished parent**, and the child starts live and is
  never ended. The adapter refuses first (`not-live`).
- **`wait --children any` reports only news that arrives while it waits.** A child
  that stopped before the call is not news, and the reply can name no child (empty
  `children`, reason `children`). The adapter reads the finished children from the
  listing, so the contract starts the wait before the child finishes.
- **`hc ls --all` lists a child that finished while nobody watched it**, with its
  exit code and reason. `hc ls` lists only live terminals. Confirmed.
- **Event types.** `hc events --json` opens with a snapshot line (`channel`, `seq`, `terminals`, no JSON-RPC wrapper), then one JSON-RPC `event` notification per change, typed by `params.type`, and a `{"jsonrpc":"2.0","method":"heartbeat","params":{"seq":N}}` line about every 20 s (no terminal, read as no events; its absence from the first capture is why the live watch died, see #1868): `created`, `foreground`, `labels`, `status`, `finished` and `removed` (captured 2026-11-22 on hc 0.1.21). The ledger watch reads each of them as changed, except `finished`, and reads the event's terminal with `get`.
- **A plain shell parent reports `status` null and `reported` false**, and its
  listing row has `agent: "sh"`. Confirmed.
- **A holder crash ends a live terminal** with `state: finished`, `reason:
holder_lost` and no exit code. A finished one keeps its exit code. The core
  survives. Confirmed.
- **`hc server stop` ends a live terminal** with `reason: server_stop`, unless it
  is kept. **Not settled:** "a core restart keeps terminals" (this plan, Decisions
  and Step 2). The brief for this step barred `hc server restart`, so it was not
  run; stop is not restart. It is owed to a run that may restart, and the plan
  must not claim it until then. A reboot is not tested either.
- **Exit notes.** No note reached a plain shell parent, with `--no-notify` or
  without it, and none reached a stand-in agent named `claude`. The positive
  control (a note that `--no-notify` suppresses) needs a real claude parent, so
  the `--no-notify` claim is **owed to Step 5**, and the spec asserts only the
  plain-shell case.
- **Agent status object** (against null) needs a real claude parent. A stand-in
  named `claude` reports status null too, so the status test cannot yet tell an
  agent from a shell by `status`. **Owed to Step 5.**
- **Launch caution.** A bare program name resolved on the core's PATH, which the
  core inherits at start, so a stand-in named `claude` was not used on one run.
  The wrapper (Step 4) starts by absolute path, so this matters only for tests that
  name a program; the integration spec names only `sh`.

Port changes that follow from these: `Output` is `{ text }`; `list` reads labels
per terminal; `run` refuses a finished parent; `wait` on children reads the
finished children from the listing; `hcFailure` reads stdout.

## Next

**Step 5 done under an owner waiver (2026-11-23).** `hc-sessions` is on in the local overlay (#1887) on the owner's waiver of the remaining live run ([idea 0081](../../docs/ideas/0081-hc-sessions-verification.md), evidence on #1783); #1783 is closed. Two live runs on kore-agents passed the spawn, send, wait, report, check, close, ledger and `harness wait --pr` path; the removed store item, the worktree-settings loosen attempt, a permission-prompt `blocked`, the kore-writer token and the small-split read were waived, not run. Before a session spawns on the Mac, update its claude from 2.1.329 to 2.1.330 or later (`session exec` refuses less). Left: Step 6. #1784 needs `session check` and `hc --version` recorded on both hosts and a flag soak; #1785 and #1786 follow it; #1787 waits for the owner's approval of #1786's list. Full state: #1765.

## Done When

From an hc terminal, `session spawn` starts a role with `hc run claude --agent <role>`.
The writer reports back through hc, and `session wait` returns that report.
The ledger records the writer's statuses from events. `session close`
removes only the caller's own children. The evidence-based
removal list is applied. The harness does no window layout.
No harness code polls, sleeps,
scrapes a status from the screen, or names a backend binary outside
`terminal/`.
