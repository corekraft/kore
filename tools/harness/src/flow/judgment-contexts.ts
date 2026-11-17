// Judgment panes and the context they reached (ADR 0121, idea 0007): each judgment
// pane launched in the window with a token reading in it, and the ones whose largest
// cumulative count went above the context limit, most tokens first.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** The most tokens of context a judgment pane may reach (ADR 0121; a placeholder the owner confirms). */
export const JUDGMENT_CONTEXT_LIMIT = 60_000;

/** The role session spawn gives a judgment pane (ADR 0121). */
const JUDGMENT_ROLE = "judgment";

export interface JudgmentPaneContext {
  /** The pane's name, as its launch and token readings name it. */
  session: string;
  /** The idea the pane judged, from its launch; absent when the launch named none. */
  idea?: string;
  /** The pane's largest cumulative token count at or before the window's end. */
  tokens: number;
}

export interface JudgmentContexts {
  /** The limit a pane's tokens are read against. */
  limit: number;
  /** Judgment panes launched in the window that have a token reading in it. */
  panes: number;
  /** The panes whose tokens went above the limit, most tokens first. */
  over: JudgmentPaneContext[];
}

/** Every name an event carries for its session. */
const namesOf = (event: LedgerEvent): string[] =>
  [event.agent, event.session, event.pane].filter(
    (name): name is string => name !== undefined,
  );

/**
 * The judgment panes in the window and their peak token counts. A pane is known by
 * its launch's agent name, and a reading joins it through any name it carries.
 */
export function judgmentContexts(
  events: LedgerEvent[],
  window: Span,
): JudgmentContexts {
  const keyOf = new Map<string, string>();
  const ideaOf = new Map<string, string>();
  for (const event of events) {
    if (
      event.kind !== "session.launch" ||
      event.role !== JUDGMENT_ROLE ||
      !inWindow(window, time(event))
    ) {
      continue;
    }
    const key = event.agent ?? event.session ?? event.pane;
    if (key === undefined) {
      continue;
    }
    if (event.idea !== undefined) {
      ideaOf.set(key, event.idea);
    }
    for (const name of namesOf(event)) {
      keyOf.set(name, key);
    }
  }

  const peak = new Map<string, number>();
  for (const event of events) {
    if (
      event.kind !== "token.usage" ||
      event.tokens === undefined ||
      !inWindow(window, time(event))
    ) {
      continue;
    }
    const key = namesOf(event)
      .map((name) => keyOf.get(name))
      .find((found) => found !== undefined);
    if (key !== undefined) {
      peak.set(key, Math.max(peak.get(key) ?? 0, event.tokens));
    }
  }

  const over = [...peak]
    .filter(([, tokens]) => tokens > JUDGMENT_CONTEXT_LIMIT)
    .map(([session, tokens]) => {
      const idea = ideaOf.get(session);
      return idea === undefined
        ? { session, tokens }
        : { session, idea, tokens };
    })
    .sort((a, b) => b.tokens - a.tokens || a.session.localeCompare(b.session));

  return { limit: JUDGMENT_CONTEXT_LIMIT, panes: peak.size, over };
}
