// The ADR lookup behind the vision check: status and replacement by ADR number.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { frontmatter } from "./markdown.js";
import type { AdrLookup } from "./vision-check.js";

/** A lookup from a four-digit ADR number to its frontmatter status, read from the tracked files. */
export function adrLookup(
  files: readonly string[],
  read: (path: string) => string | null,
): AdrLookup {
  return (number) => {
    const prefix = `docs/decisions/${number}-`;
    const file = files.find(
      (name) =>
        name.startsWith(prefix) &&
        name.endsWith(".md") &&
        !name.slice(prefix.length).includes("/"),
    );
    const keys = file ? frontmatter(file, read(file) ?? "")?.keys : null;
    const status = keys?.get("status")?.value;
    if (!keys || status === undefined) {
      return null;
    }
    const replacement = keys.get("superseded-by")?.value;
    return {
      status,
      supersededBy: replacement && /(\d{4})-/.exec(replacement)?.[1],
    };
  };
}
