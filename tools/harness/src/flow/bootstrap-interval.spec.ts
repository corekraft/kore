import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapDifferenceInterval } from "./bootstrap-interval.js";
import { seededRandom } from "./seeded-random.js";

// The generator is the dependency under test elsewhere: here it is mocked, so each draw is scripted.
vi.mock("./seeded-random.js", () => ({ seededRandom: vi.fn() }));

const scripted = (values: number[]) => {
  const queue = [...values];
  return () => queue.shift() ?? 0;
};

describe("bootstrapDifferenceInterval", () => {
  beforeEach(() => {
    vi.mocked(seededRandom).mockReset();
  });

  it("starts the generator from the given seed, so the same seed gives the same interval", () => {
    vi.mocked(seededRandom).mockReturnValue(scripted([0, 0, 0]));
    bootstrapDifferenceInterval([0, 10], [0], {
      seed: 42,
      resamples: 1,
      confidence: 0.5,
    });
    expect(seededRandom).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("reads the nearest-rank percentiles of the resampled differences", () => {
    // Each resample draws the first arm's values, then the second's. The first arm is [0, 10],
    // so a draw below one half picks 0 and a draw at or above one half picks 10; the second arm
    // is [0], so its draw is always 0. The four resampled differences are 0, 10, 5 and 10.
    vi.mocked(seededRandom).mockReturnValue(
      scripted([0, 0, 0, 0.9, 0.9, 0, 0.9, 0, 0, 0.9, 0.9, 0]),
    );
    // At confidence one half the low is the 25th percentile (the second of four sorted
    // differences, 5) and the high the 75th (the third, 10).
    expect(
      bootstrapDifferenceInterval([0, 10], [0], {
        seed: 1,
        resamples: 4,
        confidence: 0.5,
      }),
    ).toEqual({ low: 5, high: 10 });
  });

  it("gives a point interval when both arms hold one value, whatever the seed", () => {
    // Three resamples, each drawing one value from each arm: six draws.
    vi.mocked(seededRandom).mockReturnValue(
      scripted([0.2, 0.7, 0.4, 0.1, 0.9, 0.5]),
    );
    expect(
      bootstrapDifferenceInterval([5], [2], {
        seed: 9,
        resamples: 3,
        confidence: 0.95,
      }),
    ).toEqual({ low: 3, high: 3 });
  });
});
