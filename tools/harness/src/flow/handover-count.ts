// The handover count in the flow report (spec #1031, ticket #1036): the main session's
// pane sends that name a handover reason, counted over the window. It is a reading, not
// a guard; nothing here blocks a send. A window with no reason-carrying send, or with
// fewer merged changes than the minimum, is insufficient and never a zero.

import {
  HANDOVER_REASONS,
  type HandoverReason,
  type LedgerEvent,
} from "../ledger/index.js";
import { DEFAULT_COST, type CostOptions } from "./cost.js";
import { time } from "./github-waits.js";
import { mergedIn } from "./merged-span.js";
import { inWindow, type Span } from "./scope.js";

export type HandoverCount =
  | { status: "insufficient"; reason: string }
  | {
      status: "ok";
      /** Main-session sends in the window that named a handover reason. */
      handovers: number;
      /** Merged changes in the window, the figure the minimum is read against. */
      merged: number;
      /** Handovers by reason; every reason is a key, zero where none. */
      byReason: Record<HandoverReason, number>;
    };

const NO_SOURCE = "no handover reason recorded in the window";

/**
 * The handovers the main session made in the window, by reason. A send from a role
 * session is not a handover for this count, however it is worded, so only sends with
 * no sender role are read.
 */
export function handoverCount(
  events: LedgerEvent[],
  window: Span,
  cost: Partial<CostOptions> = {},
): HandoverCount {
  const reasons = events.flatMap((event) =>
    event.kind === "session.send" &&
    event.handover !== undefined &&
    event.senderRole === undefined &&
    inWindow(window, time(event))
      ? [event.handover]
      : [],
  );
  if (reasons.length === 0) {
    return { status: "insufficient", reason: NO_SOURCE };
  }
  const merged = mergedIn(events, window);
  const needed = { ...DEFAULT_COST, ...cost }.minMergedChanges;
  if (merged < needed) {
    return {
      status: "insufficient",
      reason: `${merged} of ${needed} merged changes needed`,
    };
  }
  const byReason = Object.fromEntries(
    HANDOVER_REASONS.map((reason) => [reason, 0]),
  ) as Record<HandoverReason, number>;
  for (const reason of reasons) {
    byReason[reason] += 1;
  }
  return { status: "ok", handovers: reasons.length, merged, byReason };
}
