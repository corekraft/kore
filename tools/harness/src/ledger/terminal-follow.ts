import type { Clock } from "../runtime/index.js";
import type { TerminalError, Terminals } from "../terminal/index.js";
import type { Ledger } from "./ledger.js";
import { reconcileTerminals } from "./terminal-reconcile.js";
import { lastReadings, planTerminals } from "./terminal-watch.js";

/** The end of the watch: ok when hc's stream ended cleanly, else the message of the failure. */
export type FollowEnd = { ok: true } | { ok: false; message: string };

/** hc's message for an error: its message, with its hint in brackets when hc gives one. */
function messageOf(error: TerminalError): string {
  const { message, hint } = error.error;
  return hint === undefined ? message : `${message} (${hint})`;
}

/**
 * Records terminal readings as hc reports them (plan 16, Step 4 (e)). It reconciles first, so the gap before the
 * follow is recorded. Then it follows hc events, which carry no labels, so each event's terminal is read with get
 * and planned: a terminal the watch does not record is never recorded, and a terminal removed since its event is
 * skipped. It runs until the stream ends or fails, and returns why, so the caller starts it again.
 */
export async function followTerminals(deps: {
  ledger: Ledger;
  terminals: Terminals;
  clock: Clock;
}): Promise<FollowEnd> {
  const reconciled = await reconcileTerminals(deps);
  if (!reconciled.ok) {
    return { ok: false, message: reconciled.message };
  }
  let last = lastReadings(
    (await deps.ledger.list({ source: "terminal" })).events,
  );
  try {
    for await (const event of deps.terminals.events()) {
      const terminal = await deps.terminals.get(event.terminal);
      if ("error" in terminal) {
        if (terminal.error.kind === "not-found") {
          continue;
        }
        return { ok: false, message: messageOf(terminal) };
      }
      const planned = planTerminals(
        [terminal],
        last,
        deps.clock.now().toISOString(),
      );
      last = planned.last;
      for (const recorded of planned.events) {
        const stored = await deps.ledger.record(recorded);
        if (!stored.ok) {
          return { ok: false, message: stored.message };
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
