import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { leadLines } from "./flow-lines-lead.js";

type Terminal = NonNullable<FlowReport["terminal"]>;

const LEAD: FlowReport["leadTime"] = {
  ideas: [{ idea: "#12", seconds: 90 }],
  medianSeconds: 90,
  maxSeconds: 200,
};
const NONE: FlowReport["leadTime"] = {
  ideas: [],
  medianSeconds: null,
  maxSeconds: null,
};
const TERMINAL: Terminal = {
  finishDetection: {
    windowSeconds: 300,
    results: 0,
    detected: 0,
    undetected: 0,
    neverNoticed: 0,
    late: 0,
    medianLagSeconds: null,
    lagMinutes: { samples: 0, median: null, p90: null },
  },
  stalledPanes: {
    silenceSeconds: 900,
    recorded: 0,
    silentSessions: 0,
    backgroundExcluded: 0,
    questionExcluded: 0,
  },
  leadTime: NONE,
  mainSession: {
    paneReadsPerFinishedPane: {
      status: "insufficient",
      reason: "the retro scan counts herdr pane reads only",
    },
    signedSendShare: {
      status: "insufficient",
      reason: "the retro scan counts no raw terminal sends",
    },
  },
};

describe("flow report text: lead time (#1782)", () => {
  it("prints one lead time line as before when the ledger holds no terminal event", () => {
    expect(leadLines({ leadTime: LEAD, terminal: null })).toEqual([
      "Lead time: 1 ideas, median 90s, max 200s",
    ]);
  });

  it("prints a lead time line for each source when a terminal event is in the ledger", () => {
    expect(leadLines({ leadTime: LEAD, terminal: TERMINAL })).toEqual([
      "Lead time (herdr): 1 ideas, median 90s, max 200s",
      "Lead time (terminal): no completed ideas",
    ]);
  });
});
