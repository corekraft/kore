import { describe, expect, it } from "vitest";
import { mainRoot } from "./main-root.js";
import { FakeRunner } from "../testing/index.js";

function deps(
  options: {
    root?: string | null;
    env?: Record<string, string>;
    commonDir?: string | undefined;
  } = {},
) {
  const { root = "/work/tree", env = {} } = options;
  const commonDir = "commonDir" in options ? options.commonDir : "/main/.git";
  const runner = new FakeRunner([
    {
      match: (c, a) => c === "git" && a.includes("--git-common-dir"),
      result:
        commonDir === undefined
          ? { code: 128, stderr: "fatal" }
          : { stdout: `${commonDir}\n` },
    },
  ]);
  return {
    runner,
    env,
    cwd: "/work/tree/sub/dir",
    root: () =>
      root === null
        ? Promise.reject(new Error("no root"))
        : Promise.resolve(root),
  };
}

describe("mainRoot", () => {
  it("is the parent of git's common dir, asked from this checkout's root, never the working directory", async () => {
    const d = deps();
    expect(await mainRoot(d)).toBe("/main");
    expect(d.runner.calls[0]).toMatchObject({
      command: "git",
      args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      options: { cwd: "/work/tree" },
    });
  });

  it("lets KORE_ROOT override without running git", async () => {
    const d = deps({ env: { KORE_ROOT: "/elsewhere" } });
    expect(await mainRoot(d)).toBe("/elsewhere");
    expect(d.runner.calls).toEqual([]);
  });

  it("honours KORE_ROOT even where no checkout root can be found", async () => {
    const d = deps({ root: null, env: { KORE_ROOT: "/elsewhere" } });
    expect(await mainRoot(d)).toBe("/elsewhere");
  });

  it("is undefined when there is no checkout root and no override", async () => {
    expect(await mainRoot(deps({ root: null }))).toBeUndefined();
  });

  it("is undefined when git cannot say", async () => {
    expect(await mainRoot(deps({ commonDir: undefined }))).toBeUndefined();
  });
});
