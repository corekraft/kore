import type { Clock } from "../runtime/index.js";
import type { TerminalError, Terminals } from "../terminal/index.js";
import type { Ledger } from "./ledger.js";
import { lastReadings, planTerminals } from "./terminal-watch.js";

export type ReconcileResult =
  { ok: true; recorded: number } | { ok: false; message: string };

/** hc's message for an error: its message, with its hint in brackets when hc gives one. */
function messageOf(error: TerminalError): string {
  const { message, hint } = error.error;
  return hint === undefined ? message : `${message} (${hint})`;
}

/**
 * Records a terminal event for each terminal whose reading differs from the last one the ledger holds (plan 16,
 * Step 4 (e)). It reads hc ls --all once, so a terminal that finished while the watch was down is recorded once,
 * with its final status last. It stops at the first record the ledger refuses.
 */
export async function reconcileTerminals(deps: {
  ledger: Ledger;
  terminals: Terminals;
  clock: Clock;
}): Promise<ReconcileResult> {
  const listed = await deps.terminals.list();
  if ("error" in listed) {
    return { ok: false, message: messageOf(listed) };
  }
  const past = await deps.ledger.list({ source: "terminal" });
  const { events } = planTerminals(
    listed,
    lastReadings(past.events),
    deps.clock.now().toISOString(),
  );
  for (const event of events) {
    const recorded = await deps.ledger.record(event);
    if (!recorded.ok) {
      return { ok: false, message: recorded.message };
    }
  }
  return { ok: true, recorded: events.length };
}
