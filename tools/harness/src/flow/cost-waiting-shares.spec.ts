import { describe, expect, it, vi } from "vitest";
import { levelOf, readingOf } from "./cost-waiting-shares.js";

// Everything outside the unit is mocked, the pure arithmetic helpers included: a share is the
// plan-weighted tokens over the ceiling, a summary is a fixed fake.
vi.mock("./cost-waiting-support.js", () => ({
  shareOf: (plan: number, ceiling: number | undefined) =>
    ceiling === undefined ? "not set" : plan / ceiling,
  summaryOf: (values: number[]) => ({
    total: values.reduce((sum, v) => sum + v, 0),
    median: values.length === 0 ? null : values[0],
    p90: values.length === 0 ? null : values[values.length - 1],
  }),
}));

const RATE = "of the weekly ceiling";
const SIZE = "of one week's ceiling";

describe("one unit's share of the ceiling", () => {
  it("is the unit's plan-weighted tokens over the ceiling, under the label it is given", () => {
    expect(
      readingOf(RATE, { plan: 50, unweighted: [] }, { ceiling: 200 }),
    ).toEqual({ label: RATE, status: "measured", share: 0.25 });
  });

  it("carries a size's span and the main session's basis beside the share", () => {
    expect(
      readingOf(
        SIZE,
        { plan: 50, unweighted: [], spanSeconds: 90, basis: "assumed model" },
        { ceiling: 200 },
      ),
    ).toEqual({
      label: SIZE,
      status: "measured",
      share: 0.25,
      spanSeconds: 90,
      basis: "assumed model",
    });
  });

  it("reads not set, never zero, when the config names no ceiling", () => {
    expect(
      readingOf(SIZE, { plan: 0, unweighted: [] }, { ceiling: undefined }),
    ).toEqual({ label: SIZE, status: "measured", share: "not set" });
  });

  it("names a model with no plan weight and prints no share for the unit", () => {
    expect(
      readingOf(
        RATE,
        { plan: 40, unweighted: ["mystery", "mystery"] },
        { ceiling: 200 },
      ),
    ).toEqual({
      label: RATE,
      status: "insufficient weights",
      models: ["mystery"],
    });
  });
});

describe("a level's shares: the sum, the median and the p90 over its units", () => {
  const units = [
    { plan: 10, unweighted: [] },
    { plan: 30, unweighted: [] },
  ];

  it("sums the units' shares, which may pass 100%, with the median and p90 over the units' shares", () => {
    expect(levelOf(RATE, units, { ceiling: 20, minimum: 2 })).toEqual({
      label: RATE,
      status: "measured",
      units: 2,
      needed: 2,
      total: 2,
      median: 0.5,
      p90: 1.5,
    });
  });

  it("is insufficient, never zero, below the minimum count of units", () => {
    expect(levelOf(SIZE, units, { ceiling: 20, minimum: 3 })).toEqual({
      label: SIZE,
      status: "insufficient",
      units: 2,
      needed: 3,
    });
  });

  it("reads every figure not set when the config names no ceiling", () => {
    expect(levelOf(SIZE, units, { ceiling: undefined, minimum: 2 })).toEqual({
      label: SIZE,
      status: "measured",
      units: 2,
      needed: 2,
      total: "not set",
      median: "not set",
      p90: "not set",
    });
  });

  it("names the models with no plan weight before it checks the minimum, and sums nothing", () => {
    expect(
      levelOf(
        SIZE,
        [
          { plan: 10, unweighted: ["b", "a"] },
          { plan: 5, unweighted: ["a"] },
        ],
        { ceiling: 20, minimum: 9 },
      ),
    ).toEqual({
      label: SIZE,
      status: "insufficient weights",
      units: 2,
      needed: 9,
      models: ["a", "b"],
    });
  });
});
