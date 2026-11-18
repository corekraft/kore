// The idea rows of the token cost figures (#1019, #1093): each idea's stamped sessions' cumulative
// dollars and tokens to the window's end, plus the writers whose pull request carries the idea
// (cost-waiting-writing.ts), and its lead time and outcome as leadTime reports them.

import type { LedgerEvent } from "../ledger/index.js";
import { firstTime, time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import { cumulativeOf, round } from "./cost-waiting-support.js";
import type { IdeaFigure, CostWaitingOptions } from "./cost-waiting-types.js";
import { namedIdea } from "./attribution.js";
import { ideaKey } from "./writer-link-ideas.js";
import { addSpend, NO_SPEND, type WritingSpend } from "./writing-spend.js";

/**
 * The idea rows over the window, in idea order; an idea is one an event names (a pull request's
 * link that names none names no idea) or one a linked writer's pull request carries. A writer's
 * idea takes the form a stamp gives the same issue, so the two are one row.
 */
export function ideaRowsIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
  writing: Map<string, WritingSpend> = new Map(),
): IdeaFigure[] {
  const stamped = [
    ...new Set(events.map(namedIdea).filter((idea): idea is string => !!idea)),
  ];
  const formOf = new Map(stamped.map((idea) => [ideaKey(idea), idea]));
  const written = new Map<string, WritingSpend>();
  for (const [idea, spend] of writing) {
    const name = formOf.get(ideaKey(idea)) ?? idea;
    written.set(name, addSpend(written.get(name) ?? NO_SPEND, spend));
  }
  return [...new Set([...stamped, ...written.keys()])]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((idea) =>
      ideaRow(events, idea, window, options, written.get(idea) ?? NO_SPEND),
    );
}

function ideaRow(
  events: LedgerEvent[],
  idea: string,
  window: Span,
  options: CostWaitingOptions,
  written: WritingSpend,
): IdeaFigure {
  const own = events.filter((e) => e.idea === idea);
  const spend = addSpend(
    own.length === 0 ? NO_SPEND : cumulativeOf(own, window[1], options.prices),
    written,
  );
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
