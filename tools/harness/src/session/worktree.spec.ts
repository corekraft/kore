import { describe, expect, it, vi } from "vitest";
import { closeHint, removeHint, type Worktree } from "./worktree.js";

// worktree.ts is not yet converted (plan 14); this spec pins only the two
// hint functions, which are pure and need no collaborator.
vi.mock("node:path");
vi.mock("../runtime/index.js");
vi.mock("./equalize.js");

const WORKTREE: Worktree = {
  path: "/main/.claude/worktrees/x",
  branch: "feat/x",
};

describe("worktree hints name the commands that remove a worktree", () => {
  it("tells the caller to remove a closed session's worktree once its branch is merged", () => {
    expect(closeHint(WORKTREE)).toBe(
      "Remove its worktree once its branch is merged: `git worktree remove /main/.claude/worktrees/x` and `git branch -D feat/x`.",
    );
  });

  it("names the worktree left behind by a failed spawn and both removal commands", () => {
    expect(removeHint(WORKTREE)).toBe(
      "The worktree /main/.claude/worktrees/x was left behind; remove it with `git worktree remove /main/.claude/worktrees/x` and `git branch -D feat/x`.",
    );
  });
});
