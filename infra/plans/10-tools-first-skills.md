---
status: done
summary: Move the deterministic steps of skills and hooks into the harness package, so each skill is a short description plus tool calls.
last-verified: 2026-11-12
---

# Tools-First Skills Plan

## Purpose

Skills ask the model to do deterministic work by hand. That costs tokens,
invites mistakes, and keeps cheap models from running the loop. This plan
moves that work into the harness package
([ADR 0082](../../docs/decisions/0082-harness-package-bundled-for-skills.md)).
Each step reports its effect against the plan 8 baseline.

## Principles

- **A skill is a description and tool calls.** Description at most 200
  characters, body at most 25 lines, detail in reference files read on demand.
- **Behaviour first.** Each port pins current behaviour with tests before
  moving it.

## Step 1: write-adr Tool

### Work

- [x] Add an `adr` domain: `new` picks the next number, writes the file name
      and frontmatter, and adds the index entry; `supersede` updates the old
      ADR.
- [x] Shrink `skills/write-adr/SKILL.md` to judgement plus tool calls.

### Exit Criteria

- A new ADR passes kb-check without hand edits to numbering, frontmatter or
  the index.

## Step 2: spawn-session Tool

### Work

- [x] Add a `session` domain that launches
      `claude --agent <role> --model <model> --effort <effort>` in a Herdr
      pane: split direction, pane naming, busy retry, worktree creation, and
      the anchored `RESULT` wait.
- [x] Shrink `skills/spawn-session/SKILL.md` from 46 lines to the budget.

### Exit Criteria

- One tool call spawns a pane, waits for its result and returns it as JSON.

## Step 3: handoff Tool

### Work

- [x] Add a `plan` domain that finds the active plan, ticks items, recounts the
      open-item lists and sets the single `Next:` line.
- [x] Shrink `skills/handoff/SKILL.md`.

### Exit Criteria

- A handoff changes only the lines the tool reports.

## Step 4: Port the Hooks

### Work

- [x] Port `guard`, `context`, `delta`, `feedback`, `kb-check`, `retro-scan`,
      `skill-links` and `workflow-permissions` into harness domains, pinning
      each with its existing tests first.
- [x] Point `.claude/settings.json` at `node skills/bin/harness.mjs hook
<name>`.
- [x] Remove `.claude/hooks/*.mjs` once each is ported. The `*.test.mjs`
      files left in `.claude/hooks/` and `node-test-shim.mjs` are test tooling
      for the commit, workflow and test-runner scripts, not hooks; they already
      run under vitest. That narrower scope is the recorded outcome of #182's
      "no tests" criterion.

### Exit Criteria

- `.claude/hooks/` holds no logic, and every hook test runs under vitest.

## Step 5: Remaining Skills and Enforcement

### Work

- [x] Bring `add-command`, `add-policy`, `pin-upgrade`, `retro` and
      `test-driven-development` within the budget, adding tools where a step
      is deterministic.
- [x] Turn the skill budget audit from warn to fail.

### Exit Criteria

- `node skills/bin/harness.mjs skill audit` passes for every skill, and CI
  fails a skill over budget.

## Results

### Effect against the plan 8 baseline (issue #184)

Measured 2026-11-12T20:10Z. `ledger poll-github` and `ledger poll-herdr` ran
against the shared ledger, then `flow report --json` (version 5) ran with the
same fields as the plan 8 baseline. The baseline reproduces exactly (47
ideas, median lead time 7139 s, max 15397 s, bottleneck `await approval` at
0.8836), so the ledger and the report agree with what plan 8 recorded.

**The comparison is weak, and this section says so before the numbers.**

- **No clean "before".** Plan 10 was delivered on the same day as the
  baseline. Of its 19 completed ideas, 14 closed before the baseline cut
  (2026-11-12T12:00Z) and are inside the baseline's 47. Only #176, #179, #180,
  #181 and #183 closed after it. There is no period of work done without the
  plan 10 tools to compare with.
- **No tokens.** The ledger holds no `token.usage` event, so
  `metrics.tokensPerIdea` reads `insufficient history` (0 closed ideas with
  usage, 6 needed) in every scope below.
