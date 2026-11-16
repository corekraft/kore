import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownerQuestions } from "./idea-metrics.js";
import { time } from "./github-waits.js";
import { inWindow, scopeOf, windowOf } from "./scope.js";
import { buildReport } from "./report.js";
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

describe("buildReport owner questions (#859)", () => {
  it("reports owner questions per merged change over every named event, the window and the default trailing days", () => {
    fakeTally();
    const named = [ev(1, "owner.asked")];
    cover(new Map(), named);
    const figure = {
      trailingDays: 7,
      questions: 2,
      merged: 1,
      perMerged: 2,
      trailingAverage: 1,
      worsened: true,
    };
    vi.mocked(ownerQuestions).mockReturnValue(figure);

    expect(run([]).ownerQuestions).toBe(figure);
    expect(ownerQuestions).toHaveBeenCalledWith(named, WINDOW, {
      trailingDays: 7,
      asOf: ASOF,
    });
  });

  it("versions the report to 10 when the question figure joins it, since a field changed", () => {
    fakeTally();
    vi.mocked(ownerQuestions).mockReturnValue({
      trailingDays: 7,
      questions: 0,
      merged: 0,
      perMerged: null,
      trailingAverage: null,
      worsened: false,
    });

    const report = buildReport([], {
      asOf: ASOF,
      minCompletedIdeas: 1,
    });

    expect(report.ownerQuestions.perMerged).toBeNull();
    expect(report.version).toBe(12);
  });
});
