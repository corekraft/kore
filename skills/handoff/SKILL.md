---
name: handoff
description: Use before ending a turn, or before /clear or /compact, while the active plan step still has unchecked items, so the next thread resumes from the plan instead of rediscovering it.
---

# Hand off a thread

The plan is the only state that carries over. The next session's brief reads it.

1. **Find the plan:** `node skills/bin/harness.mjs plan active`.
2. **Tick only what was verified in this thread.** Was each item's check run and passing, or only written? For each verified item run `node skills/bin/harness.mjs plan tick --item "<text>"`. It also updates the open-item lists and counts, and reports the lines it changed.
3. **Write the `Next:` line.** Run `node skills/bin/harness.mjs plan next --text "<line>"`. The line names the first concrete action and any state the next thread can't find in the files: a failing test, a branch, a decision still open. Leave out transcript, reasoning, and anything already in the files or git history.
4. **Show the person the `Next:` line** and tell them to start a new thread.

When the step is finished, run `node skills/bin/harness.mjs plan clear-next`.
