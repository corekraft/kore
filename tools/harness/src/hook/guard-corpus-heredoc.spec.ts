import { describe, expect, it } from "vitest";
import { HEREDOC } from "./guard-corpus-heredoc.js";

describe("heredoc and node -e corpus data", () => {
  it("names role-worktree for every attempt, so each one must be refused by that rule", () => {
    expect(
      HEREDOC.corpus.filter(
        (c) => c.rule !== "role-worktree" || c.role !== "writer",
      ),
    ).toEqual([]);
  });

  it("keeps the attempts that a shell runs or a node -e read reaches, and leaves none empty", () => {
    expect(HEREDOC.corpus.length).toBeGreaterThanOrEqual(5);
    expect(HEREDOC.corpus.filter((c) => c.input.trim() === "")).toEqual([]);
  });

  it("gives every ordinary case a writer's Bash command to run", () => {
    expect(
      HEREDOC.ordinary.filter(
        (c) =>
          c.role !== "writer" || c.tool !== "Bash" || c.input.trim() === "",
      ),
    ).toEqual([]);
  });
});
