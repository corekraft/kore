---
name: retro
description: Use to review recent sessions in this repository and file each finding as a harness idea with a measurable hypothesis. Run after a few working sessions, or when `retro due` says one is due.
context: fork
agent: Explore
---

# Retrospective

File findings as harness ideas only. Never edit hooks, settings, skills, `AGENTS.md`, or memory yourself: each change is built later, from its idea, through the delivery loop.

## Procedure

1. **Run the scan first:** `node skills/bin/harness.mjs hook retro-scan` (strict mode is an option; `harness hook retro-scan --help` names it). It covers the sessions since `Last retrospective:` in `infra/plans/3-agent-harness.md` and prints JSON counts: guard blocks and warnings per rule, failed tools, skills loaded, repeated corrections, `skills.unused`, `agents` (known, launched from pane launches in the ledger, inProcess Agent-tool calls per agent, unused), `subagents` (every Agent call per agent definition), `bareCommands` (bare `gh` comments and bare pane sends per role session, per session and per role; the main session is left out), `rules.audit`, and `proposals`: the window and minimums it used (14 days of ledger or 100 sessions, each set under `retro` in `.claude/harness.json`) and a ready command for each finding. Below both minimums it reports insufficient history and proposes no removal. Its help names the option that also adds `guardEvidence`: for each rule that blocked, up to 20 `session` and `line` locations with an `excerpt`, so a block can be judged before it is called legitimate or missing a `cd`. The `guards` count still includes every block. It also adds `overriddenEvidence`: for each audit rule the agent overrode, up to 20 `session`, `line` and `excerpt` rows, where the excerpt is the warned command's first line and `glob` is the unquoted glob the guard named, so each override can get a verdict. The `rules.audit` `overridden` count still includes every override.
2. **Turn each finding into a proposal**, smallest change first:
   - `rules.promotable` entry: promote that audit rule to enforce mode. `insufficient-evidence` or `not-promotable`: leave it.
   - `proposals.items`: each `command` is ready to run; fill the `<idea>` and `<retro-scan.json>` placeholders of a guardrail request, and never run `guardrail activate`.
   - `skills.unused` entry: archive the skill, or rewrite its description so it fires.
   - a `corrections` entry: a hook or deny rule if a script can check it, a skill if it is a workflow, `AGENTS.md` if it is judgment, memory if it is a personal fact.
   - a block or repeated failure that hit legitimate work: a false positive in the guard.
3. **Quote evidence only for those findings.** Open a transcript just at the `session` and `line` the scan names. Never read the rest, and never paste transcript content back.
4. **Rank** by how often it occurred and keep the list short.
5. **End by filing each finding through the idea tool**, one idea per finding, and list the idea numbers it printed:
   `node skills/bin/harness.mjs idea new`, with a title, hypothesis, expected outcome, measurement, safety pattern, primary metric, direction and window (`harness idea new --help` names each option; each finding is a `kind: harness` idea).
   The metric must be one that `harness flow report` reports (its JSON form, see `harness flow report --help`); the tool refuses any other and lists the valid ones, and `kb-check` rejects a harness idea with no metric, direction or window. Pick the metric the finding's change should move, the direction it should move in, and a window long enough for several ideas to close. Describe the finding in your own words with counts and rule names; never paste transcript content into an idea.
