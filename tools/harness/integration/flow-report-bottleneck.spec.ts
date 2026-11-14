import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "../src/flow/index.js";
import { T0, at, finishedIdea } from "../src/testing/index.js";
import type { LedgerEvent } from "../src/ledger/index.js";

const ASOF = new Date(T0 + 1_000_000_000);

function report(events: LedgerEvent[], minCompletedIdeas = 1): FlowReport {
  return buildReport(events, { asOf: ASOF, minCompletedIdeas });
}

function stage(r: FlowReport, name: string) {
  const found = r.stages.find((s) => s.stage === name);
  if (found === undefined) {
    throw new Error(`no stage ${name}`);
  }
  return found;
}

describe("flow report bottleneck", () => {
  it("names the stage with the largest share of waiting, a person's approval included", () => {
    const events = [
      ...finishedIdea(1, { approval: 3000 }),
      ...finishedIdea(2, { approval: 1000 }, 10_000),
      ...finishedIdea(3, { approval: 2000 }, 20_000),
    ];
    const r = report(events, 3);
    expect(r.ideas.completed).toBe(3);
    expect(r.bottleneck).toMatchObject({ stage: "await approval" });
    const waiting = r.stages.reduce((sum, s) => sum + s.waitingSeconds, 0);
    expect(r.bottleneck?.share).toBeCloseTo(
      stage(r, "await approval").waitingSeconds / waiting,
      3,
    );
    expect(r.bottleneck?.share).toBeGreaterThan(0.5);
    expect(r.bottleneckNote).toBeNull();
  });

  it("names merge when pull requests wait longer than approvals", () => {
    const events = [
      ...finishedIdea(1, { approval: 10, merge: 5000 }),
      ...finishedIdea(2, { approval: 10, merge: 4000 }, 10_000),
    ];
    expect(report(events, 2).bottleneck?.stage).toBe("merge");
  });

  it("counts a pane waiting on a person as waiting time that can be the bottleneck", () => {
    const pane = "s-writer";
    const r = report(
      [
        at(0, "pane.spawned", { pane, idea: "#1" }),
        at(5, "pane.waiting", { pane, idea: "#1" }),
        at(905, "pane.closed", { pane, idea: "#1" }),
        at(906, "issue.closed", { number: 1 }),
      ],
      1,
    );
    expect(r.bottleneck).toMatchObject({ stage: "write", share: 1 });
  });
});

describe("flow report bottleneck ties and gaps", () => {
  it("names the earlier stage on an exact tie, summing whole milliseconds", () => {
    const r = report(
      [
        at(0, "issue.opened", { number: 1 }),
        at(0.3, "issue.labelled", { number: 1, label: "ready-for-agent" }),
        at(0, "pr.opened", { number: 5, idea: "#2" }),
        at(0.1, "pr.merged", { number: 5, idea: "#2" }),
        at(0, "pr.opened", { number: 6, idea: "#3" }),
        at(0.2, "pr.merged", { number: 6, idea: "#3" }),
        at(1, "issue.closed", { number: 1 }),
      ],
      1,
    );
    expect(stage(r, "merge").waitingSeconds).toBe(0.3);
    expect(r.bottleneck?.stage).toBe("await approval");
  });

  it("names no bottleneck below the minimum number of completed ideas", () => {
    const r = report(
      [
        ...finishedIdea(1, { approval: 3000 }),
        ...finishedIdea(2, { approval: 1000 }, 10_000),
      ],
      3,
    );
    expect(r.bottleneck).toBeNull();
    expect(r.bottleneckNote).toBe(
      "Not enough data: 2 of 3 completed ideas needed to name a bottleneck.",
    );
  });

  it("invents no bottleneck from an empty ledger", () => {
    const r = report([], 3);
    expect(r.bottleneck).toBeNull();
    expect(r.bottleneckNote).toContain("0 of 3");
  });

  it("names no bottleneck when no waiting time was recorded", () => {
    const r = report([at(0, "issue.closed", { number: 1 })], 1);
    expect(r.bottleneck).toBeNull();
    expect(r.bottleneckNote).toBe(
      "No waiting time recorded, so there is no bottleneck.",
    );
  });
});
