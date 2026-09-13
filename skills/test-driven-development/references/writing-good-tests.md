# Writing Good Tests

- Before writing production code, name the production change that should make the test fail.
- Test one behavior with a clear, behavior-focused name.
- Assert observable results, state, errors, and meaningful side effects—not implementation details.
- Prefer real code and realistic inputs. Mock only when a dependency is uncontrollable, nondeterministic, external, or too expensive for the test.
- Keep test-only setup and helpers out of production classes.
- Understand a dependency’s side effects before mocking it; otherwise the test may pass while the integrated behavior is broken.
- If a test is difficult to express or requires a large setup, treat that as feedback about the design and simplify the interface or introduce explicit dependency injection.
