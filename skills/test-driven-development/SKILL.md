---
name: test-driven-development
description: Use before writing or changing any code or hook, including implementing a plan step, a review finding, or a fix. Write the failing test first.
---

# Test-Driven Development

**No production code without a failing test first.** Code written before its test is deleted and rewritten from the test, not kept as a reference. Exceptions (throwaway prototypes, config-only changes) need the human's say-so.

## The cycle

1. **Red.** One test, one behavior, named after the guarantee it protects. For tests in `tools/kore`, fake the process runner. Run only that test: `npm --prefix tools/kore exec vitest run <file>`, or `node --test <file>` for hooks.
2. **Green.** Write the least code that makes it pass. Then run the wider suite.
3. **Refactor** only while green, without adding behavior. For a bug, the first red test reproduces it.

## Before you move on, ask

- Did I see this test fail, and did it fail because the behavior was missing? An import or setup error doesn't count.
- If the code were broken, would this test catch it? Does it assert what must _not_ happen?
- Am I asserting outcomes, or just how many times a mock was called?
- Is this the least code that makes the test pass?
- Am I skipping a step because "it's too simple" or "I'll test after"? If so, go back to red.

Read [writing-good-tests.md](references/writing-good-tests.md) when writing tests, and [rationalizations.md](references/rationalizations.md) when tempted to skip a step.
