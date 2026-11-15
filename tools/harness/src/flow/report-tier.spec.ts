import { beforeEach, describe, expect, it, vi } from "vitest";
import { time } from "./github-waits.js";
import { tierShares } from "./idea-metrics.js";
import { inWindow, scopeOf, windowOf } from "./scope.js";
import { newLife } from "./toil.js";
import {
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

describe("buildReport tier sources", () => {
  it("reports each role's launches by tier source over every named event and the window", () => {
    fakeTally();
    const named = [ev(1, "session.launch", { role: "writer" })];
    cover(new Map(), named);
    const shares = [
      {
        role: "writer",
        launches: 1,
        definition: 0,
        escalation: 0,
        override: 0,
        unknown: 1,
        overrideShare: null,
      },
    ];
    vi.mocked(tierShares).mockReturnValue(shares);

    expect(run([]).tierShares).toBe(shares);
    expect(tierShares).toHaveBeenCalledWith(named, WINDOW);
  });
});
