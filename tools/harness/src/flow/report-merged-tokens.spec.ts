import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergedChangeTokens, ownerQuestions } from "./idea-metrics.js";
import { time } from "./github-waits.js";
import { buildReport } from "./report.js";
import { scopeOf, windowOf, inWindow } from "./scope.js";
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

const FIGURE = {
  trailingDays: 7,
  minMergedChanges: 5,
  current: { status: "insufficient merged changes", merged: 0, needed: 5 },
  trailingAverage: {
    status: "insufficient merged changes",
    merged: 0,
    needed: 5,
  },
} as const;

beforeEach(() => {
  vi.mocked(scopeOf).mockReturnValue(SCOPE);
  vi.mocked(windowOf).mockReturnValue(WINDOW);
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
  vi.mocked(newLife).mockReturnValue(fakeLife());
  vi.mocked(ownerQuestions).mockReturnValue({
    trailingDays: 7,
    questions: 0,
    merged: 0,
    perMerged: null,
    trailingAverage: null,
    worsened: false,
  });
  vi.mocked(mergedChangeTokens).mockReturnValue(FIGURE);
  cover(new Map());
  fakeTally();
});

describe("buildReport tokens per merged change (#829)", () => {
  it("reports the figure the merged-change module computes over every named event and the window", () => {
    const named = [ev(1, "token.usage", { session: "a", tokens: 5 })];
    cover(new Map(), named);

    expect(run([]).tokensPerMergedChange).toBe(FIGURE);
    expect(mergedChangeTokens).toHaveBeenCalledWith(
      named,
      WINDOW,
      expect.objectContaining({ asOf: ASOF }),
    );
  });

  it("passes the cost options through, so the configured minimum reaches the figure", () => {
    buildReport([], {
      asOf: ASOF,
      minCompletedIdeas: 1,
      cost: { minMergedChanges: 9 },
    });

    expect(mergedChangeTokens).toHaveBeenCalledWith(
      [],
      WINDOW,
      expect.objectContaining({ cost: { minMergedChanges: 9 } }),
    );
  });

  it("versions the report to 14, since a field joined it", () => {
    expect(run([]).version).toBe(14);
  });
});
