import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { leadLines } from "./flow-lines-lead.js";

const LEAD = {
  ideas: [{ idea: "#12", seconds: 90 }],
  medianSeconds: 90,
  maxSeconds: 200,
};

describe("flow report text: lead time (#1782)", () => {
  it("prints one lead time line as before when the ledger holds no terminal event", () => {
    expect(
      leadLines({ leadTime: LEAD, terminal: null } as unknown as Pick<
        FlowReport,
        "leadTime" | "terminal"
      >),
    ).toEqual(["Lead time: 1 ideas, median 90s, max 200s"]);
  });

  it("prints a lead time line for each source when a terminal event is in the ledger", () => {
    const none = { ideas: [], medianSeconds: null, maxSeconds: null };
    expect(
      leadLines({
        leadTime: LEAD,
        terminal: { leadTime: none },
      } as unknown as Pick<FlowReport, "leadTime" | "terminal">),
    ).toEqual([
      "Lead time (herdr): 1 ideas, median 90s, max 200s",
      "Lead time (terminal): no completed ideas",
    ]);
  });
});
