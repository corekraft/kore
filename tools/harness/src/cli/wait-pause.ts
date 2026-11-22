// The pauses of a wait (plan 16, Step 6): each waits for the next news, for at most the remaining milliseconds, and
// resolves true when the bound passed first. The children pause waits on the caller's children on hc and never sleeps;
// the default pause sleeps one checks interval, as the checks loop always did.

import type { Clock } from "../runtime/index.js";
import type { TerminalError, Terminals } from "../terminal/index.js";
import { CHECKS_POLL_MS } from "./pr-checks.js";

/** Waits for the next news, for at most the remaining milliseconds: resolves true when the bound passed with nothing new. */
export type Pause = (remainingMs: number) => Promise<boolean>;

/** hc's message for an error: its message, with its hint in brackets when hc gives one. */
export function messageOf(error: TerminalError): string {
  const { message, hint } = error.error;
  return hint === undefined ? message : `${message} (${hint})`;
}

/**
 * The pause that waits on the caller's children for news: a child that finished and was not reported before. A wake
 * that names only children already reported waits again for the rest of the bound, without a read and without a sleep.
 */
export function childrenPause(deps: {
  terminals: Terminals;
  self: string;
  clock: Clock;
}): Pause {
  const reported = new Set<string>();
  return async (remainingMs) => {
    const start = deps.clock.now().getTime();
    for (;;) {
      const left = remainingMs - (deps.clock.now().getTime() - start);
      if (left <= 0) {
        return true;
      }
      const waited = await deps.terminals.wait(
        { children: "any", of: deps.self },
        left,
      );
      if ("error" in waited) {
        if (waited.error.kind === "timeout") {
          return true;
        }
        throw new Error(messageOf(waited));
      }
      const news = waited.finished.filter((t) => !reported.has(t.id));
      for (const terminal of news) {
        reported.add(terminal.id);
      }
      if (news.length > 0) {
        return false;
      }
    }
  };
}

/** The pause that sleeps one poll interval, and passes the bound when less than one interval remains. */
export function pollPause(clock: Clock): Pause {
  return async (remainingMs) => {
    if (remainingMs < CHECKS_POLL_MS) {
      return true;
    }
    await clock.sleep(CHECKS_POLL_MS);
    return false;
  };
}
