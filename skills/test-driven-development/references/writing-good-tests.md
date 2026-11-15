# Writing Good Tests

- Before writing production code, name the production change that should make the test fail.
- Test one behavior with a clear, behavior-focused name.
- Assert observable results, state, errors, and meaningful side effects—not implementation details.
- Unit tests mock everything with behaviour outside the unit, pure helpers and units in its own domain included. "Real" means types, error classes and constants only. A unit test starts no process and waits on no real timer (ADR 0098).
- Integration tests run real domains together and never a cluster.
- In a domain that plan 14 has not yet converted, a new or changed unit test still follows ADR 0098, even where the neighbouring specs use real code.
- Keep test-only setup and helpers out of production classes.
- Understand a dependency’s side effects before mocking it; otherwise the test may pass while the integrated behavior is broken.
- If a test is difficult to express or requires a large setup, treat that as feedback about the design and simplify the interface or introduce explicit dependency injection.
