// The join from a merged change to a writer tier (#1007, spec #997): a merged change joins to
// the tier of the linked writer's first priced launch, or of the earliest priced launch with the
// idea that launch carries. A change with no link event, or whose linked session has no priced
// launch, joins to no tier and is counted as unjoinable.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import { priceWeight } from "./writer-prices.js";

/** A writer launch on a priced tier: its session name, pane, tier, idea (if stamped) and launch time. */
export interface PricedLaunch {
  agent: string | undefined;
  pane: string | undefined;
  tier: string;
  idea: string | undefined;
  at: number;
}

export function pricedLaunches(events: LedgerEvent[]): PricedLaunch[] {
  return events
    .filter(
      (e) =>
        e.kind === "session.launch" &&
        e.role === "writer" &&
        e.tier !== undefined &&
        priceWeight(e.tier) !== undefined,
    )
    .map((e) => ({
      agent: e.agent,
      pane: e.pane,
      tier: e.tier as string,
      idea: e.idea,
      at: time(e),
    }));
}

/** The earliest of the launches by launch time, or undefined with none. */
function earliest(launches: PricedLaunch[]): PricedLaunch | undefined {
  return [...launches].sort((a, b) => a.at - b.at)[0];
}

/** Each pull request's linked session name, from its earliest pr.linked event. */
function linkedAgents(events: LedgerEvent[]): Map<number, string> {
  const first = new Map<number, { at: number; agent: string }>();
  for (const e of events) {
    if (
      e.kind !== "pr.linked" ||
      e.number === undefined ||
      e.agent === undefined
    ) {
      continue;
    }
    const at = time(e);
    const seen = first.get(e.number);
    if (seen === undefined || at < seen.at) {
      first.set(e.number, { at, agent: e.agent });
    }
  }
  return new Map([...first].map(([number, v]) => [number, v.agent]));
}

/**
 * The tier a linked session's merged change joins to: the tier of the earliest priced launch
 * with the idea that session's own first launch carries, or that launch's tier when it carries
 * no idea. Undefined when the session has no priced launch.
 */
function tierOfLinked(
  launches: PricedLaunch[],
  agent: string,
): string | undefined {
  const own = earliest(launches.filter((l) => l.agent === agent));
  if (own === undefined) {
    return undefined;
  }
  if (own.idea === undefined) {
    return own.tier;
  }
  return earliest(launches.filter((l) => l.idea === own.idea))?.tier;
}

/** The merged changes in the span by the tier each joins to, and the count that joins to none. */
export function mergedTierJoins(
  events: LedgerEvent[],
  span: Span,
): { joined: Map<string, number>; unjoinable: number } {
  const launches = pricedLaunches(events);
  const agents = linkedAgents(events);
  const joined = new Map<string, number>();
  let unjoinable = 0;
  for (const e of events) {
    if (e.kind !== "pr.merged" || !inWindow(span, time(e))) {
      continue;
    }
    const agent = e.number === undefined ? undefined : agents.get(e.number);
    const tier =
      agent === undefined ? undefined : tierOfLinked(launches, agent);
    if (tier === undefined) {
      unjoinable += 1;
    } else {
      joined.set(tier, (joined.get(tier) ?? 0) + 1);
    }
  }
  return { joined, unjoinable };
}
