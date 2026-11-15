import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "./report.js";
import { time } from "./github-waits.js";
import { frictionMetrics } from "./idea-metrics.js";
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
