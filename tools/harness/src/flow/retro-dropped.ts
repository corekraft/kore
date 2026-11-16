import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** Proposals the per-retro cap dropped in the window, so a cap set too low shows in the report. */
export function retroProposalsDropped(
  events: LedgerEvent[],
  window: Span,
): number {
  return events
    .filter((e) => e.kind === "retro.dropped" && inWindow(window, time(e)))
    .reduce((sum, e) => sum + (e.number ?? 0), 0);
}
