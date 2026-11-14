// The knowledge health check's problems: links and anchors, the index, idea numbers, Docs/Plan/ADR markers and README coverage.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { checkFrontmatter } from "./document-checks.js";
import { findings } from "./findings.js";
import { checkIdea } from "./idea-checks.js";
import { fakeFinding, fakeProse, fakeTree } from "./kb-support.js";
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

const FIX_LINK = "point the link at an existing file or remove it";

beforeEach(() => {
  vi.mocked(finding).mockImplementation(fakeFinding);
  vi.mocked(proseLines).mockImplementation(fakeProse);
  vi.mocked(isExternal).mockReturnValue(false);
  vi.mocked(resolve).mockImplementation((_from, target) => target);
  vi.mocked(anchors).mockReturnValue([]);
  vi.mocked(checkFrontmatter).mockReturnValue([]);
  vi.mocked(checkIdea).mockReturnValue([]);
});

test("a tree with an index and nothing to check reports nothing", () => {
  expect(findings(fakeTree({ "docs/index.md": "" }))).toEqual([]);
});

test("a relative link to a missing file is reported on its line", () => {
  vi.mocked(resolve).mockReturnValue("skills/a/references/gone.md");
  const tree = fakeTree({
    "docs/index.md": "",
    "docs/a.md": "# A\n[rules](references/gone.md)\n",
  });
  expect(findings(tree)).toEqual([
    {
      file: "docs/a.md",
      line: 2,
      message: "link target skills/a/references/gone.md does not exist",
      fix: FIX_LINK,
    },
  ]);
});

test("a link that leaves the repository is reported with the path as written", () => {
  vi.mocked(resolve).mockReturnValue(null);
  const tree = fakeTree({
    "docs/index.md": "",
    "docs/a.md": "[up](../../../x.md)\n",
  });
  expect(findings(tree)).toEqual([
    {
      file: "docs/a.md",
      line: 1,
      message: "link target ../../../x.md does not exist",
      fix: FIX_LINK,
    },
  ]);
});

test("external links are never resolved, and a bare anchor is checked against the file's own headings", () => {
  vi.mocked(isExternal).mockImplementation((target) =>
    target.startsWith("https://"),
  );
  vi.mocked(anchors).mockReturnValue(["intro"]);
  const tree = fakeTree({
    "docs/index.md": "",
    "docs/a.md": "[web](https://x.test/a) [top](#intro) [bad](#nowhere)\n",
  });
  expect(findings(tree)).toEqual([
    {
      file: "docs/a.md",
      line: 1,
      message: "link anchor #nowhere is not a heading in docs/a.md",
      fix: "use one of its heading slugs, e.g. #intro",
    },
  ]);
  expect(resolve).not.toHaveBeenCalledWith("docs/a.md", "https://x.test/a");
});

test("an anchor into a file with no headings says to remove the anchor", () => {
  vi.mocked(resolve).mockReturnValue("skills/a/notes.md");
  const tree = fakeTree({
    "docs/index.md": "",
    "skills/a/notes.md": "plain\n",
    "docs/a.md": "[n](notes.md#gone)\n",
  });
  expect(findings(tree)).toEqual([
    {
      file: "docs/a.md",
      line: 1,
      message: "link anchor #gone is not a heading in skills/a/notes.md",
      fix: "remove the anchor; the file has no headings",
    },
  ]);
});

test("an existing anchor passes, and an anchor into a non-Markdown file is not checked", () => {
  vi.mocked(resolve).mockImplementation((_from, target) =>
    target.startsWith("src/") ? "src/a.ts" : "skills/a/rules.md",
  );
  vi.mocked(anchors).mockReturnValue(["rules"]);
  const tree = fakeTree({
    "docs/index.md": "",
    "skills/a/rules.md": "# Rules\n",
    "src/a.ts": "export {};\n",
    "docs/a.md": "[ok](rules.md#rules) [code](src/a.ts#L3)\n",
  });
  expect(findings(tree)).toEqual([]);
});

