import { describe, expect, it } from "vitest";
import { testHarness } from "../testing/index.js";
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

  it("launches a Sonnet writer in its own worktree and delivers the --brief text as its brief", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    const brief = "Implement step 2 of plan 14.";
    expect(
      await run(
        [
          ...writer,
          "--worktree",
          "--model",
          "claude-sonnet-5-5",
          "--effort",
          "high",
          "--brief",
          brief,
        ],
        h.deps,
      ),
    ).toBe(0);
    const calls = herdrCalls(h);
    expect(calls).toContain(
      "herdr agent start image-trust-writer --kind claude --pane w3:p9 -- --agent writer --model claude-sonnet-5-5 --effort high",
    );
    expect(
      calls.filter(
        (c) =>
          c.startsWith("herdr agent prompt image-trust-writer ") &&
          c.includes(brief),
      ),
    ).toHaveLength(1);
  });

  it("does not require a worktree for other roles", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [gitCommon, nameFree, layoutOf(), splitReturns("w3:p9")],
    });
    expect(await run(spawnArgs, h.deps)).toBe(0);
  });
});
