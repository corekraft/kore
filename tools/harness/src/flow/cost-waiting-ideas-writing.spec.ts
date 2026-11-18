import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import type { IdeaFigure, Writing } from "./cost-waiting-types.js";
import { ideasWithWritingIn } from "./cost-waiting-ideas-writing.js";
import { ideaRowsIn } from "./cost-waiting-ideas.js";
import { writingIn } from "./cost-waiting-writing.js";

vi.mock("./cost-waiting-ideas.js", () => ({ ideaRowsIn: vi.fn() }));
vi.mock("./cost-waiting-writing.js", () => ({ writingIn: vi.fn() }));

const WINDOW: [number, number] = [0, 1000];
const OPTIONS = { prices: {}, minimum: 1 };
const EVENTS = [{ kind: "token.split" }] as LedgerEvent[];
const BY_IDEA = new Map([["#7", { tokens: 5, dollars: 1, unpriced: [] }]]);
const FIGURE = { unjoinable: 2 } as Writing;
const ROWS = [{ idea: "#7" }] as IdeaFigure[];

describe("ideas with writing: the writers' spend reaches the idea rows", () => {
  beforeEach(() => {
    vi.mocked(writingIn).mockReturnValue({ byIdea: BY_IDEA, figure: FIGURE });
    vi.mocked(ideaRowsIn).mockReturnValue(ROWS);
  });

  it("reads the idea rows with the spend the writing join charged to each idea", () => {
    ideasWithWritingIn(EVENTS, WINDOW, OPTIONS);

    expect(ideaRowsIn).toHaveBeenCalledWith(EVENTS, WINDOW, OPTIONS, BY_IDEA);
  });

  it("returns the idea rows and the writing buckets as the two readings produced them", () => {
    expect(ideasWithWritingIn(EVENTS, WINDOW, OPTIONS)).toEqual({
      ideas: ROWS,
      writing: FIGURE,
    });
  });
});
