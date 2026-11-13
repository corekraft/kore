import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";

/**
 * Gives an event that names no agent the agent its pane was last named, at or
 * before the event. Herdr names a pane when it is spawned, and a stamped
 * session names itself, so older ledgers, from before sessions were stamped,
 * still map to a role. An event from before its pane was named stays unnamed.
 */
export function withPaneAgents(events: LedgerEvent[]): LedgerEvent[] {
  const named = new Map<string, { at: number; agent: string }[]>();
  for (const e of events) {
    if (e.pane !== undefined && e.agent !== undefined) {
      named.set(e.pane, [
        ...(named.get(e.pane) ?? []),
        { at: time(e), agent: e.agent },
      ]);
    }
  }
  for (const list of named.values()) {
    list.sort((a, b) => a.at - b.at);
  }
  return events.map((e) => {
    if (e.agent !== undefined || e.pane === undefined) {
      return e;
    }
    const agent = (named.get(e.pane) ?? []).findLast(
      (n) => n.at <= time(e),
    )?.agent;
    return agent === undefined ? e : { ...e, agent };
  });
}

/** When sessions began carrying their stamp: the first claude event that names its agent, or undefined before that. */
export function stampLanded(events: LedgerEvent[]): number | undefined {
  const stamped = events
    .filter((e) => e.source === "claude" && e.agent !== undefined)
    .map(time);
  return stamped.length === 0 ? undefined : Math.min(...stamped);
}
