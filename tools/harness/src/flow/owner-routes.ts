// Questions the router sent to the owner, by the signal that sent them (ADR 0120). A signal
// that never fires, or always does, shows here; the advisor's own route is counted apart.
import {
  DECISION_ROUTE_SIGNALS,
  type DecisionRouteSignal,
  type LedgerEvent,
} from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** Every signal that can send a question to the owner: all but the advisor's own, "agreed". */
export type OwnerSignal = Exclude<DecisionRouteSignal, "agreed">;

const OWNER_SIGNALS = DECISION_ROUTE_SIGNALS.filter(
  (signal): signal is OwnerSignal => signal !== "agreed",
);

export interface OwnerRoutes {
  /** Questions the router sent to the advisor in the range. */
  advisor: number;
  /** Questions the router sent to the owner in the range. */
  owner: number;
  /** The owner-routed questions per signal, every owner signal present and zero where none. */
  bySignal: Record<OwnerSignal, number>;
}

/** The routes decision.routed events record in the range, by where they went and why. */
export function ownerRoutes(events: LedgerEvent[], window: Span): OwnerRoutes {
  const routed = events.filter(
    (e) => e.kind === "decision.routed" && inWindow(window, time(e)),
  );
  const bySignal = Object.fromEntries(
    OWNER_SIGNALS.map((signal) => [signal, 0]),
  ) as Record<OwnerSignal, number>;
  let owner = 0;
  for (const event of routed) {
    if (event.route !== "owner" || event.signal === undefined) {
      continue;
    }
    owner += 1;
    if (event.signal !== "agreed") {
      bySignal[event.signal] += 1;
    }
  }
  return {
    advisor: routed.filter((e) => e.route === "advisor").length,
    owner,
    bySignal,
  };
}
