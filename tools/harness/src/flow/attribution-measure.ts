import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** Cost events feed the cost metrics only; they are neither stage time nor attributed work. */
export const COST_KINDS = new Set<string>(["token.usage", "session.launch"]);

export interface Attribution {
  /** Where measuring starts: when sessions began carrying their stamp; null before any did. */
  since: string | null;
  events: number;
  withIdea: number;
  withIdeaAndStage: number;
}

/**
 * How much of the work recorded since the stamp landed has an idea, and an
 * idea and a stage. Earlier events cannot carry a stamp, so they stay
 * unattributed and are not counted against the figure.
 */
export function measureAttribution(
  groups: LedgerEvent[][],
  orphans: LedgerEvent[],
  window: Span,
  landed: number | undefined,
  hasStage: (event: LedgerEvent, own: LedgerEvent[]) => boolean,
): Attribution {
  if (landed === undefined) {
    return { since: null, events: 0, withIdea: 0, withIdeaAndStage: 0 };
  }
  const counted = (e: LedgerEvent) =>
    !COST_KINDS.has(e.kind) && inWindow(window, time(e)) && time(e) >= landed;
  let withIdea = 0;
  let withIdeaAndStage = 0;
  for (const own of groups) {
    for (const event of own.filter(counted)) {
      withIdea += 1;
      withIdeaAndStage += hasStage(event, own) ? 1 : 0;
    }
  }
  return {
    since: new Date(landed).toISOString(),
    events: withIdea + orphans.filter(counted).length,
    withIdea,
    withIdeaAndStage,
  };
}
