import { describe, expect, it, vi } from "vitest";
import {
  EXPERIMENT_EFFORT_ENV,
  EXPERIMENT_MODEL,
  EXPERIMENT_SHARE_ENV,
  EXPERIMENT_START,
} from "./spawn-experiment.js";
import {
  DAY_MS,
  END_MS,
  START_MS,
  WINDOW,
  kindOf,
  sample,
} from "./spawn-experiment-support.js";

describe("writerExperiment samples a writer that names no model at ten percent inside the window", () => {
  it("runs the writer on Sonnet at the window effort, as an experiment override, when its draw is under the share", () => {
    expect(sample({ random: () => 0.09 })).toEqual({
      model: EXPERIMENT_MODEL,
      effort: "high",
      tier: { tierSource: "override", tierReason: "experiment" },
    });
  });

  it("keeps the share at ten percent: a draw of exactly the share is the control, not sampled", () => {
    expect(sample({ random: () => 0.1 })).toEqual({
      model: undefined,
      effort: "high",
      tier: { tierSource: "definition", tierReason: "experiment-control" },
    });
  });

  it("selects by the injected draw alone, so a fixed sequence gives a fixed share", () => {
    const random = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.0999)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.05);
    const results = [1, 2, 3, 4, 5].map(() => kindOf(sample({ random })));
    expect(results).toEqual([
      "sampled",
      "sampled",
      "control",
      "control",
      "sampled",
    ]);
    expect(random).toHaveBeenCalledTimes(5);
  });

  it("includes the first instant of the window and excludes its end", () => {
    expect(kindOf(sample({ now: START_MS, random: () => 0 }))).toBe("sampled");
    expect(kindOf(sample({ now: END_MS - 1, random: () => 0 }))).toBe(
      "sampled",
    );
    expect(kindOf(sample({ now: END_MS, random: () => 0 }))).toBe("outside");
  });
});

describe("writerExperiment eligibility is read from the model flag, not from the tier origin", () => {
  it("draws a writer launched with only an effort flag, at a share of 1, onto Sonnet at the window effort", () => {
    const env = { ...WINDOW, [EXPERIMENT_SHARE_ENV]: "1" };
    expect(
      sample({
        env,
        origin: { tierSource: "override" },
        random: () => 0.999999,
      }),
    ).toEqual({
      model: EXPERIMENT_MODEL,
      effort: "high",
      tier: { tierSource: "override", tierReason: "experiment" },
    });
  });

  it("keeps an undrawn eligible writer as the control at the window effort, adding only the control reason to the origin", () => {
    expect(
      sample({
        origin: { tierSource: "override" },
        random: () => 0.5,
      }),
    ).toEqual({
      model: undefined,
      effort: "high",
      tier: { tierSource: "override", tierReason: "experiment-control" },
    });
  });

  it("replaces a caller's own reason with the control reason on an undrawn eligible writer", () => {
    expect(
      sample({
        origin: { tierSource: "override", tierReason: "deep diff" },
        random: () => 0.5,
      }),
    ).toEqual({
      model: undefined,
      effort: "high",
      tier: { tierSource: "override", tierReason: "experiment-control" },
    });
  });

  it.each(["low", "medium", "high", "xhigh", "max"])(
    "records the window effort %s, whichever effort the window variable names",
    (effort) => {
      const env = { ...WINDOW, [EXPERIMENT_EFFORT_ENV]: effort };
      expect(sample({ env, random: () => 0.5 })).toMatchObject({ effort });
      expect(sample({ env, random: () => 0.01 })).toMatchObject({ effort });
    },
  );

  it("never draws a writer launched with a model flag, reads no random value, and carries no control marker", () => {
    const random = vi.fn(() => 0);
    expect(
      sample({
        model: "claude-opus-5-5",
        origin: { tierSource: "override", tierReason: "deep diff" },
        random,
      }),
    ).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });

  it("never draws an escalated writer, which carries a model flag, and reads no random value", () => {
    const random = vi.fn(() => 0);
    expect(
      sample({
        model: "claude-sonnet-5-5",
        origin: { tierSource: "escalation" },
        random,
      }),
    ).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
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
    const env = { ...WINDOW, [EXPERIMENT_START]: "2026-02-30" };
    expect(sample({ env, random })).toEqual({
      error: expect.stringContaining('got "2026-02-30"'),
    });
    expect(random).not.toHaveBeenCalled();
  });

  it("refuses a flag-chosen writer whose window start is malformed, so a typo never passes silently", () => {
    const env = { ...WINDOW, [EXPERIMENT_START]: "next week" };
    expect(
      sample({
        env,
        model: "claude-opus-5-5",
        origin: { tierSource: "override", tierReason: "deep diff" },
      }),
    ).toEqual({
      error: expect.stringContaining('got "next week"'),
    });
  });

  it("leaves a judge or a reader on its own tier, whatever the draw", () => {
    const random = vi.fn(() => 0);
    expect(sample({ role: "judge", random })).toBeUndefined();
    expect(sample({ role: "reader", random })).toBeUndefined();
    expect(random).not.toHaveBeenCalled();
  });
});
