import { describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { advisorQuality } from "./advisor-quality.js";
import { ownerQuestions } from "./owner-questions.js";
import { ownerRoutes } from "./owner-routes.js";
import { waitingOnPerson } from "./owner-wait.js";
import { questionFigures } from "./question-figures.js";
import type { Span } from "./scope.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./advisor-quality.js", () => ({ advisorQuality: vi.fn() }));
vi.mock("./owner-questions.js", () => ({
  DEFAULT_QUESTION_DAYS: 7,
  ownerQuestions: vi.fn(),
}));
vi.mock("./owner-routes.js", () => ({ ownerRoutes: vi.fn() }));
vi.mock("./owner-wait.js", () => ({ waitingOnPerson: vi.fn() }));

const WINDOW: Span = [0, 1000];
const ASOF = new Date(1000);
const EVENTS = [] as LedgerEvent[];

describe("questionFigures: the figures about owner questions and the advisor", () => {
  it("returns each figure the module computes, under its report name", () => {
    const figures = {
      owner: { trailingDays: 7 },
      quality: { made: 1 },
      routes: { owner: 2 },
      waits: { questions: 3 },
    };
    vi.mocked(ownerQuestions).mockReturnValue(figures.owner as never);
    vi.mocked(advisorQuality).mockReturnValue(figures.quality as never);
    vi.mocked(ownerRoutes).mockReturnValue(figures.routes as never);
    vi.mocked(waitingOnPerson).mockReturnValue(figures.waits as never);

    expect(questionFigures(EVENTS, WINDOW, ASOF)).toEqual({
      ownerQuestions: figures.owner,
      advisorQuality: figures.quality,
      ownerRoutes: figures.routes,
      waitingOnPerson: figures.waits,
    });
  });

  it("computes the owner questions over the default trailing days before the as-of time", () => {
    questionFigures(EVENTS, WINDOW, ASOF);

    expect(ownerQuestions).toHaveBeenCalledWith(EVENTS, WINDOW, {
      trailingDays: 7,
      asOf: ASOF,
    });
  });

  it("computes the advisor quality and the routes over the same events and window", () => {
    questionFigures(EVENTS, WINDOW, ASOF);

    expect(advisorQuality).toHaveBeenCalledWith(EVENTS, WINDOW);
    expect(ownerRoutes).toHaveBeenCalledWith(EVENTS, WINDOW);
  });

  it("computes the waiting on a person to the as-of time, since a question still open waits until then", () => {
    questionFigures(EVENTS, WINDOW, ASOF);

    expect(waitingOnPerson).toHaveBeenCalledWith(EVENTS, WINDOW, ASOF);
  });
});
