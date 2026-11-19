// The pure half of the delivery-stage timer (#1113): the stage names, the merge
// time check, and each stage's seconds. No reads happen here.

export const deliveryStages = [
  "namespace",
  "sync",
  "admission",
  "certificate",
  "rollout",
  "readiness",
] as const;
export type DeliveryStage = (typeof deliveryStages)[number];

export interface StageTime {
  stage: DeliveryStage;
  seconds: number;
}

/** The end of each stage, in stage order, in epoch milliseconds. */
export type StageEnds = [DeliveryStage, number][];

/**
 * The merge time in milliseconds. Checked before any read, so a malformed time
 * fails by name and never yields NaN seconds.
 */
const rfc3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

export function mergedMilliseconds(mergedAt: string): number {
  const parsed = rfc3339.test(mergedAt) ? Date.parse(mergedAt) : Number.NaN;
  if (Number.isNaN(parsed)) {
    throw new Error(
      "KORE_DELIVERY_MERGED_AT must be an RFC 3339 time, for example 2026-11-18T10:00:00Z",
    );
  }
  return parsed;
}

/**
 * Each stage's seconds from the end of the stage before it, starting at the
 * merge. A stage that ended before the one before it (a namespace created
 * before a redeploy's merge) takes zero seconds, never a negative one.
 */
export function stageTimes(
  merged: number,
  ends: StageEnds,
): { stages: StageTime[]; totalSeconds: number } {
  const stages: StageTime[] = [];
  let previous = merged;
  for (const [stage, end] of ends) {
    stages.push({ stage, seconds: seconds(Math.max(0, end - previous)) });
    previous = Math.max(previous, end);
  }
  return { stages, totalSeconds: seconds(previous - merged) };
}

/** Seconds from milliseconds, to one decimal place, as the footprint measurement rounds. */
function seconds(milliseconds: number): number {
  return Math.round(milliseconds / 100) / 10;
}
