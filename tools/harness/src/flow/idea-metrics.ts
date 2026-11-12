import type { LedgerEvent } from "../ledger/index.js";
import {
  DEFAULT_COST,
  costMetrics,
  type CostMetrics,
  type CostOptions,
} from "./cost.js";

export type { CostMetrics, CostOptions };
import { firstTime, time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import { median } from "./wip.js";

/** Seconds from each completed idea's first event to its outcome event. */
export interface LeadTime {
  ideas: { idea: string; seconds: number }[];
  /** Null when no idea has an outcome. */
  medianSeconds: number | null;
  maxSeconds: number | null;
}

export const firstClosed = (own: LedgerEvent[]) =>
  firstTime(own, (e) => e.kind === "issue.closed");

/** Each idea completed in the range, from its first event to its first issue.closed, with median and maximum. */
function leadTime(byIdea: Map<string, LedgerEvent[]>, window: Span): LeadTime {
  const ideas: LeadTime["ideas"] = [];
  for (const [idea, own] of byIdea) {
    const outcome = firstClosed(own);
    if (outcome !== undefined && inWindow(window, outcome)) {
      const first = Math.min(...own.map(time));
      ideas.push({ idea, seconds: (outcome - first) / 1000 });
    }
  }
  ideas.sort((a, b) =>
    a.idea.localeCompare(b.idea, undefined, { numeric: true }),
  );
  const seconds = ideas.map((i) => i.seconds);
  return {
    ideas,
    medianSeconds: median(seconds),
    maxSeconds: seconds.length === 0 ? null : Math.max(...seconds),
  };
}

/** Lead time and the cost metrics of the covered ideas, as the report names them. */
export function ideaMetrics(
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
  cost: Partial<CostOptions> = {},
): { leadTime: LeadTime; metrics: CostMetrics } {
  return {
    leadTime: leadTime(byIdea, window),
    metrics: costMetrics(byIdea, window, { ...DEFAULT_COST, ...cost }),
  };
}
