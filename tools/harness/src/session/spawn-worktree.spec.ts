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

const WORKTREE = "/main/.claude/worktrees/image-trust-writer";
const args = [...spawnArgs, "--worktree"];
const responses = () => [
  gitCommon,
  nameFree,
  layoutOf(),
  splitReturns("w3:p9"),
];

const calls = (h: ReturnType<typeof testHarness>): string[] =>
  h.runner.calls
    .filter((c) => c.command !== "herdr" || c.args[1] === "split")
    .map((c) => `${c.command} ${c.args.join(" ")}`)
    .filter((c) => !c.includes("--git-common-dir"));

describe("session spawn --worktree", () => {
  it("creates the branch and worktree before the split, then runs npm ci", async () => {
    const h = testHarness({ env: INSIDE, responses: responses() });
    expect(await run(args, h.deps)).toBe(0);
    expect(calls(h)).toEqual([
      `git worktree add -b image-trust-writer ${WORKTREE} HEAD`,
      `npm ci`,
      `herdr pane split --current --direction right --cwd ${WORKTREE} --no-focus`,
    ]);
    const install = h.runner.calls.find((c) => c.command === "npm");
    expect(install?.options?.cwd).toBe(`${WORKTREE}/tools/kore`);
  });

  it("uses --branch as the branch name", async () => {
    const h = testHarness({ env: INSIDE, responses: responses() });
    await run([...args, "--branch", "feat/trust"], h.deps);
    expect(calls(h)[0]).toBe(`git worktree add -b feat/trust ${WORKTREE} HEAD`);
  });

  it("leaves the working directory alone without --worktree", async () => {
    const h = testHarness({ env: INSIDE, responses: responses() });
    await run(spawnArgs, h.deps);
    expect(h.runner.calls.some((c) => c.args[0] === "worktree")).toBe(false);
  });

  it("fails before splitting when the worktree cannot be created", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        {
          match: (c, a) => c === "git" && a[0] === "worktree",
          result: { code: 128, stderr: "branch already exists" },
        },
        ...responses(),
      ],
    });
    expect(await run(args, h.deps)).toBe(1);
    expect(h.err()).toContain("branch already exists");
    expect(herdrCalls(h).some((c) => c.includes("pane split"))).toBe(false);
  });

  it("names the worktree to remove when the split fails afterwards", async () => {
    const h = testHarness({
      env: INSIDE,
      responses: [
        {
          match: (_c, a) => a[1] === "split",
          result: { code: 1, stderr: "x" },
        },
        ...responses(),
      ],
    });
    expect(await run(args, h.deps)).toBe(1);
    expect(h.err()).toContain(`git worktree remove ${WORKTREE}`);
  });

  it("reports the worktree in JSON", async () => {
    const h = testHarness({ env: INSIDE, responses: responses() });
    await run([...args, "--json"], h.deps);
    expect(JSON.parse(h.out())).toMatchObject({
      worktree: { path: WORKTREE, branch: "image-trust-writer" },
    });
  });

  it("refuses --branch without --worktree", async () => {
    const h = testHarness({ env: INSIDE, responses: responses() });
    expect(await run([...spawnArgs, "--branch", "x"], h.deps)).toBe(2);
    expect(h.runner.calls).toHaveLength(0);
  });
});