- **No session cost per idea.** Session and pane events still carry no idea, so
  `metrics.sessionsPerIdea` is 0 for every idea and says nothing. Refine,
  challenge, orchestrate, write, judge and verify still show no active time,
  and `toil.*Seconds` is 0 in every stage.
- Only GitHub-attributed stages carry data: `await approval` (waiting
  only) and `merge`.

#### Lead time and stage waits, by step

| Scope (ideas)             | Done | Lead median s | Lead max s | Await approval waiting s | Merge waiting s | Merge WIP peak / avg |
| ------------------------- | ---: | ------------: | ---------: | -----------------------: | --------------: | -------------------: |
| Baseline (47, plan 8)     |   47 |          7139 |      15397 |                   342087 |           45047 |             8 / 0.52 |
| Step 1 (#164, #169)       |    2 |        5025.5 |       6248 |                    10051 |            1864 |             1 / 0.30 |
| Step 2 (#165, #170, #177) |    3 |          8151 |      10781 |                    23089 |            4305 |             1 / 0.40 |
| Step 3 (#166, #171, #178) |    3 |          5739 |       8200 |                    17520 |            3016 |             1 / 0.36 |
| Step 4 (8 hook ports)     |    8 |         15224 |      54738 |                   213082 |           18682 |             4 / 0.34 |
| Step 5 (#168, #181, #183) |    3 |         29994 |      54290 |                    89232 |             543 |             1 / 0.01 |
| All plan 10 (19)          |   19 |         11638 |      54738 |                   352974 |           28410 |             4 / 0.52 |
| After the cut (since 12Z) |   10 |       44168.5 |      54738 |                  1495017 |           87882 |             6 / 2.03 |

Step 1 to 3 (the `adr`, `session` and `plan` tools) sit at or below the
baseline median lead time. Step 4 and 5 are higher, but their ideas waited on
blockers: `await approval` is 92% to 99% of waiting time in every scope, the
same bottleneck as the baseline, and the stage mapping still cannot tell a
blocked ticket from an unclaimed one. The later lead times therefore read as
queueing behind blockers, not as the tools costing time. Read them as "no
evidence of a speed-up", not as a regression. Merge waiting (PR opened to PR
merged) for plan 10's ideas peaks at 4 PRs open at once against the baseline's
8, but the scopes cover different numbers of ideas, so this is not an effect.

#### Skill size, a proxy for tokens a skill costs when loaded

`skill audit` passes for all 8 skills (descriptions 82 to 179 characters,
bodies 11 to 25 lines). Body lines before the harness landed (`5c856727^`) and
now:

| Skill                   | Before | Now |
| ----------------------- | -----: | --: |
| spawn-session           |     46 |  29 |
| write-adr               |     29 |  24 |
| handoff                 |     17 |  15 |
| add-command             |     21 |  23 |
| add-policy              |     16 |  18 |
| pin-upgrade             |     19 |  20 |
| retro                   |     21 |  23 |
| test-driven-development |     24 |  26 |

Files are whole-file line counts (frontmatter included). The three skills
that shrank are the ones whose deterministic steps became tools
(`session`, `adr`, `plan`). The others grew by 1 to 2 lines because tool calls
replaced prose without removing a step. This is size, not measured tokens.

#### Does a cheaper model now run skills that needed a strong one?

Not answerable from the ledger. No skill's model changed in plan 10, no
`token.usage` events exist, and sessions have no idea join, so neither cost
nor the model that ran a given skill can be compared. The structural change
(a skill is a description plus tool calls) makes a cheaper model plausible for
`spawn-session`, `write-adr` and `handoff`, but it is untested. Plan 12's
model-tier change goes through approve, measure and revert, which is where
this question gets a real answer.

#### What would make the next report meaningful

1. Record `token.usage` in the ledger (nothing writes it yet), so
   `tokensPerIdea` leaves `insufficient history`.
2. Join session and pane events to an idea, so refine, write and judge show
   active time and `sessionsPerIdea` stops reading 0.
3. Split `await approval` into blocked and ready-and-unclaimed.
4. Take a period after the plan 10 tools are in place and before plan 11's
   agents change the loop, so the "after" is not mixed with other changes.

Plan 10's one open item, removing `.claude/hooks/*.mjs` (#182), is not
finished by this report, so no item is ticked and the plan stays `active`.
