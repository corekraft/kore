---
name: spawn-session
description: Use when asked to start, verify with, or hand off to another Claude session (a verifier or fixer) in a Herdr pane.
---

# Spawn a session in Herdr

The installed `herdr` binary is the authority for syntax; run `herdr --skill` once if its skill is not in context.

1. **Check you are inside Herdr:** `test "${HERDR_ENV:-}" = 1`. If not, say so and stop.
2. **Keep the layout: main session on the left, spawned sessions stacked in one column on the right.** Only the first spawned pane splits horizontally; every later pane splits that column vertically. Always pass `--no-focus` so focus stays on the caller, and read the id from `.result.pane.pane_id`.
   - No spawned pane open yet: `herdr pane split --current --direction right --cwd "$PWD" --no-focus`.
   - Otherwise, split the bottom-most spawned pane down: `herdr pane split <last-pane-id> --direction down --cwd "$PWD" --no-focus`.
   - After every split or close, equalize the column so each spawned pane gets the same height: `node .claude/skills/spawn-session/equalize.mjs`. Each split halves the pane above it, so without this the user has to resize panes by hand to read them.
   - Sessions that run in parallel and edit code each get their own worktree (`git worktree add -b <branch> <scratchpad>/wt-<subject> HEAD`, then `npm ci` in `tools/kore`), passed as `--cwd`, so builds and edits never collide. Merge their branches, then remove the worktrees.
3. **Pick the model for the role**, by exact ID (aliases drift):

   | Role                                                                        | Model               |
   | --------------------------------------------------------------------------- | ------------------- |
   | Implementer, fixer, or verifier working from a written plan step or spec    | `claude-sonnet-5-5` |
   | Read files, summarize, run commands and report, small basic code changes    | `claude-haiku-5-5`  |
   | Independent judge or complex eval that must not be anchored on this session | `claude-opus-5-5`   |
   | Retrospective over recent sessions (`/retro`)                               | `claude-opus-5-5`   |

   The main session is the Opus orchestrator: it does the thinking, design, and final judgment itself. Minimize Opus elsewhere; spawn it only for the last two rows, and say why. Prefer Haiku whenever the task leaves no decisions open.

4. **Name it after its subject**, in the domain's own words: `image-trust-reader`, `gateway-tls-verifier`, `postgresql-api-fixer`. Never use letters, ordinals, or plan step numbers (`reader-a`, `verifier-2`, `step8-verifier`); the name alone must tell the user what the pane is about. Herdr rejects names over 32 characters (lowercase letters, digits, `-`, `_`; `invalid_agent_name`), so count the role suffix: `portability-validation-implementer` (33) fails, `portability-implementer` works. Pass the model after `--`: `herdr agent start gateway-tls-verifier --kind claude --pane <id> -- --model claude-sonnet-5-5`. A fresh pane can answer `agent_pane_busy` until its shell is ready; retry for a few seconds. Confirm the model in `herdr agent read <name>` (the status line names it).
5. **Talk to it:** `herdr agent prompt <name> "<brief>" --wait --until working --timeout <ms>` and check the reply says `working`; `--timeout` without `--wait` is rejected, so never discard the prompt's output. Then `herdr agent read <name>`. Text sitting in a pane's input box after a turn (such as `commit this`) is Claude Code's suggested prompt, not the user's. For a slash command, `herdr pane send-text <id> "/clear"`, then `herdr agent send-keys <name> enter`.
6. **Wait on long work** with `herdr agent wait <name> --until idle --timeout <ms>` in the background, then read its result line; or wait for a line only the task prints when done (`herdr pane wait-output --regex '<summary pattern>' <id>`), never for a word that may already be on screen. The brief itself is on screen, so anchor the marker to its own line (`--regex '(?m)^\s*RESULT: (pass|miss)\s*$'`) and never write the literal marker in the brief: the pane wraps long lines, so `... RESULT: pass or RESULT: miss` can land on a line of its own and match at once. Describe it instead ("end with the word RESULT, a colon, then pass or miss").

Ask yourself:

- Does the new session need context it cannot find in the repository? Then write it into the active plan's `Next:` line or the prompt, never only this session's scratchpad.
- Is it waiting on an approval or a question? Ask the user before answering it.
- Did a sibling branch from a parallel session merge since this branch's live run? Rebase and repeat the live run before merging: the merge-interaction bugs between parallel branches (a gate row in filtered status, a stale port-forward, a plain row rendering `[object Object]`) only showed up live.
- Did I create this pane? Close only those, and only once their result is recorded.
