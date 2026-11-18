// The compaction count in the flow report (#1037, spec #1027): the session.compacted
// readings of the window, totalled and given per session. It is a reading, not a guard.
// A window with no session is insufficient and never a zero; a session seen that never
// compacted counts as zero beside the ones that did.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

export type CompactionCount =
  | { status: "insufficient"; reason: string }
  | {
      status: "ok";
      /** Compactions recorded in the window, each compaction of a session once. */
      compactions: number;
      /** Sessions with any event in the window. */
      sessions: number;
      /** Compactions by session; every session seen is a key, zero where none. */
      perSession: Record<string, number>;
    };

const NO_SESSION = "no session recorded in the window";

/** The compactions in the window, in total and per session. */
export function compactionCount(
  events: LedgerEvent[],
  window: Span,
): CompactionCount {
  const seen = new Set<string>();
  const numbers = new Map<string, Set<number>>();
  for (const event of events) {
    if (event.session === undefined || !inWindow(window, time(event))) {
      continue;
    }
    seen.add(event.session);
    if (event.kind === "session.compacted" && event.compaction !== undefined) {
      const held = numbers.get(event.session) ?? new Set<number>();
      held.add(event.compaction);
      numbers.set(event.session, held);
    }
  }
  if (seen.size === 0) {
    return { status: "insufficient", reason: NO_SESSION };
  }
  const perSession = Object.fromEntries(
    [...seen].map((session) => [session, numbers.get(session)?.size ?? 0]),
  );
  return {
    status: "ok",
    compactions: Object.values(perSession).reduce((a, b) => a + b, 0),
    sessions: seen.size,
    perSession,
  };
}
