---
name: handoff
description: Use before ending a turn, or before /clear or /compact, while the active plan step still has unchecked items, so the next thread resumes from the plan instead of rediscovering it.
---

# Hand off a thread

The plan is the only state that carries over. The next session's brief reads it (`.claude/hooks/context.mjs`).

1. **Find the active plan:** the highest-numbered file in `infra/plans/` with an unchecked item.
2. **Tick what is done.** Mark an item `[x]` only if its checks passed in this thread. Was each one verified, or only written?
3. **Write one `Next:` line** directly under the current step's `##` heading, replacing any `Next:` line elsewhere in the plan. It names the first concrete action and any state the next thread can't find in the files: a failing test, a branch, a decision still open.
4. **Leave out** transcript content, reasoning, and anything already in the files or git history.
5. **Verify:** run `mise run test-hooks`, then show the user the `Next:` line and tell them to start a new thread.

When the step is finished, delete its `Next:` line.
