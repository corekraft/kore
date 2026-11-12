import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "./report.js";
import { T0, at } from "./flow-support.js";
import type { LedgerEvent } from "../ledger/index.js";

function toil(events: LedgerEvent[], name: string) {
  const r: FlowReport = buildReport(events, {
    asOf: new Date(T0 + 1_000_000),
    minCompletedIdeas: 1,
  });
  const found = r.stages.find((s) => s.stage === name);
  if (found === undefined) {
    throw new Error(`no stage ${name}`);
  }
  return found.toil;
}

const ZERO = {
  startingSeconds: 0,
  stoppingSeconds: 0,
  waitingSeconds: 0,
  retryingSeconds: 0,
};
const pane = "idea-writer";
const own = { pane, idea: "#1" };

describe("flow report toil per stage", () => {
  it("is zero in every kind for a stage with no events", () => {
    expect(toil([], "write")).toEqual(ZERO);
  });

  it("counts starting as session start to the first tool", () => {
    const events = [
      at(0, "pane.spawned", own),
      at(12, "tool.start", { ...own, tool: "Read" }),
      at(20, "tool.end", { ...own, tool: "Read", outcome: "success" }),
      at(30, "tool.start", { ...own, tool: "Bash" }),
    ];
    expect(toil(events, "write")).toEqual({ ...ZERO, startingSeconds: 12 });
  });

  it("counts stopping as the last tool to close", () => {
    const events = [
      at(0, "pane.spawned", own),
      at(5, "tool.start", { ...own, tool: "Read" }),
      at(20, "tool.end", { ...own, tool: "Read", outcome: "success" }),
      at(50, "pane.closed", own),
    ];
    expect(toil(events, "write")).toEqual({
      ...ZERO,
      startingSeconds: 5,
      stoppingSeconds: 30,
    });
  });

  it("counts waiting as time a pane waits on a person", () => {
    const events = [
      at(0, "pane.busy", own),
      at(10, "pane.waiting", own),
      at(70, "pane.busy", own),
    ];
    expect(toil(events, "write")).toEqual({ ...ZERO, waitingSeconds: 60 });
  });

  it("counts retrying as a failed tool end to the next start of the same tool", () => {
    const events = [
      at(0, "pane.busy", own),
      at(1, "tool.start", { ...own, tool: "Bash" }),
      at(5, "tool.end", { ...own, tool: "Bash", outcome: "failure" }),
      at(15, "tool.start", { ...own, tool: "Bash" }),
      at(16, "tool.end", { ...own, tool: "Bash", outcome: "success" }),
    ];
    expect(toil(events, "write").retryingSeconds).toBe(10);
  });
});

describe("flow report toil kinds do not overlap", () => {
  it("does not count time a pane waited on a person as starting or retrying", () => {
    const events = [
      at(0, "pane.spawned", own),
      at(2, "pane.waiting", own),
      at(12, "pane.busy", own),
      at(14, "tool.start", { ...own, tool: "Bash" }),
      at(15, "tool.end", { ...own, tool: "Bash", outcome: "failure" }),
      at(16, "pane.waiting", own),
      at(26, "pane.busy", own),
      at(30, "tool.start", { ...own, tool: "Bash" }),
    ];
    expect(toil(events, "write")).toEqual({
      ...ZERO,
      startingSeconds: 4,
      waitingSeconds: 20,
      retryingSeconds: 5,
    });
  });

  it("counts no starting for a life that began at a pane going busy", () => {
    const events = [
      at(0, "pane.busy", own),
      at(9, "tool.start", { ...own, tool: "Read" }),
    ];
    expect(toil(events, "write").startingSeconds).toBe(0);
  });
});

describe("flow report toil edge cases", () => {
  it("counts starting to a first tool event even when it is a tool end", () => {
    const events = [
      at(0, "pane.spawned", own),
      at(7, "tool.end", { ...own, tool: "Read", outcome: "success" }),
    ];
    expect(toil(events, "write").startingSeconds).toBe(7);
  });

  it("does not count a retry after a success or after a different tool", () => {
    const events = [
      at(0, "pane.busy", own),
      at(1, "tool.start", { ...own, tool: "Bash" }),
      at(5, "tool.end", { ...own, tool: "Bash", outcome: "success" }),
      at(15, "tool.start", { ...own, tool: "Bash" }),
      at(16, "tool.end", { ...own, tool: "Bash", outcome: "failure" }),
      at(30, "tool.start", { ...own, tool: "Read" }),
    ];
    expect(toil(events, "write").retryingSeconds).toBe(0);
  });

  it("does not carry a failure across a close into the next life", () => {
    const events = [
      at(0, "pane.spawned", own),
      at(1, "tool.start", { ...own, tool: "Bash" }),
      at(2, "tool.end", { ...own, tool: "Bash", outcome: "failure" }),
      at(3, "pane.closed", own),
      at(100, "pane.spawned", own),
      at(110, "tool.start", { ...own, tool: "Bash" }),
    ];
    expect(toil(events, "write").retryingSeconds).toBe(0);
  });

  it("reports every kind together under its own stage only", () => {
    const events = [
      at(0, "pane.spawned", own),
      at(4, "tool.start", { ...own, tool: "Bash" }),
      at(6, "tool.end", { ...own, tool: "Bash", outcome: "failure" }),
      at(9, "tool.start", { ...own, tool: "Bash" }),
      at(10, "tool.end", { ...own, tool: "Bash", outcome: "success" }),
      at(10, "pane.waiting", own),
      at(40, "pane.busy", own),
      at(45, "pane.closed", own),
    ];
    const combined = toil(events, "write");
    // The 30s wait sits inside the last-tool-to-close gap, so stopping keeps only 5s.
    expect(combined).toEqual({
      startingSeconds: 4,
      stoppingSeconds: 5,
      waitingSeconds: 30,
      retryingSeconds: 3,
    });
    expect(Object.values(combined).reduce((a, b) => a + b, 0)).toBeLessThan(45);
    expect(toil(events, "judge")).toEqual(ZERO);
  });
});

function stageOf(r: FlowReport, name: string) {
  return r.stages.find((s) => s.stage === name) as FlowReport["stages"][number];
}

describe("flow report reused panes", () => {
  it("measures each spawn-to-close life of a reused pane, not the gap between them", () => {
    const judge = "idea-judge";
    const o = { pane: judge, idea: "#1" };
    const r = buildReport(
      [
        at(0, "pane.spawned", o),
        at(2, "tool.start", { ...o, tool: "Read" }),
        at(4, "tool.end", { ...o, tool: "Read", outcome: "success" }),
        at(10, "pane.closed", o),
        at(100, "pane.spawned", o),
        at(103, "tool.start", { ...o, tool: "Read" }),
        at(104, "tool.end", { ...o, tool: "Read", outcome: "success" }),
        at(130, "pane.closed", o),
        at(0, "pr.opened", { number: 5, idea: "#1" }),
        at(200, "pr.merged", { number: 5, idea: "#1" }),
      ],
      { asOf: new Date(T0 + 1_000_000), minCompletedIdeas: 1 },
    );
    // Each life is charged on its own: starting 2s and 3s, stopping 6s and 26s, never the gap.
    expect(stageOf(r, "judge").toil).toEqual({
      startingSeconds: 5,
      stoppingSeconds: 32,
      waitingSeconds: 0,
      retryingSeconds: 0,
    });
    expect(stageOf(r, "judge").activeSeconds).toBe(40);
    // Only the two lives, 10s and 30s, are carved out of the 200s PR wait.
    expect(stageOf(r, "merge").waitingSeconds).toBe(160);
  });
});
