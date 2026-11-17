import type { TierOrigin } from "../ledger/index.js";

/** The environment variable naming the first UTC day of the writer experiment's window. Unset means the window is closed. */
export const EXPERIMENT_START = "KORE_WRITER_EXPERIMENT_START";
/** The environment variable setting the share of default-tier writer launches the window samples: a number above 0 and up to 1. Unset or empty keeps the default. */
export const EXPERIMENT_SHARE_ENV = "KORE_WRITER_EXPERIMENT_SHARE";
/** The environment variable setting the window's length in whole days. Unset or empty keeps the default. */
export const EXPERIMENT_DAYS_ENV = "KORE_WRITER_EXPERIMENT_DAYS";
/** The default share of default-tier writer launches the window samples onto Sonnet. */
export const EXPERIMENT_SHARE = 0.1;
/** The default window length in days, counted from its first instant. */
export const EXPERIMENT_DAYS = 14;
/** The model a sampled writer launch runs on. */
export const EXPERIMENT_MODEL = "claude-sonnet-5-5";
/** The reason a sampled launch's override records in the ledger. */
export const EXPERIMENT_REASON = "experiment";

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHARE = /^(\d+(\.\d+)?|\.\d+)$/;
const WHOLE_DAYS = /^\d+$/;

type Env = Readonly<Record<string, string | undefined>>;

/** A parsed setting, or the refusal naming why the code would not read it. */
type Parsed<T> = { value: T } | { error: string };

/** The window's first instant, UTC midnight of the configured day; undefined when the value is not a real calendar date. */
function windowStart(value: string): number | undefined {
  if (!DATE.test(value)) {
    return undefined;
  }
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ms) &&
    new Date(ms).toISOString().slice(0, 10) === value
    ? ms
    : undefined;
}

function startOf(value: string | undefined): Parsed<number | undefined> {
  if (value === undefined || value === "") {
    return { value: undefined };
  }
  const ms = windowStart(value);
  return ms === undefined
    ? {
        error: `${EXPERIMENT_START} must be a date such as 2026-12-01 (UTC), or unset; got "${value}". No session was started.`,
      }
    : { value: ms };
}

function shareOf(value: string | undefined): Parsed<number> {
  if (value === undefined || value === "") {
    return { value: EXPERIMENT_SHARE };
  }
  const share = SHARE.test(value) ? Number(value) : Number.NaN;
  return share > 0 && share <= 1
    ? { value: share }
    : {
        error: `${EXPERIMENT_SHARE_ENV} must be a share above 0 and up to 1, such as 0.1, or unset; got "${value}". No session was started.`,
      };
}

function daysOf(value: string | undefined): Parsed<number> {
  if (value === undefined || value === "") {
    return { value: EXPERIMENT_DAYS };
  }
  const days = WHOLE_DAYS.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(days) && days > 0
    ? { value: days }
    : {
        error: `${EXPERIMENT_DAYS_ENV} must be a whole number of days above 0, such as 14, or unset; got "${value}". No session was started.`,
      };
}

/** The window as the environment sets it: its first instant (undefined while closed), its share and its length in days. */
export interface WindowSettings {
  start: number | undefined;
  share: number;
  days: number;
}

/**
 * The window's settings, or the refusal for the first setting the code would
 * not read. Checked before any spawn, so a typo never silently changes the
 * experiment; a share or length that is unset or empty keeps its default.
 */
export function windowSettings(env: Env): WindowSettings | { error: string } {
  const start = startOf(env[EXPERIMENT_START]);
  if ("error" in start) {
    return start;
  }
  const share = shareOf(env[EXPERIMENT_SHARE_ENV]);
  if ("error" in share) {
    return share;
  }
  const days = daysOf(env[EXPERIMENT_DAYS_ENV]);
  if ("error" in days) {
    return days;
  }
  return { start: start.value, share: share.value, days: days.value };
}

/**
 * The refusal for a window setting the code would not read, or undefined when
 * every setting is unset (the window is closed) or valid. Checked before any
 * spawn, so a typo never silently leaves the experiment shut.
 */
export function experimentConfigError(env: Env): string | undefined {
  const settings = windowSettings(env);
  return "error" in settings ? settings.error : undefined;
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
 * window consumes randomness. The window is [start, start + days): the first
 * instant is in, the end is out; days and share default to 14 and 0.1.
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
  const settings = windowSettings(input.env);
  if ("error" in settings) {
    return { error: settings.error };
  }
  if (input.origin.tierSource !== "definition") {
    return undefined;
  }
  if (settings.start === undefined) {
    return undefined;
  }
  const at = input.now.getTime();
  if (at < settings.start || at >= settings.start + settings.days * DAY_MS) {
    return undefined;
  }
  if (input.random === undefined || input.random() >= settings.share) {
    return undefined;
  }
  return {
    model: EXPERIMENT_MODEL,
    tier: { tierSource: "override", tierReason: EXPERIMENT_REASON },
  };
}
