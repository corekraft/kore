import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { stageStamp, stampedStages } from "./stamped-stage.js";
import {
  APPROVAL_LABEL,
  GITHUB_STAGES,
  MAIN_SESSION_STAGE,
  ROLE_STAGES,
  type Stage,
} from "./stages.js";

export type { Stage };

function roleOf(event: LedgerEvent) {
  for (const name of [event.agent, event.pane, event.session]) {
    const role = name?.split("-").at(-1);
    if (role !== undefined && Object.hasOwn(ROLE_STAGES, role)) {
      return ROLE_STAGES[role];
    }
  }
  return undefined;
}

/**
 * Whether an event's session has a role: it was stamped with a stage at launch,
 * or its name ends in a role. The main session has none.
 */
export function roleResolver(events: LedgerEvent[]) {
  const stamps = stampedStages(events);
  return (event: LedgerEvent): boolean =>
    stageStamp(event, stamps) !== undefined || roleOf(event) !== undefined;
}

/**
 * The stage of an event, or undefined when none claims it. A GitHub event names
 * its own; a stamped session's events take the stage its launch carried, before
 * any guess from a pane name; the main session orchestrates.
 */
export function stageResolver(events: LedgerEvent[]) {
  const stamps = stampedStages(events);
  return (event: LedgerEvent, mergedAt: number | undefined) => {
    const github = GITHUB_STAGES[event.kind];
    if (github !== undefined) {
      return github;
    }
    if (event.kind === "issue.labelled") {
      return event.label === APPROVAL_LABEL ? "await approval" : undefined;
    }
    const stamped = stageStamp(event, stamps);
    if (stamped !== undefined) {
      return stamped;
    }
    const role = roleOf(event);
    if (role !== undefined) {
      const gate = role.after === "pr.merged" ? mergedAt : undefined;
      const open =
        role.after === undefined || (gate !== undefined && time(event) >= gate);
      return open ? role.stage : undefined;
    }
    // A claude session no agent name reaches, stamped or from its pane, is the main session.
    return event.agent === undefined && event.source === "claude"
      ? MAIN_SESSION_STAGE
      : undefined;
  };
}
