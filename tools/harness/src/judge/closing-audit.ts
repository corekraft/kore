// The closing-keyword audit item: a GitHub closing keyword with an issue reference (`Closes #n`,
// `Fixes owner/repo#n`) in the PR body, on a PR that also declares an idea. An idea's outcome
// closes on recorded proof, not on merge, so the reference should read `Refs` (ADR 0079, ADR 0097).
// It is an audit item: reported to the writer and the judge, never a reason to fail the check
// (AGENTS.md, Audit before enforce). It reads the body alone and needs no tokens.
import type { AuditFinding } from "./file-length.js";

export const CLOSING_ITEM = "closing-keyword";

/** The file a PR body finding names: the body is not a file, so no line is given. */
const FILE = "PR body";

/** GitHub's closing keywords, any case, then the issue reference they close: `#n` or `owner/repo#n`. */
const CLOSING =
  /\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?):?\s+((?:[\w.-]+\/[\w.-]+)?#\d+)\b/gi;

/** A template's HTML comment is guidance, not the body's text (as the declaration reader treats it). */
const COMMENT = /<!--[\s\S]*?-->/g;

/**
 * The audit findings for the closing keywords the PR body writes beside its idea: each keyword
 * with its issue reference, the fix (write `Refs` to the same reference). A body with no idea
 * is not read, since no idea line marks an outcome that closes on proof.
 */
export function closingAudit(
  body: string,
  idea: string | undefined,
): AuditFinding[] {
  if (idea === undefined) {
    return [];
  }
  const visible = body.replace(COMMENT, "");
  return [...visible.matchAll(CLOSING)].map((match) => {
    const reference = match[1] ?? "";
    return {
      item: CLOSING_ITEM,
      file: FILE,
      detail: match[0],
      fix: `replace it with Refs ${reference} (ADR 0097)`,
    };
  });
}
