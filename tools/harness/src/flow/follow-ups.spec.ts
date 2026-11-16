import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { closedIdeas, trailingMetric } from "./cost.js";
import { followUpMetrics } from "./follow-ups.js";
import { time } from "./github-waits.js";
import { inWindow, type Span } from "./scope.js";

vi.mock("./cost.js");
vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: Span = [0, 1000];

let seq = 0;
function event(
  kind: string,
  fields: Partial<LedgerEvent> = {},
  ms = 10,
): LedgerEvent {
  seq += 1;
  return {
    schema: 1,
    id: `e${seq}`,
    source: "herdr",
    kind: kind as Kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...fields,
  };
}

const writerLaunch = (pane: string, ms = 10) =>
  event(
    "session.launch",
    { pane, agent: `${pane}-writer`, role: "writer" },
    ms,
  );

const send = (
  pane: string,
  fields: Partial<LedgerEvent> = {},
  ms = 20,
): LedgerEvent => event("session.send", { pane, ...fields }, ms);

const closed = (idea: string, own: LedgerEvent[]) => ({ idea, at: 1, own });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(time).mockImplementation((e) => Date.parse(e.occurredAt));
  vi.mocked(inWindow).mockImplementation((w, t) => t >= w[0] && t < w[1]);
  vi.mocked(closedIdeas).mockReturnValue([]);
  vi.mocked(trailingMetric).mockReturnValue({
    status: "insufficient history",
    closedIdeas: 0,
    needed: 6,
  });
});

describe("followUpMetrics counts a follow-up only when a writer launched its pane", () => {
  it("counts a send to a pane a writer launched, and leaves out a send to any other pane", () => {
    const own = [
      writerLaunch("w1:p1"),
      send("w1:p1"),
      send("w1:p2"),
      event("session.launch", { pane: "w1:p3", role: "judge" }),
      send("w1:p3"),
    ];
    expect(
      followUpMetrics(new Map([["#1", own]]), WINDOW, 5, 0.25).followUps,
    ).toEqual({
      writerSessions: 1,
      bySender: [{ sender: "main session", events: 1 }],
    });
  });

  it("names a send from the main session as the main session, including one from before senders were recorded", () => {
    const own = [
      writerLaunch("w1:p1"),
      send("w1:p1"),
      send("w1:p1", { senderRole: "judge", senderName: "judge-1" }),
    ];
    expect(
      followUpMetrics(new Map([["#1", own]]), WINDOW, 5, 0.25).followUps
        .bySender,
    ).toEqual([
      { sender: "judge", events: 1 },
      { sender: "main session", events: 1 },
    ]);
  });

  it("orders senders by most follow-ups first, and ties by sender name", () => {
    const own = [
      writerLaunch("w1:p1"),
      send("w1:p1", { senderRole: "tick" }),
      send("w1:p1", { senderRole: "judge" }),
      send("w1:p1", { senderRole: "judge" }),
      send("w1:p1", { senderRole: "tick" }),
      send("w1:p1"),
    ];
    expect(
      followUpMetrics(new Map([["#1", own]]), WINDOW, 5, 0.25).followUps
        .bySender,
    ).toEqual([
      { sender: "judge", events: 2 },
      { sender: "tick", events: 2 },
      { sender: "main session", events: 1 },
    ]);
  });

  it("leaves a send from before the window out of the sender split", () => {
    const own = [writerLaunch("w1:p1", 10), send("w1:p1", {}, 2000)];
    expect(
      followUpMetrics(new Map([["#1", own]]), WINDOW, 5, 0.25).followUps,
    ).toEqual({ writerSessions: 1, bySender: [] });
  });

  it("counts only the writer launches in the window as writer sessions", () => {
    const own = [writerLaunch("w1:p1", 10), writerLaunch("w1:p2", 2000)];
    expect(
      followUpMetrics(new Map([["#1", own]]), WINDOW, 5, 0.25).followUps
        .writerSessions,
    ).toBe(1);
  });
});

describe("followUpMetrics trailing figures are follow-ups per writer session", () => {
  it("divides an idea's follow-ups by its writer sessions before the trailing average compares them", () => {
    const own = [
      writerLaunch("w1:p1"),
      writerLaunch("w1:p2"),
      send("w1:p1"),
      send("w1:p2", { senderRole: "judge" }),
      send("w1:p2"),
    ];
    vi.mocked(closedIdeas).mockReturnValue([closed("#1", own)]);
    followUpMetrics(new Map([["#1", own]]), WINDOW, 5, 0.25);
    expect(vi.mocked(trailingMetric)).toHaveBeenNthCalledWith(
      1,
      [{ idea: "#1", value: 1.5 }],
      5,
      { maxIncrease: 0.25 },
    );
  });

  it("leaves an idea with no writer session out of the per-writer-session figures", () => {
    const withWriter = [writerLaunch("w1:p1"), send("w1:p1")];
    const withoutWriter = [send("w1:p9")];
    vi.mocked(closedIdeas).mockReturnValue([
      closed("#1", withoutWriter),
      closed("#2", withWriter),
    ]);
    followUpMetrics(
      new Map([
        ["#1", withoutWriter],
        ["#2", withWriter],
      ]),
      WINDOW,
      5,
      0.25,
    );
    expect(vi.mocked(trailingMetric).mock.calls[0]?.[0]).toEqual([
      { idea: "#2", value: 1 },
    ]);
  });

  it("gives the main session's figure over its own follow-ups only, beside the all-sender figure", () => {
    const own = [
      writerLaunch("w1:p1"),
      send("w1:p1"),
      send("w1:p1", { senderRole: "judge" }),
    ];
    vi.mocked(closedIdeas).mockReturnValue([closed("#1", own)]);
    followUpMetrics(new Map([["#1", own]]), WINDOW, 5, 0.25);
    expect(vi.mocked(trailingMetric).mock.calls[0]?.[0]).toEqual([
      { idea: "#1", value: 2 },
    ]);
    expect(vi.mocked(trailingMetric).mock.calls[1]?.[0]).toEqual([
      { idea: "#1", value: 1 },
    ]);
  });

  it("returns the trailing metric it is given, so the qualifier can read it as a flow metric", () => {
    const insufficient = {
      status: "insufficient history" as const,
      closedIdeas: 1,
      needed: 6,
    };
    vi.mocked(trailingMetric).mockReturnValue(insufficient);
    const metrics = followUpMetrics(new Map(), WINDOW, 5, 0.25);
    expect(metrics.followUpsPerWriterSession).toBe(insufficient);
    expect(metrics.mainFollowUpsPerWriterSession).toBe(insufficient);
  });
});
