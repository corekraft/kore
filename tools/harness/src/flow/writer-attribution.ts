// The dollars of each merged change in a span (#1008, spec #997), attributed as the advisor reading
// on #1008 decided, under ADR 0125 (proposed):
// - the writer: the whole-life dollars of the writer sessions that started the change (its linked
//   session and every launch sharing its idea), to the last merge of those sessions; a session linked
//   to several merged changes splits that life equally between them;
// - the reviewer: the whole-life dollars of the session named for the change's PR (pr<N>-reviewer),
//   to its merge;
// - the shared part: the judge's and orchestrating session's spend in the span, not the reviewers',
//   divided equally over every merged change in the span. The orchestrating part is priced at the
//   assumed main-session model (writer-usage.ts), since the ledger's reading is the main session's.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";
import { tokenStageResolver, type Stage } from "./stage-of.js";
import { median } from "./wip.js";
import {
  addCounts,
  NO_COUNTS,
  priceCounts,
  spendBefore,
  subCounts,
  type PriceTable,
  type SessionSpend,
} from "./writer-dollars.js";
import {
  linkedAgents,
  pricedLaunches,
  tierOfLinked,
  writerGroup,
  type PricedLaunch,
} from "./writer-join.js";
import { MAIN_SESSION_MODEL } from "./writer-usage.js";

/** One merged change in the span: the tier it joins to, its writer's share and its reviewer's dollars. */
export interface MergedChangeDollars {
  number: number;
  /** The tier its linked writer's first launch was on; undefined when the change joins to none. */
  tier: string | undefined;
  /** The writer sessions' share of this change; undefined when the change joins to none. */
  writer: number | undefined;
  /** The dollars of the session named for this change's PR, to its merge. */
  reviewer: number;
}

export interface WriterDollars {
  /** Every merged change in the span, joined or not. */
  changes: MergedChangeDollars[];
  /** The judge's and orchestrating session's spend in the span, not the reviewers', shared per change. */
  shared: { judge: number; orchestrate: number };
  /** Writer sessions with spend before the span's end and no merged change linked to them: left out. */
  unmergedWriterSessions: number;
}

/**
 * A tier's all-in dollars per merged change (#1008): the means of each part over the tier's merged
 * changes, their sum, and the median of the per-change all-in totals. The parts do not sum to the
 * median.
 */
export interface TierDollars {
  /** The writer sessions' dollars per change, the mean over the tier's merged changes. */
  writer: number;
  /** The change's reviewer session's dollars, the mean over the tier's merged changes. */
  reviewer: number;
  /** The judge's shared share per merged change, the same for every tier. */
  judge: number;
  /** The orchestrating session's shared share per merged change, the same for every tier. */
  orchestrate: number;
  /** The sum of the four parts. */
  allIn: number;
  /** The median of the per-change all-in totals (writer, reviewer and the shared parts). */
  median: number;
}

type Merge = { number: number; at: number };

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** The dollars one session's spend is worth at the price table, each model priced at its own rates. */
function dollarsOf(
  spend: SessionSpend | undefined,
  prices: PriceTable,
): number {
  if (spend === undefined) {
    return 0;
  }
  let total = 0;
  for (const [model, counts] of spend.byModel) {
    total += priceCounts(counts, model, prices) ?? 0;
  }
  return total;
}

/** Each writer session's merged changes before the span's end: how many, and its last merge. */
function mergesBefore(
  merges: Merge[],
  span: Span,
  linked: Map<number, string>,
  launches: PricedLaunch[],
) {
  const count = new Map<string, number>();
  const last = new Map<string, number>();
  for (const merge of merges.filter((m) => m.at < span[1])) {
    const agent = linked.get(merge.number);
    const group =
      agent === undefined ? undefined : writerGroup(launches, agent);
    for (const session of group ?? []) {
      count.set(session, (count.get(session) ?? 0) + 1);
      last.set(session, Math.max(last.get(session) ?? merge.at, merge.at));
    }
  }
  return { count, last };
}

/** The spend up to a time, read once per time (the readings at or before `at`). */
function spendReader(
  events: LedgerEvent[],
  stageOf: (e: LedgerEvent) => Stage,
) {
  const snapshots = new Map<number, Map<string, SessionSpend>>();
  return (at: number) => {
    const seen = snapshots.get(at);
    if (seen !== undefined) {
      return seen;
    }
    const read = spendBefore(events, at + 1, stageOf);
    snapshots.set(at, read);
    return read;
  };
}

/** What each merged change is read against: the links, the launches, the price table and the spend at a time. */
interface ChangeContext {
  linked: Map<number, string>;
  launches: PricedLaunch[];
  prices: PriceTable;
  spendAt: (at: number) => Map<string, SessionSpend>;
  count: Map<string, number>;
  last: Map<string, number>;
}

