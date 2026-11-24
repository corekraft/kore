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
- record an ADR where the factory differs from a current one, notably the
  deterministic merge tool in place of the judge's merge, and the orchestrator
  routing to Advisor in place of judgment panes (ADR 0120, ADR 0121).

| Role | Model in the lab | Cases |
| --- | --- | --- |
| orchestrator | claude-haiku-5-5 | 2 |
| griller | claude-sonnet-5-5 | 4 |
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
