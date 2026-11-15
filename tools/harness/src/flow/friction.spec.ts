import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { closedIdeas, trailingMetric } from "./cost.js";
import { time } from "./github-waits.js";
import { friction, reworkMetrics } from "./friction.js";
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
    source: "claude",
    kind: kind as Kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...fields,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(time).mockImplementation((e) => Date.parse(e.occurredAt));
  vi.mocked(inWindow).mockImplementation((w, t) => t >= w[0] && t < w[1]);
  vi.mocked(trailingMetric).mockReturnValue({
    status: "insufficient history",
    closedIdeas: 0,
    needed: 6,
  });
});

describe("friction", () => {
  it("is zero events and no sources for an empty ledger, without failing", () => {
    expect(friction([], WINDOW)).toEqual({
      total: 0,
      sources: [],
      unknownKinds: 0,
    });
  });

  it("names a hook block and an audit warning by the rule that fired", () => {
    const r = friction(
      [
        event("guard.block", { label: "destructive" }),
        event("guard.block", { label: "destructive" }),
        event("guard.audit", { label: "append-only" }),
      ],
      WINDOW,
    );
    expect(r).toEqual({
      total: 3,
      sources: [
        { kind: "hook rule", source: "destructive", events: 2 },
        { kind: "hook rule", source: "append-only", events: 1 },
      ],
      unknownKinds: 0,
    });
  });

  it("counts a failed and retried kore command once per retry, named by command", () => {
    const r = friction(
      [
        event("kore.retry", { label: "local up" }),
        event("kore.retry", { label: "local up" }),
        event("kore.retry", { label: "policy test" }),
      ],
      WINDOW,
    );
    expect(r.sources).toEqual([
      { kind: "command", source: "local up", events: 2 },
      { kind: "command", source: "policy test", events: 1 },
    ]);
    expect(r.total).toBe(3);
  });

  it("names an interrupted pane by its pane id", () => {
    const r = friction([event("pane.interrupted", { pane: "w1:p2" })], WINDOW);
    expect(r.sources).toEqual([{ kind: "pane", source: "w1:p2", events: 1 }]);
  });

  it("ignores unknown record kinds and counts them instead", () => {
    const r = friction(
      [event("from.the.future", { label: "x" }), event("tool.end")],
      WINDOW,
    );
    expect(r).toEqual({ total: 0, sources: [], unknownKinds: 1 });
  });

  it("leaves out friction recorded outside the range", () => {
    const r = friction(
      [event("guard.block", { label: "destructive" }, 5000)],
      WINDOW,
    );
    expect(r.total).toBe(0);
  });
});

describe("reworkMetrics", () => {
  it("hands each metric the per-idea counts of closed ideas to the trailing comparison", () => {
    vi.mocked(closedIdeas).mockReturnValue([
      {
        idea: "#1",
        at: 1,
        own: [
          event("escalation", { label: "blocked" }),
          event("send-back", { label: "r", number: 3 }),
          event("send-back", { label: "r", number: 3 }),
          event("challenge.round", { label: "r", number: 3 }),
          event("kore.retry", { label: "up" }),
          event("guard.block", { label: "x" }),
        ],
      },
      { idea: "#2", at: 2, own: [] },
    ]);
    const m = reworkMetrics(new Map(), WINDOW, 5);
    const values = (i: number) => vi.mocked(trailingMetric).mock.calls[i]?.[0];
    expect(values(0)).toEqual([
      { idea: "#1", value: 1 },
      { idea: "#2", value: 0 },
    ]);
    expect(values(1)).toEqual([
      { idea: "#1", value: 2 },
      { idea: "#2", value: 0 },
    ]);
    expect(values(2)).toEqual([
      { idea: "#1", value: 1 },
      { idea: "#2", value: 0 },
    ]);
    expect(values(3)).toEqual([
      { idea: "#1", value: 2 },
      { idea: "#2", value: 0 },
    ]);
    expect(m.trailingIdeas).toBe(5);
    expect(m.escalationsPerIdea).toEqual({
      status: "insufficient history",
      closedIdeas: 0,
      needed: 6,
    });
  });

  it("reports insufficient history, never zero, when no idea has closed", () => {
    vi.mocked(closedIdeas).mockReturnValue([]);
    reworkMetrics(new Map(), WINDOW, 5);
    expect(vi.mocked(trailingMetric).mock.calls[0]?.[0]).toEqual([]);
  });
});
