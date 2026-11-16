import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** Cost events feed the cost metrics only; they are neither stage time nor attributed work. */
export const COST_KINDS = new Set<string>(["token.usage", "session.launch"]);

export interface Attribution {
  /** Where measuring starts: when sessions began carrying their stamp; null before any did. */
  since: string | null;
  /** Role-session events with an idea, and role-session events with none, since the stamp landed. */
  events: number;
  /** Role-session events that carry an idea. */
  withIdea: number;
  /** Role-session events that carry an idea and a stage. */
  withIdeaAndStage: number;
  /** Share, 0 to 1, of the session events since the stamp landed that come from sessions with no role; null when there are none. */
  noRoleShare: number | null;
}

/** What the measure asks of an event: the stage it claims, and whether its session has a role. */
export interface AttributionChecks {
  hasStage: (event: LedgerEvent, own: LedgerEvent[]) => boolean;
  hasRole: (event: LedgerEvent) => boolean;
}

/**
 * How much of the work recorded since the stamp landed comes from role sessions
 * and has an idea, and an idea and a stage. Earlier events cannot carry a
 * stamp, so they are not counted against the figure. GitHub events come from no
 * session and are left out; the share of the rest that comes from sessions with
 * no role is reported beside the figure, because the main session drives many
 * ideas and no stamp reaches it.
 */
export function measureAttribution(
  groups: LedgerEvent[][],
  orphans: LedgerEvent[],
  window: Span,
  landed: number | undefined,
  { hasStage, hasRole }: AttributionChecks,
): Attribution {
  if (landed === undefined) {
    return {
      since: null,
      events: 0,
      withIdea: 0,
      withIdeaAndStage: 0,
      noRoleShare: null,
    };
  }
  const counted = (e: LedgerEvent) =>
    !COST_KINDS.has(e.kind) &&
    e.source !== "github" &&
    inWindow(window, time(e)) &&
    time(e) >= landed;
  let withIdea = 0;
  let withIdeaAndStage = 0;
  let sessionEvents = 0;
  let noRole = 0;
  for (const own of groups) {
    for (const event of own.filter(counted)) {
      sessionEvents += 1;
      if (!hasRole(event)) {
        noRole += 1;
        continue;
      }
      withIdea += 1;
      withIdeaAndStage += hasStage(event, own) ? 1 : 0;
    }
  }
  let roleOrphans = 0;
  for (const event of orphans.filter(counted)) {
    sessionEvents += 1;
    if (hasRole(event)) {
      roleOrphans += 1;
    } else {
      noRole += 1;
    }
  }
  return {
    since: new Date(landed).toISOString(),
    events: withIdea + roleOrphans,
    withIdea,
    withIdeaAndStage,
    noRoleShare:
      sessionEvents === 0
        ? null
        : Math.round((noRole / sessionEvents) * 10_000) / 10_000,
  };
}
