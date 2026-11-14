// The vision check on the tracked tree: vision.md's text and each ADR's frontmatter status.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { adrLookup } from "./adr-status.js";
import { VisionCheck, type AdrLookup } from "./vision-check.js";
import { visionProblems } from "./vision-problems.js";

vi.mock("./adr-status.js", () => ({ adrLookup: vi.fn() }));
vi.mock("./vision-check.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./vision-check.js")>()),
  VisionCheck: vi.fn(),
}));

const FOUND = { file: "docs/vision.md", line: 9, message: "m", fix: "f" };
const LOOKUP: AdrLookup = () => null;
const FILES = [
  "docs/decisions/0037-a.md",
  "docs/vision.html",
  "docs/vision.md",
];
const check = vi.fn<(text: string, html: string | null) => (typeof FOUND)[]>();
const docs: Record<string, string> = {
  "docs/vision.md": "# Vision",
  "docs/vision.html": "<h1>Vision</h1>",
};
const read = (path: string) => docs[path] ?? null;

beforeEach(() => {
  check.mockReturnValue([FOUND]);
  vi.mocked(VisionCheck).mockImplementation(function () {
    return { check } as unknown as VisionCheck;
  });
  vi.mocked(adrLookup).mockReturnValue(LOOKUP);
});

test("vision.md's and vision.html's text go to the vision check and its findings are returned", () => {
  expect(visionProblems(FILES, read)).toEqual([FOUND]);
  expect(check.mock.calls).toEqual([["# Vision", "<h1>Vision</h1>"]]);
});

test("a vision.html that is not tracked reaches the vision check as null", () => {
  visionProblems(["docs/vision.md"], read);
  expect(check.mock.calls).toEqual([["# Vision", null]]);
});

test("the vision check gets the ADR lookup built from the tracked files", () => {
  visionProblems(FILES, read);
  expect(vi.mocked(adrLookup).mock.calls).toEqual([[FILES, read]]);
  expect(vi.mocked(VisionCheck).mock.calls).toEqual([[LOOKUP]]);
});

test("a tree without vision.md never calls the vision check", () => {
  expect(visionProblems(["docs/index.md"], read)).toEqual([]);
  expect(VisionCheck).not.toHaveBeenCalled();
});

test("an unreadable vision.md never calls the vision check", () => {
  expect(visionProblems(FILES, () => null)).toEqual([]);
  expect(VisionCheck).not.toHaveBeenCalled();
});
