// Writing cost by idea (#1093, spec #1086, ADR 0126): each writer session's cumulative tokens and
// dollars to the window's end, charged to the idea its pull request carries on its pr.linked event.
// A session stamped with an idea is already in that idea's figure, so it is never charged again.
// What carries no idea stays in a named bucket beside the per-idea figures: a linked pull request
// with no idea, and a writer session with no link. Neither is ever added to an idea.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import { cumulativeOf, round } from "./cost-waiting-support.js";
import { addSpend, NO_SPEND, type WritingSpend } from "./writing-spend.js";
import type {
  AttributedShare,
  CostWaitingOptions,
  Writing,
  WritingBucket,
} from "./cost-waiting-types.js";
import { NO_IDEA, writerLinks, type WriterLink } from "./writer-link-ideas.js";

/** What the writing join reads: the spend charged to each idea, and the figure with its buckets. */
export interface WritingIn {
  byIdea: Map<string, WritingSpend>;
  figure: Writing;
}

/** A bucket of sessions: null dollars naming the models when any ran on a model the price table does not price. */
function bucketOf(sessions: number, spend: WritingSpend): WritingBucket {
  const unpriced = spend.unpriced.length > 0;
  return {
    sessions,
    tokens: spend.tokens,
    dollars: unpriced ? null : round(spend.dollars),
    ...(unpriced ? { unpricedModels: spend.unpriced } : {}),
  };
}

/** Each writer launch's session name: the sessions whose spend is writing. */
function writerNames(events: LedgerEvent[]): Set<string> {
  return new Set(
    events
      .filter((e) => e.kind === "session.launch" && e.role === "writer")
      .map((e) => e.agent)
      .filter((agent): agent is string => agent !== undefined),
  );
}

/** The token.split readings of each named session, by name. */
function readingsBy(
  events: LedgerEvent[],
  names: Set<string>,
): Map<string, LedgerEvent[]> {
  const readings = new Map<string, LedgerEvent[]>();
  for (const e of events) {
    if (
      e.kind === "token.split" &&
      e.agent !== undefined &&
      names.has(e.agent)
    ) {
      readings.set(e.agent, [...(readings.get(e.agent) ?? []), e]);
    }
  }
  return readings;
}

/** Pull requests opened in the window that no pr.linked event names: counted, never read as no writing. */
function unjoinableIn(events: LedgerEvent[], window: Span): number {
  const linked = new Set(
    events.filter((e) => e.kind === "pr.linked").map((e) => e.number),
  );
  return new Set(
    events
      .filter(
        (e) =>
          e.kind === "pr.opened" &&
          e.number !== undefined &&
          inWindow(window, time(e)) &&
          !linked.has(e.number),
      )
      .map((e) => e.number),
  ).size;
}

/** The share of writer tokens attributed to an idea; insufficient below the minimum writer sessions. */
function shareOf(
  attributed: number,
  all: { sessions: number; tokens: number },
  minimum: number,
): AttributedShare {
  if (all.sessions < minimum || all.tokens === 0) {
    return { status: "insufficient", sessions: all.sessions, needed: minimum };
  }
  return {
    status: "measured",
    share: round(attributed / all.tokens),
    sessions: all.sessions,
  };
}

/** The bucket a session lands in: attributed when stamped or linked to an idea, else by whether it has a link. */
function bucketFor<B>(
  buckets: { attributed: B; noIdea: B; noPullRequest: B },
  stamped: boolean,
  link: WriterLink | undefined,
): B {
  if (stamped || link?.idea !== undefined) {
    return buckets.attributed;
  }
  return link === undefined ? buckets.noPullRequest : buckets.noIdea;
}

/**
 * The writing join over the window. A writer session is one with a writer launch and a token.split
 * reading in the window. A session stamped with a real idea on a reading is attributed to that
 * idea already; any other with a link is charged to the idea its earliest link carries, or to the
 * no-idea bucket when that carries none; a session with no link is in the no-pull-request bucket.
 */
export function writingIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
): WritingIn {
  const readings = readingsBy(events, writerNames(events));
  const links = writerLinks(events);
  const byIdea = new Map<string, WritingSpend>();
  const buckets = {
    attributed: { sessions: 0, spend: NO_SPEND },
    noIdea: { sessions: 0, spend: NO_SPEND },
    noPullRequest: { sessions: 0, spend: NO_SPEND },
  };
  for (const [name, own] of readings) {
    if (!own.some((e) => inWindow(window, time(e)))) {
      continue;
    }
    const spend = cumulativeOf(own, window[1], options.prices);
    const stamped = own.some((e) => e.idea !== undefined && e.idea !== NO_IDEA);
    const link = links.get(name);
    const bucket = bucketFor(buckets, stamped, link);
    bucket.sessions += 1;
    bucket.spend = addSpend(bucket.spend, spend);
    if (!stamped && link?.idea !== undefined) {
      byIdea.set(link.idea, addSpend(byIdea.get(link.idea) ?? NO_SPEND, spend));
    }
  }
  const all = {
    sessions:
      buckets.attributed.sessions +
      buckets.noIdea.sessions +
      buckets.noPullRequest.sessions,
    tokens:
      buckets.attributed.spend.tokens +
      buckets.noIdea.spend.tokens +
      buckets.noPullRequest.spend.tokens,
  };
  return {
    byIdea,
    figure: {
      attributed: bucketOf(
        buckets.attributed.sessions,
        buckets.attributed.spend,
      ),
      noIdea: bucketOf(buckets.noIdea.sessions, buckets.noIdea.spend),
      noPullRequest: bucketOf(
        buckets.noPullRequest.sessions,
        buckets.noPullRequest.spend,
      ),
      unjoinable: unjoinableIn(events, window),
      share: shareOf(buckets.attributed.spend.tokens, all, options.minimum),
    },
  };
}
