import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { agentRowsIn, rowOf } from "./cost-waiting-agents.js";
import {
  sessionsInWindow,
  type SessionWindow,
} from "./cost-waiting-support.js";
import { secondsBySession } from "./cost-waiting-time.js";

vi.mock("./cost-waiting-support.js", () => ({
  sessionsInWindow: vi.fn(),
  summaryOf: (values: number[]) => ({
    total: values.reduce((sum, v) => sum + v, 0),
    median: null,
    p90: null,
  }),
}));
vi.mock("./cost-waiting-time.js", () => ({ secondsBySession: vi.fn() }));

const WINDOW: [number, number] = [0, 1];
const OPTIONS = { prices: {}, minimum: 2 };

const session = (
  key: string,
  over: Partial<SessionWindow> = {},
): SessionWindow => ({
  key,
  named: true,
  tokens: 10,
  dollars: 1,
  plan: 10,
  unpriced: [],
  ...over,
});

describe("agent rows: which role a session belongs to", () => {
  it("reads the role from the last dash-separated word its name carries", () => {
    expect(rowOf(session("idea-7-writer"))).toBe("writer");
    expect(rowOf(session("pr100-reviewer"))).toBe("reviewer");
    expect(rowOf(session("idea-7-judgment-r1"))).toBe("judgment");
  });

  it("names a session with no role as the main session when no agent names it, and as other when one does", () => {
    expect(rowOf(session("9f2c", { named: false }))).toBe("orchestrate");
    expect(rowOf(session("tracker", { named: true }))).toBe("other");
  });
});

describe("agent rows: each role's measured figures over the window", () => {
  beforeEach(() => {
    vi.mocked(secondsBySession).mockReturnValue(
      new Map([
        ["idea-1-writer", { active: 300, waiting: 60 }],
        ["idea-2-writer", { active: 500, waiting: 0 }],
      ]),
    );
  });

  it("measures a role with enough sessions: dollars, tokens and seconds", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([
      session("idea-1-writer", { dollars: 1, tokens: 10, plan: 10 }),
      session("idea-2-writer", { dollars: 3, tokens: 30, plan: 30 }),
    ]);

    const rows = agentRowsIn([] as LedgerEvent[], WINDOW, OPTIONS);

    expect(rows.writer).toEqual({
      status: "measured",
      sessions: 2,
      dollars: { total: 4, median: null, p90: null },
      tokens: { total: 40, median: null, p90: null },
      activeSeconds: { total: 800, median: null, p90: null },
      waitingSeconds: { total: 60, median: null, p90: null },
    });
  });

  it("reads a role with fewer sessions than the minimum as insufficient, with its count", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([session("idea-1-judge")]);

    expect(agentRowsIn([] as LedgerEvent[], WINDOW, OPTIONS).judge).toEqual({
      status: "insufficient",
      sessions: 1,
      needed: 2,
    });
  });

  it("reads a role with a session on an unpriced model as insufficient prices, naming the models", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([
      session("idea-1-reader", { unpriced: ["zeta", "alpha"] }),
    ]);

    expect(agentRowsIn([] as LedgerEvent[], WINDOW, OPTIONS).reader).toEqual({
      status: "insufficient prices",
      models: ["alpha", "zeta"],
    });
  });

  it("reads a role with no session as insufficient with zero sessions, never as a measured zero", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([]);

    expect(agentRowsIn([] as LedgerEvent[], WINDOW, OPTIONS).verifier).toEqual({
      status: "insufficient",
      sessions: 0,
      needed: 2,
    });
  });
});
