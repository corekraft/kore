// The figures a writer tier reads beside its cost (#1009, spec #997), each from events the ledger
// already holds: the rework sent to the tier's writer panes, the owner's minutes on the tier's
// merged changes, the share of its requests over the 100K prompt step, and the first request's
// prompt size. None of them reads prompt or reply text: only counts and sizes.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { ownerMinutes } from "./outcomes.js";
import { inWindow, type Span } from "./scope.js";
import { median } from "./wip.js";
import {
  linkedAgents,
  mergedTierJoins,
  pricedLaunches,
  writerGroup,
  type PricedLaunch,
} from "./writer-join.js";

export type { PricedLaunch } from "./writer-join.js";

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Requests a writer tier made in a span, and how many of them ran over the 100K prompt step. */
export interface RequestSplit {
  requests: number;
  over100k: number;
}

/** The figures one tier reads beside its cost; each is null (not zero) where nothing can be read. */
export interface TierFigureFields {
  /** Rework sent to the tier's writer panes in the span. */
  rework: number;
  /** The rework over the tier's merged changes; null with none joined. */
  reworkPerMergedChange: number | null;
  /** The owner's minutes on the tier's joined merged changes in the span (an upper bound, as outcomes.ts). */
  ownerMinutes: number;
  /** The owner's minutes over the tier's merged changes; null with none joined. */
  ownerMinutesPerMergedChange: number | null;
  /** The tier's requests in the span: the growth of its writer sessions' request counts. */
  requests: number;
  /** The share of the tier's requests over the 100K prompt step; null with no request in the span. */
  over100kShare: number | null;
  /**
   * The median first-request prompt size of the tier's writer sessions launched in the span whose first
   * request is in it; null with none.
   */
  firstPromptP50: number | null;
  /** The 90th percentile (nearest rank) of the same sessions' first-request prompt sizes; null with none. */
  firstPromptP90: number | null;
}

/** A tier with nothing in the span: no rework, no owner minutes, and every figure that needs a change or a request not read. */
export const NO_TIER_FIELDS: TierFigureFields = {
  rework: 0,
  reworkPerMergedChange: null,
  ownerMinutes: 0,
  ownerMinutesPerMergedChange: null,
  requests: 0,
  over100kShare: null,
  firstPromptP50: null,
  firstPromptP90: null,
};

/**
 * Rework sent to each tier's writer panes in the span. A send is rework when a judge send-back
 * for a pull request came before it and its writer started that pull request (the linked session
 * or a relaunch sharing its idea). Interrupts never reach the ledger as sends, so they never count.
 */
