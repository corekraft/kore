import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { ideaRowsIn } from "./cost-waiting-ideas.js";
import { cumulativeOf } from "./cost-waiting-support.js";

vi.mock("./cost-waiting-support.js", () => ({
  cumulativeOf: vi.fn(),
  round: (value: number) => Math.round(value * 10_000) / 10_000,
}));
vi.mock("./attribution.js", () => ({
  namedIdea: (event: LedgerEvent) =>
    event.kind === "pr.linked" && event.idea === "none"
      ? undefined
      : event.idea,
}));
vi.mock("./writer-link-ideas.js", () => ({
  ideaKey: (idea: string) => (/^[1-9]\d*$/.test(idea) ? `#${idea}` : idea),
}));
vi.mock("./writing-spend.js", () => ({
  NO_SPEND: { tokens: 0, dollars: 0, unpriced: [] },
  addSpend: (
    a: { tokens: number; dollars: number; unpriced: string[] },
    b: { tokens: number; dollars: number; unpriced: string[] },
  ) => ({
    tokens: a.tokens + b.tokens,
    dollars: a.dollars + b.dollars,
    unpriced: [...new Set([...a.unpriced, ...b.unpriced])].sort(),
  }),
}));
vi.mock("./github-waits.js", () => ({
  time: (event: LedgerEvent) => Date.parse(event.occurredAt),
  firstTime: (events: LedgerEvent[], match: (e: LedgerEvent) => boolean) =>
    events
      .filter(match)
      .map((e) => Date.parse(e.occurredAt))
      .sort((a, b) => a - b)[0],
}));

const MINUTE = 60_000;
const BASE = Date.parse("2026-11-18T10:00:00Z");
const at = (minute: number) => new Date(BASE + minute * MINUTE).toISOString();
const PRICES = {};
const OPTIONS = { prices: PRICES, minimum: 1 };

const event = (idea: string, kind: string, minute: number): LedgerEvent =>
  ({ kind, idea, occurredAt: at(minute) }) as LedgerEvent;

describe("idea rows: each idea's cost to the window's end and its outcome", () => {
  beforeEach(() => {
    vi.mocked(cumulativeOf).mockImplementation((own) => ({
      tokens: own.length * 1000,
      dollars: 2.5,
      unpriced: [],
    }));
  });

  it("lists each idea in numeric order with its dollars, tokens, lead time and closed outcome", () => {
    const events = [
      event("10", "session.launch", 2),
      event("7", "session.launch", 0),
      event("8", "token.split", 1),
      event("7", "issue.closed", 60),
    ];

    expect(ideaRowsIn(events, [BASE, BASE + 90 * MINUTE], OPTIONS)).toEqual([
      {
        idea: "7",
        dollars: 2.5,
        tokens: 2000,
        leadTimeSeconds: 3600,
        outcome: "closed",
      },
      {
        idea: "8",
        dollars: 2.5,
        tokens: 1000,
        leadTimeSeconds: null,
        outcome: null,
      },
      {
        idea: "10",
        dollars: 2.5,
        tokens: 1000,
        leadTimeSeconds: null,
        outcome: null,
      },
    ]);
  });

  it("leaves an outcome outside the window out: no outcome and no lead time", () => {
    const events = [
      event("7", "session.launch", 0),
      event("7", "issue.closed", 60),
    ];

    expect(ideaRowsIn(events, [BASE, BASE + 30 * MINUTE], OPTIONS)).toEqual([
      {
        idea: "7",
        dollars: 2.5,
        tokens: 2000,
        leadTimeSeconds: null,
        outcome: null,
      },
    ]);
  });

  it("reads each idea's cumulative cost to the window's end", () => {
    const events = [event("7", "session.launch", 0)];

    ideaRowsIn(events, [BASE, BASE + 30 * MINUTE], OPTIONS);

    expect(cumulativeOf).toHaveBeenCalledWith(
      events,
      BASE + 30 * MINUTE,
      PRICES,
    );
  });
});

