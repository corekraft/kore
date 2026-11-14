---
name: retro
description: Use to review recent sessions in this repository and propose changes to hooks, skills, AGENTS.md, or memory. Run manually after a few working sessions.
context: fork
agent: Explore
---

# Retrospective

Propose changes only. Never edit hooks, settings, skills, `AGENTS.md`, or memory yourself; a human accepts or rejects each proposal.

## Procedure

1. **Run the scan first:** `node skills/bin/harness.mjs hook retro-scan --strict`. It covers the sessions since `Last retrospective:` in `infra/plans/3-agent-harness.md` and prints JSON counts: guard blocks and warnings per rule, failed tools, skills loaded, repeated corrections, `skills.unused`, and `rules.audit`. Add `--evidence` to also get `guardEvidence`: for each rule that blocked, up to 20 `session` and `line` locations with an `excerpt`, so a block can be judged before it is called legitimate or missing a `cd`. The `guards` count still includes every block. It also adds `overriddenEvidence`: for each audit rule the agent overrode, up to 20 `session`, `line` and `excerpt` rows, where the excerpt is the warned command's first line and `glob` is the unquoted glob the guard named, so each override can get a verdict. The `rules.audit` `overridden` count still includes every override.
2. **Turn each finding into a proposal**, smallest change first:
   - `rules.promotable` entry: promote that audit rule to enforce mode. `insufficient-evidence` or `not-promotable`: leave it.
   - `skills.unused` entry: archive the skill, or rewrite its description so it fires.
   - a `corrections` entry: a hook or deny rule if a script can check it, a skill if it is a workflow, `AGENTS.md` if it is judgment, memory if it is a personal fact.
   - a block or repeated failure that hit legitimate work: a false positive in the guard.
3. **Quote evidence only for those findings.** Open a transcript just at the `session` and `line` the scan names. Never read the rest, and never paste transcript content back.
4. **Rank** by how often it occurred, keep the list short, and end with it, each item with a short quote. The calling thread asks the user which to accept, records them in `infra/plans/3-agent-harness.md` or an ADR, and sets `Last retrospective:` to the current UTC time, as `date -u +%Y-%m-%dT%H:%M:%SZ`; this read-only run cannot.

Step 1 is a tool. Steps 2 to 4 are judgement: which change fits a finding and which proposals are worth a human's time are not something a script can decide.
