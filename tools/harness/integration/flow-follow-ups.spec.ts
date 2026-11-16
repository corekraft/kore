import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "../src/flow/index.js";
import { T0, at } from "../src/testing/index.js";
import type { LedgerEvent } from "../src/ledger/index.js";

const ASOF = new Date(T0 + 1_000_000_000);

function report(events: LedgerEvent[]): FlowReport {
  return buildReport(events, { asOf: ASOF, minCompletedIdeas: 1 });
}

describe("flow report writer follow-ups (#835)", () => {
  it("splits the sends to a writer pane by sender in the JSON, and leaves out a send to a pane no writer launched", () => {
    const r = report([
      at(0, "session.launch", {
        source: "herdr",
        pane: "w1:p1",
        agent: "x-writer",
        role: "writer",
        idea: "#1",
      }),
      at(5, "session.send", {
        source: "herdr",
        pane: "w1:p1",
        agent: "x-writer",
      }),
      at(6, "session.send", {
        source: "herdr",
        pane: "w1:p1",
        agent: "x-writer",
        senderRole: "judge",
        senderName: "judge-1",
      }),
      at(7, "session.send", {
        source: "herdr",
        pane: "w1:p9",
        agent: "not-a-writer",
        idea: "#1",
      }),
    ]);
    expect(r.rework.followUps).toEqual({
      writerSessions: 1,
      bySender: [
        { sender: "judge", events: 1 },
        { sender: "main session", events: 1 },
      ],
    });
    expect(r.rework.followUpsPerWriterSession).toEqual({
      status: "insufficient history",
      closedIdeas: 0,
      needed: 6,
    });
  });
});
