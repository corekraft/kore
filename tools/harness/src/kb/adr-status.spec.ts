// The ADR lookup behind the vision check: status and replacement by ADR number.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { adrLookup } from "./adr-status.js";
import { frontmatter } from "./markdown.js";

vi.mock("./markdown.js", () => ({ frontmatter: vi.fn() }));

const FILES = ["docs/decisions/0037-a.md", "docs/vision.md"];
const read = (path: string) => `text of ${path}`;
const keys = (entries: Record<string, string>) => ({
  keys: new Map(
    Object.entries(entries).map(([k, value]) => [k, { value, line: 2 }]),
  ),
  errors: [],
});

beforeEach(() => {
  vi.mocked(frontmatter).mockReturnValue(null);
});

test("the lookup reads an ADR's status from its frontmatter by number", () => {
  vi.mocked(frontmatter).mockReturnValue(keys({ status: "proposed" }));
  expect(adrLookup(FILES, read)("0037")).toEqual({
    status: "proposed",
    supersededBy: undefined,
  });
  expect(frontmatter).toHaveBeenCalledWith(
    "docs/decisions/0037-a.md",
    "text of docs/decisions/0037-a.md",
  );
});

test("a superseded ADR's lookup carries the number of its replacement", () => {
  vi.mocked(frontmatter).mockReturnValue(
    keys({
      status: "superseded",
      "superseded-by": "docs/decisions/0081-agentgateway.md",
    }),
  );
  expect(adrLookup(FILES, read)("0037")).toEqual({
    status: "superseded",
    supersededBy: "0081",
  });
});

test("the lookup is null for an ADR with no frontmatter, no status or no file", () => {
  expect(adrLookup(FILES, read)("0037")).toBeNull();
  vi.mocked(frontmatter).mockReturnValue(keys({ date: "2026-11-14" }));
  expect(adrLookup(FILES, read)("0037")).toBeNull();
  expect(adrLookup(FILES, read)("0999")).toBeNull();
});

test("a file outside docs/decisions is never read as an ADR", () => {
  vi.mocked(frontmatter).mockReturnValue(keys({ status: "accepted" }));
  expect(adrLookup(["docs/other/0037-a.md"], read)("0037")).toBeNull();
  expect(frontmatter).not.toHaveBeenCalled();
});
