---
name: test-driven-development
description: Use when implementing any feature, bugfix, refactoring, or behavior change, before writing production code.
---

# Test-Driven Development (TDD)

Write the test first. Watch it fail. Write the minimum production code to pass it, then refactor while keeping the suite green.

## When to Use

Use for new features, bug fixes, refactoring, and behavior changes. For throwaway prototypes, generated code, or configuration-only changes, ask the human partner before making an exception.

## The Iron Law

```text
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

If production code was written before its test, delete that implementation and start again from the test. Do not keep it as a reference or adapt it while writing the test.

## Red-Green-Refactor

### RED — Write a failing test

Write one minimal test for one behavior. Give it a name that states the expected behavior, exercise real code, and avoid mocks unless they are unavoidable.

```typescript
test('retries failed operations 3 times', async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  };

  const result = await retryOperation(operation);

  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```

Read [writing-good-tests.md](references/writing-good-tests.md) when writing or changing tests.

### Verify RED — Watch it fail

Run the narrowest relevant test command, for example:

```bash
npm test path/to/test.test.ts
```

Confirm that the test fails—not merely errors—for the expected reason: the behavior is missing, not the test is malformed. If it passes immediately, fix the test because it does not demonstrate the requested change. If it errors, correct the error and rerun until it fails correctly.

### GREEN — Minimal implementation

Write only enough production code to pass the failing test. Do not add unrequested features, speculative options, or unrelated refactors.

### Verify GREEN — Watch it pass

Rerun the focused test, then the relevant broader suite. Confirm the new test passes, existing tests remain green, and output has no unexplained errors or warnings. When a test fails, fix production code rather than weakening the test.

### REFACTOR — Clean up after green

Only after green, remove duplication, improve names, or extract helpers. Do not add behavior during refactoring. Keep the tests green throughout.

Repeat the cycle with the next behavior.

## Test Quality

- Test one behavior at a time; split tests whose names contain “and”.
- Name tests after observable behavior, not implementation details.
- Assert real outcomes and side effects, not mock call counts, unless the interaction itself is the behavior.
- Keep test-only helpers in test utilities.
- Understand dependency side effects before introducing a mock.

## Bug Fixes and Integration Failures

When a bug is found, first add a failing regression test that reproduces it, then follow the same red-green-refactor cycle. Never fix a bug without a test that would have caught it.

## Common Rationalizations

Treat these as signals to stop and return to the cycle:

| Excuse | Reality |
|---|---|
| “It is too simple to test.” | Simple code breaks; a focused test is cheap. |
| “I will test after.” | A passing after-the-fact test does not prove it can catch the missing behavior. |
| “Manual testing is enough.” | Manual checks are not repeatable regression protection. |
| “I need to explore first.” | Exploration is fine only if discarded before the test-first implementation. |
| “The test is hard to write.” | The design may be too coupled or difficult to use. Simplify it. |
| “The existing code has no tests.” | Add coverage around the behavior you are changing. |
| “I already spent time implementing it.” | Sunk cost is not evidence that the implementation is correct. |

## Red Flags

Stop and start over if you:

- wrote implementation code before the test;
- wrote the test after implementation;
- saw the test pass immediately;
- cannot explain why the test failed;
- plan to add tests later;
- are relying on manual testing;
- are keeping implementation as a “reference” while writing tests; or
- are rationalizing that this case is different.

## Verification Checklist

Before marking the work complete:

- [ ] Every new or changed behavior has a test.
- [ ] Each test was observed failing before implementation.
- [ ] Each failure was for the expected reason, not a typo or setup error.
- [ ] Production code is the minimum needed to pass.
- [ ] Focused and relevant broader tests pass.
- [ ] Output has no unexplained errors or warnings.
- [ ] Tests use real code; mocks are used only when unavoidable.
- [ ] Relevant edge cases and errors are covered.

If a box cannot be checked, the work did not follow TDD: delete the premature implementation and restart from a failing test, unless the human partner explicitly authorizes an exception.

## When Stuck

- Do not know how to test: write the wished-for API and the assertion first.
- Setup is complicated: extract test helpers, then simplify the design if it remains complicated.
- Everything needs mocking: introduce dependency injection or reduce coupling.
- Unsure what to do: ask the human partner after preserving the test-first boundary.

## Final Rule

```text
Production code → a test exists and failed first.
Otherwise → it is not TDD.
```
