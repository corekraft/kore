import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "./report.js";
import { time } from "./github-waits.js";
import { frictionMetrics, unstampedSpawns } from "./idea-metrics.js";
import { inWindow, scopeOf, windowOf } from "./scope.js";
import { newLife } from "./toil.js";
import {
  ASOF,
  SCOPE,
  WINDOW,
  cover,
  ev,
  fakeLife,
  fakeTally,
  run,
} from "./report-support.js";

vi.mock("./github-waits.js");
vi.mock("./idea-metrics.js");
vi.mock("./select.js");
vi.mock("./scope.js");
vi.mock("./tally.js");
vi.mock("./toil.js");

beforeEach(() => {
  vi.mocked(scopeOf).mockReturnValue(SCOPE);
  vi.mocked(windowOf).mockReturnValue(WINDOW);
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
  vi.mocked(newLife).mockReturnValue(fakeLife());
  cover(new Map());
});

describe("buildReport friction and rework", () => {
  it("reports friction and rework over the covered ideas and every named event, with the configured trailing window", () => {
    fakeTally();
    const own = [ev(1, "send-back", { label: "r", number: 3 })];
    const named = [ev(1, "kore.retry", { label: "local up" })];
    cover(new Map([["#1", own]]), named);
    const found = { rework: {}, friction: { total: 1 } } as ReturnType<
      typeof frictionMetrics
    >;
    vi.mocked(frictionMetrics).mockReturnValue(found);
    const r = buildReport([], {
      asOf: ASOF,
      minCompletedIdeas: 1,
      cost: { trailingIdeas: 3 },
    });
    expect(r.rework).toBe(found.rework);
    expect(r.friction).toBe(found.friction);
    expect(frictionMetrics).toHaveBeenCalledWith(
      named,
      new Map([["#1", own]]),
      WINDOW,
      3,
    );
  });

  it("reports the send-backs by category that the friction metrics count", () => {
    fakeTally();
    cover(new Map());
    const categories = { perPrHead: {}, perMergedChange: {} } as Partial<
      ReturnType<typeof frictionMetrics>
    >;
    vi.mocked(frictionMetrics).mockReturnValue({
      sendBackCategories: categories,
    } as unknown as ReturnType<typeof frictionMetrics>);
    const r = run([]);
    expect(r.sendBackCategories).toBe(categories);
  });

  it("leaves the trailing window to the default when the cost options name none", () => {
    fakeTally();
    cover(new Map());
    vi.mocked(frictionMetrics).mockReturnValue(
      {} as ReturnType<typeof frictionMetrics>,
    );
    run([]);
    expect(vi.mocked(frictionMetrics).mock.calls[0]?.[3]).toBeUndefined();
  });
});

describe("buildReport counts unstamped spawns beside friction", () => {
  it("reports the unstamped spawns among the named events in the window", () => {
    fakeTally();
    const named = [
      ev(1, "spawn.unstamped", { role: "writer", agent: "x-writer" }),
    ];
    cover(new Map(), named);
    vi.mocked(unstampedSpawns).mockReturnValue({ total: 1, withReason: 0 });

    const r = buildReport([], { asOf: ASOF, minCompletedIdeas: 1 });

    expect(unstampedSpawns).toHaveBeenCalledWith(named, WINDOW);
    expect(r.unstampedSpawns).toEqual({ total: 1, withReason: 0 });
  });
});
