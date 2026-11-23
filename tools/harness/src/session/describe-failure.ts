import type { RunResult } from "../runtime/index.js";

/** What a failed command said, for an error message: its stderr, or its stdout, or its exit code. */
export function describeFailure(result: RunResult): string {
  return (result.stderr || result.stdout).trim() || `exit code ${result.code}`;
}