test("a link to a tracked directory exists, and the repository root is a valid target", () => {
  vi.mocked(resolve).mockImplementation((_from, target) =>
    target === "." ? "." : "skills/tdd/references",
  );
  const tree = fakeTree({
    "docs/index.md": "",
    "skills/tdd/references/rules.md": "# Rules\n",
    "docs/tdd.md": "[dir](references/) [root](.)\n",
  });
  expect(findings(tree)).toEqual([]);
});

test("plans and ADRs get the frontmatter check, and ideas the idea check with their numbers", () => {
  const tree = fakeTree({
    "docs/index.md": "",
    "infra/plans/1-a.md": "p",
    "docs/decisions/0001-a.md": "d",
    "docs/ideas/0001-a.md": "i",
  });
  findings(tree);
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
  const tree = fakeTree({
    "docs/index.md": "",
    "docs/ideas/0001-a.md": "a",
    "docs/ideas/0001-b.md": "b",
  });
  expect(findings(tree)).toContainEqual({
    file: "docs/ideas/0001-b.md",
    line: 1,
    message: "idea number 0001 is also used by docs/ideas/0001-a.md",
    fix: "renumber it to the next free number",
  });
});

test("an index entry naming a missing file is reported, and so is a plan the index omits", () => {
  vi.mocked(resolve).mockImplementation((_from, target) =>
    target.replace(/^\.\.\//, ""),
  );
  const tree = fakeTree({
    "docs/index.md":
      "# Index\n\n- [`infra/plans/9-gone.md`](../infra/plans/9-gone.md) — gone.\n",
    "infra/plans/2-b.md": "p",
  });
  expect(findings(tree)).toEqual([
    {
      file: "docs/index.md",
      line: 3,
      message: "link target infra/plans/9-gone.md does not exist",
      fix: FIX_LINK,
    },
    {
      file: "docs/index.md",
      line: 3,
      message: "index entry infra/plans/9-gone.md names a missing file",
      fix: "remove the entry or restore the file",
    },
    {
      file: "docs/index.md",
      line: 1,
      message: "infra/plans/2-b.md is not in the index",
      fix: "add an entry under its ## heading",
    },
  ]);
});

test("a missing index is reported once, on line 1", () => {
  expect(findings(fakeTree({ "infra/plans/1-a.md": "p" }))).toContainEqual({
    file: "docs/index.md",
    line: 1,
    message: "the knowledge index is missing",
    fix: "create it with one entry per plan, ADR, and skill",
  });
});

test("a file that cannot be read is skipped, and an unreadable index is a missing index", () => {
  const unreadable = {
    files: () => ["docs/index.md", "docs/a.md", "tools/x.ts"],
    read: () => null,
  };
  expect(findings(unreadable)).toEqual([
    {
      file: "docs/index.md",
      line: 1,
      message: "the knowledge index is missing",
      fix: "create it with one entry per plan, ADR, and skill",
    },
  ]);
});

test("Docs:, Plan: and ADR: markers whose path or anchor does not resolve are reported", () => {
  vi.mocked(anchors).mockReturnValue(["adr-0001-a"]);
  const tree = fakeTree({
    "docs/index.md": "",
    "docs/decisions/0001-a.md": "# ADR 0001: A\n",
    "tools/kore/src/a.ts": "// Docs: infra/plans/9-gone.md#x\n",
    "tools/kore/src/b.ts": "// ADR: docs/decisions/0001-a.md#no-such\n",
  });
  const problems = findings(tree);
  expect(problems).toContainEqual({
    file: "tools/kore/src/a.ts",
    line: 1,
    message: "Docs: path infra/plans/9-gone.md does not exist",
    fix: "use a path from the repository root",
  });
  expect(problems).toContainEqual({
    file: "tools/kore/src/b.ts",
    line: 1,
    message:
      "ADR: anchor #no-such is not a heading in docs/decisions/0001-a.md",
    fix: "use one of its heading slugs, e.g. #adr-0001-a",
  });
});

test("the CLI usage text's commands must each appear in README.md, once each", () => {
  const tree = fakeTree({
    "docs/index.md": "",
    "README.md": "Run `kore -- doctor`.\n",
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
  expect(findings(tree)).toEqual([
    {
      file: "tools/kore/src/cli/cli.ts",
      line: 6,
      message:
        "kore cluster is in the CLI usage text but README.md does not mention it",
      fix: "document it in README.md",
    },
  ]);
});
