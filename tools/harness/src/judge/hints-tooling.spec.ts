import { describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "./diff.js";
import { hintsFor } from "./hints.js";
import { isTooling } from "./tooling.js";

vi.mock("./tooling.js", () => ({ isTooling: vi.fn() }));

const changed = (path: string): ChangedFile => ({
  path,
  deleted: false,
  added: [],
  removed: 0,
  netRemoved: 0,
  after: [],
});

describe("hintsFor no-behaviour-change with tooling", () => {
  it("a diff of docs and tooling only has no behavioural diff, and the tooling stays listed", () => {
    vi.mocked(isTooling).mockImplementation((f) => f.path.startsWith("tools/"));
    expect(
      hintsFor("no-behaviour-change", [
        changed("docs/index.md"),
        changed("tools/harness/a.ts"),
      ]),
    ).toEqual({
      behaviouralPaths: [],
      toolingPaths: ["tools/harness/a.ts"],
      noBehaviouralDiff: true,
    });
  });

  it("a product file beside tooling is still behavioural", () => {
    vi.mocked(isTooling).mockImplementation((f) => f.path.startsWith("tools/"));
    expect(
      hintsFor("no-behaviour-change", [
        changed("tools/harness/a.ts"),
        changed("apps/web/values.yaml"),
      ]),
    ).toEqual({
      behaviouralPaths: ["apps/web/values.yaml"],
      toolingPaths: ["tools/harness/a.ts"],
      noBehaviouralDiff: false,
    });
  });
});
