import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CommandError } from "./errors.js";
import { resolveRoot } from "./root.js";

vi.mock("node:path");
vi.mock("node:url");

const exists = vi.fn<(path: string) => Promise<boolean>>();

/** Only the given absolute paths exist; every other path is missing. */
function present(...paths: string[]) {
  exists.mockImplementation((path) => Promise.resolve(paths.includes(path)));
}

/** A bundle at `bundle` sits two levels under `root`, as skills/bin/harness.mjs does. */
function bundleAt(bundle: string, root: string) {
  vi.mocked(fileURLToPath).mockReturnValue(bundle);
  vi.mocked(dirname).mockReturnValue(`${root}/skills/bin`);
  vi.mocked(resolve).mockReturnValue(root);
}

describe("resolveRoot: CLAUDE_PROJECT_DIR", () => {
  it("prefers CLAUDE_PROJECT_DIR over the bundle's location", async () => {
    vi.mocked(join).mockReturnValue("/work/repo/infra/plans");
    present("/work/repo/infra/plans");
    await expect(
      resolveRoot(
        { CLAUDE_PROJECT_DIR: "/work/repo" },
        "file:///other/skills/bin/harness.mjs",
        exists,
      ),
    ).resolves.toBe("/work/repo");
    expect(vi.mocked(join).mock.calls).toEqual([["/work/repo", "infra/plans"]]);
    expect(vi.mocked(fileURLToPath)).not.toHaveBeenCalled();
  });

  it("treats an empty CLAUDE_PROJECT_DIR as unset, and uses the bundle", async () => {
    bundleAt("/work/repo/skills/bin/harness.mjs", "/work/repo");
    vi.mocked(join).mockReturnValue("/work/repo/infra/plans");
    present("/work/repo/infra/plans");
    await expect(
      resolveRoot(
        { CLAUDE_PROJECT_DIR: "" },
        "file:///work/repo/skills/bin/harness.mjs",
        exists,
      ),
    ).resolves.toBe("/work/repo");
    expect(vi.mocked(join).mock.calls).toEqual([["/work/repo", "infra/plans"]]);
  });

  it("fails naming CLAUDE_PROJECT_DIR when it holds no infra/plans, without falling back", async () => {
    vi.mocked(join).mockReturnValue("/nope/infra/plans");
    present();
    const error = await resolveRoot(
      { CLAUDE_PROJECT_DIR: "/nope" },
      "file:///work/repo/skills/bin/harness.mjs",
      exists,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as Error).message).toMatch(
      /CLAUDE_PROJECT_DIR.*\/nope.*infra\/plans/s,
    );
    expect(vi.mocked(fileURLToPath)).not.toHaveBeenCalled();
  });
});

describe("resolveRoot: the bundle's location", () => {
  it("falls back to two levels above the bundle, skills/bin/../..", async () => {
    bundleAt("/work/repo/skills/bin/harness.mjs", "/work/repo");
    vi.mocked(join).mockReturnValue("/work/repo/infra/plans");
    present("/work/repo/infra/plans");
    await expect(
      resolveRoot({}, "file:///work/repo/skills/bin/harness.mjs", exists),
    ).resolves.toBe("/work/repo");
    expect(vi.mocked(fileURLToPath)).toHaveBeenCalledWith(
      "file:///work/repo/skills/bin/harness.mjs",
    );
    expect(vi.mocked(resolve).mock.calls).toEqual([
      ["/work/repo/skills/bin", "../.."],
    ]);
  });

  it("fails with an expected error a hook can report, not a stack, naming the bundle location", async () => {
    bundleAt("/tmp/skills/bin/harness.mjs", "/tmp");
    vi.mocked(join).mockReturnValue("/tmp/infra/plans");
    present();
    const attempt = resolveRoot(
      {},
      "file:///tmp/skills/bin/harness.mjs",
      exists,
    );
    await expect(attempt).rejects.toBeInstanceOf(CommandError);
    await expect(attempt).rejects.toThrow(
      /\/tmp\/skills\/bin\/harness\.mjs.*CLAUDE_PROJECT_DIR/s,
    );
  });
});
