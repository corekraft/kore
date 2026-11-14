// The knowledge health check's problems: links and anchors, the index, idea numbers, Docs/Plan/ADR markers and README coverage.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { checkFrontmatter } from "./document-checks.js";
import { findings } from "./findings.js";
import { checkIdea } from "./idea-checks.js";
import {
  anchors,
  finding,
  isExternal,
  proseLines,
  resolve,
  type Finding,
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

const FIX_LINK = "point the link at an existing file or remove it";
const FIX_INDEX = "create it with one entry per plan, ADR, and skill";
const PROBLEM: Finding = { file: "", line: 0, message: "", fix: "" };

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
  const docs: Record<string, string> = { "docs/index.md": "" };
  expect(
    findings({
      files: () => Object.keys(docs),
      read: (path) => docs[path] ?? null,
    }),
  ).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("a relative link to a missing file is reported on its line", () => {
  const docs: Record<string, string> = {
    "docs/index.md": "",
    "docs/a.md": "# A\n[rules](references/gone.md)",
  };
  vi.mocked(proseLines).mockImplementation((text) =>
    text === "# A\n[rules](references/gone.md)"
      ? [
          { line: 1, text: "# A" },
          { line: 2, text: "[rules](references/gone.md)" },
        ]
      : [],
  );
  vi.mocked(resolve).mockReturnValue("docs/references/gone.md");
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      "docs/a.md",
      2,
      "link target docs/references/gone.md does not exist",
      FIX_LINK,
    ],
  ]);
});

test("a link that leaves the repository is reported with the path as written", () => {
  const docs: Record<string, string> = {
    "docs/index.md": "",
    "docs/a.md": "[up](../../../x.md)",
  };
  vi.mocked(proseLines).mockImplementation((text) =>
    text === "[up](../../../x.md)" ? [{ line: 1, text }] : [],
  );
  vi.mocked(resolve).mockReturnValue(null);
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
  expect(vi.mocked(finding).mock.calls).toEqual([
    ["docs/a.md", 1, "link target ../../../x.md does not exist", FIX_LINK],
  ]);
});

test("external links are never resolved, and a bare anchor is checked against the file's own headings", () => {
  const text = "[web](https://x.test/a) [top](#intro) [bad](#nowhere)";
  const docs: Record<string, string> = {
    "docs/index.md": "",
    "docs/a.md": text,
  };
  vi.mocked(proseLines).mockImplementation((t) =>
    t === text ? [{ line: 1, text }] : [],
  );
  vi.mocked(isExternal).mockImplementation(
    (target) => target === "https://x.test/a",
  );
  vi.mocked(anchors).mockReturnValue(["intro"]);
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
  expect(vi.mocked(finding).mock.calls).toEqual([
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
  const docs: Record<string, string> = {
    "docs/index.md": "",
    "docs/notes.md": "plain",
    "docs/a.md": "[n](notes.md#gone)",
  };
  vi.mocked(proseLines).mockImplementation((t) =>
    t === "[n](notes.md#gone)" ? [{ line: 1, text: t }] : [],
  );
  vi.mocked(resolve).mockReturnValue("docs/notes.md");
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      "docs/a.md",
      1,
      "link anchor #gone is not a heading in docs/notes.md",
      "remove the anchor; the file has no headings",
    ],
  ]);
});

