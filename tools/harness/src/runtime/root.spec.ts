import { describe, expect, it } from "vitest";
import { CommandError } from "./errors.js";
import { resolveRoot } from "./root.js";

const exists = (dirs: string[]) => (path: string) =>
  Promise.resolve(dirs.includes(path));

describe("resolveRoot", () => {
  it("prefers CLAUDE_PROJECT_DIR", async () => {
    await expect(
      resolveRoot(
        { CLAUDE_PROJECT_DIR: "/work/repo" },
        "file:///other/skills/bin/harness.mjs",
        exists(["/work/repo/infra/plans", "/other/infra/plans"]),
      ),
    ).resolves.toBe("/work/repo");
  });

  it("falls back to two levels above the bundle, skills/bin/../..", async () => {
    await expect(
      resolveRoot(
        {},
        "file:///work/repo/skills/bin/harness.mjs",
        exists(["/work/repo/infra/plans"]),
      ),
    ).resolves.toBe("/work/repo");
  });

  it("treats an empty CLAUDE_PROJECT_DIR as unset", async () => {
    await expect(
      resolveRoot(
        { CLAUDE_PROJECT_DIR: "" },
        "file:///work/repo/skills/bin/harness.mjs",
        exists(["/work/repo/infra/plans"]),
      ),
    ).resolves.toBe("/work/repo");
  });

  it("fails naming CLAUDE_PROJECT_DIR when it holds no infra/plans, without falling back", async () => {
    await expect(
      resolveRoot(
        { CLAUDE_PROJECT_DIR: "/nope" },
        "file:///work/repo/skills/bin/harness.mjs",
        exists(["/work/repo/infra/plans"]),
      ),
    ).rejects.toThrow(/CLAUDE_PROJECT_DIR.*\/nope.*infra\/plans/s);
  });

  it("fails with an expected error a hook can report, not a stack", async () => {
    await expect(
      resolveRoot(
        { CLAUDE_PROJECT_DIR: "/nope" },
        "file:///a/skills/bin/h.mjs",
        exists([]),
      ),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      resolveRoot({}, "file:///tmp/skills/bin/harness.mjs", exists([])),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it("fails naming the bundle location when the repo root cannot be found", async () => {
    await expect(
      resolveRoot({}, "file:///tmp/skills/bin/harness.mjs", exists([])),
    ).rejects.toThrow(/\/tmp\/skills\/bin\/harness\.mjs.*CLAUDE_PROJECT_DIR/s);
  });
});
