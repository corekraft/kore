import { beforeEach, describe, expect, it, vi } from "vitest";
import { questionFigures } from "./idea-metrics.js";
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

const NO_QUESTIONS = {
  trailingDays: 7,
  questions: 0,
  merged: 0,
  perMerged: null,
  trailingAverage: null,
  worsened: false,
};

beforeEach(() => {
  vi.mocked(scopeOf).mockReturnValue(SCOPE);
  vi.mocked(windowOf).mockReturnValue(WINDOW);
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
  vi.mocked(newLife).mockReturnValue(fakeLife());
  cover(new Map());
});

describe("buildReport owner questions (#859)", () => {
  it("reports owner questions per merged change over every named event, the window and the as-of time", () => {
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
    vi.mocked(questionFigures).mockReturnValue({
      ownerQuestions: figure,
    } as ReturnType<typeof questionFigures>);

    expect(run([]).ownerQuestions).toBe(figure);
    expect(questionFigures).toHaveBeenCalledWith(named, WINDOW, ASOF);
  });

  it("versions the report to 25 when the advisor figures join it, since a field changed", () => {
    fakeTally();
    vi.mocked(questionFigures).mockReturnValue({
      ownerQuestions: NO_QUESTIONS,
    } as ReturnType<typeof questionFigures>);

    const report = buildReport([], {
      asOf: ASOF,
      minCompletedIdeas: 1,
    });

    expect(report.ownerQuestions.perMerged).toBeNull();
    expect(report.version).toBe(39);
  });
});
