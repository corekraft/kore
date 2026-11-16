// The time fields of the ledger: the ISO 8601 UTC check every time shares, and the
// one time a merged pull request carries beyond occurredAt (#830).

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** Whether a value is an ISO 8601 UTC time whose date exists. */
export function isTimestamp(value: string): boolean {
  if (!TIMESTAMP.test(value)) {
    return false;
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) {
    return false;
  }
  // Rejects overflow such as 02-31, which Date would roll into March.
  return time.toISOString().slice(0, 10) === value.slice(0, 10);
}

/**
 * pr.merged: when the pull request opened, as GitHub says. The flow report falls
 * back to it for a lead time when the ledger holds no opening event. Optional: a
 * merge from before it was recorded has none.
 */
export interface MergedOrigin {
  openedAt: string;
}

export const MERGED_RULES = [
  {
    field: "openedAt",
    check: (v: unknown) => typeof v === "string" && isTimestamp(v),
    hint: "must be an ISO 8601 UTC time such as 2026-01-02T03:04:05.000Z",
    kinds: ["pr.merged"],
    optional: true,
  },
] as const;
