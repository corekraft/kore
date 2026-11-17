import { GUARD_METRICS } from "../flow/index.js";
import type { IdeaRecord } from "../idea/index.js";

/** A claim about an idea's primary metric the qualifier flags. A warning never refuses. */
export interface Warning {
  kind: "guard-metric" | "shared-primary";
  metric: string;
  message: string;
}

/**
 * Warnings for a harness idea's primary metric: a guard metric, or the primary
 * of another idea still open. `others` is every idea in the repository; the
 * idea itself and any idea with an outcome are left out. Pure: the same ideas
 * always give the same warnings, and an idea that is not a harness idea has none.
 */
export function sharingWarnings(
  idea: IdeaRecord,
  others: readonly IdeaRecord[],
): Warning[] {
  const metric = idea.harness?.metric;
  if (metric === undefined) {
    return [];
  }
  const warnings: Warning[] = [];
  if (GUARD_METRICS.includes(metric)) {
    warnings.push({
      kind: "guard-metric",
      metric,
      message: `${metric} is a guard metric: several ideas move it, so no one idea may claim it as its primary (ADR 0119).`,
    });
  }
  for (const other of others) {
    if (
      other.number === idea.number ||
      other.outcome !== undefined ||
      other.harness?.metric !== metric
    ) {
      continue;
    }
    warnings.push({
      kind: "shared-primary",
      metric,
      message: `${metric} is also the primary of open idea ${other.number}: ideas with one primary open their windows in sequence (ADR 0119).`,
    });
  }
  return warnings;
}
