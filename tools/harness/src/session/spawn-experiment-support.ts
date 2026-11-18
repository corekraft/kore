import type { TierOrigin } from "../ledger/index.js";
import {
  EXPERIMENT_DAYS,
  EXPERIMENT_EFFORT_ENV,
  EXPERIMENT_START,
  writerExperiment,
} from "./spawn-experiment.js";

export const DAY_MS = 86_400_000;
export const START = "2026-12-01";
export const START_MS = Date.parse("2026-12-01T00:00:00.000Z");
export const END_MS = START_MS + EXPERIMENT_DAYS * DAY_MS;
/** A window open from START with the window effort set to high. */
export const WINDOW = {
  [EXPERIMENT_START]: START,
  [EXPERIMENT_EFFORT_ENV]: "high",
};

/** A writer launch inside the window that names no model unless `model` is given. */
export function sample(
  over: {
    role?: string;
    model?: string;
    origin?: TierOrigin;
    env?: Record<string, string | undefined>;
    now?: number;
    random?: () => number;
  } = {},
) {
  return writerExperiment({
    role: over.role ?? "writer",
    model: over.model,
    origin: over.origin ?? { tierSource: "definition" },
    env: over.env ?? WINDOW,
    now: new Date(over.now ?? START_MS),
    random: over.random ?? (() => 0),
  });
}

/** The kind of result a launch got: sampled onto Sonnet, the window's control, outside, or refused. */
export function kindOf(result: ReturnType<typeof sample>): string {
  if (result === undefined) {
    return "outside";
  }
  if ("error" in result) {
    return "refused";
  }
  return result.model === undefined ? "control" : "sampled";
}
