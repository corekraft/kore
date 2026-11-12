import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "./report.js";
import { T0, at } from "./flow-support.js";
import type { LedgerEvent } from "../ledger/index.js";

const ASOF = new Date(T0 + 1_000_000);

function report(events: LedgerEvent[]): FlowReport {
  return buildReport(events, { asOf: ASOF, minCompletedIdeas: 1 });
}

function wip(events: LedgerEvent[], name: string) {
  const found = report(events).stages.find((s) => s.stage === name);
  if (found === undefined) {
    throw new Error(`no stage ${name}`);
  }
  return found.wip;
}

/** A writer pane for idea `n`, alive from `from` to `to` seconds. */
const writer = (n: number, from: number, to: number) => [
  at(from, "pane.spawned", { pane: `w${n}-writer`, idea: `#${n}` }),
  at(to, "pane.closed", { pane: `w${n}-writer`, idea: `#${n}` }),
];

describe("flow report work in progress per stage", () => {
  it("is zero for a stage no idea entered", () => {
    expect(wip([], "write")).toEqual({ peak: 0, average: 0 });
  });

  it("counts one idea as 1 at peak and by the share of the range it was open", () => {
    const events = [...writer(1, 0, 50), ...writer(2, 100, 200)];
    expect(wip(events, "write")).toEqual({ peak: 1, average: 0.75 });
  });

  it("finds the peak and the time-weighted average of overlapping ideas", () => {
    const events = [...writer(1, 0, 100), ...writer(2, 50, 150)];
    expect(wip(events, "write")).toEqual({ peak: 2, average: 1.3333 });
  });

  it("does not count two ideas as overlapping when one closes as the next opens", () => {
    const events = [...writer(1, 0, 100), ...writer(2, 100, 200)];
    expect(wip(events, "write")).toEqual({ peak: 1, average: 1 });
  });

  it("counts an idea once in a stage however many panes it ran there", () => {
    const events = [
      ...writer(1, 0, 100),
      at(20, "pane.spawned", { pane: "x1-writer", idea: "#1" }),
      at(80, "pane.closed", { pane: "x1-writer", idea: "#1" }),
    ];
    expect(wip(events, "write")).toEqual({ peak: 1, average: 1 });
  });

  it("measures every stage over the same range, the whole report's", () => {
    const events = [
      ...writer(1, 0, 100),
      at(0, "pane.spawned", { pane: "w1-judge", idea: "#1" }),
      at(50, "pane.closed", { pane: "w1-judge", idea: "#1" }),
    ];
    expect(wip(events, "judge")).toEqual({ peak: 1, average: 0.5 });
  });

  it("counts an unapproved issue in await approval up to the report time", () => {
    const events = [at(0, "issue.opened", { number: 1 })];
    expect(wip(events, "await approval")).toEqual({ peak: 1, average: 1 });
  });
});

describe("flow report lead time", () => {
  const closed = (n: number, opened: number, end: number) => [
    at(opened, "issue.opened", { number: n }),
    at(opened + 1, "issue.labelled", { number: n, label: "ready-for-agent" }),
    at(end, "issue.closed", { number: n }),
  ];

  it("is empty, with no median or maximum, when no idea has an outcome", () => {
    expect(report([at(0, "issue.opened", { number: 1 })]).leadTime).toEqual({
      ideas: [],
      medianSeconds: null,
      maxSeconds: null,
    });
  });

  it("measures each idea from its first event to its outcome event", () => {
    const events = [...closed(1, 0, 100), ...closed(2, 10, 310)];
    expect(report(events).leadTime).toEqual({
      ideas: [
        { idea: "#1", seconds: 100 },
        { idea: "#2", seconds: 300 },
      ],
      medianSeconds: 200,
      maxSeconds: 300,
    });
  });

  it("takes the middle idea as the median of an odd count", () => {
    const events = [
      ...closed(1, 0, 10),
      ...closed(2, 0, 500),
      ...closed(3, 0, 40),
    ];
    const { medianSeconds, maxSeconds } = report(events).leadTime;
    expect([medianSeconds, maxSeconds]).toEqual([40, 500]);
  });

  it("starts at an idea's earliest event, even one before its issue opened", () => {
    const events = [
      at(0, "pane.spawned", { pane: "w1-refiner", idea: "#1" }),
      ...closed(1, 30, 100),
    ];
    expect(report(events).leadTime.ideas).toEqual([
      { idea: "#1", seconds: 100 },
    ]);
  });

  it("leaves out ideas without an outcome", () => {
    const events = [...closed(1, 0, 100), at(5, "issue.opened", { number: 2 })];
    expect(report(events).leadTime.ideas).toEqual([
      { idea: "#1", seconds: 100 },
    ]);
  });
});
