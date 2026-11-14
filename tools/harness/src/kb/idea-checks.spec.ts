// Frontmatter checks for idea records (ADR 0079): required fields, enumerations, workflow state, links and the Outcome section.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { checkIdea, IDEA_NAME } from "./idea-checks.js";
import { finding, frontmatter, type Finding } from "./markdown.js";

vi.mock("./markdown.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./markdown.js")>()),
  finding: vi.fn(),
  frontmatter: vi.fn(),
}));

const FILE = "docs/ideas/0001-a.md";
const IDEAS = new Map([["0001", FILE]]);
const PROBLEM: Finding = { file: "", line: 0, message: "", fix: "" };
const ERROR: Finding = {
  file: FILE,
  line: 4,
  message: "frontmatter tags is not a scalar string",
  fix: "use flat key: value lines only",
};
const VALID: [string, { value: string; line: number }][] = [
  ["summary", { value: "Tries A.", line: 2 }],
  ["hypothesis", { value: "A makes B faster.", line: 3 }],
  ["expected-outcome", { value: "B is 20 percent faster.", line: 4 }],
  ["measurement", { value: "Compare B duration before and after.", line: 5 }],
  ["safety-pattern", { value: "feature-flagged", line: 6 }],
  ["date", { value: "2026-11-11", line: 7 }],
];

beforeEach(() => {
  vi.mocked(finding).mockReturnValue(PROBLEM);
});

test("a file with no frontmatter is reported on line 1, naming the idea fields", () => {
  vi.mocked(frontmatter).mockReturnValue(null);
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      1,
      "frontmatter is missing",
      "start the file with --- and the idea fields (summary, hypothesis, expected-outcome, measurement, safety-pattern, date) ---",
    ],
  ]);
});

test("a complete idea with an issue and an issue parent is clean", () => {
  const keys = new Map(VALID);
  keys.set("issue", { value: "185", line: 8 });
  keys.set("parent", { value: "#127", line: 9 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  expect(checkIdea(FILE, "# Idea 0001: A\n", IDEAS)).toEqual([]);
});

test("an idea missing a required field reports it on line 1", () => {
  const keys = new Map(VALID);
  keys.delete("measurement");
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [FILE, 1, "frontmatter measurement is missing", "add a measurement: line"],
  ]);
});

test("an unknown safety pattern is reported, and the fix lists the allowed ones", () => {
  const keys = new Map(VALID);
  keys.set("safety-pattern", { value: "yolo", line: 6 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      6,
      "frontmatter safety-pattern is yolo",
      "use one of no-behaviour-change, feature-flagged, dark-launched, branch-by-abstraction, expand-contract",
    ],
  ]);
});

test("an outcome that is not confirmed, refuted or inconclusive is reported", () => {
  const keys = new Map(VALID);
  keys.set("outcome", { value: "great", line: 8 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n\n## Outcome\n\nNo.\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      8,
      "frontmatter outcome is great",
      "use one of confirmed, refuted, inconclusive",
    ],
  ]);
});

test("a date that is not YYYY-MM-DD is reported on the date line", () => {
  const keys = new Map(VALID);
  keys.set("date", { value: "yesterday", line: 7 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [FILE, 7, "frontmatter date is yesterday", "use a YYYY-MM-DD date"],
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
  const keys = new Map(VALID);
  keys.set(key, { value: "x", line: 8 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      8,
      `frontmatter ${key} is workflow state`,
      "the GitHub issue owns it, so remove the line",
    ],
  ]);
});

test("an issue must be a number, #number or a GitHub URL", () => {
  const soon = new Map(VALID);
  soon.set("issue", { value: "soon", line: 8 });
  vi.mocked(frontmatter).mockReturnValue({ keys: soon, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      8,
      "frontmatter issue is soon",
      "use an issue number such as 185 or #185, or its URL",
    ],
  ]);

  for (const value of ["185", "https://github.com/corekraft/kore/issues/1"]) {
    vi.mocked(finding).mockClear();
    const keys = new Map(VALID);
    keys.set("issue", { value, line: 8 });
    vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
    expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([]);
    expect(finding).not.toHaveBeenCalled();
  }
});

test("a parent is an issue, or an idea number that exists", () => {
  const unknown = new Map(VALID);
  unknown.set("parent", { value: "0042", line: 8 });
  vi.mocked(frontmatter).mockReturnValue({ keys: unknown, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      8,
      "frontmatter parent is 0042; idea 0042 does not exist",
      "use an existing idea's number or an issue such as #127",
    ],
  ]);

  vi.mocked(finding).mockClear();
  const existing = new Map(VALID);
  existing.set("parent", { value: "0001-a", line: 8 });
  vi.mocked(frontmatter).mockReturnValue({ keys: existing, errors: [] });
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([]);

  const bogus = new Map(VALID);
  bogus.set("parent", { value: "bogus", line: 8 });
  vi.mocked(frontmatter).mockReturnValue({ keys: bogus, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toContainEqual([
    FILE,
    8,
    "frontmatter parent is bogus",
    "use an idea number such as 0001, or an issue such as #127",
  ]);
});

test("an outcome line without an Outcome section is reported, naming the tool that writes both", () => {
  const keys = new Map(VALID);
  keys.set("outcome", { value: "refuted", line: 8 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      8,
      "frontmatter outcome has no ## Outcome section",
      "run `harness outcome record --idea 1`, or remove the line",
    ],
  ]);
});

test("an Outcome section without an outcome line is reported on the heading", () => {
  vi.mocked(frontmatter).mockReturnValue({ keys: new Map(VALID), errors: [] });
  checkIdea(FILE, "# Idea 0001: A\n\n## Outcome\n\nNo.\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      3,
      "## Outcome section has no frontmatter outcome line",
      "the outcome tool writes both; run `harness outcome record`, or remove the section",
    ],
  ]);
});

test("an idea file must be named NNNN-slug.md", () => {
  vi.mocked(frontmatter).mockReturnValue({ keys: new Map(VALID), errors: [] });
  checkIdea("docs/ideas/a.md", "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      "docs/ideas/a.md",
      1,
      "idea file is not named NNNN-slug.md",
      "rename it to a four-digit number and a lowercase slug",
    ],
  ]);
});

test("the idea file name pattern takes four digits and a lowercase slug", () => {
  expect(IDEA_NAME.test("docs/ideas/0001-a-b.md")).toBe(true);
  expect(IDEA_NAME.test("docs/ideas/1-a.md")).toBe(false);
  expect(IDEA_NAME.test("docs/ideas/0001-A.md")).toBe(false);
});

test("a frontmatter parse error is reported with the idea problems", () => {
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map(VALID),
    errors: [ERROR],
  });
  expect(checkIdea(FILE, "# Idea\n", IDEAS)).toEqual([ERROR]);
});

test("problems come in line order, and missing fields come after them", () => {
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map([
      ["summary", { value: "Tries A.", line: 2 }],
      ["hypothesis", { value: "A makes B faster.", line: 3 }],
      ["expected-outcome", { value: "B is 20 percent faster.", line: 4 }],
      ["safety-pattern", { value: "feature-flagged", line: 5 }],
      ["date", { value: "soon", line: 6 }],
    ]),
    errors: [],
  });
  checkIdea(FILE, "# Idea\n", IDEAS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [FILE, 6, "frontmatter date is soon", "use a YYYY-MM-DD date"],
    [FILE, 1, "frontmatter measurement is missing", "add a measurement: line"],
  ]);
});
