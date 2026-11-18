// The Haiku and Sonnet arms in the flow report (#1012, spec #998). Each merged change joins to the
// tier of its linked writer's first launch (writer-join.ts, ADR 0125), so an arm is the merged
// changes joined to one tier. For the overall figure and for each stratum (each label the changes'
// writers carried at launch, session.labelled), the report gives:
// - each arm's all-in dollars per merged change (writer-attribution.ts), and their difference,
//   Haiku minus Sonnet, with a seeded percentile bootstrap interval (bootstrap-interval.ts);
// - each arm's guards: blocked share, send-backs and owner minutes (writer-arm-guards.ts);
// - each arm's effort mix, from the launch each change joins to.
// A row below the minimum merged changes in either arm is insufficient, never zero. The code prints
// no winner, margin or verdict: the deciding rule is the owner's, recorded on the idea.
// ADR 0126: a pr.linked idea of none is not an idea, so this join reads the launch's idea only.

import type { LedgerEvent } from "../ledger/index.js";
import { bootstrapDifferenceInterval } from "./bootstrap-interval.js";
import type { Span } from "./scope.js";
import { armGuards, type ArmGuards } from "./writer-arm-guards.js";
import { launchOfLinked, linkedAgents, pricedLaunches } from "./writer-join.js";
import {
  writerDollarsIn,
  type MergedChangeDollars,
} from "./writer-attribution.js";
import type { PriceTable } from "./writer-dollars.js";

/** The two arms: the model tier each arm's first launch ran on. */
export const ARM_TIERS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
} as const;

/** The fixed seed of the interval: the same ledger always gives the same interval. */
export const ARM_SEED = 20261117;
/** The bootstrap's resamples. */
export const ARM_RESAMPLES = 2000;
/** The interval's coverage: a 95 percent percentile interval. */
export const ARM_CONFIDENCE = 0.95;
/** The effort of a launch from before effort was recorded (#1055). */
export const UNKNOWN_EFFORT = "unknown";

/** One arm's figures over its merged changes in a stratum, or the whole span. */
export interface ArmSide extends ArmGuards {
  /** The model tier of the arm. */
  tier: string;
  /** Merged changes joined to the arm. */
  mergedChanges: number;
  /** Mean all-in dollars per merged change; null with none, or when a model is not priced. */
  allInPerMergedChange: number | null;
  /** Merged changes by the effort their joined launch ran at, each effort a key; unknown where not recorded. */
  effort: Record<string, number>;
}

interface ArmRowBase {
  /** The label of the stratum, or null for the overall figure. */
  label: string | null;
  haiku: ArmSide;
  sonnet: ArmSide;
}

/** One row: the overall figure or one stratum. A row that is not ok has no difference and no interval. */
export type ArmRow = ArmRowBase &
  (
    | {
        status: "ok";
        /** Mean all-in dollars per merged change, Haiku minus Sonnet, rounded to four places. */
        difference: number;
        /** The seeded percentile interval for the difference. */
        interval: { low: number; high: number };
      }
    | {
        status: "insufficient merged changes";
        /** The fewest merged changes each arm needs before the row is read. */
        needed: number;
      }
    | {
        status: "insufficient prices";
        /** The models the price table does not price that the row's changes ran on, each named once. */
        models: string[];
      }
  );

export interface WriterArms {
  seed: number;
  resamples: number;
  confidence: number;
  /** The fewest merged changes each arm needs in a row before it is read. */
  minMergedChanges: number;
  /** Arm merged changes whose writer carried no label at launch: in the overall figure only. */
  unlabelled: number;
  overall: ArmRow;
  /** One row per label carried by an arm's merged change, in label order. */
  strata: ArmRow[];
}

export interface WriterArmsOptions {
  minMergedChanges: number;
  seed?: number;
  resamples?: number;
  confidence?: number;
}

/** A merged change on one of the arms, with what the figures are read from. */
interface ArmChange {
  number: number;
  tier: string;
  agent: string;
  /** Its all-in dollars: writer, reviewer and the shared judge and orchestrating parts per change. */
  total: number;
  unpriced: string[];
  effort: string;
  labels: string[];
}

/** What every row is read against: the events, the span, the price table and the settings. */
interface Context {
  events: LedgerEvent[];
  span: Span;
  settings: Required<WriterArmsOptions>;
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

const unique = (names: string[]) => [...new Set(names)].sort();

const mean = (values: number[]) =>
  values.reduce((sum, v) => sum + v, 0) / values.length;

/** Each session's labels as recorded at its launch (session.labelled, one event per label). */
function labelsBySession(events: LedgerEvent[]): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  for (const e of events) {
    if (
      e.kind !== "session.labelled" ||
      e.session === undefined ||
      e.label === undefined
    ) {
      continue;
    }
    labels.set(e.session, [...(labels.get(e.session) ?? []), e.label]);
  }
  return labels;
}

