import type { TierOrigin } from "../ledger/index.js";

/** The environment variable naming the first UTC day of the writer experiment's window. Unset means the window is closed. */
export const EXPERIMENT_START = "KORE_WRITER_EXPERIMENT_START";
/** The share of default-tier writer launches the window samples onto Sonnet. */
export const EXPERIMENT_SHARE = 0.1;
/** The window's length in days, counted from its first instant. */
export const EXPERIMENT_DAYS = 14;
/** The model a sampled writer launch runs on. */
export const EXPERIMENT_MODEL = "claude-sonnet-5-5";
/** The reason a sampled launch's override records in the ledger. */
export const EXPERIMENT_REASON = "experiment";

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Env = Readonly<Record<string, string | undefined>>;

/** The window's first instant, UTC midnight of the configured day; undefined when unset or when the value is not a real calendar date. */
function windowStart(value: string | undefined): number | undefined {
  if (value === undefined || !DATE.test(value)) {
    return undefined;
  }
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 10) === value
    ? ms
    : undefined;
}

/**
 * The refusal for a window start the code would not read, or undefined when
 * it is unset (the window is closed) or a real UTC date. Checked before any
 * spawn, so a typo never silently leaves the experiment shut.
 */
export function experimentConfigError(env: Env): string | undefined {
  const value = env[EXPERIMENT_START];
  if (value === undefined || value === "" || windowStart(value) !== undefined) {
    return undefined;
  }
  return `${EXPERIMENT_START} must be a date such as 2026-12-01 (UTC), or unset; got "${value}". No session was started.`;
}

/** What a sampled launch runs on and records: the model, and the override with its reason. */
export interface Experiment {
  model: string;
  tier: TierOrigin;
}

/**
 * The Sonnet launch the experiment samples a default-tier writer onto, the
 * refusal for a misconfigured window (for any writer), or undefined when the
 * launch keeps its definition. Only a writer on its definition's tier, inside
 * the window, is drawn for; the draw is read only there, so nothing outside the
 * window consumes randomness. The window is [start, start + 14 days): the first
 * instant is in, the end is out.
 */
export function writerExperiment(input: {
  role: string;
  origin: TierOrigin;
  env: Env;
  now: Date;
  random?: (() => number) | undefined;
}): Experiment | { error: string } | undefined {
  if (input.role !== "writer") {
    return undefined;
  }
  const refusal = experimentConfigError(input.env);
  if (refusal !== undefined) {
    return { error: refusal };
  }
  if (input.origin.tierSource !== "definition") {
    return undefined;
  }
  const start = windowStart(input.env[EXPERIMENT_START]);
  if (start === undefined) {
    return undefined;
  }
  const at = input.now.getTime();
  if (at < start || at >= start + EXPERIMENT_DAYS * DAY_MS) {
    return undefined;
  }
  if (input.random === undefined || input.random() >= EXPERIMENT_SHARE) {
    return undefined;
  }
  return {
    model: EXPERIMENT_MODEL,
    tier: { tierSource: "override", tierReason: EXPERIMENT_REASON },
  };
}