/** Each merged change in the span: its tier, its writer's share and its reviewer's dollars. */
function changesIn(
  merges: Merge[],
  span: Span,
  ctx: ChangeContext,
): MergedChangeDollars[] {
  const { linked, launches, prices, spendAt, count, last } = ctx;
  return merges
    .filter((m) => inWindow(span, m.at))
    .map((m): MergedChangeDollars => {
      const agent = linked.get(m.number);
      const group =
        agent === undefined ? undefined : writerGroup(launches, agent);
      const writer =
        group === undefined
          ? undefined
          : group.reduce((sum, session) => {
              const life = spendAt(last.get(session) ?? m.at);
              const share = count.get(session) ?? 1;
              return sum + dollarsOf(life.get(session), prices) / share;
            }, 0);
      return {
        number: m.number,
        tier: agent === undefined ? undefined : tierOfLinked(launches, agent),
        writer,
        reviewer: dollarsOf(
          spendAt(m.at).get(`pr${m.number}-reviewer`),
          prices,
        ),
      };
    });
}

/** The judge's and orchestrating session's spend in the span: each one's growth, priced at its model. */
function sharedIn(
  start: Map<string, SessionSpend>,
  end: Map<string, SessionSpend>,
  prices: PriceTable,
) {
  const shared = { judge: 0, orchestrate: 0 };
  for (const [session, spend] of end) {
    if (spend.stage !== "judge" && spend.stage !== "orchestrate") {
      continue;
    }
    const before = start.get(session)?.byModel ?? new Map();
    const grown = [...spend.byModel].map(
      ([model, counts]) =>
        [model, subCounts(counts, before.get(model) ?? NO_COUNTS)] as const,
    );
    if (spend.stage === "orchestrate") {
      const summed = grown.reduce(
        (sum, [, counts]) => addCounts(sum, counts),
        NO_COUNTS,
      );
      shared.orchestrate +=
        priceCounts(summed, MAIN_SESSION_MODEL, prices) ?? 0;
    } else {
      shared.judge += grown.reduce(
        (sum, [model, counts]) =>
          sum + (priceCounts(counts, model, prices) ?? 0),
        0,
      );
    }
  }
  return shared;
}

/**
 * The dollars of the merged changes in the span and of the shared judge and orchestrating spend.
 * A model the price table does not price is worth no dollars, and is not read as a zero figure.
 */
export function writerDollarsIn(
  events: LedgerEvent[],
  span: Span,
  prices: PriceTable,
): WriterDollars {
  const stageOf = tokenStageResolver(events);
  const linked = linkedAgents(events);
  const launches = pricedLaunches(events);
  const merges: Merge[] = events
    .filter((e) => e.kind === "pr.merged" && e.number !== undefined)
    .map((e) => ({ number: e.number as number, at: time(e) }));
  const spendAt = spendReader(events, stageOf);
  const start = spendBefore(events, span[0], stageOf);
  const end = spendBefore(events, span[1], stageOf);
  const { count, last } = mergesBefore(merges, span, linked, launches);

  const writers = new Set(
    launches
      .map((l) => l.agent)
      .filter((name): name is string => name !== undefined),
  );
  return {
    changes: changesIn(merges, span, {
      linked,
      launches,
      prices,
      spendAt,
      count,
      last,
    }),
    shared: sharedIn(start, end, prices),
    unmergedWriterSessions: [...writers].filter(
      (session) => end.has(session) && !count.has(session),
    ).length,
  };
}

/**
 * A tier's all-in dollars per merged change, or null with no merged change joined to the tier
 * (never zero). The shared parts are divided by every merged change in the span, joined or not.
 */
export function tierDollarsIn(
  dollars: WriterDollars,
  tier: string,
): TierDollars | null {
  const joined = dollars.changes.filter((c) => c.tier === tier);
  if (joined.length === 0) {
    return null;
  }
  const merged = dollars.changes.length;
  const judge = dollars.shared.judge / merged;
  const orchestrate = dollars.shared.orchestrate / merged;
  const mean = (values: number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  const writer = mean(joined.map((c) => c.writer ?? 0));
  const reviewer = mean(joined.map((c) => c.reviewer));
  const totals = joined.map(
    (c) => (c.writer ?? 0) + c.reviewer + judge + orchestrate,
  );
  const middle = median(totals);
  if (middle === null) {
    return null;
  }
  return {
    writer: round(writer),
    reviewer: round(reviewer),
    judge: round(judge),
    orchestrate: round(orchestrate),
    allIn: round(writer + reviewer + judge + orchestrate),
    median: round(middle),
  };
}
