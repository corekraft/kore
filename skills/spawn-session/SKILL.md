---
name: spawn-session
description: Use when asked to start, verify with, or hand off to another Claude session (a verifier or fixer) in a Herdr pane.
---

# Spawn a session in Herdr

The installed `herdr` binary is the authority for syntax; run `herdr --skill` once if its skill is not in context.

1. **Check you are inside Herdr:** `test "${HERDR_ENV:-}" = 1`. If not, say so and stop.
2. **Split beside the caller, keeping focus:** `herdr pane split --current --direction right --cwd "$PWD" --no-focus`. Read the id from `.result.pane.pane_id`.
3. **Start it with its role as the name:** `herdr agent start verifier --kind claude --pane <id>`.
4. **Talk to it:** `herdr agent prompt <name> "<brief>" --wait --timeout <ms>`, then `herdr agent read <name>`. For a slash command, `herdr pane send-text <id> "/clear"`, then `herdr agent send-keys <name> enter`.
5. **Wait on long work** for a line only the task prints when done (`herdr pane wait-output --regex '<summary pattern>' <id>`), never for a word that may already be on screen.

Ask yourself:

- Does the new session need context it cannot find in the repository? Then write it into the active plan's `Next:` line or the prompt, never only this session's scratchpad.
- Is it waiting on an approval or a question? Ask the user before answering it.
- Did I create this pane? Close only those, and only once their result is recorded.
