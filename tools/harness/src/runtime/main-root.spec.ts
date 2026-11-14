import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "./command.js";
import { bundleMainRoot, mainRoot } from "./main-root.js";
import type { Runner } from "./runner.js";

vi.mock("node:path");
vi.mock("node:url");

const COMMON_DIR = ["rev-parse", "--path-format=absolute", "--git-common-dir"];

/**
 * Typed mocks for the collaborators. The runner answers as `git` does for a
 * checkout whose common dir is /main/.git; the checkout root is `root`, or
 * rejects when `root` is null.
 */
function deps(
  options: {
    root?: string | null;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const run = vi.fn<Runner["run"]>();
  run.mockResolvedValue({ stdout: "/main/.git\n", stderr: "", code: 0 });
  const root = vi.fn<CliDeps["root"]>();
  if (options.root === null) {
    root.mockRejectedValue(new Error("no root"));
  } else {
    root.mockResolvedValue(options.root ?? "/work/tree");
  }
  return {
    runner: { run },
    run,
    root,
    env: options.env ?? {},
    cwd: "/work/tree/sub/dir",
  };
}

beforeEach(() => {
  vi.mocked(dirname).mockReturnValue("/main");
});

describe("mainRoot: the main checkout", () => {
  it("is the parent of git's common dir, asked from this checkout's root, never the working directory", async () => {
    const d = deps();
    expect(await mainRoot(d)).toBe("/main");
    expect(vi.mocked(dirname).mock.calls).toEqual([["/main/.git"]]);
    expect(d.run.mock.calls).toEqual([
      ["git", COMMON_DIR, { cwd: "/work/tree" }],
    ]);
  });

  it("lets KORE_ROOT override, resolved against the working directory, without running git", async () => {
    vi.mocked(resolve).mockReturnValue("/elsewhere");
    const d = deps({ env: { KORE_ROOT: "../elsewhere" } });
    expect(await mainRoot(d)).toBe("/elsewhere");
    expect(vi.mocked(resolve).mock.calls).toEqual([
      ["/work/tree/sub/dir", "../elsewhere"],
    ]);
    expect(d.run).not.toHaveBeenCalled();
  });

  it("honours KORE_ROOT even where no checkout root can be found", async () => {
    vi.mocked(resolve).mockReturnValue("/elsewhere");
    const d = deps({ root: null, env: { KORE_ROOT: "/elsewhere" } });
    expect(await mainRoot(d)).toBe("/elsewhere");
    expect(d.run).not.toHaveBeenCalled();
  });

  it("is undefined when there is no checkout root and no override", async () => {
    const d = deps({ root: null });
    expect(await mainRoot(d)).toBeUndefined();
    expect(d.run).not.toHaveBeenCalled();
  });

  it("is undefined when git cannot say", async () => {
    const d = deps();
    d.run.mockResolvedValue({ stdout: "", stderr: "fatal", code: 128 });
    expect(await mainRoot(d)).toBeUndefined();
  });
});

describe("bundleMainRoot: the checkout that holds the bundle", () => {
  it("is undefined without a bundle URL, and runs nothing", async () => {
    const d = deps();
    const found = await bundleMainRoot({ env: {}, runner: d.runner });
    expect(found).toBeUndefined();
    expect(d.run).not.toHaveBeenCalled();
  });

  it("asks git from the bundle's checkout, under an environment with no GIT_* variable", async () => {
    vi.mocked(fileURLToPath).mockReturnValue(
      "/work/repo/skills/bin/harness.mjs",
    );
    vi.mocked(dirname).mockReturnValueOnce("/work/repo/skills/bin");
    vi.mocked(resolve).mockReturnValue("/work/repo");
    const d = deps();
    const env = { PATH: "/bin", GIT_DIR: "/elsewhere/.git", UNSET: undefined };
    const found = await bundleMainRoot({
      env,
      runner: d.runner,
      bundleUrl: "file:///work/repo/skills/bin/harness.mjs",
    });
    expect(found).toBe("/main");
    expect(vi.mocked(resolve).mock.calls).toEqual([
      ["/work/repo/skills/bin", "../.."],
    ]);
    expect(d.run.mock.calls).toEqual([
      ["git", COMMON_DIR, { cwd: "/work/repo", env: { PATH: "/bin" } }],
    ]);
  });

  it("is undefined when git fails from the bundle's checkout", async () => {
    vi.mocked(fileURLToPath).mockReturnValue(
      "/work/repo/skills/bin/harness.mjs",
    );
    vi.mocked(resolve).mockReturnValue("/work/repo");
    const d = deps();
    d.run.mockResolvedValue({ stdout: "", stderr: "fatal", code: 128 });
    const found = await bundleMainRoot({
      env: {},
      runner: d.runner,
      bundleUrl: "file:///work/repo/skills/bin/harness.mjs",
    });
    expect(found).toBeUndefined();
  });
});
