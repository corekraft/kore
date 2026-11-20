import type { BoundName } from "./tick-bounds.js";
import type { JudgmentStep } from "./tick-judgment.js";
import type { TickNotifier } from "./tick-notify.js";
import type { Starts } from "./tick-starts.js";
import type { Queue } from "./tick-ticket.js";

export type PaneState = "running" | "done" | "blocked" | "closed";

/** One pane `session spawn` made for an idea, read from the session registry. */
export interface IdeaPane {
  name: string;
  state: PaneState;
}

export type StepName =
  | "spawn-writer"
  | "relaunch-writer"
  | "spawn-judge"
  | "spawn-piece"
  | "spawn-live-proof"
  | "review"
  | "send-back"
  | "close"
  | "record-outcome"
  | "waiting"
  | "blocked"
  | "awaiting-judge"
  | "awaiting-outcome"
  | "merged"
  | "needs-judgment"
  | "not-queued"
  | "held"
  | JudgmentStep;

/** The one step a pass took for an idea. */
export interface IdeaStep {
  idea: string;
  issue?: number;
  step: StepName;
  pr?: number;
  pane?: string;
  /** On a held step: the bound that stopped the pane start this pass. */
  bound?: BoundName;
  /** What the branch update notice did for this idea this pass, when it has something to say (#980). */
  notice?: string;
}

/** The live-proof part of a pass, as the tick sees it (see LiveProofs). */
export interface LiveProofPass {
  pass(queue: Queue, starts: Starts): Promise<IdeaStep[]>;
}

/** What the tick tells each step of a pass, so an idea that needs a person can reach the attended pane. */
export type StepNotifier = Pick<TickNotifier, "notify">;
