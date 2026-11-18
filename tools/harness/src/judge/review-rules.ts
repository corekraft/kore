import { MAX_RULE_LABELS, RULE_LABEL_LENGTH } from "../ledger/index.js";

export { RULE_LABEL_LENGTH };

/** The rule a finding cites: the second field of `file:line | rule | what | fix`, as a slug. */
function labelOf(finding: string): string | undefined {
  const rule = finding.split("|")[1];
  if (rule === undefined) {
    return undefined;
  }
  const slug = rule
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, RULE_LABEL_LENGTH)
    .replace(/-+$/, "");
  return slug === "" ? undefined : slug;
}

/**
 * The rules a verdict's findings cite, as short labels: each is bounded to RULE_LABEL_LENGTH,
 * listed once, and at most MAX_RULE_LABELS are kept. A finding with no rule field gives none,
 * and no other part of a finding is copied.
 */
export function ruleLabels(findings: readonly string[]): string[] {
  const labels = findings.flatMap((f) => labelOf(f) ?? []);
  return [...new Set(labels)].slice(0, MAX_RULE_LABELS);
}
