// findings() appends the vision problems of the tracked tree.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { findings } from "./findings.js";
import { visionProblems } from "./vision-problems.js";

vi.mock("./vision-problems.js", () => ({ visionProblems: vi.fn() }));

const FOUND = { file: "docs/vision.md", line: 9, message: "m", fix: "f" };
const docs: Record<string, string> = {
  "docs/index.md": "",
  "docs/vision.md": "# Vision",
};
const read = (path: string) => docs[path] ?? null;

beforeEach(() => {
  vi.mocked(visionProblems).mockReturnValue([FOUND]);
});

test("the vision problems are reported with the rest", () => {
  expect(findings({ files: () => Object.keys(docs), read })).toEqual([FOUND]);
});

test("the vision unit receives the sorted tracked files and the tree's reader", () => {
  findings({ files: () => ["docs/vision.md", "docs/index.md"], read });
  expect(vi.mocked(visionProblems).mock.calls).toEqual([
    [["docs/index.md", "docs/vision.md"], read],
  ]);
});
