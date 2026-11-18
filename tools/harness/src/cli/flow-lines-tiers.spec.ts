import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyReport } from "./flow-commands-support.js";
import { reviewRoundReportLines } from "./flow-lines-review-rounds.js";
import { sendBackTierReportLines } from "./flow-lines-send-back-split.js";
import { writerTierReportLines } from "./flow-lines-tiers.js";

vi.mock("./flow-lines-review-rounds.js");
vi.mock("./flow-lines-send-back-split.js");

const REPORT = emptyReport();

beforeEach(() => {
  vi.resetAllMocks();
});

describe("writerTierReportLines: the per-writer-tier lines of the flow report text", () => {
  it("prints the send-back lines, then the failed review round and coverage lines, each read from the same report", () => {
    vi.mocked(sendBackTierReportLines).mockReturnValue(["send-back line"]);
    vi.mocked(reviewRoundReportLines).mockReturnValue(["review line"]);

    expect(writerTierReportLines(REPORT)).toEqual([
      "send-back line",
      "review line",
    ]);
    expect(sendBackTierReportLines).toHaveBeenCalledWith(REPORT);
    expect(reviewRoundReportLines).toHaveBeenCalledWith(REPORT);
  });
});
