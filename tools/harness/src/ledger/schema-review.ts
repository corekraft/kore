import type { Kind } from "./schema.js";

const REVIEW_KINDS: readonly Kind[] = ["review.run"];

const isCount = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

/**
 * How many findings the Reviewer's verdict gave: 0 for a clean review. Optional,
 * so a review.run from before the verdict was recorded reads as unrecorded.
 */
export const REVIEW_RULES = [
  {
    field: "findings",
    check: isCount,
    hint: "must be a whole number, 0 or more",
    kinds: REVIEW_KINDS,
    optional: true,
  },
] as const;
