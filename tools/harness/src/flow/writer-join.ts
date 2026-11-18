// The join from a merged change to a writer tier (#1007, spec #997): a merged change joins to
// the tier of the linked writer's first priced launch, or of the earliest priced launch with the
// idea that launch carries. A change with no link event, or whose linked session has no priced
// launch, joins to no tier and is counted as unjoinable.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import { priceWeight } from "./writer-prices.js";

/**
 * A writer launch on a priced tier: its session name, pane, tier, idea (if stamped), effort (if
 * recorded, #1055) and launch time.
 */
export interface PricedLaunch {
  agent: string | undefined;
  pane: string | undefined;
  tier: string;
  idea: string | undefined;
  effort: string | undefined;
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
      effort: e.effort,
      at: time(e),
    }));
}

/** The earliest of the launches by launch time, or undefined with none. */
function earliest(launches: PricedLaunch[]): PricedLaunch | undefined {
  return [...launches].sort((a, b) => a.at - b.at)[0];
}

/** Each pull request's linked session name, from its earliest pr.linked event. */
export function linkedAgents(events: LedgerEvent[]): Map<number, string> {
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
 * The launch a linked session's merged change joins to: the session's own first priced launch when
 * it carries no idea, else the earliest priced launch with that idea. Undefined when the session has
 * no priced launch. Its tier is the tier the change joins to, and its effort the effort it ran at.
 */
export function launchOfLinked(
  launches: PricedLaunch[],
  agent: string,
): PricedLaunch | undefined {
  const own = earliest(launches.filter((l) => l.agent === agent));
  if (own === undefined) {
    return undefined;
  }
  if (own.idea === undefined) {
    return own;
  }
  return earliest(launches.filter((l) => l.idea === own.idea));
}

/**
 * The tier a linked session's merged change joins to: the tier of the earliest priced launch
 * with the idea that session's own first launch carries, or that launch's tier when it carries
 * no idea. Undefined when the session has no priced launch.
 */
export function tierOfLinked(
  launches: PricedLaunch[],
  agent: string,
): string | undefined {
  return launchOfLinked(launches, agent)?.tier;
}

/**
 * The writer sessions a linked session's merged change is charged for: the session, and every
 * launch that shares its first launch's idea (a relaunch of the same work). Undefined when the
 * session has no priced launch, the same case that joins no tier.
 */
export function writerGroup(
  launches: PricedLaunch[],
  agent: string,
): string[] | undefined {
  const own = earliest(launches.filter((l) => l.agent === agent));
  if (own === undefined) {
    return undefined;
  }
  if (own.idea === undefined) {
    return [agent];
  }
  const sharing = launches
    .filter((l) => l.idea === own.idea)
    .map((l) => l.agent)
    .filter((name): name is string => name !== undefined);
  return [...new Set([agent, ...sharing])];
}

/**
 * The merged changes in the span by the tier each joins to, and the count that joins to none. The
 * numbers are each tier's joined pull requests, so a tier's owner time can be read on them.
 */
export function mergedTierJoins(
  events: LedgerEvent[],
  span: Span,
): {
  joined: Map<string, number>;
  numbers: Map<string, number[]>;
  unjoinable: number;
} {
  const launches = pricedLaunches(events);
  const agents = linkedAgents(events);
  const joined = new Map<string, number>();
  const numbers = new Map<string, number[]>();
  let unjoinable = 0;
  for (const e of events) {
    if (e.kind !== "pr.merged" || !inWindow(span, time(e))) {
      continue;
    }
    const agent = e.number === undefined ? undefined : agents.get(e.number);
    const tier =
      agent === undefined ? undefined : tierOfLinked(launches, agent);
    if (tier === undefined || e.number === undefined) {
      unjoinable += 1;
    } else {
      joined.set(tier, (joined.get(tier) ?? 0) + 1);
      numbers.set(tier, [...(numbers.get(tier) ?? []), e.number]);
    }
  }
  return { joined, numbers, unjoinable };
}
