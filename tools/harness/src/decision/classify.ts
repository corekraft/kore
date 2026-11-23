// The question classifier (ADR 0120): the route a question takes, to the advisor or to the owner. It
// is pure: `decision ask` applies it to a reserved question, and the owner gets every signal that
// says owner. It fails closed: any signal that says owner wins, and the advisor gets a question only
// when the declared category and the matcher both agree.
import type { DecisionRoute, DecisionRouteSignal } from "../ledger/index.js";
import { CATEGORY_NAME } from "./decision.js";
import { ADVISOR_FILES, matchedBy } from "./matcher.js";
import { RESERVED_CATEGORIES, reservedCategory } from "./reserved.js";

export interface ClassifyInput {
  /** The idea the question is about, as the pane names it. */
  readonly idea: string;
  /** The category the asking pane declared. */
  readonly category: string;
  readonly question: string;
  /** What the pane would do if the question were answered yes. */
  readonly action: string;
  /** The advisor's escalation: the question goes to the owner whatever the signals say. */
  readonly escalate: boolean;
}

export interface Classification {
  readonly route: DecisionRoute;
  readonly signal: DecisionRouteSignal;
}

/** A declared category is reserved by its name, or when a reserved pattern matches the name. */
function isReserved(category: string): boolean {
  return (
    RESERVED_CATEGORIES.some((entry) => entry.category === category) ||
    reservedCategory(category) !== undefined
  );
}

/**
 * The route the two signals give. Escalation and unreadable input go to the owner first; a
 * reserved category, and a match on the question or its action, go to the owner next. The
 * advisor gets the question only when the category is readable and unreserved and nothing matches.
 */
export function classify(input: ClassifyInput): Classification {
  if (input.escalate) {
    return { route: "owner", signal: "escalated" };
  }
  if (
    !CATEGORY_NAME.test(input.category) ||
    input.question.trim() === "" ||
    input.action.trim() === ""
  ) {
    return { route: "owner", signal: "unclassifiable" };
  }
  if (isReserved(input.category)) {
    return { route: "owner", signal: "reserved-category" };
  }
  const matched = matchedBy(`${input.question}\n${input.action}`);
  if (matched === ADVISOR_FILES) {
    return { route: "owner", signal: "advisor-files" };
  }
  if (matched !== undefined) {
    return { route: "owner", signal: "matched" };
  }
  return { route: "advisor", signal: "agreed" };
}
