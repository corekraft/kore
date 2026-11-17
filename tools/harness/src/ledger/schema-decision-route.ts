import type { Kind } from "./schema-kinds.js";

const DECISION_ROUTED_KINDS: readonly Kind[] = ["decision.routed"];

/** Where a question went: to the advisor, or to the owner (ADR 0120). */
export const DECISION_ROUTES = ["advisor", "owner"] as const;
export type DecisionRoute = (typeof DECISION_ROUTES)[number];

/**
 * Why the router sent a question where it did. The list is closed: a signal outside it is
 * refused, so a route can always be traced to one rule that decided it.
 */
export const DECISION_ROUTE_SIGNALS = [
  "reserved-category",
  "matched",
  "advisor-files",
  "escalated",
  "unclassifiable",
  "agreed",
] as const;
export type DecisionRouteSignal = (typeof DECISION_ROUTE_SIGNALS)[number];

/** The fields a decision.routed event carries, as EventInput extends them. */
export interface DecisionRouteOrigin {
  /** decision.routed: where the question went. */
  route: DecisionRoute;
  /** decision.routed: the rule that decided the route. */
  signal: DecisionRouteSignal;
}

/** Required on decision.routed and allowed on no other kind. */
export const DECISION_ROUTE_RULES = [
  {
    field: "route",
    check: (v: unknown) => DECISION_ROUTES.includes(v as DecisionRoute),
    hint: `must be one of ${DECISION_ROUTES.join(", ")}`,
    kinds: DECISION_ROUTED_KINDS,
  },
  {
    field: "signal",
    check: (v: unknown) =>
      DECISION_ROUTE_SIGNALS.includes(v as DecisionRouteSignal),
    hint: `must be one of ${DECISION_ROUTE_SIGNALS.join(", ")}`,
    kinds: DECISION_ROUTED_KINDS,
  },
] as const;
