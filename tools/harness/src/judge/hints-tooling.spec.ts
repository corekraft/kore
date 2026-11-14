import { describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "./diff.js";
import { hintsFor } from "./hints.js";
import { isTooling } from "./tooling.js";

vi.mock("./tooling.js", () => ({ isTooling: vi.fn() }));

const changed = (path: string, previousPath = path): ChangedFile => ({
  path,
  previousPath,
  deleted: false,
  added: [],
  removed: 0,
  netRemoved: 0,
  after: [],
  trail: [],
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

  it("a doc renamed from a product path is still behavioural", () => {
    vi.mocked(isTooling).mockReturnValue(false);
    expect(
      hintsFor("no-behaviour-change", [
        changed("docs/values.md", "apps/web/values.yaml"),
      ]),
    ).toMatchObject({
      behaviouralPaths: ["apps/web/values.yaml -> docs/values.md"],
      noBehaviouralDiff: false,
    });
  });

  it("lists a renamed tooling file as old -> new", () => {
    vi.mocked(isTooling).mockReturnValue(true);
    expect(
      hintsFor("no-behaviour-change", [
        changed("skills/b.md", "tools/harness/a.ts"),
      ]),
    ).toMatchObject({ toolingPaths: ["tools/harness/a.ts -> skills/b.md"] });
  });
});
