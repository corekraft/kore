import type { LedgerEvent } from "../ledger/index.js";
import { closedIdeas, trailingMetric, type CostMetric } from "./cost.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

/** The sender a send from the main session takes: a send names no role, and one from before senders were recorded names none either. */
export const MAIN_SESSION = "main session";

export interface FollowUpSender {
  /** The sender's role, or the main session. */
  sender: string;
  /** Follow-ups in range from this sender. */
  events: number;
}

export interface FollowUps {
  /** Writer sessions launched in range. */
  writerSessions: number;
  /** Follow-ups in range by sender, most first, ties by sender name. */
  bySender: FollowUpSender[];
}

export interface FollowUpMetrics {
  /** Follow-ups from every sender per writer session, per closed idea with a writer session, with a trailing average. */
  followUpsPerWriterSession: CostMetric;
  /** The main session's follow-ups per writer session, with a trailing average. */
  mainFollowUpsPerWriterSession: CostMetric;
  /** Follow-ups in range split by sender, beside the writer sessions they went to. */
  followUps: FollowUps;
}

const isWriterLaunch = (e: LedgerEvent) =>
  e.kind === "session.launch" && e.role === "writer";

const senderOf = (e: LedgerEvent) => e.senderRole ?? MAIN_SESSION;

/**
 * The writer launches of an idea's events, and the sends to a pane one of them
 * launched. A send to any other pane is not a follow-up to a writer session.
 */
function writerTraffic(own: LedgerEvent[]) {
  const launches = own.filter(isWriterLaunch);
  const panes = new Set(
    launches.map((e) => e.pane).filter((p): p is string => p !== undefined),
  );
  const sends = own.filter(
    (e) =>
      e.kind === "session.send" && e.pane !== undefined && panes.has(e.pane),
  );
  return { launches, sends };
}

/** Follow-ups per writer session per closed idea, from every sender and from the main session alone, each with a trailing average, and the window's split by sender. */
export function followUpMetrics(
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
  trailingIdeas: number,
  maxIncrease: number,
): FollowUpMetrics {
  const closed = closedIdeas(byIdea, window)
    .map(({ idea, own }) => ({ idea, ...writerTraffic(own) }))
    .filter((c) => c.launches.length > 0);
  const per = (isCounted: (e: LedgerEvent) => boolean) =>
    trailingMetric(
      closed.map((c) => ({
        idea: c.idea,
        value: c.sends.filter(isCounted).length / c.launches.length,
      })),
      trailingIdeas,
      { maxIncrease },
    );
  return {
    followUpsPerWriterSession: per(() => true),
    mainFollowUpsPerWriterSession: per((e) => senderOf(e) === MAIN_SESSION),
    followUps: followUpsInWindow(byIdea, window),
  };
}

/** The writer sessions launched in range, and the follow-ups sent in range by sender, most first. */
function followUpsInWindow(
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
): FollowUps {
  const counts = new Map<string, number>();
  let writerSessions = 0;
  for (const own of byIdea.values()) {
    const { launches, sends } = writerTraffic(own);
    writerSessions += launches.filter((e) => inWindow(window, time(e))).length;
    for (const send of sends) {
      if (inWindow(window, time(send))) {
        const sender = senderOf(send);
        counts.set(sender, (counts.get(sender) ?? 0) + 1);
      }
    }
  }
  const bySender = [...counts]
    .map(([sender, events]) => ({ sender, events }))
    .sort((a, b) => b.events - a.events || a.sender.localeCompare(b.sender));
  return { writerSessions, bySender };
}
