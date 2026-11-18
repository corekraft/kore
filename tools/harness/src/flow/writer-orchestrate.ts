// The main session's dollars in a span (#1041, spec #1027), the orchestrate part of the writer
// cost. A main-session model with a token.split reading in the span is priced from that reading's
// growth, each model at its own rates and prompt steps (writer-dollars.ts). A main-session session
// with token totals (token.usage) and no reading in the span has no model or token kinds recorded,
// so its totals (input, output and cache-creation, which token.usage holds) are priced at the
// assumed main-session model's input rate: a floor, and the figure says so. A session with a role
// is never read here. The figure is shared over the span's merged changes and never assigned to a
// pull request.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { countsBefore, tokenSession } from "./merged-tokens.js";
import { inWindow, type Span } from "./scope.js";
import { tokenStageResolver, type Stage } from "./stage-of.js";
import {
  NO_COUNTS,
  priceCounts,
  spendBefore,
  subCounts,
  type Counts,
  type PriceTable,
} from "./writer-dollars.js";
import { MAIN_SESSION_MODEL } from "./writer-usage.js";

/** What the main session's dollars in a span are priced from. */
export type OrchestrateBasis =
  "none" | "recorded" | "assumed model" | "recorded and assumed model";

/** The main session's dollars in a span, and what each part is read from. */
export interface OrchestrateDollars {
  /** Dollars the span's token.split readings price, each model at its own rates and prompt steps. */
  recorded: number;
  /** Dollars of token totals with no reading in the span, at the assumed model's input rate: a floor. */
  assumed: number;
  /** The models the span's readings ran on, sorted, each once, priced or not. */
  recordedModels: string[];
  /** The token totals in the span with no reading, priced at the assumed model. */
  assumedTokens: number;
  /** The sessions those token totals belong to, each counted once. */
  assumedSessions: number;
  /** The models the price table does not price, sorted, each once; their dollars are not counted. */
  unpriced: string[];
  /** What the dollars are read from: see basisOf. */
  basis: OrchestrateBasis;
}

/** The sessions' keys that a reading inside the span belongs to, as spendBefore keys them. */
type Readers = Set<string>;

interface RecordedPart {
  recorded: number;
  models: string[];
  unpriced: string[];
}

const MILLION = 1_000_000;

const tokensOfCounts = (counts: Counts): number =>
  [counts.low, counts.high].reduce(
    (sum, k) =>
      sum + k.input + k.cacheWrite5m + k.cacheWrite1h + k.cacheRead + k.output,
    0,
  );

/** The sessions that have a token.split reading inside the span. */
function readersIn(events: LedgerEvent[], span: Span): Readers {
  const keys: Readers = new Set();
  for (const e of events) {
    if (
      e.kind === "token.split" &&
      e.model !== undefined &&
      inWindow(span, time(e))
    ) {
      keys.add(tokenSession(e));
      if (e.agent !== undefined) {
        keys.add(e.agent);
      }
    }
  }
  return keys;
}

/** Each session's stage, from its latest token.usage reading, as writer-usage.ts reads it. */
function usageStages(
  events: LedgerEvent[],
  stageOf: (event: LedgerEvent) => Stage,
): Map<string, Stage> {
  const latest = new Map<string, { at: number; stage: Stage }>();
  for (const e of events) {
    if (e.kind !== "token.usage" || e.tokens === undefined) {
      continue;
    }
    const key = tokenSession(e);
    const at = time(e);
    const seen = latest.get(key);
    if (seen === undefined || at >= seen.at) {
      latest.set(key, { at, stage: stageOf(e) });
    }
  }
  return new Map([...latest].map(([key, v]) => [key, v.stage]));
}

/** The main session's recorded dollars: each model with a reading in the span, at its own rates. */
function recordedPart(
  events: LedgerEvent[],
  span: Span,
  prices: PriceTable,
  read: Readers,
): RecordedPart {
  const stageOf = tokenStageResolver(events);
  const start = spendBefore(events, span[0], stageOf);
  const end = spendBefore(events, span[1], stageOf);
  const unpriced = new Set<string>();
  const models = new Set<string>();
  let recorded = 0;
  for (const [key, spend] of end) {
    if (spend.stage !== "orchestrate" || !read.has(key)) {
      continue;
    }
    const before = start.get(key)?.byModel ?? new Map<string, Counts>();
    for (const [model, counts] of spend.byModel) {
      const grown = subCounts(counts, before.get(model) ?? NO_COUNTS);
      if (tokensOfCounts(grown) === 0) {
        continue;
      }
      models.add(model);
      const priced = priceCounts(grown, model, prices);
      if (priced === undefined) {
        unpriced.add(model);
      } else {
        recorded += priced;
      }
    }
  }
  return {
    recorded,
    models: [...models].sort(),
    unpriced: [...unpriced].sort(),
  };
}

/**
 * The main session's token totals with no reading in the span, priced at the assumed model's
 * input rate. Named unpriced, never zero, when the table does not price the assumed model.
 */
function assumedPart(
  events: LedgerEvent[],
  span: Span,
  prices: PriceTable,
  read: Readers,
): {
  assumed: number;
  assumedTokens: number;
  assumedSessions: number;
  unpriced: string[];
} {
  const stages = usageStages(events, tokenStageResolver(events));
  const from = countsBefore(events, span[0]);
  const to = countsBefore(events, span[1]);
  let assumedTokens = 0;
  let assumedSessions = 0;
  for (const [key, tokens] of to) {
    if (read.has(key) || stages.get(key) !== "orchestrate") {
      continue;
    }
    const grown = Math.max(0, tokens - (from.get(key) ?? 0));
    assumedTokens += grown;
    assumedSessions += grown > 0 ? 1 : 0;
  }
  if (assumedTokens === 0) {
    return { assumed: 0, assumedTokens, assumedSessions, unpriced: [] };
  }
  const price = Object.hasOwn(prices, MAIN_SESSION_MODEL)
    ? prices[MAIN_SESSION_MODEL]
    : undefined;
  if (price === undefined) {
    return {
      assumed: 0,
      assumedTokens,
      assumedSessions,
      unpriced: [MAIN_SESSION_MODEL],
    };
  }
  return {
    assumed: (assumedTokens * price.inputPerMTok) / MILLION,
    assumedTokens,
    assumedSessions,
    unpriced: [],
  };
}

/** The dollars of the main session's spend in a span, each part priced from its own basis. */
export function orchestrateDollarsIn(
  events: LedgerEvent[],
  span: Span,
  prices: PriceTable,
): OrchestrateDollars {
  const read = readersIn(events, span);
  const recorded = recordedPart(events, span, prices, read);
  const assumed = assumedPart(events, span, prices, read);
  const part = {
    recordedModels: recorded.models,
    assumedTokens: assumed.assumedTokens,
    assumedSessions: assumed.assumedSessions,
  };
  return {
    recorded: recorded.recorded,
    assumed: assumed.assumed,
    ...part,
    unpriced: [...new Set([...recorded.unpriced, ...assumed.unpriced])].sort(),
    basis: basisOf(part),
  };
}

/** The basis a span's main-session dollars are read from: recorded, assumed, both, or none (no tokens). */
export function basisOf(
  part: Pick<OrchestrateDollars, "recordedModels" | "assumedTokens">,
): OrchestrateBasis {
  if (part.recordedModels.length === 0 && part.assumedTokens === 0) {
    return "none";
  }
  if (part.assumedTokens === 0) {
    return "recorded";
  }
  return part.recordedModels.length === 0
    ? "assumed model"
    : "recorded and assumed model";
}
