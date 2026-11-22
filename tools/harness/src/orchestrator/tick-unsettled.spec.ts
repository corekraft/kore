import { describe, expect, it } from "vitest";
import { unsettledOf } from "./tick-unsettled.js";

describe("unsettledOf", () => {
  it("selects an open hc record that names a terminal and has no result yet", () => {
    expect(
      unsettledOf([
        { name: "idea-0001-writer", backend: "hc", terminal: "t7" },
      ]),
    ).toEqual([{ name: "idea-0001-writer", terminal: "t7", reportSeq: 0 }]);
  });

  it("keeps the report seq already consumed and the worktree path a writer runs in", () => {
    expect(
      unsettledOf([
        {
          name: "idea-0001-writer",
          backend: "hc",
          terminal: "t7",
          reportSeq: 3,
          worktree: { path: "/main/.claude/worktrees/idea-0001-writer" },
        },
      ]),
    ).toEqual([
      {
        name: "idea-0001-writer",
        terminal: "t7",
        reportSeq: 3,
        worktree: "/main/.claude/worktrees/idea-0001-writer",
      },
    ]);
  });

  it("leaves out a herdr record, whether it names a backend or predates the field", () => {
    expect(
      unsettledOf([
        { name: "old", terminal: "t7" },
        { name: "herdr", backend: "herdr", terminal: "t8" },
      ]),
    ).toEqual([]);
  });

  it("leaves out a closed record, a record that already has a result, one still starting, and one with no terminal", () => {
    expect(
      unsettledOf([
        { name: "closed", backend: "hc", terminal: "t1", closedAt: "t" },
        {
          name: "settled",
          backend: "hc",
          terminal: "t2",
          result: { outcome: "done", at: "t" },
        },
        { name: "starting", backend: "hc", terminal: "t3", starting: true },
        { name: "unnamed", backend: "hc" },
      ]),
    ).toEqual([]);
  });
});
