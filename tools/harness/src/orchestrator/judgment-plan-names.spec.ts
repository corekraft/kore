import { describe, expect, it, vi } from "vitest";
import { checkNames } from "./judgment-plan.js";
import { pieceNameProblem } from "./tick-piece.js";

vi.mock("./tick-piece.js", () => ({ pieceNameProblem: vi.fn() }));

const SUFFIX =
  "The whole plan is refused and nothing was started; fix the judgment pane's plan and rerun.";

const WORK = {
  ok: true as const,
  plan: {
    kind: "work" as const,
    work: [
      {
        role: "writer" as const,
        name: "docs",
        brief: "Document it.",
        files: ["docs/a.md"],
        after: [],
      },
    ],
  },
};

describe("checkNames", () => {
  it("refuses a work plan whose piece pane name spawn would refuse, with that reason and the plan suffix", () => {
    vi.mocked(pieceNameProblem).mockReturnValue(
      "Session name is unusable; shorten it.",
    );

    expect(checkNames("0007", WORK)).toEqual({
      ok: false,
      error: `Session name is unusable; shorten it. ${SUFFIX}`,
    });
    expect(pieceNameProblem).toHaveBeenCalledWith("0007", WORK.plan.work);
  });

  it("passes a work plan whose piece names spawn accepts, unchanged", () => {
    vi.mocked(pieceNameProblem).mockReturnValue(undefined);

    expect(checkNames("0007", WORK)).toBe(WORK);
  });

  it("checks no piece name of a plan that is not work, since it has no pieces", () => {
    const stop = {
      ok: true as const,
      plan: { kind: "stop" as const, reason: "r" },
    };

    expect(checkNames("0007", stop)).toBe(stop);
    expect(pieceNameProblem).not.toHaveBeenCalled();
  });

  it("passes a refusal through unchanged, checking no names", () => {
    const refused = { ok: false as const, error: "Plan is not an object." };

    expect(checkNames("0007", refused)).toBe(refused);
    expect(pieceNameProblem).not.toHaveBeenCalled();
  });
});
