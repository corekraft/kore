import { describe, expect, it, vi } from "vitest";
import {
  EXPERIMENT_DAYS_ENV,
  EXPERIMENT_EFFORT_ENV,
  EXPERIMENT_MODEL,
  EXPERIMENT_SHARE_ENV,
  EXPERIMENT_START,
  experimentConfigError,
} from "./spawn-experiment.js";
import {
  DAY_MS,
  START,
  START_MS,
  WINDOW,
  kindOf,
  sample,
} from "./spawn-experiment-support.js";

describe("writerExperiment reads the share from its variable", () => {
  it("samples at the share the variable sets, and marks the control exactly at that share", () => {
    const env = { ...WINDOW, [EXPERIMENT_SHARE_ENV]: "0.5" };
    expect(sample({ env, random: () => 0.49 })).toEqual({
      model: EXPERIMENT_MODEL,
      effort: "high",
      tier: { tierSource: "override", tierReason: "experiment" },
    });
    expect(kindOf(sample({ env, random: () => 0.5 }))).toBe("control");
  });

  it("samples every writer inside the window when the share is 1", () => {
    const env = { ...WINDOW, [EXPERIMENT_SHARE_ENV]: "1" };
    expect(kindOf(sample({ env, random: () => 0.999999 }))).toBe("sampled");
  });

  it("refuses a writer with a share that is not above 0 and up to 1, and never reads the draw", () => {
    const random = vi.fn(() => 0);
    const env = { ...WINDOW, [EXPERIMENT_SHARE_ENV]: "1.5" };
    expect(sample({ env, random })).toEqual({
      error: experimentConfigError(env),
    });
    expect(random).not.toHaveBeenCalled();
  });

  it("refuses a bad share even before the window opens, so a typo never passes silently", () => {
    const env = {
      [EXPERIMENT_START]: "2026-12-30",
      [EXPERIMENT_EFFORT_ENV]: "high",
      [EXPERIMENT_SHARE_ENV]: "x",
    };
    expect(sample({ env, now: START_MS - DAY_MS })).toEqual({
      error: experimentConfigError(env),
    });
  });
});

describe("writerExperiment reads the length from its variable", () => {
  it("closes the window after the length the variable sets, the end still excluded", () => {
    const env = { ...WINDOW, [EXPERIMENT_DAYS_ENV]: "7" };
    const end7 = START_MS + 7 * DAY_MS;
    expect(kindOf(sample({ env, now: end7 - 1, random: () => 0 }))).toBe(
      "sampled",
    );
    const random = vi.fn(() => 0);
    expect(sample({ env, now: end7, random })).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });

  it("keeps ten percent for fourteen days when the share and the length are empty", () => {
    const env = {
      ...WINDOW,
      [EXPERIMENT_SHARE_ENV]: "",
      [EXPERIMENT_DAYS_ENV]: "",
    };
    const end14 = START_MS + 14 * DAY_MS;
    expect(kindOf(sample({ env, random: () => 0.1 }))).toBe("control");
    expect(kindOf(sample({ env, random: () => 0.09 }))).toBe("sampled");
    expect(kindOf(sample({ env, now: end14 - 1, random: () => 0 }))).toBe(
      "sampled",
    );
    expect(kindOf(sample({ env, now: end14, random: () => 0 }))).toBe(
      "outside",
    );
  });

  it("refuses a writer with a length that is not a positive whole number of days, and never reads the draw", () => {
    const random = vi.fn(() => 0);
    const env = { ...WINDOW, [EXPERIMENT_DAYS_ENV]: "0" };
    expect(sample({ env, random })).toEqual({
      error: experimentConfigError(env),
    });
    expect(random).not.toHaveBeenCalled();
  });

  it("leaves a judge on its tier, whatever a bad share or length says", () => {
    const random = vi.fn(() => 0);
    const env = {
      ...WINDOW,
      [EXPERIMENT_SHARE_ENV]: "1.5",
      [EXPERIMENT_DAYS_ENV]: "0",
    };
    expect(sample({ role: "judge", env, random })).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });
});

describe("writerExperiment refuses a writer while the window's effort is missing or unrecognized", () => {
  it("refuses a writer when the window is open and the effort is unset, naming the variable, the value and the fix", () => {
    const env = { [EXPERIMENT_START]: START };
    expect(sample({ env })).toEqual({
      error: `${EXPERIMENT_EFFORT_ENV} must be one of low, medium, high, xhigh, max, such as high, while ${EXPERIMENT_START} is set; got unset. No session was started.`,
    });
  });

  it.each(["HIGH", "extra-high", " high", "1", "medium "])(
    "refuses the window effort %j, naming the variable, the value and the fix",
    (effort) => {
      const env = { ...WINDOW, [EXPERIMENT_EFFORT_ENV]: effort };
      expect(sample({ env })).toEqual({
        error: `${EXPERIMENT_EFFORT_ENV} must be one of low, medium, high, xhigh, max, such as high, while ${EXPERIMENT_START} is set; got "${effort}". No session was started.`,
      });
    },
  );

  it("refuses a writer that names a model too, and reads no random value, while the window effort is bad", () => {
    const random = vi.fn(() => 0);
    const env = { [EXPERIMENT_START]: START, [EXPERIMENT_EFFORT_ENV]: "bogus" };
    expect(sample({ env, model: "claude-opus-5-5", random })).toEqual({
      error: experimentConfigError(env),
    });
    expect(random).not.toHaveBeenCalled();
  });

  it("ignores the effort variable while the window start is unset, whatever it holds", () => {
    const random = vi.fn(() => 0);
    const env = { [EXPERIMENT_EFFORT_ENV]: "bogus" };
    expect(experimentConfigError(env)).toBeUndefined();
    expect(sample({ env, random })).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });
});
