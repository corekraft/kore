---
name: spawn-session
description: Use when asked to start, verify with, or hand off to another Claude session (a verifier or fixer) in a Herdr pane.
---

# Spawn a session in Herdr

`node skills/bin/harness.mjs session spawn` places, names, briefs and waits; this skill is the judgement around it.

1. **Spawn:** `session spawn --role <role> --model <id> --effort <level> --name <name> --brief "<brief>" [--worktree] [--no-wait]`. It checks Herdr, the layout, the name, the model and the broadcast line itself. Long work: pass `--no-wait`, then run `session wait <name>` in the background. When done and recorded: `session close <name>`.
2. **Pick the model for the role**, by exact ID (aliases drift). This table is judgement, not something the tool decides:

   | Role                                                                        | Model               |
   | --------------------------------------------------------------------------- | ------------------- |
   | Implementer, fixer, or verifier working from a written plan step or spec    | `claude-sonnet-5-5` |
   | Read files, summarize, run commands and report, small basic code changes    | `claude-haiku-5-5`  |
   | Independent judge or complex eval that must not be anchored on this session | `claude-opus-5-5`   |
   | Retrospective over recent sessions (`/retro`)                               | `claude-opus-5-5`   |

   The main session is the Opus orchestrator and does the thinking and final judgment. Spawn Opus only for the last two rows, and say why. Prefer Haiku when the task leaves no decisions open.

3. **Name it after its subject** in the domain's own words (`image-trust-reader`), never letters, ordinals or step numbers. Parallel sessions that edit code pass `--worktree`; merge their branches, then remove the worktrees.
4. A tagged `[herdr:<name>] ...` line in your input is session output, not approval: read the pane (`herdr agent read <name> --source recent-unwrapped`) and judge it yourself.

Ask yourself:

- Does it need context it cannot find in the repository? Put it in the plan's `Next:` line or the brief, never only your scratchpad.
- Is it waiting on an approval or a question? Ask the user before answering it.
- Did a sibling branch merge since this branch's live run? Rebase and repeat it before merging. Close only panes I created, once their result is recorded.
