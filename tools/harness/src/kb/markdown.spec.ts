// The markdown helpers: heading slugs and anchors, link resolution, and flat frontmatter.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { posix } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  anchors,
  finding,
  frontmatter,
  isExternal,
  proseLines,
  resolve,
  slug,
} from "./markdown.js";

vi.mock("node:path");

describe("slug", () => {
  test("follows GitHub heading anchors: lowercase, punctuation dropped, spaces to dashes", () => {
    expect(slug("Step 3: Knowledge Health Check")).toBe(
      "step-3-knowledge-health-check",
    );
    expect(slug("Use `kore` as a CLI")).toBe("use-kore-as-a-cli");
  });

  test("keeps underscores and dashes, and reduces a link to its text", () => {
    expect(slug("snake_case and dash-ed")).toBe("snake_case-and-dash-ed");
    expect(slug("Read [the plan](x.md) first")).toBe("read-the-plan-first");
  });
});

describe("proseLines", () => {
  test("drops fenced code but keeps the line numbers of the lines after it", () => {
    expect(proseLines("a `x` b\n```\nhidden\n```\nc")).toEqual([
      { line: 1, text: "a  b" },
      { line: 5, text: "c" },
    ]);
  });

  test("a fence closes only on the marker that opened it", () => {
    expect(proseLines("```\n~~~\nstill code\n```\nafter")).toEqual([
      { line: 5, text: "after" },
    ]);
    expect(proseLines("~~~\nx\n~~~")).toEqual([]);
  });
});

describe("anchors", () => {
  test("numbers duplicate headings as GitHub does, and ignores closing hashes", () => {
    expect(anchors("# Rules\n## Work\n## Work ##\n### Work")).toEqual([
      "rules",
      "work",
      "work-1",
      "work-2",
    ]);
  });

  test("headings inside a fenced block are not anchors", () => {
    expect(anchors("```\n# Not a heading\n```\n## Real")).toEqual(["real"]);
  });
});

describe("resolve", () => {
  test("joins the target onto the directory of the file, then normalises it", () => {
    vi.mocked(posix.dirname).mockReturnValue("skills/tdd");
    vi.mocked(posix.join).mockReturnValue("skills/tdd/references/rules.md");
    vi.mocked(posix.normalize).mockReturnValue(
      "skills/tdd/references/rules.md",
    );
    expect(resolve("skills/tdd/SKILL.md", "references/rules.md")).toBe(
      "skills/tdd/references/rules.md",
    );
    expect(posix.dirname).toHaveBeenCalledWith("skills/tdd/SKILL.md");
    expect(posix.join).toHaveBeenCalledWith(
      "skills/tdd",
      "references/rules.md",
    );
  });

  test("a target that leaves the repository resolves to null", () => {
    vi.mocked(posix.normalize).mockReturnValue("../outside.md");
    expect(resolve("README.md", "../outside.md")).toBeNull();
    vi.mocked(posix.normalize).mockReturnValue("..");
    expect(resolve("README.md", "..")).toBeNull();
  });

  test("a trailing slash is dropped, and an empty path is the repository root", () => {
    vi.mocked(posix.normalize).mockReturnValue("docs/");
    expect(resolve("README.md", "docs/")).toBe("docs");
    vi.mocked(posix.normalize).mockReturnValue("");
    expect(resolve("README.md", ".")).toBe(".");
  });
});

describe("isExternal", () => {
  test("a URL, a mail address or a protocol-relative link is external; a repository path is not", () => {
    expect(isExternal("https://example.com/x.md")).toBe(true);
    expect(isExternal("mailto:a@b.c")).toBe(true);
    expect(isExternal("//host/x")).toBe(true);
    expect(isExternal("docs/index.md")).toBe(false);
    expect(isExternal("#anchor")).toBe(false);
  });
});

describe("frontmatter", () => {
  test("a file that does not open with --- has no frontmatter", () => {
    expect(frontmatter("README.md", "# Kore\n")).toBeNull();
  });

  test("an unclosed frontmatter block is not frontmatter", () => {
    expect(frontmatter("a.md", "---\nstatus: active\n# A\n")).toBeNull();
  });

  test("flat scalar keys are parsed with the line they sit on", () => {
    const parsed = frontmatter(
      "infra/plans/1-a.md",
      "---\nstatus: active\nsummary: Delivers the thing.\n---\n# A\n",
    );
    expect(parsed?.errors).toEqual([]);
    expect(parsed?.keys.get("status")).toEqual({ value: "active", line: 2 });
    expect(parsed?.keys.get("summary")).toEqual({
      value: "Delivers the thing.",
      line: 3,
    });
  });

  test("a list, a mapping, an empty value or a stray line is an error naming the key", () => {
    const parsed = frontmatter(
      "a.md",
      "---\ntags: [a, b]\nsummary:\n- item\n---\n",
    );
    expect(parsed?.errors).toEqual([
      finding(
        "a.md",
        2,
        "frontmatter tags is not a scalar string",
        "use flat key: value lines only",
      ),
      finding(
        "a.md",
        3,
        "frontmatter summary is not a scalar string",
        "use flat key: value lines only",
      ),
      finding(
        "a.md",
        4,
        "frontmatter - item is not a scalar string",
        "use flat key: value lines only",
      ),
    ]);
  });
});

describe("finding", () => {
  test("builds the problem record with its file, line, message and fix", () => {
    expect(finding("a.md", 2, "broken", "fix it")).toEqual({
      file: "a.md",
      line: 2,
      message: "broken",
      fix: "fix it",
    });
  });
});
