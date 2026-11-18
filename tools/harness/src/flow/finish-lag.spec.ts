import { describe, expect, it } from "vitest";
import { finishLag } from "./finish-lag.js";

describe("finish lag: the median and 90th percentile, in minutes", () => {
  it("reads no samples, and no median or p90, when no finish has a lag", () => {
    expect(finishLag([])).toEqual({ samples: 0, median: null, p90: null });
  });

  it("gives the median and p90 in minutes, the median averaged over the two middle lags", () => {
    expect(finishLag([30, 60, 90, 120, 600])).toEqual({
      samples: 5,
      median: 1.5,
      p90: 10,
    });
  });

  it("takes the p90 as the lag at or above which the nearest rank of nine tenths falls", () => {
    const lags = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600];
    expect(finishLag(lags)).toEqual({ samples: 10, median: 5.5, p90: 9 });
  });

  it("rounds minutes to two decimal places", () => {
    expect(finishLag([2.3])).toEqual({ samples: 1, median: 0.04, p90: 0.04 });
  });
});
