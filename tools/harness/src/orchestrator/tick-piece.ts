import type { Launch } from "./idea-run.js";
import { pieceBrief, type BriefBackend } from "./judgment-briefs.js";
import type { WorkPiece } from "./judgment-check.js";
import { sessionNameError } from "../session/index.js";

/** What the tick does next for a persisted work plan: start a piece, stop at a blocked one, or pass to the flow. */
export type PieceNext =
  | { step: "start"; piece: WorkPiece; name: string }
  | { step: "blocked"; name: string }
  | { step: "pass" };

/** The pane a piece runs in, named for its idea and the piece, so the idea's panes show which pieces started. */
export function pieceName(idea: string, piece: string): string {
  return `idea-${idea}-piece-${piece}`;
}

/** The launch of one piece: a writer in its own worktree, or a reader that answers the piece's brief. */
export function pieceLaunch(
  idea: string,
  issue: number,
  piece: WorkPiece,
  name: string,
  backend: BriefBackend,
): Launch {
  return {
    role: piece.role,
    name,
    issue,
    brief: pieceBrief(idea, issue, piece, backend),
    ...(piece.role === "writer" ? { worktree: true as const } : {}),
  };
}

/** The first piece whose pane name `session spawn` would refuse, with the refusal; undefined when every name is usable. */
export function pieceNameProblem(
  idea: string,
  work: readonly WorkPiece[],
): string | undefined {
  for (const piece of work) {
    const problem = sessionNameError(pieceName(idea, piece.name));
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

/**
 * The tick's next step for a persisted work plan, decided from its pieces' panes. A blocked piece
 * stops the plan for a person. An open finished piece is left for the generic close to take first.
 * A piece starts once every piece it waits for has a closed pane, so pieces run one at a time, in
 * the plan's order where the waits allow it. Pure: it reads names and states only.
 */
export function nextPiece(
  idea: string,
  work: readonly WorkPiece[],
  panes: readonly { name: string; state: string }[],
): PieceNext {
  const state = new Map(panes.map((pane) => [pane.name, pane.state]));
  const named = work.map((piece) => ({
    piece,
    name: pieceName(idea, piece.name),
  }));
  const blocked = named.find(({ name }) => state.get(name) === "blocked");
  if (blocked !== undefined) {
    return { step: "blocked", name: blocked.name };
  }
  const unclosed = named.some(({ name }) => {
    const current = state.get(name);
    return current !== undefined && current !== "closed";
  });
  if (unclosed) {
    return { step: "pass" };
  }
  const next = named.find(
    ({ piece, name }) =>
      !state.has(name) &&
      piece.after.every((after) => state.has(pieceName(idea, after))),
  );
  return next === undefined
    ? { step: "pass" }
    : { step: "start", piece: next.piece, name: next.name };
}
