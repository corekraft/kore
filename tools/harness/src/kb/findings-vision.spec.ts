// findings() hands vision.md and each ADR's frontmatter status to the vision check.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { checkFrontmatter } from "./document-checks.js";
import { findings } from "./findings.js";
import { checkIdea } from "./idea-checks.js";
import { frontmatter } from "./markdown.js";
import { VisionCheck, type AdrLookup } from "./vision-check.js";

vi.mock("./document-checks.js", () => ({ checkFrontmatter: vi.fn() }));
vi.mock("./idea-checks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./idea-checks.js")>()),
  checkIdea: vi.fn(),
}));
vi.mock("./markdown.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./markdown.js")>()),
  frontmatter: vi.fn(),
  proseLines: vi.fn(() => []),
}));
vi.mock("./vision-check.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./vision-check.js")>()),
  VisionCheck: vi.fn(),
}));

const FOUND = { file: "docs/vision.md", line: 9, message: "m", fix: "f" };
const VISION = "docs/vision.md";
const ADR = "docs/decisions/0037-a.md";
const check = vi.fn<(text: string) => (typeof FOUND)[]>();

const scan = (docs: Record<string, string>) =>
  findings({ files: () => Object.keys(docs), read: (p) => docs[p] ?? null });
const lookup = (): AdrLookup => vi.mocked(VisionCheck).mock.calls[0]![0];
const keys = (entries: Record<string, string>) => ({
  keys: new Map(
    Object.entries(entries).map(([k, value]) => [k, { value, line: 2 }]),
  ),
  errors: [],
});

beforeEach(() => {
  check.mockReturnValue([FOUND]);
  vi.mocked(VisionCheck).mockImplementation(function () {
    return { check } as unknown as VisionCheck;
  });
  vi.mocked(checkFrontmatter).mockReturnValue([]);
  vi.mocked(checkIdea).mockReturnValue([]);
});

test("vision.md's text goes to the vision check and its findings are reported", () => {
  expect(scan({ "docs/index.md": "", [VISION]: "# Vision" })).toEqual([FOUND]);
  expect(check.mock.calls).toEqual([["# Vision"]]);
});

test("a tree without vision.md never calls the vision check", () => {
  expect(scan({ "docs/index.md": "" })).toEqual([]);
  expect(VisionCheck).not.toHaveBeenCalled();
});

test("the lookup reads an ADR's status from its frontmatter by number", () => {
  vi.mocked(frontmatter).mockReturnValue(keys({ status: "proposed" }));
  scan({ "docs/index.md": "", [VISION]: "v", [ADR]: "---\nstatus: proposed" });
  expect(lookup()("0037")).toEqual({
    status: "proposed",
    supersededBy: undefined,
  });
});

test("a superseded ADR's lookup carries the number of its replacement", () => {
  vi.mocked(frontmatter).mockReturnValue(
    keys({
      status: "superseded",
      "superseded-by": "docs/decisions/0081-agentgateway.md",
    }),
  );
  scan({ "docs/index.md": "", [VISION]: "v", [ADR]: "x" });
  expect(lookup()("0037")).toEqual({
    status: "superseded",
    supersededBy: "0081",
  });
});

test("the lookup is null for an ADR number with no file or no status", () => {
  vi.mocked(frontmatter).mockReturnValue(null);
  scan({ "docs/index.md": "", [VISION]: "v", [ADR]: "no frontmatter" });
  expect(lookup()("0037")).toBeNull();
  expect(lookup()("0999")).toBeNull();
});
