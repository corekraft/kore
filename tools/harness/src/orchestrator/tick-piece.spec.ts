import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkPiece } from "./judgment-check.js";
import { pieceBrief } from "./judgment-briefs.js";
import {
  nextPiece,
  pieceLaunch,
  pieceName,
  pieceNameProblem,
} from "./tick-piece.js";
import { sessionNameError } from "../session/index.js";

vi.mock("../session/index.js", () => ({ sessionNameError: vi.fn() }));
vi.mock("./judgment-briefs.js", () => ({ pieceBrief: vi.fn() }));

const IDEA = "0007";

const piece = (name: string, after: string[] = []): WorkPiece => ({
  role: "writer",
  name,
  brief: `Do ${name}.`,
  files: [],
  after,
});

beforeEach(() => {
  vi.mocked(sessionNameError).mockReturnValue(undefined);
});

describe("pieceLaunch", () => {
  beforeEach(() => {
    vi.mocked(pieceBrief).mockReturnValue("PIECE BRIEF");
  });

  it("briefs a reader piece for the backend it is launched under", () => {
    const reader = { ...piece("tests"), role: "reader" as const };

    pieceLaunch(IDEA, 11, reader, "idea-0007-piece-tests", "hc");

    expect(pieceBrief).toHaveBeenCalledWith(IDEA, 11, reader, "hc");
  });

  it("launches a writer piece in its own worktree, briefed with the piece, under its pane name", () => {
    expect(
      pieceLaunch(IDEA, 11, piece("docs"), "idea-0007-piece-docs", "herdr"),
    ).toEqual({
      role: "writer",
      name: "idea-0007-piece-docs",
      issue: 11,
      brief: "PIECE BRIEF",
      worktree: true,
    });
    expect(pieceBrief).toHaveBeenCalledWith(IDEA, 11, piece("docs"), "herdr");
  });

  it("launches a reader piece without a worktree, since it changes no file", () => {
    const reader = { ...piece("tests"), role: "reader" as const };

    expect(
      pieceLaunch(IDEA, 11, reader, "idea-0007-piece-tests", "herdr"),
    ).toEqual({
      role: "reader",
      name: "idea-0007-piece-tests",
      issue: 11,
      brief: "PIECE BRIEF",
    });
    expect(
      pieceLaunch(IDEA, 11, reader, "idea-0007-piece-tests", "herdr"),
    ).not.toHaveProperty("worktree");
  });
});

describe("pieceName", () => {
  it("names a piece's pane for its idea and its piece, so the idea's panes can be found", () => {
    expect(pieceName(IDEA, "docs")).toBe("idea-0007-piece-docs");
  });
});

describe("pieceNameProblem", () => {
  it("returns the spawn refusal for the first piece whose pane name is unusable", () => {
    vi.mocked(sessionNameError).mockImplementation((name) =>
      name === "idea-0007-piece-a" ? "Session name is unusable." : undefined,
    );
    expect(pieceNameProblem(IDEA, [piece("docs"), piece("a")])).toBe(
      "Session name is unusable.",
    );
  });

  it("returns undefined when every piece's pane name is usable", () => {
    expect(pieceNameProblem(IDEA, [piece("docs"), piece("tests")])).toBe(
      undefined,
    );
  });
});

describe("nextPiece", () => {
  it("starts the first piece when no piece has a pane yet", () => {
    expect(nextPiece(IDEA, [piece("docs"), piece("tests")], [])).toEqual({
      step: "start",
      piece: piece("docs"),
      name: "idea-0007-piece-docs",
    });
  });

  it("waits for a piece whose pane is finished but still open, so the generic close takes it first", () => {
    expect(
      nextPiece(
        IDEA,
        [piece("docs"), piece("tests")],
        [{ name: "idea-0007-piece-docs", state: "done" }],
      ),
    ).toEqual({ step: "pass" });
  });

  it("reports a blocked piece by its pane name and starts nothing after it", () => {
    expect(
      nextPiece(
        IDEA,
        [piece("docs"), piece("tests")],
        [{ name: "idea-0007-piece-docs", state: "blocked" }],
      ),
    ).toEqual({ step: "blocked", name: "idea-0007-piece-docs" });
  });

  it("starts the next piece once the earlier one is closed", () => {
    expect(
      nextPiece(
        IDEA,
        [piece("docs"), piece("tests")],
        [{ name: "idea-0007-piece-docs", state: "closed" }],
      ),
    ).toEqual({
      step: "start",
      piece: piece("tests"),
      name: "idea-0007-piece-tests",
    });
  });

  it("starts a piece only after every piece it waits for has a closed pane, whatever the plan order", () => {
    const work = [piece("tests", ["docs"]), piece("docs")];
    expect(nextPiece(IDEA, work, [])).toEqual({
      step: "start",
      piece: piece("docs"),
      name: "idea-0007-piece-docs",
    });
  });
});

describe("nextPiece order", () => {
  it("passes once every piece has a closed pane, so the flow moves on to the pull request", () => {
    expect(
      nextPiece(
        IDEA,
        [piece("docs"), piece("tests")],
        [
          { name: "idea-0007-piece-docs", state: "closed" },
          { name: "idea-0007-piece-tests", state: "closed" },
        ],
      ),
    ).toEqual({ step: "pass" });
  });

  it("ignores the idea's panes that are not pieces", () => {
    expect(
      nextPiece(
        IDEA,
        [piece("docs")],
        [{ name: "idea-0007-writer", state: "blocked" }],
      ),
    ).toEqual({
      step: "start",
      piece: piece("docs"),
      name: "idea-0007-piece-docs",
    });
  });
});
