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
    expect(toil(events, "write")).toEqual({
      startingSeconds: 4,
      stoppingSeconds: 35,
      waitingSeconds: 30,
      retryingSeconds: 3,
    });
    expect(toil(events, "judge")).toEqual(ZERO);
  });
});
