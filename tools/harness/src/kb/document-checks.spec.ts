// Frontmatter checks for plans and ADRs: the required keys, the allowed values, and superseded-by.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { checkFrontmatter } from "./document-checks.js";
import { fakeFinding, keysOf } from "./kb-support.js";
import { finding, frontmatter, type Finding } from "./markdown.js";

vi.mock("./markdown.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./markdown.js")>()),
  finding: vi.fn(),
  frontmatter: vi.fn(),
}));

const PLAN = "infra/plans/1-a.md";
const ADR = "docs/decisions/0001-a.md";
const exists = vi.fn<(path: string) => boolean>();

/** What frontmatter() returns for these entries, with the given parse errors. */
function parsed(entries: Record<string, string>, errors: Finding[] = []) {
  return { keys: keysOf(entries), errors };
}

beforeEach(() => {
  vi.mocked(finding).mockImplementation(fakeFinding);
});

test("a file with no frontmatter is reported on line 1, naming the keys it needs", () => {
  vi.mocked(frontmatter).mockReturnValue(null);
  expect(checkFrontmatter(PLAN, "# Plan A\n", exists)).toEqual([
    {
      file: PLAN,
      line: 1,
      message: "frontmatter is missing",
      fix: "start the file with --- status, summary, and last-verified ---",
    },
  ]);
  expect(frontmatter).toHaveBeenCalledWith(PLAN, "# Plan A\n");
});

test("a plan with a status, a summary and a dated last-verified is clean", () => {
  vi.mocked(frontmatter).mockReturnValue(
    parsed({
      status: "active",
      summary: "Delivers A.",
      "last-verified": "2026-11-07",
    }),
  );
  expect(checkFrontmatter(PLAN, "x", exists)).toEqual([]);
});

test("a plan missing its summary and last-verified reports each on line 1", () => {
  vi.mocked(frontmatter).mockReturnValue(parsed({ status: "active" }));
  expect(checkFrontmatter(PLAN, "x", exists)).toEqual([
    {
      file: PLAN,
      line: 1,
      message: "frontmatter summary is missing",
      fix: "add a summary: line",
    },
    {
      file: PLAN,
      line: 1,
      message: "frontmatter last-verified is missing",
      fix: "add a last-verified: line",
    },
  ]);
});

test("a plan's status must be active or done, and the finding sits on the status line", () => {
  vi.mocked(frontmatter).mockReturnValue(
    parsed({
      status: "accepted",
      summary: "x",
      "last-verified": "2026-11-07",
    }),
  );
  expect(checkFrontmatter(PLAN, "x", exists)).toEqual([
    {
      file: PLAN,
      line: 2,
      message: "frontmatter status is accepted",
      fix: "use one of active, done",
    },
  ]);
});

test("an ADR's status must be proposed, accepted or superseded", () => {
  vi.mocked(frontmatter).mockReturnValue(
    parsed({
      status: "active",
      date: "2026-09-13",
      summary: "x",
      "last-verified": "2026-11-07",
    }),
  );
  expect(checkFrontmatter(ADR, "x", exists)).toEqual([
    {
      file: ADR,
      line: 2,
      message: "frontmatter status is active",
      fix: "use one of proposed, accepted, superseded",
    },
  ]);
});

test("last-verified must be YYYY-MM-DD for a plan, but a plan's date is not checked", () => {
  vi.mocked(frontmatter).mockReturnValue(
    parsed({
      status: "active",
      summary: "x",
      "last-verified": "yesterday",
      date: "soon",
    }),
  );
  expect(checkFrontmatter(PLAN, "x", exists)).toEqual([
    {
      file: PLAN,
      line: 4,
      message: "frontmatter last-verified is yesterday",
      fix: "use a YYYY-MM-DD date",
    },
  ]);
});

