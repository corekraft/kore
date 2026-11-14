// The knowledge health check's problems: links and anchors, the index, idea numbers, Docs/Plan/ADR markers and README coverage.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { checkFrontmatter } from "./document-checks.js";
import { findings } from "./findings.js";
import { checkIdea } from "./idea-checks.js";
import { FIX_INDEX, FIX_LINK, PROBLEM } from "./kb-support.js";
import {
  anchors,
  finding,
  isExternal,
  proseLines,
  resolve,
} from "./markdown.js";

vi.mock("./document-checks.js", () => ({ checkFrontmatter: vi.fn() }));
vi.mock("./idea-checks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./idea-checks.js")>()),
  checkIdea: vi.fn(),
}));
vi.mock("./markdown.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./markdown.js")>()),
  anchors: vi.fn(),
  finding: vi.fn(),
  isExternal: vi.fn(),
  proseLines: vi.fn(),
  resolve: vi.fn(),
}));

/** The problems of a tree given as literal file texts. */
function scan(docs: Record<string, string>) {
  return findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
}

/** The arguments finding() was called with, one array per problem. */
const calls = () => vi.mocked(finding).mock.calls;

/** proseLines() of this text returns these lines; every other file has none. */
const proseOf = (text: string, lines: { line: number; text: string }[]) =>
  vi.mocked(proseLines).mockImplementation((t) => (t === text ? lines : []));

beforeEach(() => {
  vi.mocked(finding).mockReturnValue(PROBLEM);
  vi.mocked(proseLines).mockReturnValue([]);
  vi.mocked(isExternal).mockReturnValue(false);
  vi.mocked(resolve).mockImplementation((_from, target) => target);
  vi.mocked(anchors).mockReturnValue([]);
  vi.mocked(checkFrontmatter).mockReturnValue([]);
  vi.mocked(checkIdea).mockReturnValue([]);
});

