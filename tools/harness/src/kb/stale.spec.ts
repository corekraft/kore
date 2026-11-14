// Stale documents: plans and ADRs whose last-verified date is older than a file they depend on.
// Plan: infra/plans/5-self-maintenance.md#step-5-stale-documents

import { beforeEach, expect, test, vi } from "vitest";
import { frontmatter, isExternal, proseLines, resolve } from "./markdown.js";
import { staleDocuments } from "./stale.js";

vi.mock("./markdown.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./markdown.js")>()),
  frontmatter: vi.fn(),
  isExternal: vi.fn(),
  proseLines: vi.fn(),
  resolve: vi.fn(),
}));

const PLAN = "infra/plans/1-a.md";
const RULES = "skills/tdd/references/rules.md";
const SKILL = "skills/tdd/SKILL.md";

beforeEach(() => {
  vi.mocked(proseLines).mockReturnValue([]);
  vi.mocked(isExternal).mockReturnValue(false);
  vi.mocked(resolve).mockImplementation((_from, target) => target);
  vi.mocked(frontmatter).mockReturnValue(null);
});

test("without a commit history nothing is stale, and no file is read", async () => {
  const docs: Record<string, string> = {
    [PLAN]: "[rules](../../skills/tdd/references/rules.md)",
    [RULES]: "r",
  };
  expect(
    await staleDocuments({
      files: () => Object.keys(docs),
      read: (p) => docs[p] ?? null,
    }),
  ).toEqual([]);
  expect(frontmatter).not.toHaveBeenCalled();
});

test("a plan verified before a file it links to changed is stale, naming the newest such file", async () => {
  const docs: Record<string, string> = {
    [PLAN]:
      "[rules](../../skills/tdd/references/rules.md) [skill](../../skills/tdd/SKILL.md)",
    [RULES]: "r",
    [SKILL]: "s",
  };
  const dates: Record<string, string> = {
    [RULES]: "2026-11-09",
    [SKILL]: "2026-11-12",
  };
  vi.mocked(proseLines).mockReturnValue([{ line: 1, text: docs[PLAN] ?? "" }]);
  vi.mocked(resolve).mockImplementation(
    (_from, target) =>
      ({
        "../../skills/tdd/references/rules.md": RULES,
        "../../skills/tdd/SKILL.md": SKILL,
      })[target] ?? target,
  );
  vi.mocked(frontmatter).mockImplementation((file) =>
    file === PLAN
      ? {
          keys: new Map([["last-verified", { value: "2026-11-07", line: 2 }]]),
          errors: [],
        }
      : null,
  );
  const commitDate = vi.fn((path: string) =>
    Promise.resolve(dates[path] ?? null),
  );
  expect(
    await staleDocuments({
      files: () => Object.keys(docs),
      read: (p) => docs[p] ?? null,
      commitDate,
    }),
  ).toEqual([
    { document: PLAN, verified: "2026-11-07", path: SKILL, date: "2026-11-12" },
  ]);
});

test("a plan verified on the day its newest file changed is current", async () => {
  const docs: Record<string, string> = {
    [PLAN]: "[skill](../../skills/tdd/SKILL.md)",
    [SKILL]: "s",
  };
  vi.mocked(proseLines).mockReturnValue([{ line: 1, text: docs[PLAN] ?? "" }]);
  vi.mocked(resolve).mockReturnValue(SKILL);
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map([["last-verified", { value: "2026-11-12", line: 2 }]]),
    errors: [],
  });
  const commitDate = vi.fn((path: string) =>
    Promise.resolve(path === SKILL ? "2026-11-12" : null),
  );
  expect(
    await staleDocuments({
      files: () => Object.keys(docs),
      read: (p) => docs[p] ?? null,
      commitDate,
    }),
  ).toEqual([]);
});

test("a file whose Docs, Plan or ADR marker points back at a plan makes that plan stale", async () => {
  const docs: Record<string, string> = {
    [PLAN]: "p",
    "tools/kore/src/app/index.ts": `// Plan: ${PLAN}. Main module.`,
  };
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map([["last-verified", { value: "2026-11-07", line: 2 }]]),
    errors: [],
  });
  const commitDate = vi.fn((path: string) =>
    Promise.resolve(
      path === "tools/kore/src/app/index.ts" ? "2026-12-01" : null,
    ),
  );
  expect(
    await staleDocuments({
      files: () => Object.keys(docs),
      read: (p) => docs[p] ?? null,
      commitDate,
    }),
  ).toEqual([
    {
      document: PLAN,
      verified: "2026-11-07",
      path: "tools/kore/src/app/index.ts",
      date: "2026-12-01",
    },
  ]);
});

