import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { frictionLine, metricLine, reworkLines } from "./flow-lines.js";

const NONE = {
  status: "insufficient history",
  closedIdeas: 1,
  needed: 6,
} as const;

describe("metricLine", () => {
  it("says why a metric has no figure rather than printing zero", () => {
    expect(metricLine("Send-backs per idea", NONE, 5)).toBe(
      "Send-backs per idea: insufficient history, 1 of 6 closed ideas",
    );
  });

  it("marks a worsened metric against its rounded trailing average", () => {
    const ok = {
      status: "ok",
      currentIdea: "#9",
      current: 4,
      trailingAverage: 1.456,
      maxIncrease: 0.25,
      worsened: true,
    } as const;
    expect(metricLine("Escalations per idea", ok, 5)).toBe(
      "Escalations per idea: #9 4, average of the 5 ideas before it 1.46 (worsened)",
    );
  });
});

describe("reworkLines", () => {
  it("lists escalations, send-backs, challenger rounds and friction in that order", () => {
    const lines = reworkLines({
      trailingIdeas: 5,
      escalationsPerIdea: NONE,
      sendBacksPerIdea: NONE,
      challengeRoundsPerIdea: NONE,
      frictionPerIdea: NONE,
    });
    expect(lines.map((l) => l.split(":")[0])).toEqual([
      "Escalations per idea",
      "Send-backs per idea",
      "Challenger rounds per idea",
      "Friction events per idea",
    ]);
  });
});

describe("frictionLine", () => {
  const of = (f: Partial<FlowReport["friction"]>) =>
    frictionLine({ total: 0, sources: [], unknownKinds: 0, ...f });

  it("says none for an empty ledger", () => {
    expect(of({})).toBe("Friction: none");
  });

  it("names each source with its count", () => {
    expect(
      of({
        total: 3,
        sources: [
          { kind: "command", source: "local up", events: 2 },
          { kind: "pane", source: "w1:p2", events: 1 },
        ],
      }),
    ).toBe("Friction: 3 (local up 2, w1:p2 1)");
  });

  it("counts the unknown record kinds it ignored", () => {
    expect(of({ unknownKinds: 2 })).toBe(
      "Friction: none; 2 unknown kind(s) ignored",
    );
  });
});
