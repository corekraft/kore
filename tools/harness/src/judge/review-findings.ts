import { JudgeError } from "./errors.js";

/**
 * The verdict's findings from stdin, one per line: blank lines are dropped. `--none` is the
 * clean review, and it refuses findings and an empty stdin alike, each naming the fix.
 */
export function findingsFrom(stdin: string, none: boolean): string[] {
  const findings = stdin
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (none && findings.length > 0) {
    throw new JudgeError(
      "--none says the review found no violations, but findings came on stdin: drop --none to post them, or send empty stdin to post a clean review.",
    );
  }
  if (!none && findings.length === 0) {
    throw new JudgeError(
      "No verdict given: pipe the findings on stdin, one per line, or pass --none when the review found no violations.",
    );
  }
  return none ? [] : findings;
}
