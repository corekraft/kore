import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { run } from "../cli/index.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  nameFree,
  spawnArgs,
  splitReturns,
} from "./spawn-support.js";

const writer = spawnArgs.map((arg) => (arg === "reader" ? "writer" : arg));

describe("session spawn for a writer", () => {
  it("refuses a writer without --worktree, so concurrent writers cannot collide", async () => {
    const h = testHarness({ env: INSIDE, responses: [] });
    expect(await run(writer, h.deps)).toBe(2);
    expect(h.err()).toContain("--worktree");
    expect(h.err()).toContain("writer");
    expect(h.runner.calls).toEqual([]);
  });

  it("starts a writer that has its own worktree", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    expect(await run([...writer, "--worktree"], h.deps)).toBe(0);
    expect(herdrCalls(h)).toContain("herdr pane layout --pane w3:p1");
  });

  it("does not require a worktree for other roles", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    expect(await run(spawnArgs, h.deps)).toBe(0);
  });
});
