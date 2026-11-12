import type { Kind } from "../ledger/index.js";

/** The delivery loop's stages, in the order an idea passes through them. */
export const STAGES = [
  "refine",
  "challenge",
  "await approval",
  "orchestrate",
  "write",
  "judge",
  "merge",
  "verify",
  "outcome",
] as const;
export type Stage = (typeof STAGES)[number];

/**
 * The stage-mapping table: every rule that turns a ledger event into a stage,
 * as data in one place. A rule change is an edit here, never in the report code.
 */

/** A pane (or session) whose name ends in `-<role>` works that stage. */
export const ROLE_STAGES: Readonly<
  Record<string, { stage: Stage; after?: "pr.merged" }>
> = {
  refiner: { stage: "refine" },
  challenger: { stage: "challenge" },
  orchestrator: { stage: "orchestrate" },
  writer: { stage: "write" },
  judge: { stage: "judge" },
  // A verifier checks the merged change; earlier events are not verification.
  verifier: { stage: "verify", after: "pr.merged" },
};

/** A claude session with no pane is the main session, which orchestrates. */
export const MAIN_SESSION_STAGE: Stage = "orchestrate";

/** The issue stays in await approval, open and waiting on a person, until this label. */
export const APPROVAL_LABEL = "ready-for-agent";

/** Events by kind that name their stage; labels other than the approval label are not stages. */
export const GITHUB_STAGES: Readonly<Partial<Record<Kind, Stage>>> = {
  "issue.opened": "await approval",
  "issue.closed": "outcome",
  outcome: "outcome",
  "pr.opened": "merge",
  "pr.merged": "merge",
  "challenge.round": "challenge",
};

/** Default minimum completed ideas before a bottleneck is named. */
export const MIN_COMPLETED_IDEAS = 3;
