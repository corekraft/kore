---
name: spawn-session
description: Use when asked to start, verify with, or hand off to another Claude session (a verifier or fixer) in a Herdr pane.
---

# Spawn a session in Herdr

The installed `herdr` binary is the authority for syntax; run `herdr --skill` once if its skill is not in context.

1. **Check you are inside Herdr:** `test "${HERDR_ENV:-}" = 1`. If not, say so and stop.
2. **Split beside the caller, keeping focus:** `herdr pane split --current --direction right --cwd "$PWD" --no-focus`. Read the id from `.result.pane.pane_id`.
3. **Pick the model for the role**, by exact ID (aliases drift):

   | Role                                                                     | Model               |
   | ------------------------------------------------------------------------ | ------------------- |
   | Fixer or implementer: writes code, debugs, makes judgment calls, ADRs    | `claude-opus-5-5`   |
   | Verifier or reviewer against a written spec; focused single-file changes | `claude-sonnet-5-5` |
   | Mechanical: run a command and report, collect output, rename             | `claude-haiku-5-5`  |

   When unsure, pick the larger model. A session that writes code never gets Haiku.

4. **Start it with its role as the name**, passing the model after `--`: `herdr agent start verifier --kind claude --pane <id> -- --model claude-sonnet-5-5`. A fresh pane can answer `agent_pane_busy` until its shell is ready; retry for a few seconds. Confirm the model in `herdr agent read <name>` (the status line names it).
5. **Talk to it:** `herdr agent prompt <name> "<brief>" --wait --timeout <ms>`, then `herdr agent read <name>`. For a slash command, `herdr pane send-text <id> "/clear"`, then `herdr agent send-keys <name> enter`.
6. **Wait on long work** for a line only the task prints when done (`herdr pane wait-output --regex '<summary pattern>' <id>`), never for a word that may already be on screen. The brief itself is on screen, so anchor the marker to its own line: `--regex '(?m)^\s*RESULT: (pass|miss)\s*$'`.

Ask yourself:

- Does the new session need context it cannot find in the repository? Then write it into the active plan's `Next:` line or the prompt, never only this session's scratchpad.
- Is it waiting on an approval or a question? Ask the user before answering it.
- Did I create this pane? Close only those, and only once their result is recorded.
