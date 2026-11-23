import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADVISOR_FILES, matchedBy } from "./matcher.js";
import { reservedCategory } from "./reserved.js";
import { classify, type ClassifyInput } from "./classify.js";

vi.mock("./matcher.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./matcher.js")>()),
  matchedBy: vi.fn(),
}));
vi.mock("./reserved.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./reserved.js")>()),
  reservedCategory: vi.fn(),
}));

const INPUT: ClassifyInput = {
  idea: "8",
  category: "naming",
  question: "Should the column be named Median or P50?",
  action: "Rename the column to Median.",
  escalate: false,
};

beforeEach(() => {
  vi.mocked(matchedBy).mockReturnValue(undefined);
  vi.mocked(reservedCategory).mockReturnValue(undefined);
});

describe("classify", () => {
  it("routes a question to the advisor only when the declared category and the matcher both say so", () => {
    expect(classify(INPUT)).toEqual({ route: "advisor", signal: "agreed" });
  });

  it("routes a question to the owner when the matcher matches its text or its proposed action", () => {
    vi.mocked(matchedBy).mockReturnValue("destruction");

    expect(classify(INPUT)).toEqual({ route: "owner", signal: "matched" });
    expect(matchedBy).toHaveBeenCalledWith(
      "Should the column be named Median or P50?\nRename the column to Median.",
    );
  });

  it("routes a question that names the advisor's own files to the owner under advisor-files", () => {
    vi.mocked(matchedBy).mockReturnValue(ADVISOR_FILES);

    expect(classify(INPUT)).toEqual({
      route: "owner",
      signal: "advisor-files",
    });
  });

  it("routes a declared category that is a reserved name to the owner, even when the text matches nothing", () => {
    expect(classify({ ...INPUT, category: "credentials" })).toEqual({
      route: "owner",
      signal: "reserved-category",
    });
    expect(matchedBy).not.toHaveBeenCalled();
  });

  it("routes a declared category that a reserved pattern matches to the owner", () => {
    vi.mocked(reservedCategory).mockReturnValue("destruction");

    expect(classify({ ...INPUT, category: "delete-branch" })).toEqual({
      route: "owner",
      signal: "reserved-category",
    });
  });

  it("routes a category it cannot read, or a question or action with no text, to the owner as unclassifiable", () => {
    for (const bad of [
      { category: "" },
      { category: "Naming Rules" },
      { category: "a".repeat(65) },
      { question: "   " },
      { action: "" },
    ]) {
      expect(classify({ ...INPUT, ...bad })).toEqual({
        route: "owner",
        signal: "unclassifiable",
      });
    }
  });

  it("routes an escalated question to the owner whatever the signals say, so no input moves it to the advisor", () => {
    expect(classify({ ...INPUT, escalate: true })).toEqual({
      route: "owner",
      signal: "escalated",
    });
  });
});
