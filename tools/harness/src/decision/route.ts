// The question router (ADR 0120): decides whether a pane's question goes to the advisor or to the
// owner, and records decision.routed. It fails closed: any signal that says owner wins, and the
// advisor gets a question only when the declared category and the matcher both agree.
import type { DecisionRoute, DecisionRouteSignal } from "../ledger/index.js";
import { CATEGORY_NAME, DECISION_FLAG, DecisionError } from "./decision.js";
import { ADVISOR_FILES, matchedBy } from "./matcher.js";
import { RESERVED_CATEGORIES, reservedCategory } from "./reserved.js";

/** The label a question with no readable category is recorded under. */
export const UNCLASSIFIED = "unclassified";

export interface RouteInput {
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

export interface Routed {
  /** The idea's number, as its record writes it. */
  readonly idea: string;
  /** The category recorded, or UNCLASSIFIED when the declared one is unreadable. */
  readonly category: string;
  readonly route: DecisionRoute;
  readonly signal: DecisionRouteSignal;
}

export interface RoutePorts {
  readonly flagOn: () => Promise<boolean>;
  /** The idea's number, from its record. */
  readonly idea: (ref: string) => Promise<string>;
  /** Records decision.routed: the idea, the label, the route and the signal, never the text. */
  readonly record: (event: {
    idea: string;
    label: string;
    route: DecisionRoute;
    signal: DecisionRouteSignal;
  }) => Promise<{ ok: true } | { ok: false; message: string }>;
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
export function classify(input: RouteInput): Classification {
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

/**
 * Routes one question and records decision.routed. Refused, with nothing recorded, while the
 * decision-advisor flag is off, and when the ledger rejects the event: a route nobody recorded
 * is not one the pane may act on.
 */
export async function routeQuestion(
  ports: RoutePorts,
  input: RouteInput,
): Promise<Routed> {
  if (!(await ports.flagOn())) {
    throw new DecisionError(
      `The ${DECISION_FLAG} flag is off, so no route is recorded. Ask the owner on the idea's issue; it is turned on only with \`harness flag activate ${DECISION_FLAG}\`.`,
    );
  }
  const { route, signal } = classify(input);
  const category = CATEGORY_NAME.test(input.category)
    ? input.category
    : UNCLASSIFIED;
  const idea = await ports.idea(input.idea);
  const recorded = await ports.record({ idea, label: category, route, signal });
  if (!recorded.ok) {
    throw new DecisionError(
      `The route was not recorded: ${recorded.message} Treat the question as the owner's; ask the owner.`,
    );
  }
  return { idea, category, route, signal };
}
