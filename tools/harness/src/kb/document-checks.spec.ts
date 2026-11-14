// Frontmatter checks for plans and ADRs: the required keys, the allowed values, and superseded-by.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { checkFrontmatter } from "./document-checks.js";
import { finding, frontmatter, type Finding } from "./markdown.js";

vi.mock("./markdown.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./markdown.js")>()),
  finding: vi.fn(),
  frontmatter: vi.fn(),
}));

const PLAN = "infra/plans/1-a.md";
const ADR = "docs/decisions/0001-a.md";
const PROBLEM: Finding = { file: "", line: 0, message: "", fix: "" };
const PLAN_KEYS: [string, { value: string; line: number }][] = [
  ["status", { value: "active", line: 2 }],
  ["summary", { value: "Delivers A.", line: 3 }],
  ["last-verified", { value: "2026-11-07", line: 4 }],
];
const ADR_KEYS: [string, { value: string; line: number }][] = [
  ["status", { value: "accepted", line: 2 }],
  ["date", { value: "2026-09-13", line: 3 }],
  ["summary", { value: "Decides the thing.", line: 4 }],
  ["last-verified", { value: "2026-11-07", line: 5 }],
];
const exists = vi.fn<(path: string) => boolean>();

beforeEach(() => {
  vi.mocked(finding).mockReturnValue(PROBLEM);
});

test("a file with no frontmatter is reported on line 1, naming the keys it needs", () => {
  vi.mocked(frontmatter).mockReturnValue(null);
  expect(checkFrontmatter(PLAN, "# Plan A\n", exists)).toEqual([PROBLEM]);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      PLAN,
      1,
      "frontmatter is missing",
      "start the file with --- status, summary, and last-verified ---",
    ],
  ]);
  expect(frontmatter).toHaveBeenCalledWith(PLAN, "# Plan A\n");
});

test("a plan with a status, a summary and a dated last-verified is clean", () => {
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map(PLAN_KEYS),
    errors: [],
  });
  expect(checkFrontmatter(PLAN, "x", exists)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("a plan missing its summary and last-verified reports each on line 1", () => {
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map([["status", { value: "active", line: 2 }]]),
    errors: [],
  });
  checkFrontmatter(PLAN, "x", exists);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [PLAN, 1, "frontmatter summary is missing", "add a summary: line"],
    [
      PLAN,
      1,
      "frontmatter last-verified is missing",
      "add a last-verified: line",
    ],
  ]);
});

test("a plan's status must be active or done, and the finding sits on the status line", () => {
  const keys = new Map(PLAN_KEYS);
  keys.set("status", { value: "accepted", line: 2 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkFrontmatter(PLAN, "x", exists);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [PLAN, 2, "frontmatter status is accepted", "use one of active, done"],
  ]);
});

test("an ADR's status must be proposed, accepted or superseded", () => {
  const keys = new Map(ADR_KEYS);
  keys.set("status", { value: "active", line: 2 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkFrontmatter(ADR, "x", exists);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      ADR,
      2,
      "frontmatter status is active",
      "use one of proposed, accepted, superseded",
    ],
  ]);
});

test("last-verified must be YYYY-MM-DD for a plan, but a plan's date is not checked", () => {
  const keys = new Map(PLAN_KEYS);
  keys.set("last-verified", { value: "yesterday", line: 4 });
  keys.set("date", { value: "soon", line: 5 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkFrontmatter(PLAN, "x", exists);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      PLAN,
      4,
      "frontmatter last-verified is yesterday",
      "use a YYYY-MM-DD date",
    ],
  ]);
});

test("an ADR needs a date, and an ADR's date must be YYYY-MM-DD", () => {
  const soon = new Map(ADR_KEYS);
  soon.set("date", { value: "soon", line: 3 });
  vi.mocked(frontmatter).mockReturnValue({ keys: soon, errors: [] });
  checkFrontmatter(ADR, "x", exists);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [ADR, 3, "frontmatter date is soon", "use a YYYY-MM-DD date"],
  ]);

  vi.mocked(finding).mockClear();
  const missing = new Map(ADR_KEYS);
  missing.delete("date");
  vi.mocked(frontmatter).mockReturnValue({ keys: missing, errors: [] });
  checkFrontmatter(ADR, "x", exists);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [ADR, 1, "frontmatter date is missing", "add a date: line"],
  ]);
});

test("a superseded ADR needs superseded-by, and it must name an ADR that exists", () => {
  const keys = new Map(ADR_KEYS);
  keys.set("status", { value: "superseded", line: 2 });
  keys.set("superseded-by", { value: "docs/decisions/0009-none.md", line: 6 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  exists.mockReturnValue(false);
  checkFrontmatter(ADR, "x", exists);
  expect(exists).toHaveBeenCalledWith("docs/decisions/0009-none.md");
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      ADR,
      6,
      "frontmatter superseded-by docs/decisions/0009-none.md does not exist",
      "use the replacing ADR's path from the repository root",
    ],
  ]);
});

test("a superseded ADR without superseded-by reports the missing key", () => {
  const keys = new Map(ADR_KEYS);
  keys.set("status", { value: "superseded", line: 2 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  checkFrontmatter(ADR, "x", exists);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      ADR,
      1,
      "frontmatter superseded-by is missing",
      "add a superseded-by: line",
    ],
  ]);
});

test("superseded-by on an accepted ADR is only checked for existence, and an existing one passes", () => {
  const keys = new Map(ADR_KEYS);
  keys.set("superseded-by", { value: "docs/decisions/0002-b.md", line: 6 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  exists.mockReturnValue(true);
  expect(checkFrontmatter(ADR, "x", exists)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("a plan's superseded-by is not checked, since only ADRs are superseded", () => {
  const keys = new Map(PLAN_KEYS);
  keys.set("superseded-by", { value: "docs/decisions/0009-none.md", line: 5 });
  vi.mocked(frontmatter).mockReturnValue({ keys, errors: [] });
  expect(checkFrontmatter(PLAN, "x", exists)).toEqual([]);
  expect(exists).not.toHaveBeenCalled();
});

test("problems come in line order, and missing keys come after them", () => {
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map([
      ["status", { value: "active", line: 2 }],
      ["last-verified", { value: "yesterday", line: 3 }],
    ]),
    errors: [],
  });
  checkFrontmatter(ADR, "x", exists);
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      ADR,
      2,
      "frontmatter status is active",
      "use one of proposed, accepted, superseded",
    ],
    [ADR, 3, "frontmatter last-verified is yesterday", "use a YYYY-MM-DD date"],
    [ADR, 1, "frontmatter date is missing", "add a date: line"],
    [ADR, 1, "frontmatter summary is missing", "add a summary: line"],
  ]);
});

test("the parse errors of the frontmatter are reported with the others", () => {
  const error: Finding = {
    file: PLAN,
    line: 4,
    message: "frontmatter tags is not a scalar string",
    fix: "use flat key: value lines only",
  };
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map(PLAN_KEYS),
    errors: [error],
  });
  expect(checkFrontmatter(PLAN, "x", exists)).toEqual([error]);
});
