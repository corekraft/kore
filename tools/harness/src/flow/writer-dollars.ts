// Dollars from the token.split readings (#1008, spec #997): each reading's cumulative counts,
// per prompt step and token kind, priced per model from a price table the caller passes in.
// A request over the 100K step is priced at the step's rates on the whole request, cache
// reads included, because the reading already holds the high step's counts apart. A model the
// table does not price has no dollars: it is never read as zero.

import type { LedgerEvent } from "../ledger/index.js";
import type { Stage } from "./stages.js";
import { tokenSession } from "./merged-tokens.js";
import { time } from "./github-waits.js";
import type { ModelPrice, Rates } from "./writer-prices.js";

/** A model's price table: the rates for each model, read from writer-prices.ts or a fixture. */
export type PriceTable = Readonly<Record<string, ModelPrice>>;

/** One prompt step's five token kinds. */
export interface Kinds {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

/** A model's cumulative counts at a prompt step: the low step (at or under 100K) and the high step (over it). */
export interface Counts {
  low: Kinds;
  high: Kinds;
}

const ZERO_KINDS: Kinds = {
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
};

export const NO_COUNTS: Counts = { low: ZERO_KINDS, high: ZERO_KINDS };

/** The counts a token.split reading holds for its model; a field the reading lacks counts as zero. */
export function countsOf(event: LedgerEvent): Counts {
  return {
    low: {
      input: event.lowInput ?? 0,
      cacheWrite5m: event.lowCacheWrite5m ?? 0,
      cacheWrite1h: event.lowCacheWrite1h ?? 0,
      cacheRead: event.lowCacheRead ?? 0,
      output: event.lowOutput ?? 0,
    },
    high: {
      input: event.highInput ?? 0,
      cacheWrite5m: event.highCacheWrite5m ?? 0,
      cacheWrite1h: event.highCacheWrite1h ?? 0,
      cacheRead: event.highCacheRead ?? 0,
      output: event.highOutput ?? 0,
    },
  };
}

const addKinds = (a: Kinds, b: Kinds): Kinds => ({
  input: a.input + b.input,
  cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  cacheRead: a.cacheRead + b.cacheRead,
  output: a.output + b.output,
});

const subKinds = (a: Kinds, b: Kinds): Kinds => ({
  input: a.input - b.input,
  cacheWrite5m: a.cacheWrite5m - b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h - b.cacheWrite1h,
  cacheRead: a.cacheRead - b.cacheRead,
  output: a.output - b.output,
});

/** The two counts summed kind by kind, for a session's models priced together. */
export const addCounts = (a: Counts, b: Counts): Counts => ({
  low: addKinds(a.low, b.low),
  high: addKinds(a.high, b.high),
});

/** The growth from a earlier count to b, kind by kind: the spend between two readings. */
export const subCounts = (b: Counts, a: Counts): Counts => ({
  low: subKinds(b.low, a.low),
  high: subKinds(b.high, a.high),
});

/** Dollars of one step's kinds at one set of rates: tokens over a million, at each kind's rate. */
function kindsDollars(k: Kinds, rates: Rates): number {
  return (
    (k.input * rates.inputPerMTok +
      k.cacheWrite5m * rates.cacheWrite5mPerMTok +
      k.cacheWrite1h * rates.cacheWrite1hPerMTok +
      k.cacheRead * rates.cacheReadPerMTok +
      k.output * rates.outputPerMTok) /
    1_000_000
  );
}

/**
 * The dollars of a model's counts. The low step is priced at the model's rates; the high step
 * at its over-step rates, or at the same rates where the model has no step. Undefined for a
 * model the table does not price.
 */
export function priceCounts(
  counts: Counts,
  model: string,
  prices: PriceTable,
): number | undefined {
  const price = Object.hasOwn(prices, model) ? prices[model] : undefined;
  if (price === undefined) {
    return undefined;
  }
  return (
    kindsDollars(counts.low, price) +
    kindsDollars(counts.high, price.overStep ?? price)
  );
}

/** One session's spend before a time: its stage, and each model's latest cumulative counts. */
export interface SessionSpend {
  stage: Stage;
  byModel: Map<string, Counts>;
}

/**
 * Each session's spend in the readings before `before`. A reading's session is its agent, else
 * its session or pane, so a writer is keyed by its name. A model's counts are cumulative, so
 * its latest reading replaces the earlier ones; the session's stage is its latest reading's.
 */
export function spendBefore(
  events: LedgerEvent[],
  before: number,
  stageOf: (event: LedgerEvent) => Stage,
): Map<string, SessionSpend> {
  const latest = new Map<
    string,
    {
      at: number;
      stage: Stage;
      byModel: Map<string, { at: number; counts: Counts }>;
    }
  >();
  for (const event of events) {
    if (event.kind !== "token.split" || event.model === undefined) {
      continue;
    }
    const at = time(event);
    if (at >= before) {
      continue;
    }
    const key = event.agent ?? tokenSession(event);
    const seen = latest.get(key);
    const session = seen ?? { at, stage: stageOf(event), byModel: new Map() };
    if (seen === undefined || at >= seen.at) {
      session.at = at;
      session.stage = stageOf(event);
    }
    const model = session.byModel.get(event.model);
    if (model === undefined || at >= model.at) {
      session.byModel.set(event.model, { at, counts: countsOf(event) });
    }
    latest.set(key, session);
  }
  return new Map(
    [...latest].map(([key, v]) => [
      key,
      {
        stage: v.stage,
        byModel: new Map([...v.byModel].map(([model, m]) => [model, m.counts])),
      },
    ]),
  );
}
