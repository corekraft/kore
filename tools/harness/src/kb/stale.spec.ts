// Stale documents: plans and ADRs whose last-verified date is older than a file they depend on.
// Plan: infra/plans/5-self-maintenance.md#step-5-stale-documents

import { beforeEach, expect, test, vi } from "vitest";
import { keysOf, fakeProse, fakeTree } from "./kb-support.js";
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

/** Each file's last-verified date; a file missing from the map has no frontmatter. */
function verified(dates: Record<string, string>): void {
  vi.mocked(frontmatter).mockImplementation((file) =>
    dates[file] === undefined
      ? null
      : { keys: keysOf({ "last-verified": dates[file] }), errors: [] },
  );
}

/** A commit-date source over a fixture: the newest commit date per path, or null. */
function history(dates: Record<string, string>) {
  return vi.fn((path: string) => Promise.resolve(dates[path] ?? null));
}

beforeEach(() => {
  vi.mocked(proseLines).mockImplementation(fakeProse);
  vi.mocked(isExternal).mockReturnValue(false);
  vi.mocked(resolve).mockImplementation((_from, target) =>
    target.replace(/^(\.\.\/)+/, ""),
  );
  verified({});
});

test("without a commit history nothing is stale, and no file is read", async () => {
  const tree = fakeTree({ [PLAN]: `[rules](../../${RULES})\n`, [RULES]: "r" });
  expect(await staleDocuments(tree)).toEqual([]);
  expect(frontmatter).not.toHaveBeenCalled();
});

test("a plan verified before a file it links to changed is stale, naming the newest such file", async () => {
  verified({ [PLAN]: "2026-11-07" });
  const commitDate = history({ [RULES]: "2026-11-09", [SKILL]: "2026-11-12" });
  const tree = fakeTree({
    [PLAN]: `[rules](../../${RULES}) [skill](../../${SKILL})\n`,
    [RULES]: "r",
    [SKILL]: "s",
  });
  expect(await staleDocuments({ ...tree, commitDate })).toEqual([
    { document: PLAN, verified: "2026-11-07", path: SKILL, date: "2026-11-12" },
  ]);
});

test("a plan verified on the day its newest file changed is current", async () => {
  verified({ [PLAN]: "2026-11-12" });
  const commitDate = history({ [SKILL]: "2026-11-12" });
  const tree = fakeTree({ [PLAN]: `[skill](../../${SKILL})\n`, [SKILL]: "s" });
  expect(await staleDocuments({ ...tree, commitDate })).toEqual([]);
});

test("a file whose Docs, Plan or ADR marker points back at a plan or ADR makes it stale", async () => {
  verified({ [PLAN]: "2026-11-07" });
  const commitDate = history({ "tools/kore/src/app/index.ts": "2026-12-01" });
  const tree = fakeTree({
    [PLAN]: "p",
    "tools/kore/src/app/index.ts": `// Plan: ${PLAN}. Main module.\n`,
  });
  expect(await staleDocuments({ ...tree, commitDate })).toEqual([
    {
      document: PLAN,
      verified: "2026-11-07",
      path: "tools/kore/src/app/index.ts",
      date: "2026-12-01",
    },
  ]);
});

test("ADRs are stale through markers too, and the results are sorted by document", async () => {
  verified({
    "docs/decisions/0001-a.md": "2026-11-07",
    "docs/decisions/0002-b.md": "2026-11-07",
  });
  const commitDate = history({
    "tools/a.ts": "2026-12-01",
    "tools/b.ts": "2026-12-02",
  });
  const tree = fakeTree({
    "docs/decisions/0002-b.md": "d",
    "docs/decisions/0001-a.md": "d",
    "tools/a.ts": "// ADR: docs/decisions/0002-b.md\n",
    "tools/b.ts": "// ADR: docs/decisions/0001-a.md\n",
  });
  expect(await staleDocuments({ ...tree, commitDate })).toEqual([
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
  verified({ [PLAN]: "2026-11-07" });
  const commitDate = history({});
  const tree = fakeTree({ [PLAN]: `[rules](../../${RULES})\n`, [RULES]: "r" });
  expect(await staleDocuments({ ...tree, commitDate })).toEqual([]);
  expect(commitDate.mock.calls).toEqual([[RULES]]);
});

test("a document without a valid last-verified date is skipped, not judged", async () => {
  verified({ [PLAN]: "yesterday" });
  const commitDate = history({ [SKILL]: "2026-12-01" });
  const tree = fakeTree({
    [PLAN]: `[skill](../../${SKILL})\n`,
    "infra/plans/2-b.md": `[skill](../../${SKILL})\n`,
    [SKILL]: "s",
  });
  expect(await staleDocuments({ ...tree, commitDate })).toEqual([]);
});

test("a document is not its own dependency, and a link to an untracked path is not asked about", async () => {
  verified({ [PLAN]: "2026-11-07" });
  vi.mocked(resolve).mockImplementation(
    (_from, target) =>
      ({
        "1-a.md": PLAN,
        "../../nowhere.md": "nowhere.md",
        [`../../${SKILL}`]: SKILL,
      })[target] ?? target,
  );
  const commitDate = history({ [SKILL]: "2026-12-01" });
  const tree = fakeTree({
    [PLAN]: `[self](1-a.md) [gone](../../nowhere.md) [skill](../../${SKILL})\n`,
    [SKILL]: "s",
  });
  expect(await staleDocuments({ ...tree, commitDate })).toEqual([
    { document: PLAN, verified: "2026-11-07", path: SKILL, date: "2026-12-01" },
  ]);
  expect(commitDate.mock.calls).toEqual([[SKILL]]);
});

test("external links, anchor-only links and markers to non-plan documents are not dependencies", async () => {
  verified({ [PLAN]: "2026-11-07" });
  vi.mocked(isExternal).mockImplementation((target) =>
    target.startsWith("https://"),
  );
  const commitDate = history({ "docs/guide.md": "2026-12-01" });
  const tree = fakeTree({
    [PLAN]: "[web](https://x.test) [here](#top)\n",
    "tools/x.ts": "// Docs: skills/tdd/SKILL.md\n",
    "docs/guide.md": "g",
  });
  expect(await staleDocuments({ ...tree, commitDate })).toEqual([]);
  expect(commitDate).not.toHaveBeenCalled();
});

test("an unreadable file contributes no dependency and no staleness", async () => {
  const commitDate = history({ "tools/x.ts": "2026-12-01" });
  const unreadable = {
    files: () => [PLAN, "tools/x.ts"],
    read: () => null,
    commitDate,
  };
  expect(await staleDocuments(unreadable)).toEqual([]);
  expect(commitDate).not.toHaveBeenCalled();
});
