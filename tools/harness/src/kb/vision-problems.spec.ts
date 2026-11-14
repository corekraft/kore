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
const FILES = ["docs/decisions/0037-a.md", "docs/vision.md"];
const check = vi.fn<(text: string) => (typeof FOUND)[]>();
const read = (path: string) => (path === "docs/vision.md" ? "# Vision" : null);

beforeEach(() => {
  check.mockReturnValue([FOUND]);
  vi.mocked(VisionCheck).mockImplementation(function () {
    return { check } as unknown as VisionCheck;
  });
  vi.mocked(adrLookup).mockReturnValue(LOOKUP);
});

test("vision.md's text goes to the vision check and its findings are returned", () => {
  expect(visionProblems(FILES, read)).toEqual([FOUND]);
  expect(check.mock.calls).toEqual([["# Vision"]]);
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
