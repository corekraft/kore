import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseDiff, type ChangedFile } from "./diff.js";
import { diffStat, selectDiff } from "./diff-select.js";

vi.mock("./diff.js");

/** A parsed file with the counts the stat reads; the rest is empty. */
const file = (
  path: string,
  added: number,
  removed: number,
  previousPath = path,
): ChangedFile => ({
  path,
  previousPath,
  deleted: false,
  added: Array.from({ length: added }, () => "x"),
  addedLines: Array.from({ length: added }, (_, i) => ({
    line: i + 1,
    text: "x",
  })),
  removed,
  netRemoved: 0,
  after: [],
  trail: [],
});

const header = (path: string): string => `diff --git a/${path} b/${path}\n`;
const chunk = (path: string): string => `${header(path)}+line of ${path}\n`;
const DIFF = [chunk("src/a.ts"), chunk("docs/b.md"), chunk("src/deep/c.ts")];
const TEXT = DIFF.join("");

beforeEach(() => {
  // Each chunk is parsed alone, so its header line names its one file.
  vi.mocked(parseDiff).mockImplementation((text) => {
    const path = /^diff --git a\/(\S+) b\//.exec(text)?.[1];
    if (path === undefined) {
      return [];
    }
    return [file(path, 3, 1, path === "docs/b.md" ? "docs/old.md" : path)];
  });
});

describe("selectDiff", () => {
  it("returns the whole diff when no glob is given", () => {
    expect(selectDiff(TEXT, [])).toBe(TEXT);
  });

  it("keeps only the files a glob matches, each with its own text", () => {
    expect(selectDiff(TEXT, ["docs/*.md"])).toBe(chunk("docs/b.md"));
  });

  it("lets * stop at a slash and ** cross it", () => {
    expect(selectDiff(TEXT, ["src/*.ts"])).toBe(chunk("src/a.ts"));
    expect(selectDiff(TEXT, ["src/**/*.ts"])).toBe(chunk("src/deep/c.ts"));
    expect(selectDiff(TEXT, ["src/**"])).toBe(
      chunk("src/a.ts") + chunk("src/deep/c.ts"),
    );
  });

  it("keeps a file that any one of several globs matches, in diff order", () => {
    expect(selectDiff(TEXT, ["docs/*", "src/a.ts"])).toBe(
      chunk("src/a.ts") + chunk("docs/b.md"),
    );
  });

  it("matches a renamed file by its old path too", () => {
    expect(selectDiff(TEXT, ["docs/old.md"])).toBe(chunk("docs/b.md"));
  });

  it("treats regex characters in a glob as literal text", () => {
    expect(selectDiff(TEXT, ["src/a.t."])).toBe("");
    expect(selectDiff(TEXT, ["src/a?ts"])).toBe(chunk("src/a.ts"));
  });
});

describe("diffStat", () => {
  it("lists each selected file with its added and removed line counts", () => {
    expect(diffStat(TEXT, ["src/**"])).toEqual([
      { path: "src/a.ts", added: 3, removed: 1 },
      { path: "src/deep/c.ts", added: 3, removed: 1 },
    ]);
  });

  it("lists every file when no glob is given", () => {
    expect(diffStat(TEXT, []).map((f) => f.path)).toEqual([
      "src/a.ts",
      "docs/b.md",
      "src/deep/c.ts",
    ]);
  });
});