test("a tree with an index and nothing to check reports nothing", () => {
  expect(scan({ "docs/index.md": "" })).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("a relative link to a missing file is reported on its line", () => {
  proseOf("# A\n[rules](references/gone.md)", [
    { line: 1, text: "# A" },
    { line: 2, text: "[rules](references/gone.md)" },
  ]);
  vi.mocked(resolve).mockReturnValue("docs/references/gone.md");
  scan({
    "docs/index.md": "",
    "docs/a.md": "# A\n[rules](references/gone.md)",
  });
  expect(calls()).toEqual([
    [
      "docs/a.md",
      2,
      "link target docs/references/gone.md does not exist",
      FIX_LINK,
    ],
  ]);
});

test("a link that leaves the repository is reported with the path as written", () => {
  proseOf("[up](../../../x.md)", [{ line: 1, text: "[up](../../../x.md)" }]);
  vi.mocked(resolve).mockReturnValue(null);
  scan({ "docs/index.md": "", "docs/a.md": "[up](../../../x.md)" });
  expect(calls()).toEqual([
    ["docs/a.md", 1, "link target ../../../x.md does not exist", FIX_LINK],
  ]);
});

test("external links are never resolved, and a bare anchor is checked against the file's own headings", () => {
  const text = "[web](https://x.test/a) [top](#intro) [bad](#nowhere)";
  proseOf(text, [{ line: 1, text }]);
  vi.mocked(isExternal).mockImplementation((t) => t === "https://x.test/a");
  vi.mocked(anchors).mockReturnValue(["intro"]);
  scan({ "docs/index.md": "", "docs/a.md": text });
  expect(calls()).toEqual([
    [
      "docs/a.md",
      1,
      "link anchor #nowhere is not a heading in docs/a.md",
      "use one of its heading slugs, e.g. #intro",
    ],
  ]);
  expect(resolve).not.toHaveBeenCalledWith("docs/a.md", "https://x.test/a");
});

test("an anchor into a file with no headings says to remove the anchor", () => {
  proseOf("[n](notes.md#gone)", [{ line: 1, text: "[n](notes.md#gone)" }]);
  vi.mocked(resolve).mockReturnValue("docs/notes.md");
  scan({
    "docs/index.md": "",
    "docs/notes.md": "plain",
    "docs/a.md": "[n](notes.md#gone)",
  });
  expect(calls()).toEqual([
    [
      "docs/a.md",
      1,
      "link anchor #gone is not a heading in docs/notes.md",
      "remove the anchor; the file has no headings",
    ],
  ]);
});

test("an existing anchor passes, and an anchor into a non-Markdown file is not checked", () => {
  proseOf("[ok](rules.md#rules) [code](src/a.ts#L3)", [
    { line: 1, text: "[ok](rules.md#rules) [code](src/a.ts#L3)" },
  ]);
  vi.mocked(resolve).mockImplementation(
    (_from, target) =>
      ({ "rules.md": "docs/rules.md", "src/a.ts": "src/a.ts" })[target] ?? null,
  );
  vi.mocked(anchors).mockReturnValue(["rules"]);
  expect(
    scan({
      "docs/index.md": "",
      "docs/rules.md": "# Rules",
      "src/a.ts": "export {};",
      "docs/a.md": "[ok](rules.md#rules) [code](src/a.ts#L3)",
    }),
  ).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("a link to a tracked directory exists, and the repository root is a valid target", () => {
  proseOf("[dir](references/) [root](.)", [
    { line: 1, text: "[dir](references/) [root](.)" },
  ]);
  vi.mocked(resolve).mockImplementation((_from, target) =>
    target === "." ? "." : "docs/references",
  );
  expect(
    scan({
      "docs/index.md": "",
      "docs/references/rules.md": "# Rules",
      "docs/tdd.md": "[dir](references/) [root](.)",
    }),
  ).toEqual([]);
});

test("plans and ADRs get the frontmatter check, and ideas the idea check with their numbers", () => {
  scan({
    "docs/index.md": "",
    "infra/plans/1-a.md": "p",
    "docs/decisions/0001-a.md": "d",
    "docs/ideas/0001-a.md": "i",
  });
  expect(checkFrontmatter).toHaveBeenCalledWith(
    "infra/plans/1-a.md",
    "p",
    expect.any(Function),
  );
  expect(checkFrontmatter).toHaveBeenCalledWith(
    "docs/decisions/0001-a.md",
    "d",
    expect.any(Function),
  );
  expect(checkIdea).toHaveBeenCalledTimes(1);
  expect(checkIdea).toHaveBeenCalledWith(
    "docs/ideas/0001-a.md",
    "i",
    new Map([["0001", "docs/ideas/0001-a.md"]]),
  );
});

test("two idea files that share a number are reported on the later one, naming the earlier", () => {
  scan({
    "docs/index.md": "",
    "docs/ideas/0001-a.md": "a",
    "docs/ideas/0001-b.md": "b",
  });
  expect(calls()).toContainEqual([
    "docs/ideas/0001-b.md",
    1,
    "idea number 0001 is also used by docs/ideas/0001-a.md",
    "renumber it to the next free number",
  ]);
});

test("an index entry naming a missing file is reported, and so is a plan the index omits", () => {
  const index =
    "# Index\n\n- [`infra/plans/9-gone.md`](../infra/plans/9-gone.md) — gone.";
  proseOf(index, [
    { line: 1, text: "# Index" },
    { line: 2, text: "" },
    {
      line: 3,
      text: "- [`infra/plans/9-gone.md`](../infra/plans/9-gone.md) — gone.",
    },
  ]);
  vi.mocked(resolve).mockImplementation(
    (_from, target) =>
      ({ "../infra/plans/9-gone.md": "infra/plans/9-gone.md" })[target] ?? null,
  );
  scan({ "docs/index.md": index, "infra/plans/2-b.md": "p" });
  expect(calls()).toEqual([
    [
      "docs/index.md",
      3,
      "link target infra/plans/9-gone.md does not exist",
      FIX_LINK,
    ],
    [
      "docs/index.md",
      3,
      "index entry infra/plans/9-gone.md names a missing file",
      "remove the entry or restore the file",
    ],
    [
      "docs/index.md",
      1,
      "infra/plans/2-b.md is not in the index",
      "add an entry under its ## heading",
    ],
  ]);
});

test("a missing index is reported once, on line 1", () => {
  scan({ "infra/plans/1-a.md": "p" });
  expect(calls()).toContainEqual([
    "docs/index.md",
    1,
    "the knowledge index is missing",
    FIX_INDEX,
  ]);
});

test("a file that cannot be read is skipped, and an unreadable index is a missing index", () => {
  const unreadable = {
    files: () => ["docs/index.md", "docs/a.md", "tools/x.ts"],
    read: () => null,
  };
  expect(findings(unreadable)).toEqual([PROBLEM]);
  expect(calls()).toEqual([
    ["docs/index.md", 1, "the knowledge index is missing", FIX_INDEX],
  ]);
});

test("Docs:, Plan: and ADR: markers whose path or anchor does not resolve are reported", () => {
  vi.mocked(anchors).mockReturnValue(["adr-0001-a"]);
  scan({
    "docs/index.md": "",
    "docs/decisions/0001-a.md": "# ADR 0001: A",
    "tools/kore/src/a.ts": "// Docs: infra/plans/9-gone.md#x",
    "tools/kore/src/b.ts": "// ADR: docs/decisions/0001-a.md#no-such",
  });
  expect(calls()).toContainEqual([
    "tools/kore/src/a.ts",
    1,
    "Docs: path infra/plans/9-gone.md does not exist",
    "use a path from the repository root",
  ]);
  expect(calls()).toContainEqual([
    "tools/kore/src/b.ts",
    1,
    "ADR: anchor #no-such is not a heading in docs/decisions/0001-a.md",
    "use one of its heading slugs, e.g. #adr-0001-a",
  ]);
});

test("the CLI usage text's commands must each appear in README.md, once each", () => {
  scan({
    "docs/index.md": "",
    "README.md": "Run `kore -- doctor`.",
    "tools/kore/src/cli/cli.ts": [
      "const usage = `kore",
      "",
      "Usage:",
      "  kore doctor [--json]",
      "  kore doctor [--json]",
      "  kore cluster up",
      "  options:",
      "",
      "`;",
    ].join("\n"),
  });
  expect(calls()).toEqual([
    [
      "tools/kore/src/cli/cli.ts",
      6,
      "kore cluster is in the CLI usage text but README.md does not mention it",
      "document it in README.md",
    ],
  ]);
});
