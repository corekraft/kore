# Factory agent definitions (dark)

Behavioural definitions for the eleven roles of the expectations-first software
factory, graduated from the herdr lab where every case passed in three
consecutive runs. Each role has an `agent.md` (its job) and an
`expectations.md` (the lab cases it passed, unchanged during tuning).

These files are **not live**. `session spawn` reads only `.claude/agents/`, so
nothing here can be started as a role, and no existing role changes. Wiring a
role in is a separate change that must:

- merge its job into the live definition, keeping that definition's harness
  commands (for example `decision make`, `pr open`, `review post`), or add a
  new definition with front matter;
- give a new role a guard group in `tools/harness/src/hook/guard-roles.ts` and
  its bypass-corpus cases before it can be spawned;
- turn on the flag its ADR names: `factory-orchestrator` (ADR 0182),
  `factory-merge` (ADR 0183), the release gate's clearance in
  `flag activate` (ADR 0184); goal check records outcomes (ADR 0185).

Open work is tracked as ideas: the roles under `session spawn` (idea 0088,
#2019), the orchestrator's handoff to the advisor (0089, #2020), the merge on
the principles review verdict (0090, #2021), `flag activate` accepting a
clearance (0091, #2022), goal check's outcomes (0092, #2023), the writer's
100K cumulative token budget (0086, #1988) and the provenance evidence
freshness needs (0087, #1989). Idea 0088 comes first; 0091 needs 0087.
Griller runs only on the owner's machine, where the
`/mattpocock:grill-with-docs`, `/mattpocock:to-spec` and
`/mattpocock:to-tickets` skills are installed; it chains every ticket to
ticket review.

| Role | Model in the lab | Cases |
| --- | --- | --- |
| orchestrator | claude-haiku-5-5 | 2 |
| griller | claude-sonnet-5-5 | 5 |
| answerer | claude-haiku-5-5 | 4 |
| reader | claude-haiku-5-5 | 3 |
| advisor | claude-sonnet-5-5 | 5 |
| ticket-review | claude-haiku-5-5 | 2 |
| writer | claude-haiku-5-5 | 4 |
| principles-review | claude-sonnet-5-5 | 9 |
| evidence-freshness | claude-haiku-5-5 | 3 |
| release-gate | claude-haiku-5-5 | 6 |
| goal-check | claude-haiku-5-5 | 2 |

The lab ran each role in Pi with Opus scoring the visible pane; Answerer and
Advisor reached a separate read-only Reader through a `consult_reader` tool.
Those runs exercised each role's judgment on supplied facts, not Kore's real
tools, so a passing case here is not proof of behaviour under `session spawn`.
