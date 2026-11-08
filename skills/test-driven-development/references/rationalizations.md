# Rationalizations

Each of these is a signal to stop and return to a failing test.

| Excuse                                  | Reality                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| "It is too simple to test."             | Simple code breaks; a focused test is cheap.                                |
| "I will test after."                    | A test written after cannot show it would have caught the missing code.     |
| "Manual testing is enough."             | Manual checks are not repeatable regression protection.                     |
| "I need to explore first."              | Fine, if the exploration is discarded before the test-first version.        |
| "The test is hard to write."            | The design is too coupled. Simplify the interface or inject the dependency. |
| "The existing code has no tests."       | Cover the behavior you are changing.                                        |
| "I already spent time implementing it." | Sunk cost is not evidence of correctness.                                   |

## Red flags

Start over from the test if you wrote code before it, saw it pass immediately,
cannot explain why it failed, or are keeping an implementation "for reference".

## When stuck

- Unsure how to test it: write the wished-for API call and its assertion first.
- Setup is large, or everything needs a mock: that is design feedback; reduce
  coupling or inject the dependency.
