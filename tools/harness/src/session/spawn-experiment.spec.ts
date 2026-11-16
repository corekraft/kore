import { describe, expect, it, vi } from "vitest";
import type { TierOrigin } from "../ledger/index.js";
import {
  EXPERIMENT_DAYS,
  EXPERIMENT_MODEL,
  EXPERIMENT_START,
  experimentConfigError,
  writerExperiment,
} from "./spawn-experiment.js";

const DAY_MS = 86_400_000;
const START = "2026-12-01";
const START_MS = Date.parse("2026-12-01T00:00:00.000Z");
const END_MS = START_MS + EXPERIMENT_DAYS * DAY_MS;

/** A writer launch on the default definition, inside the window, drawing `draw`. */
function sample(
  over: {
    role?: string;
    origin?: TierOrigin;
    env?: Record<string, string | undefined>;
    now?: number;
    random?: () => number;
  } = {},
) {
  return writerExperiment({
    role: over.role ?? "writer",
    origin: over.origin ?? { tierSource: "definition" },
    env: over.env ?? { [EXPERIMENT_START]: START },
    now: new Date(over.now ?? START_MS),
    random: over.random ?? (() => 0),
  });
}

describe("writerExperiment samples default-tier writers at ten percent inside the window", () => {
  it("runs a default-tier writer on Sonnet as an experiment override when its draw is under the share", () => {
    expect(sample({ random: () => 0.09 })).toEqual({
      model: EXPERIMENT_MODEL,
      tier: { tierSource: "override", tierReason: "experiment" },
    });
  });

  it("keeps the definition when the draw is exactly the share, so the share is ten percent, not eleven", () => {
    expect(sample({ random: () => 0.1 })).toBeUndefined();
  });

  it("selects by the injected draw alone, so a fixed sequence gives a fixed share", () => {
    const random = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.0999)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.05);
    const results = [1, 2, 3, 4, 5].map(() =>
      sample({ random }) === undefined ? "kept" : "sampled",
    );
    expect(results).toEqual(["sampled", "sampled", "kept", "kept", "sampled"]);
    expect(random).toHaveBeenCalledTimes(5);
  });

  it("includes the first instant of the window and excludes its end", () => {
    expect(sample({ now: START_MS, random: () => 0 })).toBeDefined();
    expect(sample({ now: END_MS - 1, random: () => 0 })).toBeDefined();
    expect(sample({ now: END_MS, random: () => 0 })).toBeUndefined();
  });
});

describe("writerExperiment keeps the definition for every launch it does not sample", () => {
  it("selects nothing before the window starts, and never reads the draw there", () => {
    const random = vi.fn(() => 0);
    expect(sample({ now: START_MS - 1, random })).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });

  it("selects nothing after the window ends, and never reads the draw there", () => {
    const random = vi.fn(() => 0);
    expect(sample({ now: END_MS + DAY_MS, random })).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });

  it("selects nothing while the window is unset, and never reads the draw", () => {
    const random = vi.fn(() => 0);
    expect(sample({ env: {}, random })).toBeUndefined();
    expect(sample({ env: { [EXPERIMENT_START]: "" }, random })).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });

  it("refuses a writer whose window start is not a real calendar date, and never reads the draw", () => {
    const random = vi.fn(() => 0);
    expect(
      sample({ env: { [EXPERIMENT_START]: "2026-02-30" }, random }),
    ).toEqual({
      error: experimentConfigError({ [EXPERIMENT_START]: "2026-02-30" }),
    });
    expect(random).not.toHaveBeenCalled();
  });

  it("refuses a flag-chosen writer whose window start is malformed, so a typo never passes silently", () => {
    expect(
      sample({
        env: { [EXPERIMENT_START]: "next week" },
        origin: { tierSource: "override", tierReason: "deep diff" },
      }),
    ).toEqual({
      error: experimentConfigError({ [EXPERIMENT_START]: "next week" }),
    });
  });

  it("leaves a judge or a reader on its own tier, whatever the draw", () => {
    const random = vi.fn(() => 0);
    expect(sample({ role: "judge", random })).toBeUndefined();
    expect(sample({ role: "reader", random })).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });

  it("leaves a writer whose tier a flag or an escalation chose on that tier", () => {
    const random = vi.fn(() => 0);
    expect(
      sample({ origin: { tierSource: "escalation" }, random }),
    ).toBeUndefined();
    expect(
      sample({
        origin: { tierSource: "override", tierReason: "deep diff" },
        random,
      }),
    ).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });
});

describe("experimentConfigError refuses a window start the code would not read", () => {
  it("accepts an unset or empty start, which keeps the window closed", () => {
    expect(experimentConfigError({})).toBeUndefined();
    expect(experimentConfigError({ [EXPERIMENT_START]: "" })).toBeUndefined();
  });

  it("accepts a real calendar date", () => {
    expect(
      experimentConfigError({ [EXPERIMENT_START]: START }),
    ).toBeUndefined();
  });

  it("refuses a value that is not a date, naming the variable, the fix and that nothing started", () => {
    expect(experimentConfigError({ [EXPERIMENT_START]: "next week" })).toBe(
      `${EXPERIMENT_START} must be a date such as 2026-12-01 (UTC), or unset; got "next week". No session was started.`,
    );
  });

  it("refuses a date that does not exist, such as February 30", () => {
    expect(
      experimentConfigError({ [EXPERIMENT_START]: "2026-02-30" }),
    ).toContain('got "2026-02-30"');
  });
});
