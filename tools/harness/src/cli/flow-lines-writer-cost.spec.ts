import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import {
  changes,
  writerDollarsLines,
  writerTierLines,
} from "./flow-lines-writer-cost.js";

type WriterCost = FlowReport["writerCost"];

/** A writer cost figure in a window below the minimum merged changes, and its trailing average. */
const NOT_READ: WriterCost = {
  pricesAsOf: "2026-11-17",
  trailingDays: 7,
  minMergedChanges: 5,
  current: { status: "insufficient merged changes", merged: 2, needed: 5 },
  trailingAverage: {
    status: "insufficient merged changes",
    merged: 0,
    needed: 5,
  },
} as WriterCost;

describe("changes: the merged-change count, singular for one", () => {
  it("reads one merged change in the singular and any other count in the plural", () => {
    expect([changes(0), changes(1), changes(2)]).toEqual([
      "0 merged changes",
      "1 merged change",
      "2 merged changes",
    ]);
  });
});

describe("writerDollarsLines: a window below the minimum is not read, never a zero", () => {
  it("prints the dollars line as not read, and the trailing average as no average", () => {
    expect(writerDollarsLines(NOT_READ)).toEqual([
      "All-in cost per merged change: not read, 2 merged changes in this range (5 needed)",
      "All-in cost per merged change, trailing average: no average: 0 merged changes in the trailing 7 days (5 needed)",
    ]);
  });
});

describe("writerTierLines: a window below the minimum is not read, never a zero", () => {
  it("prints one line saying the tiers beyond cost are not read", () => {
    expect(writerTierLines(NOT_READ)).toEqual([
      "Writer tiers beyond cost: not read, 2 merged changes in this range (5 needed)",
    ]);
  });
});
