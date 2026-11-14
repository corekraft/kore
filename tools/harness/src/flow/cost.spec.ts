import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { T0, at } from "./flow-support.js";
import { time } from "./github-waits.js";
import { DEFAULT_COST, costMetrics, type CostOptions } from "./cost.js";
import { inWindow, type Span } from "./scope.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: Span = [T0, T0 + 1_000_000];

beforeEach(() => {
  vi.mocked(time).mockImplementation((e: LedgerEvent) =>
    Date.parse(e.occurredAt),
  );
  vi.mocked(inWindow).mockImplementation(
    (window: Span, when: number) => when >= window[0] && when < window[1],
  );
});

/** One closed idea: `launches` sessions, and a token.usage per entry of `usage`, all on its session `s<n>`. */
function closed(
  n: number,
  closeAt: number,
  launches: number,
  usage: number[],
): LedgerEvent[] {
  const idea = `#${n}`;
  return [
    at(closeAt, "issue.closed", { number: n, idea }),
    ...Array.from({ length: launches }, (_, i) =>
      at(closeAt - 1, "session.launch", {
        session: `s${n}-${i}`,
        idea,
        role: "writer",
      }),
    ),
    ...usage.map((tokens, i) =>
      at(closeAt - 10 + i, "token.usage", {
        session: `s${n}`,
        idea,
        tokens,
      }),
    ),
  ];
}

/** Ledger events grouped by the idea each names, as costMetrics takes them. */
function byIdea(events: LedgerEvent[]): Map<string, LedgerEvent[]> {
  const groups = new Map<string, LedgerEvent[]>();
  for (const event of events) {
    const idea = event.idea ?? "";
    groups.set(idea, [...(groups.get(idea) ?? []), event]);
  }
  return groups;
}

const options = (trailingIdeas: number, maxIncrease = 0.25): CostOptions => ({
  ...DEFAULT_COST,
  trailingIdeas,
  tokensPerIdea: { maxIncrease },
  sessionsPerIdea: { maxIncrease },
});

describe("costMetrics comparison", () => {
  const events = [
    ...closed(1, 100, 1, [100, 300]),
    ...closed(2, 200, 2, [200]),
    ...closed(3, 300, 3, [100, 200, 600]),
  ];

  it("compares the latest closed idea with the mean of the N closed before it", () => {
    const metrics = costMetrics(byIdea(events), WINDOW, options(2));
    expect(metrics.trailingIdeas).toBe(2);
    expect(metrics.tokensPerIdea).toEqual({
      status: "ok",
      currentIdea: "#3",
      current: 600,
      trailingAverage: (300 + 200) / 2,
      maxIncrease: 0.25,
      worsened: true,
    });
    expect(metrics.sessionsPerIdea).toEqual({
      status: "ok",
      currentIdea: "#3",
      current: 3,
      trailingAverage: 1.5,
      maxIncrease: 0.25,
      worsened: true,
    });
  });

  it("averages only the N closed ideas just before the latest", () => {
    const metrics = costMetrics(byIdea(events), WINDOW, options(1));
    expect(metrics.sessionsPerIdea).toMatchObject({
      current: 3,
      trailingAverage: 2,
    });
  });

  it("is not worsened at exactly the threshold", () => {
    const flat = [
      ...closed(1, 100, 1, [100]),
      ...closed(2, 200, 1, [100]),
      ...closed(3, 300, 1, [200]),
    ];
    const metrics = costMetrics(byIdea(flat), WINDOW, options(2, 1));
    expect(metrics.tokensPerIdea).toMatchObject({
      current: 200,
      trailingAverage: 100,
      worsened: false,
    });
  });

  it("reports insufficient history without N closed ideas before the latest, never zero", () => {
    const metrics = costMetrics(byIdea(events), WINDOW, options(3));
    const expected = {
      status: "insufficient history",
      closedIdeas: 3,
      needed: 4,
    };
    expect(metrics.tokensPerIdea).toEqual(expected);
    expect(metrics.sessionsPerIdea).toEqual(expected);
  });
});

describe("costMetrics token counting", () => {
  it("counts a session's cumulative tokens once, using its latest usage by time", () => {
    const events = [
      at(100, "issue.closed", { idea: "#1" }),
      at(20, "token.usage", { session: "s1", idea: "#1", tokens: 400 }),
      at(5, "token.usage", { session: "s1", idea: "#1", tokens: 50 }),
      at(200, "issue.closed", { idea: "#2" }),
      at(150, "token.usage", { session: "s2", idea: "#2", tokens: 100 }),
    ];
    const metrics = costMetrics(byIdea(events), WINDOW, options(1));
    expect(metrics.tokensPerIdea).toMatchObject({
      current: 100,
      trailingAverage: 400,
    });
  });

  it("keys a session's tokens by its pane when it names no session", () => {
    const events = [
      at(10, "issue.closed", { idea: "#1" }),
      at(1, "token.usage", { pane: "p1", idea: "#1", tokens: 10 }),
      at(2, "token.usage", { pane: "p1", idea: "#1", tokens: 30 }),
      at(3, "token.usage", { pane: "p2", idea: "#1", tokens: 5 }),
      at(20, "issue.closed", { idea: "#2" }),
      at(21, "token.usage", { pane: "p3", idea: "#2", tokens: 1 }),
    ];
    const metrics = costMetrics(byIdea(events), WINDOW, options(1));
    expect(metrics.tokensPerIdea).toMatchObject({
      current: 1,
      trailingAverage: 35,
    });
  });

  it("leaves an idea with no token usage out of the tokens metric instead of counting zero", () => {
    const events = [
      ...closed(1, 100, 1, [10]),
      ...closed(2, 200, 2, []),
      ...closed(3, 300, 1, [30]),
    ];
    const metrics = costMetrics(byIdea(events), WINDOW, options(1));
    expect(metrics.tokensPerIdea).toMatchObject({
      status: "ok",
      currentIdea: "#3",
      trailingAverage: 10,
    });
    expect(metrics.sessionsPerIdea).toMatchObject({ currentIdea: "#3" });
  });
});

describe("costMetrics idea selection", () => {
  it("ignores ideas that are still open", () => {
    const events = [
      ...closed(1, 100, 1, []),
      at(200, "issue.opened", { idea: "#2" }),
      at(201, "session.launch", { idea: "#2", session: "s2" }),
    ];
    const metrics = costMetrics(byIdea(events), WINDOW, options(1));
    expect(metrics.sessionsPerIdea).toEqual({
      status: "insufficient history",
      closedIdeas: 1,
      needed: 2,
    });
  });

  it("leaves out an idea that closed outside the window, asking about its close time", () => {
    const events = [...closed(1, 100, 1, []), ...closed(2, 2_000_000, 1, [])];
    const metrics = costMetrics(byIdea(events), WINDOW, options(1));
    expect(vi.mocked(inWindow)).toHaveBeenCalledWith(
      WINDOW,
      T0 + 2_000_000_000,
    );
    expect(metrics.sessionsPerIdea).toMatchObject({ closedIdeas: 1 });
  });

  it("orders ideas that closed at the same time by their number, so #10 comes after #9", () => {
    const events = [...closed(10, 500, 3, []), ...closed(9, 500, 1, [])];
    const metrics = costMetrics(byIdea(events), WINDOW, options(1));
    expect(metrics.sessionsPerIdea).toMatchObject({
      currentIdea: "#10",
      current: 3,
      trailingAverage: 1,
    });
  });
});
