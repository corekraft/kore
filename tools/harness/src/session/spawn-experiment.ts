import { EFFORTS, type Effort, type TierOrigin } from "../ledger/index.js";

/** The environment variable naming the first UTC day of the writer experiment's window. Unset means the window is closed. */
export const EXPERIMENT_START = "KORE_WRITER_EXPERIMENT_START";
/** The environment variable setting the share of writer launches the window samples: a number above 0 and up to 1. Unset or empty keeps the default. */
export const EXPERIMENT_SHARE_ENV = "KORE_WRITER_EXPERIMENT_SHARE";
/** The environment variable setting the window's length in whole days. Unset or empty keeps the default. */
export const EXPERIMENT_DAYS_ENV = "KORE_WRITER_EXPERIMENT_DAYS";
/** The environment variable setting the window effort, the one effort every eligible writer launch runs at. Required while the start is set; ignored while it is unset. */
export const EXPERIMENT_EFFORT_ENV = "KORE_WRITER_EXPERIMENT_EFFORT";
/** The default share of writer launches the window samples onto Sonnet. */
export const EXPERIMENT_SHARE = 0.1;
/** The default window length in days, counted from its first instant. */
export const EXPERIMENT_DAYS = 14;
/** The model a sampled writer launch runs on. */
export const EXPERIMENT_MODEL = "claude-sonnet-5-5";
/** The reason a sampled launch's override records in the ledger. */
export const EXPERIMENT_REASON = "experiment";
/** The reason an undrawn eligible launch records, marking it as the window's control. */
export const EXPERIMENT_CONTROL_REASON = "experiment-control";

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

/** The window effort: one of the efforts the launch event accepts. An unset or empty value is refused, as no effort was chosen. */
function effortOf(value: string | undefined): Parsed<Effort> {
  const effort = EFFORTS.find((level) => level === value);
  if (effort !== undefined) {
    return { value: effort };
  }
  const shown = value === undefined || value === "" ? "unset" : `"${value}"`;
  return {
    error: `${EXPERIMENT_EFFORT_ENV} must be one of ${EFFORTS.join(", ")}, such as high, while ${EXPERIMENT_START} is set; got ${shown}. No session was started.`,
  };
}

/**
 * The window as the environment sets it. Closed (no start), the share and the
 * length are read but the effort is ignored; open, all four are set.
 */
export type WindowSettings =
  | { start: undefined; share: number; days: number; effort: undefined }
  | { start: number; share: number; days: number; effort: Effort };

/**
 * The window's settings, or the refusal for the first setting the code would
 * not read. Checked before any spawn, so a typo never silently changes the
 * experiment; a share or length that is unset or empty keeps its default, and
 * the window effort is required, and read, only while the start is set.
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
  if (start.value === undefined) {
    return {
      start: undefined,
      share: share.value,
      days: days.value,
      effort: undefined,
    };
  }
  const effort = effortOf(env[EXPERIMENT_EFFORT_ENV]);
  if ("error" in effort) {
    return effort;
  }
  return {
    start: start.value,
    share: share.value,
    days: days.value,
    effort: effort.value,
  };
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

/**
 * What a sampled or control launch runs on: its model (undefined keeps the
 * definition's model, for the control), the window effort, and the origin with
 * its reason.
 */
export interface Experiment {
  model: string | undefined;
  effort: Effort;
  tier: TierOrigin;
}

/**
 * The window's sample for a writer launch: the Sonnet draw, the control, the
 * refusal for a misconfigured window (for any writer), or undefined when the
 * launch keeps its own tier. Only a writer that names no model, inside the
 * window, is eligible; the draw is read only for an eligible launch, so nothing
 * outside the window or with a model flag consumes randomness. An eligible
 * launch runs at the window effort whether it is drawn or not. The window is
 * [start, start + days): the first instant is in, the end is out.
 */
export function writerExperiment(input: {
  role: string;
  model: string | undefined;
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
  if (settings.start === undefined) {
    return undefined;
  }
  const at = input.now.getTime();
  if (at < settings.start || at >= settings.start + settings.days * DAY_MS) {
    return undefined;
  }
  if (input.model !== undefined) {
    return undefined;
  }
  const drawn = input.random !== undefined && input.random() < settings.share;
  return drawn
    ? {
        model: EXPERIMENT_MODEL,
        effort: settings.effort,
        tier: { tierSource: "override", tierReason: EXPERIMENT_REASON },
      }
    : {
        model: undefined,
        effort: settings.effort,
        tier: { ...input.origin, tierReason: EXPERIMENT_CONTROL_REASON },
      };
}
