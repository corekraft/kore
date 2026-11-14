import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { T0, at } from "./flow-support.js";
import * as attributionMeasure from "./attribution-measure.js";
import { DEFAULT_COST, costMetrics } from "./cost.js";
import * as outcomes from "./outcomes.js";
import { firstTime, time } from "./github-waits.js";
import * as ideaMetricsModule from "./idea-metrics.js";
import { ideaMetrics } from "./idea-metrics.js";
import { inWindow, type Span } from "./scope.js";
import { median } from "./wip.js";

vi.mock("./attribution-measure.js");
vi.mock("./cost.js");
vi.mock("./outcomes.js");
vi.mock("./github-waits.js");
vi.mock("./scope.js");
vi.mock("./wip.js");

const WINDOW: Span = [T0, T0 + 1_000_000];

beforeEach(() => {
  vi.mocked(time).mockImplementation((e: LedgerEvent) =>
    Date.parse(e.occurredAt),
  );
  vi.mocked(firstTime).mockImplementation((events, match) => {
    const times = events.filter(match).map((e) => time(e));
    return times.length === 0 ? undefined : Math.min(...times);
  });
  vi.mocked(inWindow).mockImplementation(
    (window: Span, when: number) => when >= window[0] && when < window[1],
  );
  vi.mocked(median).mockReturnValue(42);
  vi.mocked(costMetrics).mockReturnValue({
    trailingIdeas: 5,
    tokensPerIdea: {
      status: "insufficient history",
      closedIdeas: 0,
      needed: 6,
    },
    sessionsPerIdea: {
      status: "insufficient history",
      closedIdeas: 0,
      needed: 6,
    },
  });
});

/** An idea's events: opened at `first`, closed at `closedAt` (omitted when still open). */
function idea(
  n: number,
  first: number,
  closedAt?: number,
): [string, LedgerEvent[]] {
  const events = [at(first, "issue.opened", { number: n, idea: `#${n}` })];
  if (closedAt !== undefined) {
    events.push(at(closedAt, "issue.closed", { number: n, idea: `#${n}` }));
  }
  return [`#${n}`, events];
}

describe("ideaMetrics lead time", () => {
  it("measures each closed idea from its first event to its close, in seconds", () => {
    const { leadTime } = ideaMetrics(new Map([idea(2, 0, 100)]), WINDOW);
    expect(leadTime.ideas).toEqual([{ idea: "#2", seconds: 100 }]);
  });

  it("leaves out an idea still open, and one that closed outside the window", () => {
    const byIdea = new Map([idea(1, 0), idea(2, 0, 2_000_000), idea(3, 0, 50)]);
    const { leadTime } = ideaMetrics(byIdea, WINDOW);
    expect(leadTime.ideas).toEqual([{ idea: "#3", seconds: 50 }]);
    expect(vi.mocked(inWindow)).toHaveBeenCalledWith(
      WINDOW,
      T0 + 2_000_000_000,
    );
  });

  it("orders the ideas by number, so #9 comes before #10", () => {
    const byIdea = new Map([idea(10, 0, 30), idea(9, 0, 20)]);
    const { leadTime } = ideaMetrics(byIdea, WINDOW);
    expect(leadTime.ideas.map((i) => i.idea)).toEqual(["#9", "#10"]);
  });

  it("gives the median of the ideas' seconds, and their maximum", () => {
    const byIdea = new Map([idea(1, 0, 10), idea(2, 0, 40), idea(3, 0, 20)]);
    const { leadTime } = ideaMetrics(byIdea, WINDOW);
    expect(median).toHaveBeenCalledWith([10, 40, 20]);
    expect(leadTime).toMatchObject({ medianSeconds: 42, maxSeconds: 40 });
  });

  it("has no maximum when no idea has an outcome", () => {
    const { leadTime } = ideaMetrics(new Map([idea(1, 0)]), WINDOW);
    expect(median).toHaveBeenCalledWith([]);
    expect(leadTime).toEqual({
      ideas: [],
      medianSeconds: 42,
      maxSeconds: null,
    });
  });
});

describe("ideaMetrics cost", () => {
  it("returns the cost metrics the cost module computed over the same ideas and window", () => {
    const byIdea = new Map([idea(1, 0, 10)]);
    const { metrics } = ideaMetrics(byIdea, WINDOW);
    expect(vi.mocked(costMetrics).mock.calls).toEqual([
      [byIdea, WINDOW, DEFAULT_COST],
    ]);
    expect(metrics).toBe(vi.mocked(costMetrics).mock.results[0]?.value);
  });

  it("overrides only the cost options the caller names", () => {
    ideaMetrics(new Map(), WINDOW, { trailingIdeas: 2 });
    expect(vi.mocked(costMetrics).mock.calls).toEqual([
      [new Map(), WINDOW, { ...DEFAULT_COST, trailingIdeas: 2 }],
    ]);
  });
});

describe("idea-metrics re-exports", () => {
  it("passes the outcome and attribution helpers through unchanged", () => {
    expect(ideaMetricsModule.outcomes).toBe(outcomes.outcomes);
    expect(ideaMetricsModule.guardBlocks).toBe(outcomes.guardBlocks);
    expect(ideaMetricsModule.measureAttribution).toBe(
      attributionMeasure.measureAttribution,
    );
    expect(ideaMetricsModule.COST_KINDS).toBe(attributionMeasure.COST_KINDS);
  });
});
