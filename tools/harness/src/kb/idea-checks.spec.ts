// Frontmatter checks for idea records (ADR 0079): required fields, enumerations, workflow state, links and the Outcome section.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { checkIdea, IDEA_NAME } from "./idea-checks.js";
import { fakeFinding, keysOf } from "./kb-support.js";
import { finding, frontmatter, type Finding } from "./markdown.js";

vi.mock("./markdown.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./markdown.js")>()),
  finding: vi.fn(),
  frontmatter: vi.fn(),
}));

const FILE = "docs/ideas/0001-a.md";
const IDEAS = new Map([["0001", FILE]]);

/** A complete idea's frontmatter, with `changes` applied: a null value drops the key. */
function idea(
  changes: Record<string, string | null> = {},
): Record<string, string> {
  const fields: Record<string, string | null> = {
    summary: "Tries A.",
    hypothesis: "A makes B faster.",
    "expected-outcome": "B is 20 percent faster.",
    measurement: "Compare B duration before and after.",
    "safety-pattern": "feature-flagged",
    date: "2026-11-11",
    ...changes,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  );
}

/** Mock frontmatter() to parse the given keys, with parse errors when given. */
function parse(entries: Record<string, string>, errors: Finding[] = []) {
  vi.mocked(frontmatter).mockReturnValue({ keys: keysOf(entries), errors });
}

beforeEach(() => {
  vi.mocked(finding).mockImplementation(fakeFinding);
});

test("a file with no frontmatter is reported on line 1, naming the idea fields", () => {
  vi.mocked(frontmatter).mockReturnValue(null);
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 1,
      message: "frontmatter is missing",
      fix: "start the file with --- and the idea fields (summary, hypothesis, expected-outcome, measurement, safety-pattern, date) ---",
    },
  ]);
});

test("a complete idea with an issue and an issue parent is clean", () => {
  parse(idea({ issue: "185", parent: "#127" }));
  expect(checkIdea(FILE, "# Idea 0001: A\n", IDEAS)).toEqual([]);
});

test("an idea missing a required field reports it on line 1", () => {
  parse(idea({ measurement: null }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 1,
      message: "frontmatter measurement is missing",
      fix: "add a measurement: line",
    },
  ]);
});

test("an unknown safety pattern is reported, and the fix lists the allowed ones", () => {
  parse(idea({ "safety-pattern": "yolo" }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 6,
      message: "frontmatter safety-pattern is yolo",
      fix: "use one of no-behaviour-change, feature-flagged, dark-launched, branch-by-abstraction, expand-contract",
    },
  ]);
});

test("an outcome that is not confirmed, refuted or inconclusive is reported", () => {
  parse(idea({ outcome: "great" }), []);
  const problems = checkIdea(FILE, "# Idea\n\n## Outcome\n\nNo.\n", IDEAS);
  expect(problems).toContainEqual({
    file: FILE,
    line: 8,
    message: "frontmatter outcome is great",
    fix: "use one of confirmed, refuted, inconclusive",
  });
});

test("a date that is not YYYY-MM-DD is reported on the date line", () => {
  parse(idea({ date: "yesterday" }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 7,
      message: "frontmatter date is yesterday",
      fix: "use a YYYY-MM-DD date",
    },
  ]);
});

test.each([
  "status",
  "approval",
  "approved",
  "approved-by",
  "label",
  "labels",
  "assignee",
  "assignees",
  "state",
])("workflow state key %s is reported: the GitHub issue owns it", (key) => {
  parse(idea({ [key]: "x" }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 8,
      message: `frontmatter ${key} is workflow state`,
      fix: "the GitHub issue owns it, so remove the line",
    },
  ]);
});

test("an issue must be a number, #number or a GitHub URL", () => {
  parse(idea({ issue: "soon" }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 8,
      message: "frontmatter issue is soon",
      fix: "use an issue number such as 185 or #185, or its URL",
    },
  ]);
  for (const issue of ["185", "https://github.com/corekraft/kore/issues/1"]) {
    parse(idea({ issue }));
    expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([]);
  }
});

test("a parent is an issue, or an idea number that exists", () => {
  parse(idea({ parent: "0042" }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 8,
      message: "frontmatter parent is 0042; idea 0042 does not exist",
      fix: "use an existing idea's number or an issue such as #127",
    },
  ]);
  parse(idea({ parent: "0001-a" }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([]);
  parse(idea({ parent: "bogus" }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 8,
      message: "frontmatter parent is bogus",
      fix: "use an idea number such as 0001, or an issue such as #127",
    },
  ]);
});

test("an outcome line without an Outcome section is reported, naming the tool that writes both", () => {
  parse(idea({ outcome: "refuted" }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 8,
      message: "frontmatter outcome has no ## Outcome section",
      fix: "run `harness outcome record --idea 1`, or remove the line",
    },
  ]);
});

test("an Outcome section without an outcome line is reported on the heading", () => {
  parse(idea());
  expect(
    checkIdea(FILE, "# Idea 0001: A\n\n## Outcome\n\nNo.\n", IDEAS),
  ).toEqual([
    {
      file: FILE,
      line: 3,
      message: "## Outcome section has no frontmatter outcome line",
      fix: "the outcome tool writes both; run `harness outcome record`, or remove the section",
    },
  ]);
});

test("an idea file must be named NNNN-slug.md", () => {
  parse(idea());
  expect(checkIdea("docs/ideas/a.md", "# Idea\n", IDEAS)).toEqual([
    {
      file: "docs/ideas/a.md",
      line: 1,
      message: "idea file is not named NNNN-slug.md",
      fix: "rename it to a four-digit number and a lowercase slug",
    },
  ]);
});

test("the idea file name pattern takes four digits and a lowercase slug", () => {
  expect(IDEA_NAME.test("docs/ideas/0001-a-b.md")).toBe(true);
  expect(IDEA_NAME.test("docs/ideas/1-a.md")).toBe(false);
  expect(IDEA_NAME.test("docs/ideas/0001-A.md")).toBe(false);
});

test("a frontmatter parse error is reported with the idea problems", () => {
  const error = finding(
    FILE,
    4,
    "frontmatter tags is not a scalar string",
    "use flat key: value lines only",
  );
  parse(idea(), [error]);
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([error]);
});

test("problems come in line order, and missing fields come after them", () => {
  parse(idea({ date: "soon", measurement: null }));
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([
    {
      file: FILE,
      line: 6,
      message: "frontmatter date is soon",
      fix: "use a YYYY-MM-DD date",
    },
    {
      file: FILE,
      line: 1,
      message: "frontmatter measurement is missing",
      fix: "add a measurement: line",
    },
  ]);
});
