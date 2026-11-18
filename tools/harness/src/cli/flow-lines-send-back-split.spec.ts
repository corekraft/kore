import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowReport, SendBackTiers } from "../flow/index.js";
import { sendBackTierLines } from "./flow-lines-send-back.js";
import { sendBackTierReportLines } from "./flow-lines-send-back-split.js";

vi.mock("./flow-lines-send-back.js");

const AT = "2026-11-16T00:00:00.000Z";
// Two distinct values of the real type: the lines are told apart by identity, never by content.
const BASE: SendBackTiers = {
  tiers: {},
  unlinked: {
    mergedChanges: 0,
    sendBacks: {
      byCategory: {
        declaration: 0,
        "pattern-mismatch": 0,
        "failed-check": 0,
        conflict: 0,
        "missing-proof": 0,
        "rule-break": 0,
        scope: 0,
        "wrong-statement": 0,
        other: 0,
      },
      uncategorised: 0,
      otherShare: null,
      otherThreshold: 0.1,
      otherOverThreshold: false,
    },
  },
};
const BEFORE: SendBackTiers = { ...BASE };
const AFTER: SendBackTiers = { ...BASE };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sendBackTierLines).mockImplementation((tiers) => [
    tiers === BEFORE ? "before-line" : "after-line",
  ]);
});

describe("sendBackTierReportLines: the tier figures, then the same figures on each side of the split date (#1047)", () => {
  it("prints only the tier lines without a split, so the text report is exactly what it was", () => {
    const report: Pick<FlowReport, "sendBackTiers" | "sendBackTiersSplit"> = {
      sendBackTiers: BEFORE,
    };

    expect(sendBackTierReportLines(report)).toEqual(["before-line"]);
    expect(sendBackTierLines).toHaveBeenCalledTimes(1);
  });

  it("prints the tier lines, then the before side, then the after side, each under a header naming the date and indented below it", () => {
    const report: Pick<FlowReport, "sendBackTiers" | "sendBackTiersSplit"> = {
      sendBackTiers: AFTER,
      sendBackTiersSplit: { at: AT, before: BEFORE, after: AFTER },
    };

    expect(sendBackTierReportLines(report)).toEqual([
      "after-line",
      `Send-backs by writer tier, before ${AT}:`,
      "  before-line",
      `Send-backs by writer tier, on or after ${AT}:`,
      "  after-line",
    ]);
  });
});
