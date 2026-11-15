// A harness idea's hypothesis (#214): kind, metric from the flow report, direction and window.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { checkIdea } from "./idea-checks.js";
import { finding, frontmatter, type Finding } from "./markdown.js";

vi.mock("./markdown.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./markdown.js")>()),
  finding: vi.fn(),
  frontmatter: vi.fn(),
}));

const FILE = "docs/ideas/0001-a.md";
const IDEAS = new Map([["0001", FILE]]);
const METRICS = ["outcomes.mainRed.rate", "friction.total"];
const PROBLEM: Finding = { file: "", line: 0, message: "", fix: "" };
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

const HARNESS: [string, { value: string; line: number }][] = [
  ...VALID,
  ["kind", { value: "harness", line: 8 }],
  ["hypothesis-metric", { value: "friction.total", line: 9 }],
  ["hypothesis-direction", { value: "down", line: 10 }],
  ["hypothesis-window", { value: "14d", line: 11 }],
];

test("a complete harness idea naming a flow report metric is clean", () => {
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map(HARNESS),
    errors: [],
  });
  expect(checkIdea(FILE, "# Idea\n", IDEAS, METRICS)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test.each([
  ["hypothesis-metric", "friction.total"],
  ["hypothesis-direction", "down"],
  ["hypothesis-window", "14d"],
])("a harness idea with no %s names it as missing", (key) => {
  const keys = new Map(HARNESS);
  keys.delete(key);
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS, METRICS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      8,
      `frontmatter ${key} is missing for a harness idea`,
      `add a ${key}: line`,
    ],
  ]);
});

test("a harness idea with none of the hypothesis fields names all three", () => {
  const keys = new Map(VALID);
  keys.set("kind", { value: "harness", line: 8 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS, METRICS);
  expect(vi.mocked(finding).mock.calls.map((c) => c[2])).toEqual([
    "frontmatter hypothesis-metric is missing for a harness idea",
    "frontmatter hypothesis-direction is missing for a harness idea",
    "frontmatter hypothesis-window is missing for a harness idea",
  ]);
});

test("a hypothesis metric that is not in the flow report is refused, listing the valid ones", () => {
  const keys = new Map(HARNESS);
  keys.set("hypothesis-metric", { value: "vibes", line: 9 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS, METRICS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      9,
      "frontmatter hypothesis-metric is vibes, which is not a flow report metric",
      "use one of outcomes.mainRed.rate, friction.total (see `harness flow report --json`)",
    ],
  ]);
});

test("a direction other than up or down, and a window that is not days, are reported", () => {
  const keys = new Map(HARNESS);
  keys.set("hypothesis-direction", { value: "sideways", line: 10 });
  keys.set("hypothesis-window", { value: "soon", line: 11 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS, METRICS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      FILE,
      10,
      "frontmatter hypothesis-direction is sideways",
      "use up or down",
    ],
    [
      FILE,
      11,
      "frontmatter hypothesis-window is soon",
      "use a number of days such as 14d",
    ],
  ]);
});

test("a kind other than harness is reported", () => {
  const keys = new Map(VALID);
  keys.set("kind", { value: "product", line: 8 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkIdea(FILE, "# Idea\n", IDEAS, METRICS);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [FILE, 8, "frontmatter kind is product", "use harness, or remove the line"],
  ]);
});

test("an idea without a kind needs no hypothesis fields, as before", () => {
  vi.mocked(frontmatter).mockReturnValue({ keys: new Map(VALID), errors: [] });
  expect(checkIdea(FILE, "# Idea\n", IDEAS, METRICS)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});
