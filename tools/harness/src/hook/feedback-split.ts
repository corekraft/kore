// The stop hook's priced token split (#1001, spec #997): per model and prompt step, the
// requests and their input, cache-write (5 minute and 1 hour), cache-read and output
// tokens, and the first request's prompt size. Since #1032 it also holds the largest prompt
// and, when a compaction cap is set, the count of requests over it. The ledger holds these
// numbers and the model name only; the prices are applied where the reading is read
// (flow/writer-prices.ts). token.usage is counted beside it by feedback-tokens.ts and is
// not changed by this file.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { promptStepOf, type PromptStep } from "../flow/index.js";
import { isName, type SplitOrigin } from "../ledger/index.js";
import type { FileSystem } from "../runtime/index.js";

/** The compaction cap the stop hook reads with the split; see compaction-cap.ts (#1032). */
export { compactionCapOf } from "./compaction-cap.js";

/** Where a session keeps its split position between stops. */
export const splitStateFile = (session: unknown): string =>
  join(
    tmpdir(),
    `kore-split-${(typeof session === "string" ? session : "default").replace(/[^\w.-]/g, "_")}.json`,
  );

/** One request's tokens by kind, as the transcript's usage gives them. */
export interface Usage {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

/** One assistant message's usage, with the id that replaces it when it streams again. */
export interface Request {
  id?: string;
  model: string;
  /** Input, cache writes and cache reads together: the length of the request's prompt. */
  prompt: number;
  usage: Usage;
}

/** The requests of one prompt step, by kind of token. */
export interface StepTotals {
  requests: number;
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

/**
 * One model's totals: its first request's prompt size, and each prompt step's totals. The
 * largest prompt and the over-cap count cover its requests before the last one counted
 * (`SplitState.last`), so that request can be replaced exactly when it streams in again.
 */
export interface ModelSplit {
  model: string;
  firstPrompt: number;
  priorLargest: number;
  priorOver: number;
  low: StepTotals;
  high: StepTotals;
}

/**
 * The split so far, and the complete lines it has read (`offset`). `last` is the last
 * request counted, so a copy of it that streams in later replaces its count; `lastOver`
 * is whether it was over the compaction cap when it was read.
 */
export interface SplitState {
  offset: number;
  models: ModelSplit[];
  last?: Request;
  lastOver?: boolean;
}

export const EMPTY_SPLIT: SplitState = { offset: 0, models: [] };

const zero = (): StepTotals => ({
  requests: 0,
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
});

const count = (v: unknown): number =>
  Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0;

/** One assistant line's request, or undefined for a line with no usage, no name or no JSON. */
function requestOf(raw: string): Request | undefined {
  try {
    const value = JSON.parse(raw) as {
      type?: unknown;
      message?: { id?: unknown; model?: unknown; usage?: unknown };
    };
    const message = value.message;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (
      value.type !== "assistant" ||
      usage === undefined ||
      typeof message?.model !== "string" ||
      !isName(message.model)
    ) {
      return undefined;
    }
    const breakdown: unknown = usage["cache_creation"];
    const hasBreakdown = typeof breakdown === "object" && breakdown !== null;
    const parts = hasBreakdown ? (breakdown as Record<string, unknown>) : {};
    const tokens: Usage = {
      input: count(usage["input_tokens"]),
      cacheWrite5m: hasBreakdown
        ? count(parts["ephemeral_5m_input_tokens"])
        : 0,
      cacheWrite1h: hasBreakdown
        ? count(parts["ephemeral_1h_input_tokens"])
        : count(usage["cache_creation_input_tokens"]),
      cacheRead: count(usage["cache_read_input_tokens"]),
      output: count(usage["output_tokens"]),
    };
    const id = typeof message.id === "string" ? message.id : undefined;
    return {
      ...(id === undefined ? {} : { id }),
      model: message.model,
      prompt:
        tokens.input +
        tokens.cacheWrite5m +
        tokens.cacheWrite1h +
        tokens.cacheRead,
      usage: tokens,
    };
  } catch {
    // A line that is not JSON carries no usage.
    return undefined;
  }
}

const addTo = (t: StepTotals, u: Usage, sign: 1 | -1): StepTotals => ({
  requests: t.requests + sign,
  input: t.input + sign * u.input,
  cacheWrite5m: t.cacheWrite5m + sign * u.cacheWrite5m,
  cacheWrite1h: t.cacheWrite1h + sign * u.cacheWrite1h,
  cacheRead: t.cacheRead + sign * u.cacheRead,
  output: t.output + sign * u.output,
});

/** Adds (+1) or takes back (-1) one request in its model's totals for its prompt step. */
function applied(models: ModelSplit[], r: Request, sign: 1 | -1): ModelSplit[] {
  const found = models.find((m) => m.model === r.model);
  const base: ModelSplit = found ?? {
    model: r.model,
    firstPrompt: r.prompt,
    priorLargest: 0,
    priorOver: 0,
    low: zero(),
    high: zero(),
  };
  const step: PromptStep = promptStepOf(r.prompt);
  const next: ModelSplit =
    step === "low"
      ? { ...base, low: addTo(base.low, r.usage, sign) }
      : { ...base, high: addTo(base.high, r.usage, sign) };
  return found === undefined
    ? [...models, next]
    : models.map((m) => (m === found ? next : m));
}

/**
 * Folds the last counted request into its model's largest prompt and over-cap count, because
 * a newer request now follows it and it can no longer stream in again.
 */
function folded(models: ModelSplit[], r: Request, over: boolean): ModelSplit[] {
  return models.map((m) =>
    m.model === r.model
      ? {
          ...m,
          priorLargest: Math.max(m.priorLargest, r.prompt),
          priorOver: m.priorOver + (over ? 1 : 0),
        }
      : m,
  );
}

/**
 * Adds the complete lines of `text` (the transcript from `state.offset`) to the split. A
 * request whose prompt is over `cap` counts toward the over-cap count; a prompt equal to the
 * cap is not over it. A half-written last line is left for the next stop. A copy of the last
 * message that streams in again replaces its earlier count, as token.usage does. Only numbers
 * and model names are kept; no text leaves this function.
 */
export function advanceSplit(
  state: SplitState,
  text: string,
  cap?: number,
): SplitState {
  const end = text.lastIndexOf("\n") + 1;
  let models = state.models;
  let last = state.last;
  let lastOver = state.lastOver === true;
  for (const raw of text.slice(0, end).split("\n")) {
    const r = requestOf(raw);
    if (r === undefined) {
      continue;
    }
    if (
      last !== undefined &&
      r.id !== undefined &&
      r.id === last.id &&
      r.model === last.model
    ) {
      models = applied(models, last, -1);
    } else if (last !== undefined) {
      models = folded(models, last, lastOver);
    }
    models = applied(models, r, 1);
    last = r;
    lastOver = cap !== undefined && r.prompt > cap;
  }
  return {
    offset: state.offset + Buffer.byteLength(text.slice(0, end)),
    models,
    ...(last === undefined ? {} : { last, lastOver }),
  };
}

/**
 * A model's largest prompt and over-cap count, with the last request counted included when
 * it is this model's.
 */
function figuresOf(
  m: ModelSplit,
  state: SplitState,
): { largest: number; over: number } {
  const last = state.last?.model === m.model ? state.last : undefined;
  return {
    largest:
      last === undefined
        ? m.priorLargest
        : Math.max(m.priorLargest, last.prompt),
    over: m.priorOver + (last !== undefined && state.lastOver === true ? 1 : 0),
  };
}

const flat = (m: ModelSplit, state: SplitState, cap?: number): SplitOrigin => {
  const { largest, over } = figuresOf(m, state);
  return {
    model: m.model,
    firstPrompt: m.firstPrompt,
    largestPrompt: largest,
    ...(cap === undefined ? {} : { overCap: over }),
    lowRequests: m.low.requests,
    lowInput: m.low.input,
    lowCacheWrite5m: m.low.cacheWrite5m,
    lowCacheWrite1h: m.low.cacheWrite1h,
    lowCacheRead: m.low.cacheRead,
    lowOutput: m.low.output,
    highRequests: m.high.requests,
    highInput: m.high.input,
    highCacheWrite5m: m.high.cacheWrite5m,
    highCacheWrite1h: m.high.cacheWrite1h,
    highCacheRead: m.high.cacheRead,
    highOutput: m.high.output,
  };
};

/**
 * The ledger reading of each model in the split: its cumulative numbers, no text. The
 * over-cap count is left out when no cap is given, so a session with no cap never reads zero.
 */
export function readingsOf(state: SplitState, cap?: number): SplitOrigin[] {
  return state.models.map((m) => flat(m, state, cap));
}

/** A model's figures in a saved state; a state saved before #1032 has none, so it is read again. */
const isCounted = (m: unknown): boolean => {
  const { priorLargest, priorOver } = (m ?? {}) as Partial<ModelSplit>;
  return Number.isSafeInteger(priorLargest) && Number.isSafeInteger(priorOver);
};

function parseSplit(text: string): SplitState {
  try {
    const value = JSON.parse(text) as Partial<SplitState>;
    const { offset, models, last, lastOver } = value;
    return typeof offset === "number" &&
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      Array.isArray(models) &&
      models.every(isCounted)
      ? {
          offset,
          models,
          ...(last === undefined ? {} : { last, lastOver: lastOver === true }),
        }
      : EMPTY_SPLIT;
  } catch {
    return EMPTY_SPLIT;
  }
}

/**
 * The readings of the models whose numbers grew since the last stop, each cumulative,
 * and the state saved for the next stop. Only the transcript from the saved offset is
 * read, against the compaction cap when one is set. Best effort: an unreadable transcript
 * reports nothing rather than failing the stop.
 */
export async function readSplit(
  fs: FileSystem,
  path: unknown,
  stateFile: string,
  cap?: number,
): Promise<SplitOrigin[]> {
  try {
    if (typeof path !== "string" || path === "") {
      return [];
    }
    const before = await fs
      .readFile(stateFile)
      .then(parseSplit, () => EMPTY_SPLIT);
    const chunk = await fs.readFrom(path, before.offset);
    const after = advanceSplit(before, chunk, cap);
    if (after.offset !== before.offset) {
      await fs.writeFile(stateFile, JSON.stringify(after));
    }
    const earlier = new Map(
      readingsOf(before, cap).map((r) => [r.model, JSON.stringify(r)]),
    );
    return readingsOf(after, cap).filter(
      (r) => earlier.get(r.model) !== JSON.stringify(r),
    );
  } catch {
    return [];
  }
}
