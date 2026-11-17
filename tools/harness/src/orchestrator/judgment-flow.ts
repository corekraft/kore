import type {
  PlanCheck,
  Plan,
  ReadRequest,
  WorkPiece,
} from "./judgment-check.js";

/** Read rounds one decision may take before a plan that asks for more is refused (idea 0007's two passes). */
export const READ_ROUNDS = 2;

/** Retries after a refused plan before the idea is labelled needs-info: one. */
export const RETRIES = 1;

/** What the tick has already done for one decision: its read rounds, and the plans refused so far. */
export interface DecisionState {
  readRounds: number;
  refusals: number;
}

/**
 * The tick's next step for a decision. `read` asks the tick to run Haiku readers and then a fresh
 * judgment pane with their summaries; `work` hands the pieces to the tick to spawn; `retry` relaunches
 * the judgment pane once with the refusal; `needs-info` labels the idea for the owner.
 */
export type Next =
  | { step: "read"; reads: ReadRequest[] }
  | { step: "work"; work: WorkPiece[] }
  | { step: "retry"; reason: string }
  | { step: "needs-info"; reason: string };

/** Decides the next step from a checked plan and what the decision has already taken. Pure; starts nothing. */
export function decide(state: DecisionState, checked: PlanCheck): Next {
  if (!checked.ok) {
    return refusedNext(state, checked.error);
  }
  return placed(state, checked.plan);
}

function placed(state: DecisionState, plan: Plan): Next {
  if (plan.kind === "stop") {
    return { step: "needs-info", reason: plan.reason };
  }
  if (plan.kind === "work") {
    return { step: "work", work: plan.work };
  }
  if (state.readRounds >= READ_ROUNDS) {
    return refusedNext(
      state,
      `The plan asks for reads after ${READ_ROUNDS} read rounds, the most one decision may take; it must now be work or stop. Nothing was started.`,
    );
  }
  return { step: "read", reads: plan.reads };
}

function refusedNext(state: DecisionState, reason: string): Next {
  return state.refusals < RETRIES
    ? { step: "retry", reason }
    : { step: "needs-info", reason };
}
