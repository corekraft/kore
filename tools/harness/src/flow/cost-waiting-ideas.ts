// The idea rows of the token cost figures (#1019): each idea's stamped sessions' cumulative dollars
// and tokens to the window's end, and its lead time and outcome as leadTime reports them.

import type { LedgerEvent } from "../ledger/index.js";
import { firstTime, time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import { cumulativeOf, round } from "./cost-waiting-support.js";
import type { IdeaFigure, CostWaitingOptions } from "./cost-waiting-types.js";

/** The idea rows over the window, in idea order; an idea is one an event names. */
export function ideaRowsIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
): IdeaFigure[] {
  const ideas = [
    ...new Set(
      events.map((e) => e.idea).filter((idea): idea is string => !!idea),
    ),
  ];
  return ideas
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((idea) => ideaRow(events, idea, window, options));
}

function ideaRow(
  events: LedgerEvent[],
  idea: string,
  window: Span,
  options: CostWaitingOptions,
): IdeaFigure {
  const own = events.filter((e) => e.idea === idea);
  const spend = cumulativeOf(own, window[1], options.prices);
  const first = Math.min(...own.map(time));
  const closed = firstTime(own, (e) => e.kind === "issue.closed");
  const outcome =
    closed !== undefined && inWindow(window, closed) ? "closed" : null;
  return {
    idea,
    dollars: spend.unpriced.length > 0 ? null : round(spend.dollars),
    ...(spend.unpriced.length > 0 ? { unpricedModels: spend.unpriced } : {}),
    tokens: spend.tokens,
    leadTimeSeconds:
      outcome === null || closed === undefined ? null : (closed - first) / 1000,
    outcome,
  };
}
