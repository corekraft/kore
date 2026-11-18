import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { rowOf } from "./cost-waiting-agents.js";
import { assumedPartIn } from "./cost-waiting-shares-assumed.js";
import { levelOf, readingOf } from "./cost-waiting-shares.js";
import { agentSharesIn } from "./cost-waiting-shares-agents.js";
import {
  sessionsInWindow,
  type SessionWindow,
} from "./cost-waiting-support.js";

// Everything outside the unit is mocked: the sessions of the week, the row a session belongs to,
// the main session's assumed part, and the share arithmetic.
vi.mock("./cost-waiting-support.js", () => ({ sessionsInWindow: vi.fn() }));
vi.mock("./cost-waiting-agents.js", () => ({ rowOf: vi.fn() }));
vi.mock("./cost-waiting-shares-assumed.js", () => ({ assumedPartIn: vi.fn() }));
vi.mock("./cost-waiting-shares.js", () => ({
  readingOf: vi.fn(),
  levelOf: vi.fn(),
}));

const WEEK: [number, number] = [0, 7];
const TABLE = { "table-model": {} } as never;
const OPTIONS = { prices: TABLE, minimum: 2, weeklyTokenCeiling: 100 };
const EVENTS = [] as LedgerEvent[];

const session = (
  key: string,
  plan: number,
  over: Partial<SessionWindow> = {},
): SessionWindow => ({
  key,
  named: true,
  tokens: 0,
  dollars: 0,
  plan,
  unpriced: [],
  ...over,
});

beforeEach(() => {
  vi.mocked(assumedPartIn).mockReturnValue(undefined);
  // A role is the word before "-" in the fake key, "main" being the main session.
  vi.mocked(rowOf).mockImplementation((s) =>
    s.key.startsWith("main") ? "orchestrate" : (s.key.split("-")[1] as "judge"),
  );
  vi.mocked(readingOf).mockImplementation((label, unit, { ceiling }) => ({
    label,
    status: "measured",
    share: ceiling === undefined ? "not set" : unit.plan / ceiling,
    ...(unit.basis === undefined ? {} : { basis: unit.basis }),
  }));
  vi.mocked(levelOf).mockImplementation((label, units, { minimum }) => ({
    label,
    status: "measured",
    units: units.length,
    needed: minimum,
    total: units.reduce((sum, u) => sum + u.plan, 0) / 100,
    median: null,
    p90: null,
  }));
});

describe("agent shares: a role's plan-weighted tokens in the trailing week over the ceiling", () => {
  it("reads two roles as a rate under the weekly label, each from its sessions in the week", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([
      session("i1-judge", 10),
      session("i2-judge", 20),
      session("i1-reviewer", 6),
      session("i2-reviewer", 4),
    ]);
    vi.mocked(rowOf).mockImplementation((s) =>
      s.key.endsWith("judge") ? "judge" : "reviewer",
    );

    const shares = agentSharesIn(EVENTS, WEEK, OPTIONS);

    expect(sessionsInWindow).toHaveBeenCalledWith(EVENTS, WEEK, TABLE);
    expect(shares.rows.judge).toEqual({
      label: "of the weekly ceiling",
      status: "measured",
      share: 0.3,
    });
    expect(shares.rows.reviewer).toEqual({
      label: "of the weekly ceiling",
      status: "measured",
      share: 0.1,
    });
    expect(shares.days).toBe(7);
  });

  it("sums only the measured rows into the level, at a minimum of one row", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([
      session("i1-judge", 10),
      session("i2-judge", 20),
      session("i1-reviewer", 6),
    ]);
    vi.mocked(rowOf).mockImplementation((s) =>
      s.key.endsWith("judge") ? "judge" : "reviewer",
    );

    const shares = agentSharesIn(EVENTS, WEEK, OPTIONS);

    expect(levelOf).toHaveBeenCalledWith(
      "of the weekly ceiling",
      [{ plan: 30, unweighted: [] }],
      { ceiling: 100, minimum: 1 },
    );
    expect(shares).toMatchObject({ total: 0.3 });
    expect(shares.rows.reviewer).toEqual({
      label: "of the weekly ceiling",
      status: "insufficient",
      units: 1,
      needed: 2,
    });
  });
});

describe("agent shares: a thin week or an unweighted model is never a zero", () => {
  it("reads a role with no session in the week as insufficient, never zero", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([]);

    const shares = agentSharesIn(EVENTS, WEEK, OPTIONS);

    expect(shares.rows.writer).toEqual({
      label: "of the weekly ceiling",
      status: "insufficient",
      units: 0,
      needed: 2,
    });
  });

  it("names the models a role's sessions ran on that the plan does not weight, and prints no share for it", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([
      session("i1-judge", 10, { unpriced: ["mystery"] }),
      session("i2-judge", 20),
    ]);

    agentSharesIn(EVENTS, WEEK, OPTIONS);

    expect(readingOf).toHaveBeenCalledWith(
      "of the weekly ceiling",
      { plan: 30, unweighted: ["mystery"] },
      { ceiling: 100 },
    );
    expect(levelOf).toHaveBeenCalledWith(
      "of the weekly ceiling",
      [{ plan: 30, unweighted: ["mystery"] }],
      { ceiling: 100, minimum: 1 },
    );
  });

  it("passes no ceiling through when the config names none, so every share reads not set", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([
      session("i1-judge", 10),
      session("i2-judge", 20),
    ]);

    const shares = agentSharesIn(EVENTS, WEEK, {
      ...OPTIONS,
      weeklyTokenCeiling: undefined,
    });

    expect(shares.rows.judge).toEqual({
      label: "of the weekly ceiling",
      status: "measured",
      share: "not set",
    });
  });
});

describe("agent shares: the main-session row says assumed model until its model is recorded", () => {
  it("adds the token totals priced at the assumed model, counts their sessions, and labels the row", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([]);
    vi.mocked(assumedPartIn).mockReturnValue({
      sessions: 2,
      plan: 40,
      unweighted: [],
    });

    const shares = agentSharesIn(EVENTS, WEEK, OPTIONS);

    expect(assumedPartIn).toHaveBeenCalledWith(EVENTS, WEEK);
    expect(shares.rows.orchestrate).toEqual({
      label: "of the weekly ceiling",
      status: "measured",
      share: 0.4,
      basis: "assumed model",
    });
  });

  it("labels a row with both a recorded model and assumed totals as recorded and assumed model", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([
      session("main-a", 10, { named: false }),
    ]);
    vi.mocked(assumedPartIn).mockReturnValue({
      sessions: 1,
      plan: 30,
      unweighted: [],
    });

    const shares = agentSharesIn(EVENTS, WEEK, OPTIONS);

    expect(shares.rows.orchestrate).toEqual({
      label: "of the weekly ceiling",
      status: "measured",
      share: 0.4,
      basis: "recorded and assumed model",
    });
  });

  it("names the assumed model when the plan does not weight it, never reading its tokens as zero", () => {
    vi.mocked(sessionsInWindow).mockReturnValue([]);
    vi.mocked(assumedPartIn).mockReturnValue({
      sessions: 2,
      plan: 0,
      unweighted: ["claude-opus-5-5"],
    });

    agentSharesIn(EVENTS, WEEK, OPTIONS);

    expect(readingOf).toHaveBeenCalledWith(
      "of the weekly ceiling",
      expect.objectContaining({ unweighted: ["claude-opus-5-5"] }),
      { ceiling: 100 },
    );
  });
});