/** The merged changes on either arm, with their totals, efforts and labels. */
function armChangesIn(
  events: LedgerEvent[],
  span: Span,
  prices: PriceTable,
): ArmChange[] {
  const dollars = writerDollarsIn(events, span, prices);
  const merged = dollars.changes.length;
  const shared =
    merged === 0
      ? 0
      : (dollars.shared.judge + dollars.shared.orchestrate) / merged;
  const sharedUnpriced = [
    ...dollars.shared.judgeUnpriced,
    ...dollars.shared.orchestrateUnpriced,
  ];
  const linked = linkedAgents(events);
  const launches = pricedLaunches(events);
  const labels = labelsBySession(events);
  return dollars.changes.flatMap((c: MergedChangeDollars): ArmChange[] => {
    const agent = linked.get(c.number);
    if (
      agent === undefined ||
      (c.tier !== ARM_TIERS.haiku && c.tier !== ARM_TIERS.sonnet)
    ) {
      return [];
    }
    const launch = launchOfLinked(launches, agent);
    if (launch === undefined) {
      return [];
    }
    return [
      {
        number: c.number,
        tier: c.tier,
        agent,
        total: (c.writer ?? 0) + c.reviewer + shared,
        unpriced: unique([...c.unpriced, ...sharedUnpriced]),
        effort: launch.effort ?? UNKNOWN_EFFORT,
        labels: unique(labels.get(agent) ?? []),
      },
    ];
  });
}

/** Each effort the arm's changes ran at, counted, with the efforts in name order. */
function effortsOf(members: ArmChange[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of members) {
    counts[m.effort] = (counts[m.effort] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** One arm's figures over its merged changes: its dollars, efforts and guards, each null where it cannot be read. */
function sideOf(
  tier: string,
  members: ArmChange[],
  { events, span }: Context,
): ArmSide {
  const n = members.length;
  const priced = members.every((m) => m.unpriced.length === 0);
  return {
    tier,
    mergedChanges: n,
    allInPerMergedChange:
      n === 0 || !priced ? null : round(mean(members.map((m) => m.total))),
    effort: effortsOf(members),
    ...armGuards(
      events,
      span,
      members.map((m) => m.number),
      unique(members.map((m) => m.agent)),
    ),
  };
}

/** One row over the given members of each arm: insufficient below the minimum, then unpriced, else the difference and interval. */
function rowOf(
  label: string | null,
  arms: { haiku: ArmChange[]; sonnet: ArmChange[] },
  context: Context,
): ArmRow {
  const { haiku, sonnet } = arms;
  const { minMergedChanges, seed, resamples, confidence } = context.settings;
  const base = {
    label,
    haiku: sideOf(ARM_TIERS.haiku, haiku, context),
    sonnet: sideOf(ARM_TIERS.sonnet, sonnet, context),
  };
  const floor = Math.max(minMergedChanges, 1);
  if (haiku.length < floor || sonnet.length < floor) {
    return {
      ...base,
      status: "insufficient merged changes",
      needed: minMergedChanges,
    };
  }
  const models = unique([...haiku, ...sonnet].flatMap((m) => m.unpriced));
  if (models.length > 0) {
    return { ...base, status: "insufficient prices", models };
  }
  const first = haiku.map((m) => m.total);
  const second = sonnet.map((m) => m.total);
  const interval = bootstrapDifferenceInterval(first, second, {
    seed,
    resamples,
    confidence,
  });
  return {
    ...base,
    status: "ok",
    difference: round(mean(first) - mean(second)),
    interval: { low: round(interval.low), high: round(interval.high) },
  };
}

/**
 * The Haiku and Sonnet arms over the span: the overall figure, and one row per label an arm's
 * merged change carried at launch. A change on another tier is in neither arm; a change with no
 * label counts in the overall figure only, and is counted in `unlabelled`.
 */
export function writerArmsIn(
  events: LedgerEvent[],
  span: Span,
  prices: PriceTable,
  options: WriterArmsOptions,
): WriterArms {
  const settings: Required<WriterArmsOptions> = {
    seed: ARM_SEED,
    resamples: ARM_RESAMPLES,
    confidence: ARM_CONFIDENCE,
    ...options,
  };
  const context: Context = { events, span, settings };
  const changes = armChangesIn(events, span, prices);
  const onArm = (tier: string) => changes.filter((c) => c.tier === tier);
  const haiku = onArm(ARM_TIERS.haiku);
  const sonnet = onArm(ARM_TIERS.sonnet);
  const labels = unique(changes.flatMap((c) => c.labels));
  return {
    seed: settings.seed,
    resamples: settings.resamples,
    confidence: settings.confidence,
    minMergedChanges: settings.minMergedChanges,
    unlabelled: changes.filter((c) => c.labels.length === 0).length,
    overall: rowOf(null, { haiku, sonnet }, context),
    strata: labels.map((label) =>
      rowOf(
        label,
        {
          haiku: haiku.filter((c) => c.labels.includes(label)),
          sonnet: sonnet.filter((c) => c.labels.includes(label)),
        },
        context,
      ),
    ),
  };
}
