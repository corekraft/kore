// The retro due decision as a unit: a pure function of recorded data.
import { describe, expect, it } from "vitest";
import { COUNT_THRESHOLD, decideRetro, type DueInput } from "./due.js";

const WINDOW = Date.parse("2026-01-01T00:00:00Z");
const after = (n: number) => new Date(WINDOW + n * 1000).toISOString();

const closed = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    idea: `idea-${i + 1}`,
    at: Date.parse(after(i + 1)),
  }));

const input = (over: Partial<DueInput> = {}): DueInput => ({
  windowStart: WINDOW,
  closed: [],
  metrics: [],
  triggers: [],
  ...over,
});

describe("decideRetro", () => {
  it("reports nothing due with no history", () => {
    expect(decideRetro(input({ windowStart: 0 }))).toEqual({
      due: false,
      closedIdeas: 0,
      threshold: COUNT_THRESHOLD,
    });
  });

  it("stays not due at four closed ideas", () => {
    expect(decideRetro(input({ closed: closed(4) }))).toEqual({
      due: false,
      closedIdeas: 4,
      threshold: 5,
    });
  });

  it("is due with reason count at the fifth closed idea", () => {
    expect(decideRetro(input({ closed: closed(5) }))).toEqual({
      due: true,
      reason: "count",
      closedIdeas: 5,
      threshold: 5,
    });
  });

  it("counts an idea once however many outcomes it has", () => {
    const twice = [...closed(4), { idea: "idea-1", at: WINDOW + 9000 }];
    expect(decideRetro(input({ closed: twice })).due).toBe(false);
  });

  it("does not count ideas closed at or before the window opened", () => {
    const old = [...closed(4), { idea: "old", at: WINDOW }];
    expect(decideRetro(input({ closed: old })).due).toBe(false);
  });
});

describe("decideRetro metrics and recorded triggers", () => {
  it("is due early, naming the metric, when one worsened on an idea closed in the window", () => {
    const result = decideRetro(
      input({
        closed: closed(2),
        metrics: [{ name: "tokensPerIdea", idea: "idea-2", worsened: true }],
      }),
    );
    expect(result).toEqual({
      due: true,
      reason: "metric",
      metric: "tokensPerIdea",
      closedIdeas: 2,
      threshold: 5,
    });
  });

  it("ignores a worsened metric whose idea closed before the window", () => {
    const result = decideRetro(
      input({
        closed: closed(2),
        metrics: [{ name: "tokensPerIdea", idea: "old", worsened: true }],
      }),
    );
    expect(result.due).toBe(false);
  });

  it("ignores a metric that did not worsen", () => {
    const result = decideRetro(
      input({
        closed: closed(2),
        metrics: [{ name: "tokensPerIdea", idea: "idea-2", worsened: false }],
      }),
    );
    expect(result.due).toBe(false);
  });

  it("does not fire again for a trigger already recorded in the window", () => {
    const result = decideRetro(
      input({
        closed: closed(5),
        triggers: [{ at: WINDOW + 60_000, reason: "count" }],
      }),
    );
    expect(result).toEqual({
      due: false,
      closedIdeas: 5,
      threshold: 5,
      alreadyTriggered: "count",
    });
  });
});

describe("decideRetro recorded triggers", () => {
  it("fires a metric the window has not recorded even when count was recorded", () => {
    const result = decideRetro(
      input({
        closed: closed(5),
        metrics: [{ name: "sessionsPerIdea", idea: "idea-5", worsened: true }],
        triggers: [{ at: WINDOW + 60_000, reason: "count" }],
      }),
    );
    expect(result).toMatchObject({
      due: true,
      reason: "metric",
      metric: "sessionsPerIdea",
    });
  });

  it("does not let a trigger recorded in an earlier window block this one", () => {
    const result = decideRetro(
      input({
        closed: closed(5),
        triggers: [{ at: WINDOW, reason: "count" }],
      }),
    );
    expect(result).toMatchObject({ due: true, reason: "count" });
  });
});
