// The rework each pull request had (#1051, spec #1024), by #1009's definition: a send to a writer
// pane after a judge send-back for that pull request, to a session of the writer that started it
// (the linked session or a relaunch sharing its idea). It is the per-change form of
// the count reworkSendsIn makes per tier, over the whole ledger and not a span; interrupts never reach the ledger as
// sends, so they never count. A send is credited once to each pull request sent back before it.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { linkedAgents, pricedLaunches, writerGroup } from "./writer-join.js";

/** The rework sends of each pull request that had one, over the whole ledger. */
export function reworkByChange(events: LedgerEvent[]): Map<number, number> {
  const launches = pricedLaunches(events);
  const panes = new Set(
    launches.flatMap((l) => (l.pane === undefined ? [] : [l.pane])),
  );
  const agents = linkedAgents(events);
  const sendBacks = events.flatMap((e) => {
    if (e.kind !== "send-back" || e.number === undefined) {
      return [];
    }
    const agent = agents.get(e.number);
    const group =
      agent === undefined ? [] : (writerGroup(launches, agent) ?? []);
    return [{ number: e.number, at: time(e), group: new Set(group) }];
  });
  const counts = new Map<number, number>();
  for (const e of events) {
    if (
      e.kind !== "session.send" ||
      e.pane === undefined ||
      e.agent === undefined ||
      !panes.has(e.pane)
    ) {
      continue;
    }
    const at = time(e);
    const agent = e.agent;
    const sentBack = new Set(
      sendBacks
        .filter((sb) => sb.at < at && sb.group.has(agent))
        .map((sb) => sb.number),
    );
    for (const number of sentBack) {
      counts.set(number, (counts.get(number) ?? 0) + 1);
    }
  }
  return counts;
}