test("an ADR needs a date, and an ADR's date must be YYYY-MM-DD", () => {
  vi.mocked(frontmatter).mockReturnValue(
    parsed({
      status: "accepted",
      date: "soon",
      summary: "x",
      "last-verified": "2026-11-07",
    }),
  );
  expect(checkFrontmatter(ADR, "x", exists)).toEqual([
    {
      file: ADR,
      line: 3,
      message: "frontmatter date is soon",
      fix: "use a YYYY-MM-DD date",
    },
  ]);
  vi.mocked(frontmatter).mockReturnValue(
    parsed({ status: "accepted", summary: "x", "last-verified": "2026-11-07" }),
  );
  expect(checkFrontmatter(ADR, "x", exists)).toEqual([
    {
      file: ADR,
      line: 1,
      message: "frontmatter date is missing",
      fix: "add a date: line",
    },
  ]);
});

test("a superseded ADR needs a superseded-by, and it must name an ADR that exists", () => {
  const superseded = parsed({
    status: "superseded",
    date: "2026-09-13",
    summary: "x",
    "last-verified": "2026-11-07",
    "superseded-by": "docs/decisions/0009-none.md",
  });
  vi.mocked(frontmatter).mockReturnValue(superseded);
  exists.mockReturnValue(false);
  expect(checkFrontmatter(ADR, "x", exists)).toEqual([
    {
      file: ADR,
      line: 6,
      message:
        "frontmatter superseded-by docs/decisions/0009-none.md does not exist",
      fix: "use the replacing ADR's path from the repository root",
    },
  ]);
  expect(exists).toHaveBeenCalledWith("docs/decisions/0009-none.md");
});

test("a superseded ADR without superseded-by reports the missing key", () => {
  vi.mocked(frontmatter).mockReturnValue(
    parsed({
      status: "superseded",
      date: "2026-09-13",
      summary: "x",
      "last-verified": "2026-11-07",
    }),
  );
  expect(checkFrontmatter(ADR, "x", exists)).toEqual([
    {
      file: ADR,
      line: 1,
      message: "frontmatter superseded-by is missing",
      fix: "add a superseded-by: line",
    },
  ]);
});

test("superseded-by on an accepted ADR is only checked for existence, and an existing one passes", () => {
  vi.mocked(frontmatter).mockReturnValue(
    parsed({
      status: "accepted",
      date: "2026-09-13",
      summary: "x",
      "last-verified": "2026-11-07",
      "superseded-by": "docs/decisions/0002-b.md",
    }),
  );
  exists.mockReturnValue(true);
  expect(checkFrontmatter(ADR, "x", exists)).toEqual([]);
});

test("a plan's superseded-by is not checked, since only ADRs are superseded", () => {
  vi.mocked(frontmatter).mockReturnValue(
    parsed({
      status: "active",
      summary: "x",
      "last-verified": "2026-11-07",
      "superseded-by": "docs/decisions/0009-none.md",
    }),
  );
  expect(checkFrontmatter(PLAN, "x", exists)).toEqual([]);
  expect(exists).not.toHaveBeenCalled();
});

test("problems come in line order, and missing keys come after them", () => {
  vi.mocked(frontmatter).mockReturnValue(
    parsed({ status: "active", "last-verified": "yesterday" }),
  );
  expect(checkFrontmatter(ADR, "x", exists)).toEqual([
    {
      file: ADR,
      line: 2,
      message: "frontmatter status is active",
      fix: "use one of proposed, accepted, superseded",
    },
    {
      file: ADR,
      line: 3,
      message: "frontmatter last-verified is yesterday",
      fix: "use a YYYY-MM-DD date",
    },
    {
      file: ADR,
      line: 1,
      message: "frontmatter date is missing",
      fix: "add a date: line",
    },
    {
      file: ADR,
      line: 1,
      message: "frontmatter summary is missing",
      fix: "add a summary: line",
    },
  ]);
});

test("the parse errors of the frontmatter are reported with the others", () => {
  const error = fakeFinding(
    PLAN,
    4,
    "frontmatter tags is not a scalar string",
    "use flat key: value lines only",
  );
  vi.mocked(frontmatter).mockReturnValue(
    parsed({ status: "active", summary: "x", "last-verified": "2026-11-07" }, [
      error,
    ]),
  );
  expect(checkFrontmatter(PLAN, "x", exists)).toEqual([error]);
});
