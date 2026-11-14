import { expect, test } from "vitest";
import {
  footprintBaseline,
  summarizeFootprint,
  type FootprintSample,
} from "./footprint-summary.js";

const sample = (
  cpuMillicores: number,
  memoryMiB: number,
  swapMiB = 100,
  loadAverage = 2,
): FootprintSample => ({ cpuMillicores, memoryMiB, swapMiB, loadAverage });

test("reports each metric's median and peak, taking the mean of the middle pair for an even count", () => {
  const run = summarizeFootprint(
    [sample(100, 1000), sample(300, 2000), sample(200, 4000, 400, 6)],
    10000,
  );

  expect(run.summary).toEqual({
    cpuMillicores: { median: 200, max: 300 },
    memoryMiB: { median: 2000, max: 4000 },
    swapMiB: { median: 100, max: 400 },
    loadAverage: { median: 2, max: 6 },
  });
  expect(
    summarizeFootprint([sample(100, 1000), sample(200, 3000)], 10000).summary
      .cpuMillicores.median,
  ).toBe(150);
});

test("derives VM headroom as the share left free at the median and at the peak memory", () => {
  const run = summarizeFootprint(
    [sample(1, 2000), sample(1, 3000), sample(1, 7500)],
    10000,
  );

  expect(run.headroomPercent).toEqual({ atMedian: 70, atPeak: 25 });
});

test("refuses to summarise a run with no samples", () => {
  expect(() => summarizeFootprint([], 10000)).toThrow(
    "a footprint run needs at least one sample",
  );
});

const run = (cpu: number, memory: number) =>
  summarizeFootprint([sample(cpu, memory)], 10000);

test("the baseline is the mean of the run medians per metric, with headroom averaged the same way", () => {
  const baseline = footprintBaseline([run(100, 2000), run(300, 4000)]);

  expect(baseline.medians).toEqual({
    cpuMillicores: 200,
    memoryMiB: 3000,
    swapMiB: 100,
    loadAverage: 2,
  });
  expect(baseline.headroomPercent).toEqual({ atMedian: 70, atPeak: 70 });
});

test("the spread is the gap between the highest and lowest run median as a percentage of the baseline", () => {
  const baseline = footprintBaseline([run(100, 2000), run(300, 4000)]);

  expect(baseline.spreadPercent).toEqual({
    cpuMillicores: 100,
    memoryMiB: 66.7,
    swapMiB: 0,
    loadAverage: 0,
  });
});

test("a baseline needs at least one run", () => {
  expect(() => footprintBaseline([])).toThrow(
    "a footprint baseline needs at least one run",
  );
});
