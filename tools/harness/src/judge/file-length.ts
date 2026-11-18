// The file-length audit item: a changed file the lint's max-lines rule would reject, by the
// lint's own count (code-lines.ts). It is an audit item: reported to the writer and the judge,
// never a reason to fail the check (AGENTS.md, Audit before enforce).
import { codeLineCount } from "./code-lines.js";
import type { ChangedFile } from "./diff.js";
import type { Api } from "./manifest-source.js";

/** The limit the lint's max-lines rule sets for tools/harness and tools/kore (.oxlintrc.json). */
export const LENGTH_LIMIT = 300;

/** One audit finding: what the writer can fix, named by its item, its file, what was read and the fix. */
export interface AuditFinding {
  item: string;
  file: string;
  /** The line of the file the finding is on, when the item places one (a type cast does; a file length does not). */
  line?: number;
  detail: string;
  fix: string;
}

const RAW = ["api", "-H", "Accept: application/vnd.github.raw"] as const;

/** The .ts files the lint's max-lines rule reads: the src, tests and integration trees of tools/harness and tools/kore. */
const LINT_SCOPE =
  /^tools\/(?:harness\/(?:src|tests|integration)|kore\/(?:src|integration))\/.+\.ts$/;

const FIX =
  "split it into smaller modules, or move a fixture only one spec uses into a <name>-support.ts beside it (docs/guides/contributor.md)";

/**
 * The audit findings for the changed files: each file the lint reads, read whole at the head
 * commit, that counts over the limit. A deleted file, and a file outside the lint's scope, is
 * not read. A failed read rejects, as the other reads of the precheck do.
 */
export async function lengthAudit(
  api: Api,
  repo: string,
  headSha: string,
  files: readonly ChangedFile[],
): Promise<AuditFinding[]> {
  const targets = files.filter((f) => !f.deleted && LINT_SCOPE.test(f.path));
  const counted = await Promise.all(
    targets.map(async (f) => {
      const text = await api([
        ...RAW,
        `repos/${repo}/contents/${f.path}?ref=${headSha}`,
      ]);
      return { file: f.path, count: codeLineCount(text) };
    }),
  );
  return counted
    .filter(({ count }) => count > LENGTH_LIMIT)
    .map(({ file, count }) => ({
      item: "file-length",
      file,
      detail: `${count} non-blank, non-comment lines; the limit is ${LENGTH_LIMIT}`,
      fix: FIX,
    }));
}
