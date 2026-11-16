// The guard's worktree root: the git top level of where the session launched, never the shell's directory. The runner is a fake.

import { describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { launchRoot } from "./guard-launch-root.js";

/** The one assertion: a fake's parts as the deps the unit reads. */
const asDeps = (parts: object) => parts as Pick<CliDeps, "env" | "runner">;

function deps(
  env: Record<string, string>,
  top: { code: number; stdout: string },
) {
  const run = vi.fn(() => Promise.resolve({ ...top, stderr: "" }));
  return { run, deps: asDeps({ env, runner: { run } }) };
}

/** The directories git was asked from, for the top-level lookup only. */
const askedFrom = (run: ReturnType<typeof deps>["run"]) =>
  run.mock.calls.map(([command, args, options]: unknown[]) => {
    expect([command, args]).toEqual(["git", ["rev-parse", "--show-toplevel"]]);
    return (options as { cwd: string }).cwd;
  });

describe("launchRoot", () => {
  it("asks git for the top level of the launch directory, so a subfolder of the worktree resolves to its root", async () => {
    const { run, deps: d } = deps(
      { CLAUDE_PROJECT_DIR: "/repo/tools/kore" },
      { code: 0, stdout: "/repo\n" },
    );

    expect(await launchRoot(d, "/repo/tools/kore")).toBe("/repo");
    expect(askedFrom(run)).toEqual(["/repo/tools/kore"]);
  });

  it("anchors on the launch directory the environment names, not on the shell's current directory", async () => {
    const { run, deps: d } = deps(
      { CLAUDE_PROJECT_DIR: "/repo" },
      { code: 0, stdout: "/repo\n" },
    );

    await launchRoot(d, "/repo/tools/kore");

    expect(askedFrom(run)).toEqual(["/repo"]);
  });

  it("anchors on the shell's directory only when the environment names none", async () => {
    const { run, deps: d } = deps({}, { code: 0, stdout: "/repo\n" });

    expect(await launchRoot(d, "/repo/tools/kore")).toBe("/repo");
    expect(askedFrom(run)).toEqual(["/repo/tools/kore"]);
  });

  it("falls back to the anchor itself when git cannot say", async () => {
    const { deps: d } = deps(
      { CLAUDE_PROJECT_DIR: "/repo" },
      { code: 128, stdout: "" },
    );

    expect(await launchRoot(d, "/elsewhere")).toBe("/repo");
  });
});