test("ADRs are stale through markers too, and the results are sorted by document", async () => {
  const docs: Record<string, string> = {
    "docs/decisions/0002-b.md": "d",
    "docs/decisions/0001-a.md": "d",
    "tools/a.ts": "// ADR: docs/decisions/0002-b.md",
    "tools/b.ts": "// ADR: docs/decisions/0001-a.md",
  };
  const dates: Record<string, string> = {
    "tools/a.ts": "2026-12-01",
    "tools/b.ts": "2026-12-02",
  };
  vi.mocked(frontmatter).mockImplementation((file) =>
    file.startsWith("docs/decisions/")
      ? {
          keys: new Map([["last-verified", { value: "2026-11-07", line: 2 }]]),
          errors: [],
        }
      : null,
  );
  const commitDate = vi.fn((path: string) =>
    Promise.resolve(dates[path] ?? null),
  );
  expect(
    await staleDocuments({
      files: () => Object.keys(docs),
      read: (p) => docs[p] ?? null,
      commitDate,
    }),
  ).toEqual([
    {
      document: "docs/decisions/0001-a.md",
      verified: "2026-11-07",
      path: "tools/b.ts",
      date: "2026-12-02",
    },
    {
      document: "docs/decisions/0002-b.md",
      verified: "2026-11-07",
      path: "tools/a.ts",
      date: "2026-12-01",
    },
  ]);
});

test("a document with no history for its files is never stale", async () => {
  const docs: Record<string, string> = {
    [PLAN]: "[rules](../../skills/tdd/references/rules.md)",
    [RULES]: "r",
  };
  vi.mocked(proseLines).mockReturnValue([{ line: 1, text: docs[PLAN] ?? "" }]);
  vi.mocked(resolve).mockReturnValue(RULES);
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map([["last-verified", { value: "2026-11-07", line: 2 }]]),
    errors: [],
  });
  const commitDate = vi.fn(() => Promise.resolve(null));
  expect(
    await staleDocuments({
      files: () => Object.keys(docs),
      read: (p) => docs[p] ?? null,
      commitDate,
    }),
  ).toEqual([]);
  expect(commitDate.mock.calls).toEqual([[RULES]]);
});

test("a document without a valid last-verified date is skipped, not judged", async () => {
  const docs: Record<string, string> = {
    [PLAN]: `[skill](../../${SKILL})`,
    "infra/plans/2-b.md": `[skill](../../${SKILL})`,
    [SKILL]: "s",
  };
  vi.mocked(proseLines).mockReturnValue([{ line: 1, text: "[skill]" }]);
  vi.mocked(resolve).mockReturnValue(SKILL);
  vi.mocked(frontmatter).mockImplementation((file) =>
    file === PLAN
      ? {
          keys: new Map([["last-verified", { value: "yesterday", line: 2 }]]),
          errors: [],
        }
      : null,
  );
  const commitDate = vi.fn(() => Promise.resolve("2026-12-01"));
  expect(
    await staleDocuments({
      files: () => Object.keys(docs),
      read: (p) => docs[p] ?? null,
      commitDate,
    }),
  ).toEqual([]);
});

test("a document is not its own dependency, and a link to an untracked path is not asked about", async () => {
  const docs: Record<string, string> = {
    [PLAN]: `[self](1-a.md) [gone](../../nowhere.md) [skill](../../${SKILL})`,
    [SKILL]: "s",
  };
  vi.mocked(proseLines).mockReturnValue([{ line: 1, text: docs[PLAN] ?? "" }]);
  vi.mocked(resolve).mockImplementation(
    (_from, target) =>
      ({
        "1-a.md": PLAN,
        "../../nowhere.md": "nowhere.md",
        [`../../${SKILL}`]: SKILL,
      })[target] ?? target,
  );
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map([["last-verified", { value: "2026-11-07", line: 2 }]]),
    errors: [],
  });
  const commitDate = vi.fn((path: string) =>
    Promise.resolve(path === SKILL ? "2026-12-01" : null),
  );
  expect(
    await staleDocuments({
      files: () => Object.keys(docs),
      read: (p) => docs[p] ?? null,
      commitDate,
    }),
  ).toEqual([
    { document: PLAN, verified: "2026-11-07", path: SKILL, date: "2026-12-01" },
  ]);
  expect(commitDate.mock.calls).toEqual([[SKILL]]);
});

test("external links, anchor-only links and markers to non-plan documents are not dependencies", async () => {
  const docs: Record<string, string> = {
    [PLAN]: "[web](https://x.test) [here](#top)",
    "tools/x.ts": "// Docs: skills/tdd/SKILL.md",
    "docs/guide.md": "g",
  };
  vi.mocked(proseLines).mockReturnValue([{ line: 1, text: docs[PLAN] ?? "" }]);
  vi.mocked(isExternal).mockImplementation(
    (target) => target === "https://x.test",
  );
  vi.mocked(frontmatter).mockReturnValue({
    keys: new Map([["last-verified", { value: "2026-11-07", line: 2 }]]),
    errors: [],
  });
  const commitDate = vi.fn(() => Promise.resolve("2026-12-01"));
  expect(
    await staleDocuments({
      files: () => Object.keys(docs),
      read: (p) => docs[p] ?? null,
      commitDate,
    }),
  ).toEqual([]);
  expect(commitDate).not.toHaveBeenCalled();
});

test("an unreadable file contributes no dependency and no staleness", async () => {
  const commitDate = vi.fn(() => Promise.resolve("2026-12-01"));
  const unreadable = {
    files: () => [PLAN, "tools/x.ts"],
    read: () => null,
    commitDate,
  };
  expect(await staleDocuments(unreadable)).toEqual([]);
  expect(commitDate).not.toHaveBeenCalled();
});
