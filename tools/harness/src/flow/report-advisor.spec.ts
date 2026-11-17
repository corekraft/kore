import { beforeEach, describe, expect, it, vi } from "vitest";
import { questionFigures } from "./idea-metrics.js";
import { time } from "./github-waits.js";
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

describe("buildReport advisor figures (ADR 0120)", () => {
  it("reports the advisor's quality, the owner routes and the waiting on a person over the named events, the window and the as-of time", () => {
    fakeTally();
    const named = [ev(1, "decision.made")];
    cover(new Map(), named);
    const figures = {
      advisorQuality: {
        made: 1,
        overturned: 0,
        perMade: 0,
        refutingShare: 0.07,
        refuted: false,
      },
      ownerRoutes: {
        advisor: 1,
        owner: 0,
        bySignal: {
          "reserved-category": 0,
          matched: 0,
          "advisor-files": 0,
          escalated: 0,
          unclassifiable: 0,
        },
      },
      waitingOnPerson: {
        questions: 0,
        answered: 0,
        unanswered: 0,
        waitingSeconds: 0,
        perQuestionSeconds: null,
      },
    };
    vi.mocked(questionFigures).mockReturnValue(
      figures as unknown as ReturnType<typeof questionFigures>,
    );

    const report = run([]);

    expect(report.advisorQuality).toBe(figures.advisorQuality);
    expect(report.ownerRoutes).toBe(figures.ownerRoutes);
    expect(report.waitingOnPerson).toBe(figures.waitingOnPerson);
    expect(questionFigures).toHaveBeenCalledWith(named, WINDOW, ASOF);
  });
});
