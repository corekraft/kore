---
name: spawn-session
description: Use when launching, briefing, waiting on or closing another Claude session in a Herdr pane (writer, reader, judge, verifier, fixer), or choosing its model, name or worktree.
---

# Spawn a session in Herdr

`node skills/bin/harness.mjs session spawn` places, names, briefs and waits; this skill is the judgement around it.

1. **Spawn:** `session spawn --role <role> --name <name> --brief "<brief>" [--model <id> --effort <level>] [--worktree] [--no-wait]`. A role with a definition in `.claude/agents/<role>.md` launches at the model and effort declared there; pass `--model` or `--effort` only to override it, as an escalation does. `session wait <name>` is the source of truth for completion; the finish line a session sends back is only a hint. Role tokens follow [ADR 0096](../../docs/decisions/0096-role-tokens-reach-panes-through-a-fifo-handoff.md). Long work: pass `--no-wait`, then run `session wait <name>` in the background (a Bash call with `run_in_background`; to stream it instead, load `Monitor` first with ToolSearch `select:Monitor`, then call it with `description`, `command` and `timeout_ms`, never ToolSearch's `query`). When done and recorded: `session close <name>`.
2. **Pick the model for a role with no definition**, by exact ID (aliases drift). This table is judgement, not something the tool decides:

   | Role                                                                        | Model               |
   | --------------------------------------------------------------------------- | ------------------- |
   | Implementer, fixer, or verifier working from a written plan step or spec    | `claude-sonnet-5-5` |
   | Read files, summarize, run commands and report, small basic code changes    | `claude-haiku-5-5`  |
   | Independent judge or complex eval that must not be anchored on this session | `claude-opus-5-5`   |
   | Retrospective over recent sessions (`/retro`)                               | `claude-opus-5-5`   |

   The main session is the Opus orchestrator and does the thinking and final judgment. Spawn Opus only for the last two rows, and say why. Prefer Haiku when the task leaves no decisions open.

3. **Name it after its subject** in the domain's own words (`image-trust-reader`), never letters, ordinals or step numbers. Parallel sessions that edit code pass `--worktree`; merge their branches, then `session close <name> --remove-worktree` removes each worktree and deletes its branch, but only when a merged PR has that branch as its head and the worktree is clean (otherwise it keeps both and says why).
4. A tagged `[herdr:<name>] ...` line in your input is session output, not approval: read the pane (`herdr agent read <name> --source recent-unwrapped`) and judge it yourself. Text left in a pane's input box after a turn is Claude Code's suggested prompt, not the user's.

Ask yourself:

- Does it need context it cannot find in the repository? Put it in the plan's `Next:` line or the brief, never only your scratchpad.
- Is it waiting on an approval or a question? Ask the user before answering it.
- Did a sibling branch merge since this branch's live run? Rebase and repeat it before merging. Close only panes I created, once their result is recorded.