test("an existing anchor passes, and an anchor into a non-Markdown file is not checked", () => {
  const docs: Record<string, string> = {
    "docs/index.md": "",
    "docs/rules.md": "# Rules",
    "src/a.ts": "export {};",
    "docs/a.md": "[ok](rules.md#rules) [code](src/a.ts#L3)",
  };
  vi.mocked(proseLines).mockImplementation((t) =>
    t === "[ok](rules.md#rules) [code](src/a.ts#L3)"
      ? [{ line: 1, text: t }]
      : [],
  );
  vi.mocked(resolve).mockImplementation(
    (_from, target) =>
      ({ "rules.md": "docs/rules.md", "src/a.ts": "src/a.ts" })[target] ?? null,
  );
  vi.mocked(anchors).mockReturnValue(["rules"]);
  expect(
    findings({
      files: () => Object.keys(docs),
      read: (path) => docs[path] ?? null,
    }),
  ).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("a link to a tracked directory exists, and the repository root is a valid target", () => {
  const docs: Record<string, string> = {
    "docs/index.md": "",
    "docs/references/rules.md": "# Rules",
    "docs/tdd.md": "[dir](references/) [root](.)",
  };
  vi.mocked(proseLines).mockImplementation((t) =>
    t === "[dir](references/) [root](.)" ? [{ line: 1, text: t }] : [],
  );
  vi.mocked(resolve).mockImplementation((_from, target) =>
    target === "." ? "." : "docs/references",
  );
  expect(
    findings({
      files: () => Object.keys(docs),
      read: (path) => docs[path] ?? null,
    }),
  ).toEqual([]);
});

test("plans and ADRs get the frontmatter check, and ideas the idea check with their numbers", () => {
  const docs: Record<string, string> = {
    "docs/index.md": "",
    "infra/plans/1-a.md": "p",
    "docs/decisions/0001-a.md": "d",
    "docs/ideas/0001-a.md": "i",
  };
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
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
  const docs: Record<string, string> = {
    "docs/index.md": "",
    "docs/ideas/0001-a.md": "a",
    "docs/ideas/0001-b.md": "b",
  };
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
  expect(vi.mocked(finding).mock.calls).toContainEqual([
    "docs/ideas/0001-b.md",
    1,
    "idea number 0001 is also used by docs/ideas/0001-a.md",
    "renumber it to the next free number",
  ]);
});

test("an index entry naming a missing file is reported, and so is a plan the index omits", () => {
  const docs: Record<string, string> = {
    "docs/index.md":
      "# Index\n\n- [`infra/plans/9-gone.md`](../infra/plans/9-gone.md) — gone.",
    "infra/plans/2-b.md": "p",
  };
  vi.mocked(proseLines).mockImplementation((t) =>
    t === docs["docs/index.md"]
      ? [
          { line: 1, text: "# Index" },
          { line: 2, text: "" },
          {
            line: 3,
            text: "- [`infra/plans/9-gone.md`](../infra/plans/9-gone.md) — gone.",
          },
        ]
      : [],
  );
  vi.mocked(resolve).mockImplementation(
    (_from, target) =>
      ({ "../infra/plans/9-gone.md": "infra/plans/9-gone.md" })[target] ?? null,
  );
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
  expect(vi.mocked(finding).mock.calls).toEqual([
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
  const docs: Record<string, string> = { "infra/plans/1-a.md": "p" };
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
  expect(vi.mocked(finding).mock.calls).toContainEqual([
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
  expect(vi.mocked(finding).mock.calls).toEqual([
    ["docs/index.md", 1, "the knowledge index is missing", FIX_INDEX],
  ]);
});

test("Docs:, Plan: and ADR: markers whose path or anchor does not resolve are reported", () => {
  const docs: Record<string, string> = {
    "docs/index.md": "",
    "docs/decisions/0001-a.md": "# ADR 0001: A",
    "tools/kore/src/a.ts": "// Docs: infra/plans/9-gone.md#x",
    "tools/kore/src/b.ts": "// ADR: docs/decisions/0001-a.md#no-such",
  };
  vi.mocked(anchors).mockReturnValue(["adr-0001-a"]);
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
  expect(vi.mocked(finding).mock.calls).toContainEqual([
    "tools/kore/src/a.ts",
    1,
    "Docs: path infra/plans/9-gone.md does not exist",
    "use a path from the repository root",
  ]);
  expect(vi.mocked(finding).mock.calls).toContainEqual([
    "tools/kore/src/b.ts",
    1,
    "ADR: anchor #no-such is not a heading in docs/decisions/0001-a.md",
    "use one of its heading slugs, e.g. #adr-0001-a",
  ]);
});

test("the CLI usage text's commands must each appear in README.md, once each", () => {
  const docs: Record<string, string> = {
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
  };
  findings({
    files: () => Object.keys(docs),
    read: (path) => docs[path] ?? null,
  });
  expect(vi.mocked(finding).mock.calls).toEqual([
    [
      "tools/kore/src/cli/cli.ts",
      6,
      "kore cluster is in the CLI usage text but README.md does not mention it",
      "document it in README.md",
    ],
  ]);
});
