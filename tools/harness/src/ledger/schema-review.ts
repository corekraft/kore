import type { Kind } from "./schema.js";

const REVIEW_KINDS: readonly Kind[] = ["review.run"];

const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

/** The longest a cited rule label may be, and the most labels one verdict may carry. */
export const RULE_LABEL_LENGTH = 32;
export const MAX_RULE_LABELS = 10;

const LABEL = new RegExp(`^[a-z0-9-]{1,${RULE_LABEL_LENGTH}}$`);

/** A comma-separated list of 1 to MAX_RULE_LABELS short labels: no free text can fit in one. */
function isRuleList(v: unknown): boolean {
  if (typeof v !== "string") {
    return false;
  }
  const labels = v.split(",");
  return labels.length <= MAX_RULE_LABELS && labels.every((l) => LABEL.test(l));
}

/**
 * How many findings the Reviewer's verdict gave: 0 for a clean review. Optional,
 * so a review.run from before the verdict was recorded reads as unrecorded.
 * `rules` lists the rules the findings cite, as short labels and never verdict text.
 */
export const REVIEW_RULES = [
  {
    field: "findings",
    check: isCount,
    hint: "must be a whole number, 0 or more",
    kinds: REVIEW_KINDS,
    optional: true,
  },
  {
    field: "rules",
    check: isRuleList,
    hint: `must be 1 to ${MAX_RULE_LABELS} comma-separated labels of at most ${RULE_LABEL_LENGTH} lowercase letters, digits or -`,
    kinds: REVIEW_KINDS,
    optional: true,
  },
] as const;
