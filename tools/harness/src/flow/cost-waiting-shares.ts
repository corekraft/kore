// The arithmetic of the shares of the weekly ceiling (#1048, spec #1030): one unit's share, and a
// level's sum, median and 90th percentile over its units' shares. A share is plan-weighted tokens
// over the ceiling. The rate and size kinds differ only in the label and the span they are given;
// the caller picks the units and the plan-weighted tokens of each.

import { shareOf, summaryOf } from "./cost-waiting-support.js";
import type { LevelShare, ShareReading } from "./cost-waiting-shares-types.js";

/** A unit's plan-weighted tokens, with the models that have no plan weight, and what a size or the main session adds. */
export interface ShareUnit {
  plan: number;
  /** Models in the unit that the plan weights do not read; named, never read as zero. */
  unweighted: string[];
  spanSeconds?: number | null;
  basis?: string;
}

const modelsOf = (units: { unweighted: string[] }[]): string[] => [
  ...new Set(units.flatMap((unit) => unit.unweighted)),
];

/** One unit's share of the ceiling under a label; a model with no plan weight is named instead. */
export function readingOf(
  label: string,
  unit: ShareUnit,
  { ceiling }: { ceiling: number | undefined },
): ShareReading {
  if (unit.unweighted.length > 0) {
    return {
      label,
      status: "insufficient weights",
      models: modelsOf([unit]).sort(),
    };
  }
  return {
    label,
    status: "measured",
    share: shareOf(unit.plan, ceiling),
    ...(unit.spanSeconds === undefined
      ? {}
      : { spanSeconds: unit.spanSeconds }),
    ...(unit.basis === undefined ? {} : { basis: unit.basis }),
  };
}

/**
 * A level over its units: the sum of their shares (which may pass 100%, as agents overlap in
 * time) and the median and 90th percentile over the units' shares. A model with no plan weight is
 * named before the minimum is checked; below the minimum count the level is insufficient.
 */
export function levelOf(
  label: string,
  units: ShareUnit[],
  { ceiling, minimum }: { ceiling: number | undefined; minimum: number },
): LevelShare {
  const base = { label, units: units.length, needed: minimum };
  const unweighted = modelsOf(units).sort();
  if (unweighted.length > 0) {
    return { ...base, status: "insufficient weights", models: unweighted };
  }
  if (units.length < minimum) {
    return { ...base, status: "insufficient" };
  }
  const plans = summaryOf(units.map((unit) => unit.plan));
  return {
    ...base,
    status: "measured",
    total: shareOf(plans.total, ceiling),
    median: plans.median === null ? null : shareOf(plans.median, ceiling),
    p90: plans.p90 === null ? null : shareOf(plans.p90, ceiling),
  };
}
