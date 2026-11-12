import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "./report.js";
import { T0, at, finishedIdea } from "./flow-support.js";
import type { LedgerEvent } from "../ledger/index.js";

const ASOF = new Date(T0 + 1_000_000_000);
const secs = (n: number) => new Date(T0 + n * 1000);

interface Scope {
  since?: number;
  until?: number;
  ideas?: string[];
}

function report(events: LedgerEvent[], scope: Scope = {}): FlowReport {
  return buildReport(events, {
    asOf: ASOF,
    minCompletedIdeas: 1,
    ...(scope.since === undefined ? {} : { since: secs(scope.since) }),
    ...(scope.until === undefined ? {} : { until: secs(scope.until) }),
    ...(scope.ideas === undefined ? {} : { ideas: scope.ideas }),
  });
}

function stage(r: FlowReport, name: string) {
  const found = r.stages.find((s) => s.stage === name);
  if (found === undefined) {
    throw new Error(`no stage ${name}`);
  }
  return found;
}

// Idea 1 opens at 0, is approved at 100, merges at 120 and closes at 121.
// Idea 2 does the same shifted 1000 seconds later.
const TWO = [
  ...finishedIdea(1, { approval: 100 }),
  ...finishedIdea(2, { approval: 100 }, 1000),
];

describe("flow report scope", () => {
  it("states an unbounded range and no idea filter when none is given", () => {
    expect(report(TWO).scope).toEqual({
      since: null,
      until: null,
      ideas: null,
    });
  });

  it("states the range and ideas it covers", () => {
    expect(
      report(TWO, { since: 10, until: 500, ideas: ["#2", "#1"] }).scope,
    ).toEqual({
      since: secs(10).toISOString(),
      until: secs(500).toISOString(),
      ideas: ["#1", "#2"],
    });
  });
});

describe("flow report idea filter", () => {
  it("covers only the named ideas", () => {
    const r = report(TWO, { ideas: ["#2"] });
    expect(r.ideas).toEqual({ total: 1, completed: 1 });
    expect(r.leadTime.ideas.map((i) => i.idea)).toEqual(["#2"]);
    expect(stage(r, "await approval").waitingSeconds).toBe(100);
  });

  it("leaves other ideas' events out of the unmapped count", () => {
    const r = report([...TWO, at(5, "tool.start", { session: "x" })], {
      ideas: ["#1"],
    });
    expect(r.unmappedEvents).toBe(0);
  });

  it("covers nothing for an idea the ledger does not know", () => {
    const r = report(TWO, { ideas: ["#99"] });
    expect(r.ideas).toEqual({ total: 0, completed: 0 });
    expect(stage(r, "await approval").waitingSeconds).toBe(0);
  });
});

describe("flow report time range", () => {
  it("clips a waiting interval at both range edges", () => {
    const r = report(finishedIdea(1, { approval: 100 }), {
      since: 20,
      until: 70,
    });
    expect(stage(r, "await approval").waitingSeconds).toBe(50);
  });

  it("clips a waiting interval that runs on past the range to the range end", () => {
    const r = report([at(0, "issue.opened", { number: 1 })], {
      since: 10,
      until: 40,
    });
    expect(stage(r, "await approval").waitingSeconds).toBe(30);
  });

  it("clips a pane's active time and counts only the events inside the range", () => {
    const pane = "x-writer";
    const r = report(
      [
        at(0, "pane.spawned", { pane, idea: "#1" }),
        at(30, "pane.busy", { pane, idea: "#1" }),
        at(100, "pane.closed", { pane, idea: "#1" }),
      ],
      { since: 20, until: 60 },
    );
    expect(stage(r, "write")).toMatchObject({ activeSeconds: 40, events: 1 });
  });
});

describe("flow report time range toil and ideas", () => {
  it("clips toil at the range edge", () => {
    const pane = "x-writer";
    const events = [
      at(0, "pane.spawned", { pane, idea: "#1" }),
      at(100, "tool.start", { pane, idea: "#1", tool: "Bash" }),
      at(110, "pane.closed", { pane, idea: "#1" }),
    ];
    expect(stage(report(events), "write").toil.startingSeconds).toBe(100);
    expect(
      stage(report(events, { since: 60, until: 200 }), "write").toil
        .startingSeconds,
    ).toBe(40);
  });

  it("leaves out an idea whose events all fall outside the range", () => {
    const r = report(TWO, { since: 500, until: 900 });
    expect(r.ideas).toEqual({ total: 0, completed: 0 });
  });

  it("keeps an idea that straddles the range with no event inside it", () => {
    const r = report(finishedIdea(1, { approval: 100 }), {
      since: 20,
      until: 70,
    });
    expect(r.ideas.total).toBe(1);
  });

  it("completes and times only ideas whose outcome is inside the range", () => {
    const r = report(TWO, { since: 900, until: 5000 });
    expect(r.ideas).toEqual({ total: 1, completed: 1 });
    expect(r.leadTime.ideas).toEqual([{ idea: "#2", seconds: 121 }]);
    const early = report(TWO, { until: 500 });
    expect(early.ideas).toEqual({ total: 1, completed: 1 });
    expect(early.leadTime.ideas.map((i) => i.idea)).toEqual(["#1"]);
  });

  it("counts an idea open at the range end as not completed", () => {
    const r = report(finishedIdea(1, { approval: 100 }), { until: 110 });
    expect(r.ideas).toEqual({ total: 1, completed: 0 });
    expect(r.leadTime.medianSeconds).toBeNull();
  });

  it("measures work in progress over the range, not the whole ledger", () => {
    const pane = "x-writer";
    const events = [
      at(0, "pane.spawned", { pane, idea: "#1" }),
      at(100, "pane.closed", { pane, idea: "#1" }),
    ];
    expect(
      stage(report(events, { since: 0, until: 200 }), "write").wip,
    ).toEqual({ peak: 1, average: 0.5 });
  });

  it("does not cover an idea that first appears exactly at the range end", () => {
    const r = report([at(10, "issue.opened", { number: 1 })], {
      since: 0,
      until: 10,
    });
    expect(r.ideas.total).toBe(0);
  });

  it("counts an event at the range start but not one at the range end", () => {
    const events = [
      at(10, "issue.opened", { number: 1 }),
      at(20, "issue.labelled", { number: 1, label: "ready-for-agent" }),
    ];
    const r = report(events, { since: 10, until: 20 });
    expect(stage(r, "await approval").events).toBe(1);
  });
});

describe("flow report range and ideas together", () => {
  it("applies both: the named ideas, clipped to the range", () => {
    const r = report(TWO, { since: 1020, until: 1070, ideas: ["#2"] });
    expect(r.ideas).toEqual({ total: 1, completed: 0 });
    expect(stage(r, "await approval").waitingSeconds).toBe(50);
  });

  it("two ranges compare field by field with the same shape", () => {
    const first = report(TWO, { until: 500 });
    const second = report(TWO, { since: 500 });
    expect(Object.keys(first)).toEqual(Object.keys(second));
    expect(first.stages.map((s) => s.stage)).toEqual(
      second.stages.map((s) => s.stage),
    );
    expect(first.leadTime.ideas[0]?.idea).toBe("#1");
    expect(second.leadTime.ideas[0]?.idea).toBe("#2");
  });
});
