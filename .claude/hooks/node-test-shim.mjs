// Runs node:test-style cases under vitest. A case keeps its `(t) => ...` shape
// and calls `t.after(cleanup)`; only the import line differs from node:test.
import { onTestFinished, test as vitestTest } from "vitest";

export function test(name, body) {
  vitestTest(name, () => body({ after: (cleanup) => onTestFinished(cleanup) }));
}

export default test;
