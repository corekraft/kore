import type { Kind } from "./schema.js";

const SEND_BACK_KINDS: readonly Kind[] = ["send-back"];

/**
 * Why the judge, or the precheck on its behalf, sent a change back. The list is
 * fixed: a reason outside it is refused, and `other` is what the flow report
 * watches, so a list missing an entry shows.
 */
export const SEND_BACK_CATEGORIES = [
  "declaration",
  "pattern-mismatch",
  "failed-check",
  "conflict",
  "missing-proof",
  "rule-break",
  "scope",
  "wrong-statement",
  "other",
] as const;
export type SendBackCategory = (typeof SEND_BACK_CATEGORIES)[number];

/** Optional: a send-back from before categories existed reads as uncategorised. */
export const SEND_BACK_RULES = [
  {
    field: "category",
    check: (v: unknown) => SEND_BACK_CATEGORIES.includes(v as SendBackCategory),
    hint: `must be one of ${SEND_BACK_CATEGORIES.join(", ")}`,
    kinds: SEND_BACK_KINDS,
    optional: true,
  },
] as const;
