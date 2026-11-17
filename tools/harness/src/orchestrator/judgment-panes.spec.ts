import { describe, expect, it } from "vitest";
import {
  flowOf,
  isFinished,
  isOpen,
  judgmentName,
  readerName,
  retryName,
  type FlowPane,
} from "./judgment-panes.js";

const pane = (name: string, state: FlowPane["state"]): FlowPane => ({
  name,
  state,
});

describe("judgment pane names", () => {
  it("names each judgment, retry and reader pane with a letter before its ordinal, so session names are accepted", () => {
    expect(judgmentName("0007", 2)).toBe("idea-0007-judgment-r2");
    expect(retryName("0007", 3)).toBe("idea-0007-retry-r3");
    expect(readerName("0007", 2, 4)).toBe("idea-0007-read-r2-q4");
  });

  it("keeps every name within the 32 characters a Herdr session name allows", () => {
    expect(readerName("0007", 99, 99).length).toBeLessThanOrEqual(32);
    expect(retryName("0007", 99).length).toBeLessThanOrEqual(32);
  });
});

describe("pane states", () => {
  it("counts a running pane as not finished and a closed pane as not open", () => {
    expect(isFinished(pane("a", "running"))).toBe(false);
    expect(isFinished(pane("a", "closed"))).toBe(false);
    expect(isFinished(pane("a", "done"))).toBe(true);
    expect(isFinished(pane("a", "blocked"))).toBe(true);
    expect(isOpen(pane("a", "closed"))).toBe(false);
    expect(isOpen(pane("a", "done"))).toBe(true);
  });
});

describe("flowOf", () => {
  it("reads no flow and starts at ordinal 1 when the idea has no judgment pane", () => {
    expect(flowOf("0007", [pane("idea-0007-writer", "done")])).toEqual({
      decisions: [],
      rounds: [],
      readRounds: 0,
      refusals: 0,
      nextOrd: 1,
    });
  });

  it("orders the decisions by ordinal, counts each retry as one refusal and takes the next ordinal", () => {
    const flow = flowOf("0007", [
      pane("idea-0007-judgment-r2", "done"),
      pane("idea-0007-judgment-r1", "closed"),
      pane("idea-0007-retry-r3", "running"),
    ]);

    expect(flow.decisions).toEqual([
      { ord: 1, retry: false, pane: pane("idea-0007-judgment-r1", "closed") },
      { ord: 2, retry: false, pane: pane("idea-0007-judgment-r2", "done") },
      { ord: 3, retry: true, pane: pane("idea-0007-retry-r3", "running") },
    ]);
    expect(flow.refusals).toBe(1);
    expect(flow.nextOrd).toBe(4);
  });

  it("groups each reader under the decision that asked for it, in question order", () => {
    const flow = flowOf("0007", [
      pane("idea-0007-judgment-r1", "closed"),
      pane("idea-0007-read-r1-q2", "closed"),
      pane("idea-0007-read-r1-q1", "done"),
      pane("idea-0007-judgment-r2", "done"),
    ]);

    expect(flow.rounds).toEqual([
      {
        ord: 1,
        readers: [
          pane("idea-0007-read-r1-q1", "done"),
          pane("idea-0007-read-r1-q2", "closed"),
        ],
      },
    ]);
    expect(flow.readRounds).toBe(1);
    expect(flow.nextOrd).toBe(3);
  });

  it("ignores another idea's panes, the writer and judge panes, and any name it does not make", () => {
    const flow = flowOf("0007", [
      pane("idea-0008-judgment-r1", "done"),
      pane("idea-0007-judgment-r", "done"),
      pane("idea-0007-judgment-r1-x", "done"),
      pane("idea-0007-read-r1", "done"),
      pane("idea-0007-judge-abcdef1", "done"),
    ]);

    expect(flow.decisions).toEqual([]);
    expect(flow.rounds).toEqual([]);
    expect(flow.nextOrd).toBe(1);
  });
});
