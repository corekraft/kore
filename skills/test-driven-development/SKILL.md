---
name: test-driven-development
description: Use before writing or changing any code, hook, script or skill tooling: implementing a plan step, fixing a bug or review finding, adding a feature. Write the failing test first, assert exact output.
---

# Test-Driven Development

**No production code without a failing test first.** Code written before its test is deleted and rewritten from the test, not kept as a reference. Exceptions (throwaway prototypes, config-only changes) need the human's say-so.

## The cycle

1. **Red.** One test, one behavior, named after the guarantee it protects. A guard role rule gets a spec for every role it names. For tests in `tools/kore`, fake the process runner. Run only that test: `npm --prefix tools/kore exec vitest run <file>`, or `npm --prefix tools/harness exec vitest run <file>` for hooks (their cases live in `.claude/hooks`).
2. **Green.** Write the least code that makes it pass. Then run the wider suite.
3. **Refactor** only while green, without adding behavior. For a bug, the first red test reproduces it.

Locally run only the related tests and typecheck; the full suites run in CI `check` (AGENTS.md, Changes).

## Before you move on, ask

- Did I see this test fail, and did it fail because the behavior was missing? An import or setup error doesn't count.
- If the code were broken, would this test catch it? Does it assert what must _not_ happen?
- Do I assert the exact output (the whole string, list or value), not `toContain` or a loose match that a wrong answer would also satisfy?
- Am I asserting outcomes, or just how many times a mock was called?
- Is this the least code that makes the test pass?
- Am I skipping a step because "it's too simple" or "I'll test after"? If so, go back to red.

No step here is a tool: choosing the behavior to pin, judging whether a test would catch a break, and keeping the code minimal are judgement. Running the test file is the only mechanical part.

Read [writing-good-tests.md](references/writing-good-tests.md) when writing tests, and [rationalizations.md](references/rationalizations.md) when tempted to skip a step.
