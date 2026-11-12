import { describe, expect, it } from "vitest";
import { buildReport, type FlowReport } from "./report.js";
import { T0, at } from "./flow-support.js";
import type { LedgerEvent } from "../ledger/index.js";

const ASOF = new Date(T0 + 1_000_000_000);

/** One idea closed at `base + 100`, with `launches` sessions and `tokens` over its writer's stops. */
function costed(
  n: number,
  base: number,
  launches: number,
  tokens: number[],
): LedgerEvent[] {
  const idea = `#${n}`;
  return [
    at(base, "issue.opened", { number: n }),
    ...Array.from({ length: launches }, (_, i) =>
      at(base + 1 + i, "session.launch", {
        pane: `w${n}-p${i}`,
        role: "writer",
        tier: "claude-opus-5-5",
        idea,
      }),
    ),
    ...tokens.map((count, i) =>
      at(base + 10 + i, "token.usage", {
        session: `s${n}`,
        pane: "w" + n + "-p0",
        tokens: count,
      }),
    ),
    at(base + 100, "issue.closed", { number: n }),
  ];
}

function report(
  events: LedgerEvent[],
  cost: Partial<NonNullable<Parameters<typeof buildReport>[1]["cost"]>> = {},
): FlowReport {
  return buildReport(events, { asOf: ASOF, minCompletedIdeas: 1, cost });
}

describe("flow report cost metrics", () => {
  const events = [
    ...costed(1, 0, 1, [100, 300]),
    ...costed(2, 1000, 2, [200]),
    ...costed(3, 2000, 3, [100, 200, 600]),
  ];

  it("gives each closed idea's tokens and sessions, trailing averages and a worsened flag", () => {
    const { metrics } = report(events, { trailingIdeas: 3 });
    expect(metrics.trailingIdeas).toBe(3);
    expect(metrics.tokensPerIdea).toEqual({
      status: "ok",
      currentIdea: "#3",
      current: 600,
      trailingAverage: (300 + 200 + 600) / 3,
      maxIncrease: 0.25,
      worsened: true,
    });
    expect(metrics.sessionsPerIdea).toEqual({
      status: "ok",
      currentIdea: "#3",
      current: 3,
      trailingAverage: 2,
      maxIncrease: 0.25,
      worsened: true,
    });
  });

  it("counts a session's cumulative tokens once, using its latest usage", () => {
    const { metrics } = report(costed(1, 0, 1, [50, 120, 400]), {
      trailingIdeas: 1,
    });
    expect(metrics.tokensPerIdea).toMatchObject({ current: 400 });
  });
});

describe("flow report cost metric windows", () => {
  const events = [
    ...costed(1, 0, 1, [100, 300]),
    ...costed(2, 1000, 2, [200]),
    ...costed(3, 2000, 3, [100, 200, 600]),
  ];

  it("is not worsened at or below the threshold", () => {
    const { metrics } = report(events, {
      trailingIdeas: 3,
      tokensPerIdea: { maxIncrease: 0.7 },
      sessionsPerIdea: { maxIncrease: 0.5 },
    });
    expect(metrics.tokensPerIdea).toMatchObject({
      maxIncrease: 0.7,
      worsened: false,
    });
    expect(metrics.sessionsPerIdea).toMatchObject({ worsened: false });
  });

  it("averages only the last N closed ideas", () => {
    const { metrics } = report(events, { trailingIdeas: 2 });
    expect(metrics.sessionsPerIdea).toMatchObject({
      current: 3,
      trailingAverage: 2.5,
    });
  });

  it("reports insufficient history below N closed ideas, never zero", () => {
    const { metrics } = report(events, { trailingIdeas: 4 });
    const expected = {
      status: "insufficient history",
      closedIdeas: 3,
      needed: 4,
    };
    expect(metrics.tokensPerIdea).toEqual(expected);
    expect(metrics.sessionsPerIdea).toEqual(expected);
  });

  it("defaults N to five", () => {
    expect(report(events).metrics.trailingIdeas).toBe(5);
    expect(report(events).metrics.tokensPerIdea).toMatchObject({
      status: "insufficient history",
      needed: 5,
    });
  });

  it("leaves an idea with no token usage out of the tokens metric instead of counting zero", () => {
    const { metrics } = report(
      [
        at(0, "issue.opened", { number: 9 }),
        at(5, "issue.closed", { number: 9 }),
      ],
      { trailingIdeas: 1 },
    );
    expect(metrics.tokensPerIdea).toMatchObject({
      status: "insufficient history",
      closedIdeas: 0,
    });
    expect(metrics.sessionsPerIdea).toMatchObject({ current: 0 });
  });

  it("keeps cost events out of stage time and the unmapped count", () => {
    const r = report(costed(1, 0, 2, [100]), { trailingIdeas: 1 });
    expect(r.unmappedEvents).toBe(0);
  });

  it("ignores ideas that are still open", () => {
    const { metrics } = report(
      [...events, at(3000, "issue.opened", { number: 4 })],
      { trailingIdeas: 3 },
    );
    expect(metrics.sessionsPerIdea).toMatchObject({ currentIdea: "#3" });
  });
});
