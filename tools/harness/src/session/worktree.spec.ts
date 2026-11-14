import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { mainRoot } from "../runtime/index.js";
import { failed, fakeRunner, ok } from "./close-support.js";
import { describeFailure } from "./equalize.js";
import { closeHint, place, removeHint } from "./worktree.js";

vi.mock("../runtime/index.js", async (original) => ({
  ...(await original<typeof import("../runtime/index.js")>()),
  mainRoot: vi.fn(),
}));
vi.mock("./equalize.js", () => ({
  describeFailure: vi.fn(() => "npm said no"),
}));

const WORKTREE = {
  path: "/main/.claude/worktrees/x",
  branch: "feat/x",
};
/** The worktree `place` creates for session x, on the branch named after it. */
const CREATED = { path: "/main/.claude/worktrees/x", branch: "x" };
const HARNESS = "/main/.claude/worktrees/x/tools/harness";
const KORE = "/main/.claude/worktrees/x/tools/kore";

/** The one step that fails: its command line, and the directory it runs in when that matters. */
interface Failing {
  line: string;
  cwd?: string;
}

/** A runner whose steps all succeed, except the one `failing` names. */
function runnerFailing(failing?: Failing) {
  return fakeRunner((command, args, options) => {
    const line = `${command} ${args.join(" ")}`;
    const hit =
      failing !== undefined &&
      line === failing.line &&
      (failing.cwd === undefined || options?.cwd === failing.cwd);
    return hit ? failed("boom") : ok();
  });
}

/** The command lines a spawn runs, in order. */
const lines = (run: { mock: { calls: unknown[][] } }) =>
  run.mock.calls.map(
    (call) => `${String(call[0])} ${(call[1] as string[]).join(" ")}`,
  );

const ADD = "git worktree add -b x /main/.claude/worktrees/x HEAD";
const BUILD = "npm run build --silent";

function deps(runner: ReturnType<typeof runnerFailing>): CliDeps {
  return { runner: runner.runner, cwd: "/main/caller" } as unknown as CliDeps;
}

beforeEach(() => {
  vi.mocked(mainRoot).mockResolvedValue("/main");
  vi.mocked(describeFailure).mockReturnValue("npm said no");
});

describe("closeHint and removeHint", () => {
  it("names the worktree removal and the branch delete once the branch is merged", () => {
    expect(closeHint(WORKTREE)).toBe(
      "Remove its worktree once its branch is merged: `git worktree remove /main/.claude/worktrees/x` and `git branch -D feat/x`.",
    );
  });

  it("says a failed spawn left the worktree behind, and names the same two commands", () => {
    expect(removeHint(WORKTREE)).toBe(
      "The worktree /main/.claude/worktrees/x was left behind; remove it with `git worktree remove /main/.claude/worktrees/x` and `git branch -D feat/x`.",
    );
  });
});

describe("place without --worktree", () => {
  it("runs the pane in the caller's directory and creates nothing", async () => {
    const fake = runnerFailing();
    expect(await place(deps(fake), {}, "x")).toEqual({
      cwd: "/main/caller",
      left: "",
    });
    expect(fake.run).not.toHaveBeenCalled();
  });
});

describe("place with --worktree", () => {
  it("creates the worktree on a branch named after the session, installs and builds, then runs the pane there", async () => {
    const fake = runnerFailing();
    expect(await place(deps(fake), { worktree: true }, "x")).toEqual({
      worktree: CREATED,
      cwd: CREATED.path,
      left: ` ${removeHint(CREATED)}`,
    });
    expect(lines(fake.run)).toEqual([ADD, "npm ci", "npm ci", BUILD]);
    expect(fake.run.mock.calls.map((call) => call[2])).toEqual([
      { cwd: "/main/caller" },
      { cwd: KORE },
      { cwd: HARNESS },
      { cwd: HARNESS },
    ]);
  });

  it("names the branch given with --branch", async () => {
    const fake = runnerFailing();
    await place(deps(fake), { worktree: true, branch: "feat/y" }, "x");
    expect(lines(fake.run)[0]).toBe(
      "git worktree add -b feat/y /main/.claude/worktrees/x HEAD",
    );
  });

  it("refuses to place outside a repository, naming KORE_ROOT, and runs nothing", async () => {
    vi.mocked(mainRoot).mockResolvedValue(undefined);
    const fake = runnerFailing();
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: expect.stringContaining("KORE_ROOT") as string,
    });
    expect(fake.run).not.toHaveBeenCalled();
  });

  it("stops at a failed worktree add, with no pane split and a removal hint", async () => {
    const fake = runnerFailing({ line: ADD });
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: `git worktree add failed: npm said no. No pane was split. A previous spawn may have left the worktree or branch: run \`git worktree remove /main/.claude/worktrees/x\` and \`git branch -D x\`, or pass --branch <other>.`,
    });
    expect(lines(fake.run)).toEqual([ADD]);
  });

  it("stops at a failed npm ci in the worktree, leaving it behind with a removal hint", async () => {
    const fake = runnerFailing({ line: "npm ci", cwd: KORE });
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: `npm ci failed in the new worktree: npm said no. No pane was split. ${removeHint(CREATED)}`,
    });
    expect(lines(fake.run)).toEqual([ADD, "npm ci"]);
  });

  it("stops at a failed harness install, since the pane needs the harness bundle", async () => {
    const fake = runnerFailing({ line: "npm ci", cwd: HARNESS });
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: `npm ci failed for the harness in the new worktree: npm said no. No pane was split. ${removeHint(CREATED)}`,
    });
    expect(lines(fake.run)).toEqual([ADD, "npm ci", "npm ci"]);
  });

  it("stops at a failed harness build, since the guard hook would block every tool call", async () => {
    const fake = runnerFailing({ line: BUILD });
    const result = await place(deps(fake), { worktree: true }, "x");
    expect(result).toEqual({
      error: `Building the harness bundle failed in the new worktree: npm said no. The pane's guard hook would block every tool call. No pane was split. ${removeHint(CREATED)}`,
    });
    expect(lines(fake.run)).toEqual([ADD, "npm ci", "npm ci", BUILD]);
  });
});
