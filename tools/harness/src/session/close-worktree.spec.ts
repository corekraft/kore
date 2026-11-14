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
const RERUN = "session close image-trust-writer --remove-worktree";
const THEN = `Then rerun \`${RERUN}\`.`;
const KEPT = "Kept worktree /main/.claude/worktrees/x and branch feat/x.";
const GH = [
  "pr",
  "list",
  "--head",
  "feat/x",
  "--state",
  "merged",
  "--json",
  "number,headRefOid",
];
const REV = ["rev-parse", "HEAD"];
const STATUS = ["status", "--porcelain"];
const REMOVE = ["worktree", "remove", worktree.path];
const DELETE = ["branch", "-D", "feat/x"];
const MERGED_AT = "abc123";

/** What each step answers. A test overrides only the step it is about. */
interface Steps {
  gh: Partial<RunResult>;
  head: Partial<RunResult>;
  status: Partial<RunResult>;
  remove: Partial<RunResult>;
  branch: Partial<RunResult>;
}
const SAFE: Steps = {
  gh: ok(`[{"number":12,"headRefOid":"${MERGED_AT}"}]`),
  head: ok(`${MERGED_AT}\n`),
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
    if (args[0] === "rev-parse") {
      return all.head;
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

const removeIt = (fake: ReturnType<typeof runnerWith>) =>
  removeMergedWorktree(fake.runner, worktree, MAIN, RERUN);

beforeEach(() => {
  vi.mocked(describeFailure).mockReturnValue("git said no");
});

describe("removeMergedWorktree when the branch is merged and the tree is clean", () => {
  it("removes the worktree without force, then force-deletes the branch, and names both", async () => {
    const fake = runnerWith();
    expect(await removeIt(fake)).toEqual({
      removed: true,
      message:
        "Removed worktree /main/.claude/worktrees/x and deleted branch feat/x.",
    });
    expect(argsOf(fake.run)).toEqual([GH, REV, STATUS, REMOVE, DELETE]);
  });

  it("runs gh, the removal and the branch delete in the main checkout, and reads the tree from the worktree", async () => {
    const fake = runnerWith();
    await removeIt(fake);
    expect(fake.run.mock.calls.map((call) => call[2])).toEqual([
      { cwd: MAIN },
      { cwd: worktree.path },
      { cwd: worktree.path },
      { cwd: MAIN },
      { cwd: MAIN },
    ]);
  });
});

describe("removeMergedWorktree refusals keep both and name the fix and the rerun", () => {
  it("names the branch as unmerged when no merged PR has it as its head", async () => {
    const fake = runnerWith({ gh: ok("[]") });
    expect(await removeIt(fake)).toEqual({
      removed: false,
      reason: `branch feat/x is unmerged: no merged PR has it as its head. ${KEPT} Merge its PR. ${THEN}`,
    });
    expect(argsOf(fake.run)).toEqual([GH]);
  });

  it("names the worktree when it has uncommitted changes, and says to commit, stash or delete them", async () => {
    const fake = runnerWith({ status: ok(" M src/index.ts\n") });
    expect(await removeIt(fake)).toEqual({
      removed: false,
      reason: `worktree /main/.claude/worktrees/x has uncommitted or untracked changes. ${KEPT} Commit, stash or delete them. ${THEN}`,
    });
    expect(argsOf(fake.run)).toEqual([GH, REV, STATUS]);
  });

  it("keeps both when gh cannot answer, and says to fix gh", async () => {
    vi.mocked(describeFailure).mockReturnValue("not logged in");
    const fake = runnerWith({ gh: failed("not logged in") });
    expect(await removeIt(fake)).toEqual({
      removed: false,
      reason: `could not check whether feat/x is merged: not logged in. ${KEPT} Fix gh (for example with \`gh auth status\`). ${THEN}`,
    });
    expect(argsOf(fake.run)).toEqual([GH]);
  });

  it("keeps both when gh answers something other than a list of PRs with heads", async () => {
    const fake = runnerWith({ gh: ok('[{"number":12}]') });
    expect((await removeIt(fake)).removed).toBe(false);
    expect(argsOf(fake.run)).toEqual([GH]);
  });

  it("refuses when commits were added after the merge, naming both commits", async () => {
    const fake = runnerWith({ head: ok("def456\n") });
    expect(await removeIt(fake)).toEqual({
      removed: false,
      reason: `worktree /main/.claude/worktrees/x is at def456, but the merged PR's head is abc123: commits were added after the merge. ${KEPT} Merge the newer commits. ${THEN}`,
    });
    expect(argsOf(fake.run)).toEqual([GH, REV]);
  });

  it("refuses when the worktree HEAD cannot be read", async () => {
    vi.mocked(describeFailure).mockReturnValue("not a git repository");
    const fake = runnerWith({ head: failed("not a git repository") });
    expect(await removeIt(fake)).toEqual({
      removed: false,
      reason: `could not read the HEAD of worktree /main/.claude/worktrees/x: not a git repository. ${KEPT} Fix the worktree at /main/.claude/worktrees/x. ${THEN}`,
    });
    expect(argsOf(fake.run)).toEqual([GH, REV]);
  });

  it("keeps the branch and says what to clear when git cannot remove the worktree", async () => {
    vi.mocked(describeFailure).mockReturnValue("locked");
    const fake = runnerWith({ remove: failed("locked") });
    expect(await removeIt(fake)).toEqual({
      removed: false,
      reason: `git worktree remove /main/.claude/worktrees/x failed: locked. ${KEPT} Clear what blocks it, such as a locked or ignored file. ${THEN}`,
    });
    expect(argsOf(fake.run)).toEqual([GH, REV, STATUS, REMOVE]);
  });

  it("reports that the worktree is gone when the branch cannot be deleted, and says to finish by hand", async () => {
    vi.mocked(describeFailure).mockReturnValue("busy");
    const fake = runnerWith({ branch: failed("busy") });
    expect(await removeIt(fake)).toEqual({
      removed: false,
      reason:
        "Removed worktree /main/.claude/worktrees/x, but git branch -D feat/x failed: busy. Finish by hand with `git branch -D feat/x`.",
    });
    expect(argsOf(fake.run)).toEqual([GH, REV, STATUS, REMOVE, DELETE]);
  });
});
