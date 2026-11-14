/**
 * The principles-review verdict: the one format the precheck reads and `harness review
 * post` writes. Both sides use the definitions here, so a posted verdict always reads
 * back as the verdict and head it was formatted with.
 */

/** Characters of the head commit a verdict names. The parser accepts 7 to 40; live verdicts name 8. */
export const VERDICT_HEAD_LENGTH = 8;

/** The verdict line on a PR comment; its first capture is the verdict text and any head clause. */
export const VERDICT_LINE = /^\s*principles-review:\s*(.*)$/im;

/** A head named by `head <sha>` anywhere in a comment; the first match is the verdict's own head. */
export const NAMED_HEAD = /\bhead\s+([0-9a-f]{7,40})\b/i;

/** The head clause at the end of a verdict's text, removed before the verdict is compared. */
export const TRAILING_HEAD = /\s*\(?\bhead\s+[0-9a-f]{7,40}\)?\s*$/i;

/** The verdict's words for a count of violations; zero is the clean verdict. */
export function verdictText(count: number): string {
  return count === 0 ? "No violations." : `${count} violations`;
}

/**
 * The PR comment body for a review of `headSha`: the verdict line naming the head, then
 * one `- ` line per finding. The body has no trailing newline.
 */
export function reviewBody(
  headSha: string,
  findings: readonly string[],
): string {
  const head = headSha.slice(0, VERDICT_HEAD_LENGTH);
  return [
    `principles-review: ${verdictText(findings.length)} (head ${head})`,
    ...findings.map((finding) => `- ${finding}`),
  ].join("\n");
}