describe("idea rows: an unpriced model", () => {
  it("reads an idea with an unpriced model as null dollars naming the models, keeping its raw tokens", () => {
    vi.mocked(cumulativeOf).mockReturnValue({
      tokens: 900,
      dollars: 1.5,
      unpriced: ["zeta"],
    });

    expect(
      ideaRowsIn(
        [event("7", "session.launch", 0)],
        [BASE, BASE + MINUTE],
        OPTIONS,
      ),
    ).toEqual([
      {
        idea: "7",
        dollars: null,
        unpricedModels: ["zeta"],
        tokens: 900,
        leadTimeSeconds: null,
        outcome: null,
      },
    ]);
  });
});

/** The writing join's spend by idea, as ideaRowsIn is given it. */
const writing = (
  entries: Record<
    string,
    { tokens: number; dollars: number; unpriced?: string[] }
  >,
) =>
  new Map(
    Object.entries(entries).map(([idea, spend]) => [
      idea,
      { unpriced: [], ...spend },
    ]),
  );

describe("idea rows: writing charged through the pull request's link (#1093)", () => {
  beforeEach(() => {
    vi.mocked(cumulativeOf).mockImplementation((own) => ({
      tokens: own.length * 1000,
      dollars: 2.5,
      unpriced: [],
    }));
  });

  it("adds a linked writer's tokens and dollars to the idea's stamped figure", () => {
    const rows = ideaRowsIn(
      [event("#7", "session.launch", 0)],
      [BASE, BASE + 30 * MINUTE],
      OPTIONS,
      writing({ "#7": { tokens: 200, dollars: 1 } }),
    );

    expect(rows).toEqual([
      expect.objectContaining({ idea: "#7", tokens: 1200, dollars: 3.5 }),
    ]);
  });

  it("gives an idea only a writer reaches a row of its own, with no outcome and no lead time", () => {
    const rows = ideaRowsIn(
      [],
      [BASE, BASE + 30 * MINUTE],
      OPTIONS,
      writing({ "#9": { tokens: 200, dollars: 1 } }),
    );

    expect(rows).toEqual([
      {
        idea: "#9",
        dollars: 1,
        tokens: 200,
        leadTimeSeconds: null,
        outcome: null,
      },
    ]);
    expect(cumulativeOf).not.toHaveBeenCalled();
  });

  it("joins a writer's #n idea to a stamp that names the same issue by its number, keeping the stamp's form", () => {
    const rows = ideaRowsIn(
      [event("7", "session.launch", 0)],
      [BASE, BASE + 30 * MINUTE],
      OPTIONS,
      writing({ "#7": { tokens: 200, dollars: 1 } }),
    );

    expect(rows.map((row) => row.idea)).toEqual(["7"]);
    expect(rows[0]?.tokens).toBe(1200);
  });
});

describe("idea rows: what writing does not make an idea (#1093)", () => {
  beforeEach(() => {
    vi.mocked(cumulativeOf).mockImplementation((own) => ({
      tokens: own.length * 1000,
      dollars: 2.5,
      unpriced: [],
    }));
  });

  it("makes no idea of none: a link that names none gets no row", () => {
    const link = {
      kind: "pr.linked",
      idea: "none",
      occurredAt: at(0),
    } as LedgerEvent;

    expect(ideaRowsIn([link], [BASE, BASE + MINUTE], OPTIONS)).toEqual([]);
  });

  it("reads an idea with an unpriced model in its writing as null dollars naming it, keeping the tokens", () => {
    const rows = ideaRowsIn(
      [],
      [BASE, BASE + MINUTE],
      OPTIONS,
      writing({ "#9": { tokens: 200, dollars: 1, unpriced: ["zeta"] } }),
    );

    expect(rows).toEqual([
      expect.objectContaining({
        idea: "#9",
        dollars: null,
        unpricedModels: ["zeta"],
        tokens: 200,
      }),
    ]);
  });

  it("leaves the stamped figure as it was when no writing is passed", () => {
    const rows = ideaRowsIn(
      [event("#7", "session.launch", 0)],
      [BASE, BASE + MINUTE],
      OPTIONS,
    );

    expect(rows).toEqual([
      expect.objectContaining({ idea: "#7", tokens: 1000, dollars: 2.5 }),
    ]);
  });
});
