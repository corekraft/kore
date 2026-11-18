// The idea rows with the writing join (#1093): the writers' spend is charged to the ideas their
// pull requests carry, and the buckets of what carries no idea are returned beside them.

import type { LedgerEvent } from "../ledger/index.js";
import type { Span } from "./scope.js";
import { ideaRowsIn } from "./cost-waiting-ideas.js";
import { writingIn } from "./cost-waiting-writing.js";
import type {
  CostWaitingOptions,
  IdeaFigure,
  Writing,
} from "./cost-waiting-types.js";

/** The idea rows, each with its linked writers' spend, and the writing buckets over the window. */
export function ideasWithWritingIn(
  events: LedgerEvent[],
  window: Span,
  options: CostWaitingOptions,
): { ideas: IdeaFigure[]; writing: Writing } {
  const { byIdea, figure } = writingIn(events, window, options);
  return {
    ideas: ideaRowsIn(events, window, options, byIdea),
    writing: figure,
  };
}
