// Active and waiting seconds per session (#1019), charged from the session's own state events by the
// rules the flow report charges to a stage (STATE_AFTER in report.ts). Only state events bound an
// interval: a token reading inside a span does not end it. A close holds until the session's next
// spawn or start, so a reused pane is not charged for the gap between lives.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import type { Span } from "./scope.js";
import { keyOf } from "./cost-waiting-support.js";

type State = "active" | "waiting" | "closed";

/** The state an event leaves its session in, as the flow report reads it. */
const STATE_AFTER: Record<string, State> = {
  "session.start": "active",
  "tool.start": "active",
  "tool.end": "active",
  "pane.spawned": "active",
  "pane.busy": "active",
  "pane.waiting": "waiting",
  "pane.closed": "closed",
  "session.stop": "closed",
};

const LIFE_STARTS = new Set(["pane.spawned", "session.start"]);

export interface SessionSeconds {
  active: number;
  waiting: number;
}

/** One session's seconds inside the window, from its state events in time order. */
function chargeSession(items: LedgerEvent[], window: Span): SessionSeconds {
  const seconds: SessionSeconds = { active: 0, waiting: 0 };
  let closed = false;
  items.forEach((event, i) => {
    if (closed) {
      closed = !LIFE_STARTS.has(event.kind);
      return;
    }
    const state = STATE_AFTER[event.kind];
    const next = items[i + 1];
    if (state === "closed") {
      closed = true;
    } else if (state !== undefined && next !== undefined) {
      const from = Math.max(time(event), window[0]);
      const to = Math.min(time(next), window[1]);
      if (to > from) {
        seconds[state] += (to - from) / 1000;
      }
    }
  });
  return seconds;
}

/** Each session's active and waiting seconds in the window, keyed as the sessions are (keyOf). */
export function secondsBySession(
  events: LedgerEvent[],
  window: Span,
): Map<string, SessionSeconds> {
  const byKey = new Map<string, LedgerEvent[]>();
  for (const event of events) {
    const key = keyOf(event);
    if (key !== undefined && Object.hasOwn(STATE_AFTER, event.kind)) {
      byKey.set(key, [...(byKey.get(key) ?? []), event]);
    }
  }
  return new Map(
    [...byKey].map(([key, items]) => [
      key,
      chargeSession(
        items.sort((a, b) => time(a) - time(b)),
        window,
      ),
    ]),
  );
}
