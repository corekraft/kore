import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_DAYS_ENV,
  EXPERIMENT_EFFORT_ENV,
  EXPERIMENT_SHARE_ENV,
  EXPERIMENT_START,
  experimentConfigError,
} from "./spawn-experiment.js";
import { START, WINDOW } from "./spawn-experiment-support.js";

describe("experimentConfigError refuses a window start the code would not read", () => {
  it("accepts an unset or empty start, which keeps the window closed", () => {
    expect(experimentConfigError({})).toBeUndefined();
    expect(experimentConfigError({ [EXPERIMENT_START]: "" })).toBeUndefined();
  });

  it("accepts a real calendar date", () => {
    expect(experimentConfigError(WINDOW)).toBeUndefined();
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

describe("experimentConfigError refuses a window effort the code would not read", () => {
  it.each(["low", "medium", "high", "xhigh", "max"])(
    "accepts the window effort %s while the window is open",
    (effort) => {
      expect(
        experimentConfigError({
          [EXPERIMENT_START]: START,
          [EXPERIMENT_EFFORT_ENV]: effort,
        }),
      ).toBeUndefined();
    },
  );

  it("refuses an unset window effort while the window is open, naming the variable and that nothing started", () => {
    expect(experimentConfigError({ [EXPERIMENT_START]: START })).toBe(
      `${EXPERIMENT_EFFORT_ENV} must be one of low, medium, high, xhigh, max, such as high, while ${EXPERIMENT_START} is set; got unset. No session was started.`,
    );
  });

  it("accepts an unrecognized window effort while the window is closed, because the variable is ignored", () => {
    expect(
      experimentConfigError({ [EXPERIMENT_EFFORT_ENV]: "bogus" }),
    ).toBeUndefined();
  });
});

describe("experimentConfigError refuses a share or a length the code would not read", () => {
  it("accepts an unset or empty share and length, which keep the defaults", () => {
    expect(
      experimentConfigError({
        [EXPERIMENT_SHARE_ENV]: "",
        [EXPERIMENT_DAYS_ENV]: "",
      }),
    ).toBeUndefined();
  });

  it.each(["0.5", "1", "0.10", ".25"])("accepts the share %s", (share) => {
    expect(
      experimentConfigError({ [EXPERIMENT_SHARE_ENV]: share }),
    ).toBeUndefined();
  });

  it.each(["0", "1.5", "-0.1", "one tenth", "1e-1", " 0.5", "1."])(
    "refuses the share %j, naming the variable, the value, the fix and that nothing started",
    (share) => {
      expect(experimentConfigError({ [EXPERIMENT_SHARE_ENV]: share })).toBe(
        `${EXPERIMENT_SHARE_ENV} must be a share above 0 and up to 1, such as 0.1, or unset; got "${share}". No session was started.`,
      );
    },
  );

  it.each(["1", "14", "120"])("accepts the length %s days", (days) => {
    expect(
      experimentConfigError({ [EXPERIMENT_DAYS_ENV]: days }),
    ).toBeUndefined();
  });

  it.each(["0", "-7", "1.5", "two weeks", "14 days", "1e1"])(
    "refuses the length %j, naming the variable, the value, the fix and that nothing started",
    (days) => {
      expect(experimentConfigError({ [EXPERIMENT_DAYS_ENV]: days })).toBe(
        `${EXPERIMENT_DAYS_ENV} must be a whole number of days above 0, such as 14, or unset; got "${days}". No session was started.`,
      );
    },
  );
});
