import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "../runtime/index.js";
import { removeMergedWorktree } from "./close-worktree.js";
import { describeFailure } from "./equalize.js";
import { failed, fakeRunner, ok } from "./close-support.js";

vi.mock("./equalize.js", () => ({
  describeFailure: vi.fn(() => "git said no"),
}));

const worktree = { path: "/main/.claude/worktrees/x", branch: "feat/x" };
const MAIN = "/main";
const GH = [
  "pr",
  "list",
  "--head",
  "feat/x",
  "--state",
  "merged",
  "--json",
  "number",
];
const STATUS = ["status", "--porcelain"];
const REMOVE = ["worktree", "remove", worktree.path];
const DELETE = ["branch", "-D", "feat/x"];

/** What each step answers. A test overrides only the step it is about. */
interface Steps {
  gh: Partial<RunResult>;
  status: Partial<RunResult>;
  remove: Partial<RunResult>;
  branch: Partial<RunResult>;
}
const SAFE: Steps = {
  gh: ok('[{"number":12}]'),
  status: ok(""),
  remove: ok(),
  branch: ok(),
};

/** A fake runner that answers each step from `SAFE`, with the given steps replaced. */
function runnerWith(steps: Partial<Steps> = {}) {
  const all = { ...SAFE, ...steps };
  return fakeRunner((command, args) => {
    if (command === "gh") {
      return all.gh;
    }
    if (args[0] === "status") {
      return all.status;
    }
    if (args[0] === "worktree") {
      return all.remove;
    }
    return all.branch;
  });
}

/** The arguments of each `run` call, in order: the list a test asserts on. */
const argsOf = (run: { mock: { calls: unknown[][] } }) =>
  run.mock.calls.map((call) => call[1]);

beforeEach(() => {
  vi.mocked(describeFailure).mockReturnValue("git said no");
});

describe("removeMergedWorktree when the branch is merged and the tree is clean", () => {
  it("removes the worktree without force, then force-deletes the branch, and names both", async () => {
    const fake = runnerWith();
    expect(await removeMergedWorktree(fake.runner, worktree, MAIN)).toEqual({
      removed: true,
      message:
        "Removed worktree /main/.claude/worktrees/x and deleted branch feat/x.",
    });
    expect(argsOf(fake.run)).toEqual([GH, STATUS, REMOVE, DELETE]);
  });

  it("runs gh, the removal and the branch delete in the main checkout, and reads the tree from the worktree", async () => {
    const fake = runnerWith();
    await removeMergedWorktree(fake.runner, worktree, MAIN);
    expect(fake.run.mock.calls.map((call) => call[2])).toEqual([
      { cwd: MAIN },
      { cwd: worktree.path },
      { cwd: MAIN },
      { cwd: MAIN },
    ]);
  });
});

describe("removeMergedWorktree refusals keep the worktree and the branch", () => {
  it("names the branch as unmerged when no merged PR has it as its head, removing nothing", async () => {
    const fake = runnerWith({ gh: ok("[]") });
    expect(await removeMergedWorktree(fake.runner, worktree, MAIN)).toEqual({
      removed: false,
      reason:
        "branch feat/x is unmerged: no merged PR has it as its head. Kept worktree /main/.claude/worktrees/x and branch feat/x.",
    });
    expect(argsOf(fake.run)).toEqual([GH]);
  });

  it("names the worktree when it has uncommitted changes, removing nothing", async () => {
    const fake = runnerWith({ status: ok(" M src/index.ts\n") });
    expect(await removeMergedWorktree(fake.runner, worktree, MAIN)).toEqual({
      removed: false,
      reason:
        "worktree /main/.claude/worktrees/x has uncommitted or untracked changes. Kept worktree /main/.claude/worktrees/x and branch feat/x.",
    });
    expect(argsOf(fake.run)).toEqual([GH, STATUS]);
  });

  it("keeps both when gh cannot answer, and says why", async () => {
    vi.mocked(describeFailure).mockReturnValue("not logged in");
    const fake = runnerWith({ gh: failed("not logged in") });
    expect(await removeMergedWorktree(fake.runner, worktree, MAIN)).toEqual({
      removed: false,
      reason:
        "could not check whether feat/x is merged: not logged in. Kept worktree /main/.claude/worktrees/x and branch feat/x.",
    });
    expect(argsOf(fake.run)).toEqual([GH]);
  });

  it("keeps both when gh answers something other than a list", async () => {
    const fake = runnerWith({ gh: ok("{}") });
    expect(
      (await removeMergedWorktree(fake.runner, worktree, MAIN)).removed,
    ).toBe(false);
    expect(argsOf(fake.run)).toEqual([GH]);
  });

  it("keeps the branch and says so when git cannot remove the worktree", async () => {
    vi.mocked(describeFailure).mockReturnValue("locked");
    const fake = runnerWith({ remove: failed("locked") });
    expect(await removeMergedWorktree(fake.runner, worktree, MAIN)).toEqual({
      removed: false,
      reason:
        "git worktree remove /main/.claude/worktrees/x failed: locked. Kept worktree and branch feat/x.",
    });
    expect(argsOf(fake.run)).toEqual([GH, STATUS, REMOVE]);
  });

  it("reports that the worktree is gone when the branch cannot be deleted", async () => {
    vi.mocked(describeFailure).mockReturnValue("busy");
    const fake = runnerWith({ branch: failed("busy") });
    expect(await removeMergedWorktree(fake.runner, worktree, MAIN)).toEqual({
      removed: false,
      reason:
        "Removed worktree /main/.claude/worktrees/x, but git branch -D feat/x failed: busy.",
    });
    expect(argsOf(fake.run)).toEqual([GH, STATUS, REMOVE, DELETE]);
  });
});
