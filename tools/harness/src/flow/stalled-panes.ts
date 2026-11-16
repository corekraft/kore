// Stalled panes from two independent sources (#854, parent #818). The detector's
// pane.stalled events are one count. The other is token-usage silence, which the
// detector never reads: a session whose last token.usage is more than the limit
// before the measuring point, with no RESULT since, and no background command open on
// its pane. The limit is a placeholder the owner tunes from this report.

import { hasOpenBackground, type LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** Token silence longer than this is a stall: above the host's 10 minute limit on a foreground command. */
export const SILENCE_SECONDS = 900;

export interface StalledPanes {
  /** The silence limit, in seconds, that a token-usage silence must exceed. */
  silenceSeconds: number;
  /** pane.stalled events the poll recorded in the window. */
  recorded: number;
  /** Sessions silent past the limit at the measuring point, with no RESULT since their last tokens. */
  fromTokenUsage: number;
  /** Silent sessions left out because a background command was open on their pane. */
  backgroundExcluded: number;
}

/** The latest token.usage of each session in the window, read no later than `silentAt`. */
function lastTokensBySession(
  events: readonly LedgerEvent[],
  window: Span,
  silentAt: number,
): Map<string, LedgerEvent> {
  const last = new Map<string, LedgerEvent>();
  for (const event of events) {
    const at = time(event);
    if (
      event.kind !== "token.usage" ||
      event.session === undefined ||
      !inWindow(window, at) ||
      at > silentAt
    ) {
      continue;
    }
    const seen = last.get(event.session);
    if (seen === undefined || at >= time(seen)) {
      last.set(event.session, event);
    }
  }
  return last;
}

/** Whether a session printed a RESULT, or its pane did, after `since` and by `silentAt`. */
function answeredSince(
  events: readonly LedgerEvent[],
  session: string,
  pane: string | undefined,
  since: number,
  silentAt: number,
): boolean {
  return events.some((e) => {
    const at = time(e);
    if (at <= since || at > silentAt) {
      return false;
    }
    return (
      (e.kind === "session.result" && e.session === session) ||
      (e.kind === "pane.finished" && pane !== undefined && e.pane === pane)
    );
  });
}

/**
 * Counts the stalled panes in the window. Silence is measured at the earlier of the
 * window's end and the as-of time, so a report of an old window does not grow stale.
 */
export function stalledPanes(
  events: readonly LedgerEvent[],
  window: Span,
  asOf: number,
): StalledPanes {
  const silentAt = Math.min(window[1], asOf);
  const recorded = events.filter(
    (e) => e.kind === "pane.stalled" && inWindow(window, time(e)),
  ).length;
  let fromTokenUsage = 0;
  let backgroundExcluded = 0;
  for (const [session, tokens] of lastTokensBySession(
    events,
    window,
    silentAt,
  )) {
    const since = time(tokens);
    const pane = tokens.pane;
    if (
      silentAt - since <= SILENCE_SECONDS * 1000 ||
      answeredSince(events, session, pane, since, silentAt)
    ) {
      continue;
    }
    if (pane !== undefined && hasOpenBackground(events, pane, silentAt)) {
      backgroundExcluded += 1;
    } else {
      fromTokenUsage += 1;
    }
  }
  return {
    silenceSeconds: SILENCE_SECONDS,
    recorded,
    fromTokenUsage,
    backgroundExcluded,
  };
}