export function reworkSendsIn(
  events: LedgerEvent[],
  span: Span,
): Map<string, number> {
  const launches = pricedLaunches(events);
  const tierOfPane = new Map<string, string>();
  for (const launch of launches) {
    if (launch.pane !== undefined) {
      tierOfPane.set(launch.pane, launch.tier);
    }
  }
  const agents = linkedAgents(events);
  const sendBacks = events.flatMap((e) => {
    if (e.kind !== "send-back" || e.number === undefined) {
      return [];
    }
    const agent = agents.get(e.number);
    const group =
      agent === undefined ? [] : (writerGroup(launches, agent) ?? []);
    return [{ at: time(e), group: new Set(group) }];
  });
  const counts = new Map<string, number>();
  for (const e of events) {
    if (
      e.kind !== "session.send" ||
      e.pane === undefined ||
      e.agent === undefined ||
      !inWindow(span, time(e))
    ) {
      continue;
    }
    const tier = tierOfPane.get(e.pane);
    const at = time(e);
    const agent = e.agent;
    const reworked = sendBacks.some((sb) => sb.at < at && sb.group.has(agent));
    if (tier !== undefined && reworked) {
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Minutes of owner time on the given merged changes in the span: each sitting from its first to its
 * last owner action, a sitting ten minutes or more after the last one starting a new one (outcomes.ts).
 */
export function ownerMinutesIn(
  events: LedgerEvent[],
  span: Span,
  numbers: number[],
): number {
  const joined = new Set(numbers);
  return ownerMinutes(
    events
      .filter(
        (e) =>
          e.kind === "owner.action" &&
          e.number !== undefined &&
          joined.has(e.number) &&
          inWindow(span, time(e)),
      )
      .map(time),
  );
}

/** Each writer session's cumulative request counts per model, before a time; the latest reading per model wins. */
function requestsBefore(
  events: LedgerEvent[],
  tierOf: Map<string, string>,
  before: number,
): Map<string, Map<string, { at: number; low: number; high: number }>> {
  const latest = new Map<
    string,
    Map<string, { at: number; low: number; high: number }>
  >();
  for (const e of events) {
    if (
      e.kind !== "token.split" ||
      e.agent === undefined ||
      e.model === undefined ||
      !tierOf.has(e.agent)
    ) {
      continue;
    }
    const at = time(e);
    if (at >= before) {
      continue;
    }
    const byModel = latest.get(e.agent) ?? new Map();
    const seen = byModel.get(e.model);
    if (seen === undefined || at >= seen.at) {
      byModel.set(e.model, {
        at,
        low: e.lowRequests ?? 0,
        high: e.highRequests ?? 0,
      });
    }
    latest.set(e.agent, byModel);
  }
  return latest;
}

/**
 * Each tier's requests in the span, and how many ran over the 100K step: the growth of each writer
 * session's cumulative counts between the span's start and end. A tier with no writer spend in the
 * span has no entry.
 */
export function requestSplitIn(
  events: LedgerEvent[],
  span: Span,
): Map<string, RequestSplit> {
  const tierOf = new Map<string, string>();
  for (const launch of pricedLaunches(events)) {
    if (launch.agent !== undefined) {
      tierOf.set(launch.agent, launch.tier);
    }
  }
  const end = requestsBefore(events, tierOf, span[1]);
  const start = requestsBefore(events, tierOf, span[0]);
  const split = new Map<string, RequestSplit>();
  for (const [agent, models] of end) {
    const tier = tierOf.get(agent);
    if (tier === undefined) {
      continue;
    }
    for (const [model, now] of models) {
      const before = start.get(agent)?.get(model);
      const low = now.low - (before?.low ?? 0);
      const high = now.high - (before?.high ?? 0);
      const seen = split.get(tier) ?? { requests: 0, over100k: 0 };
      split.set(tier, {
        requests: seen.requests + low + high,
        over100k: seen.over100k + high,
      });
    }
  }
  return split;
}

/**
 * Each writer session's first request: the firstPrompt of its earliest reading in the whole ledger,
 * with that reading's time. Whether that request falls in a span is the caller's to read.
 */
export function firstRequestsByAgent(
  events: LedgerEvent[],
): Map<string, { at: number; prompt: number }> {
  const earliest = new Map<string, { at: number; prompt: number }>();
  for (const e of events) {
    if (
      e.kind !== "token.split" ||
      e.agent === undefined ||
      e.firstPrompt === undefined
    ) {
      continue;
    }
    const at = time(e);
    const seen = earliest.get(e.agent);
    if (seen === undefined || at < seen.at) {
      earliest.set(e.agent, { at, prompt: e.firstPrompt });
    }
  }
  return earliest;
}

/** The first request's prompt size of one writer session, or undefined when it has no reading. */
export function firstPromptOf(
  events: LedgerEvent[],
  agent: string,
): number | undefined {
  return firstRequestsByAgent(events).get(agent)?.prompt;
}

/** The 90th percentile of the prompt sizes by nearest rank: the size one prompt in ten reaches or passes. */
export function promptSizeP90(prompts: number[]): number | null {
  if (prompts.length === 0) {
    return null;
  }
  const sorted = [...prompts].sort((a, b) => a - b);
  return sorted[Math.ceil(0.9 * sorted.length) - 1] ?? null;
}

/**
 * Every tier's figures beside its cost over the span, with the merged-change join they divide by:
 * `joined` counts each tier's merged changes, `unjoinable` those that join to no tier, and
 * `launches` are every priced writer launch of the ledger, for the caller to span-filter; the prompt
 * figures read only the span's own launches, whatever the caller passes.
 */
export function tierJoinsIn(
  events: LedgerEvent[],
  span: Span,
  tiers: string[],
) {
  const joins = mergedTierJoins(events, span);
  const launches = pricedLaunches(events);
  return {
    joined: joins.joined,
    unjoinable: joins.unjoinable,
    launches,
    figures: tierFiguresIn(events, span, tiers, launches, joins.numbers),
  };
}

/**
 * Every tier's figures over the span. `launches` are the priced writer launches, and `numbers` each
 * tier's joined merged-change pull requests; a tier's per-change figures divide by its joined count,
 * and read null when it has none. A prompt figure reads a writer only when it launched in the span
 * and its first request (its earliest reading) is in the span too: a writer launched before the span,
 * or whose first request is outside it, is left out.
 */
function tierFiguresIn(
  events: LedgerEvent[],
  span: Span,
  tiers: string[],
  launches: PricedLaunch[],
  numbers: Map<string, number[]>,
): Map<string, TierFigureFields> {
  const reworked = reworkSendsIn(events, span);
  const splits = requestSplitIn(events, span);
  const firstRequests = firstRequestsByAgent(events);
  return new Map(
    tiers.map((tier): [string, TierFigureFields] => {
      const joined = numbers.get(tier) ?? [];
      const changes = joined.length;
      const rework = reworked.get(tier) ?? 0;
      const minutes = ownerMinutesIn(events, span, joined);
      const split = splits.get(tier) ?? { requests: 0, over100k: 0 };
      // The prompt figures read only the writer sessions launched in the span whose first request is in it.
      const prompts = launches.flatMap((l) => {
        const first =
          l.tier === tier && l.agent !== undefined
            ? firstRequests.get(l.agent)
            : undefined;
        return first !== undefined &&
          inWindow(span, l.at) &&
          inWindow(span, first.at)
          ? [first.prompt]
          : [];
      });
      return [
        tier,
        {
          rework,
          reworkPerMergedChange: changes === 0 ? null : round(rework / changes),
          ownerMinutes: round(minutes),
          ownerMinutesPerMergedChange:
            changes === 0 ? null : round(minutes / changes),
          requests: split.requests,
          over100kShare:
            split.requests === 0
              ? null
              : round(split.over100k / split.requests),
          firstPromptP50: median(prompts),
          firstPromptP90: promptSizeP90(prompts),
        },
      ];
    }),
  );
}
