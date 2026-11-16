import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

export interface UnstampedSpawns {
  /** Spawns in the range that named no idea. */
  total: number;
  /** Those whose session gave a --no-idea reason: a deliberate gap, not a warned one. */
  withReason: number;
}

/** The spawns in range that named no idea, and how many gave a reason; they are not friction. */
export function unstampedSpawns(
  events: LedgerEvent[],
  window: Span,
): UnstampedSpawns {
  const spawns = events.filter(
    (e) => e.kind === "spawn.unstamped" && inWindow(window, time(e)),
  );
  return {
    total: spawns.length,
    withReason: spawns.filter((e) => e.label !== undefined).length,
  };
}
