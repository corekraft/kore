// Which lines of a document a harness command check reads: all of a current document, the open steps of a plan, none of history.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkedLines } from "./command-scope.js";
import { frontmatter, proseLines } from "./markdown.js";

vi.mock("./markdown.js", () => ({
  frontmatter: vi.fn(),
  proseLines: vi.fn(),
}));

const PLAN = "infra/plans/17-a.md";
const ADR = "docs/decisions/0001-a.md";

/** A plan whose step 1 is still open, step 2 is closed, and a Next section names no step. */
const plan = [
  { line: 1, text: "# Plan" },
  { line: 2, text: "## Steps" },
  { line: 3, text: "### Step 1: Open" },
  { line: 4, text: "- [x] done" },
  { line: 5, text: "- [ ] todo" },
  { line: 6, text: "### Step 2: Closed" },
  { line: 7, text: "- [x] done" },
  { line: 8, text: "## Next" },
  { line: 9, text: "Run harness pr open next." },
];

beforeEach(() => {
  vi.mocked(proseLines).mockReturnValue([]);
  vi.mocked(frontmatter).mockReturnValue(null);
});

describe("checkedLines", () => {
  it("checks every line of a current document", () => {
    const checked = checkedLines("docs/guides/x.md", "# X\n");
    expect([1, 2, 99].map(checked)).toEqual([true, true, true]);
  });

  it("checks the lines of a plan step that still has an unchecked box", () => {
    vi.mocked(proseLines).mockReturnValue(plan);
    const checked = checkedLines(PLAN, "");
    expect(checked(3)).toBe(true);
    expect(checked(5)).toBe(true);
  });

  it("skips the lines of a plan step whose boxes are all ticked", () => {
    vi.mocked(proseLines).mockReturnValue(plan);
    const checked = checkedLines(PLAN, "");
    expect(checked(6)).toBe(false);
    expect(checked(7)).toBe(false);
  });

  it("skips a plan line outside any step, such as its Next section", () => {
    vi.mocked(proseLines).mockReturnValue(plan);
    expect(checkedLines(PLAN, "")(9)).toBe(false);
  });

  it("skips every line of a superseded ADR", () => {
    vi.mocked(frontmatter).mockReturnValue({
      keys: new Map([["status", { value: "superseded", line: 2 }]]),
      errors: [],
    });
    expect(checkedLines(ADR, "")(4)).toBe(false);
  });

  it("checks an accepted ADR", () => {
    vi.mocked(frontmatter).mockReturnValue({
      keys: new Map([["status", { value: "accepted", line: 2 }]]),
      errors: [],
    });
    expect(checkedLines(ADR, "")(4)).toBe(true);
  });

  it("skips ideas and retros, which are history", () => {
    expect(checkedLines("docs/ideas/0001-a.md", "")(1)).toBe(false);
    expect(checkedLines("docs/retros/2026-11-20-x.md", "")(1)).toBe(false);
  });
});
