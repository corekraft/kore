// The figures of token cost beside waiting time (#1019, spec #997): the shapes the report prints in
// text and in --json. Each figure is over the window; a level below the minimum count reads
// insufficient, and a model the price table does not price reads insufficient prices, naming it.

import type { CeilingShares } from "./cost-waiting-shares-types.js";
import type { PriceTable } from "./writer-dollars.js";

/** The roles a session's name can carry, as one of its dash-separated words. */
export const AGENT_ROLES = [
  "writer",
  "reviewer",
  "judge",
  "verifier",
  "reader",
  "judgment",
  "advisor",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
/** A session with no role: the main session (no agent names it), or another named agent. */
export type AgentRow = AgentRole | "orchestrate" | "other";

/** A total with the median and 90th percentile of its per-session or per-change values; null where there are none. */
export interface Summary {
  total: number;
  median: number | null;
  p90: number | null;
}

/** A figure the price table cannot read: a model in its span is not priced, so it is never a zero. */
export interface UnpricedFigure {
  status: "insufficient prices";
  models: string[];
}

/** One agent row: measured with its summaries, insufficient below the minimum, or unpriced. */
export type AgentFigure =
  | {
      status: "measured";
      sessions: number;
      dollars: Summary;
      tokens: Summary;
      /** Seconds the role's sessions were active and waiting in the window, per session (cost-waiting-time.ts). */
      activeSeconds: Summary;
      waitingSeconds: Summary;
    }
  | { status: "insufficient"; sessions: number; needed: number }
  | UnpricedFigure;

/** One idea: the dollars and tokens of the sessions stamped with it and of the writers whose pull request carries it, its lead time and its outcome. */
export interface IdeaFigure {
  idea: string;
  /** Null, with unpricedModels, when a session ran on a model the price table does not price. */
  dollars: number | null;
  unpricedModels?: string[];
  /** Raw tokens, counted for every model. */
  tokens: number;
  /** Seconds from the idea's first event to its issue.closed, or null before its outcome. */
  leadTimeSeconds: number | null;
  outcome: "closed" | null;
}

/** One merged pull request in the window: all-in dollars and tokens, its launch-to-merge and its open-to-merge seconds. */
export interface MergedChangeFigure {
  number: number;
  /** False when no writer launch joins the pull request; its dollars, tokens and launch-to-merge seconds are then null, never zero; waitSeconds does not depend on the join. */
  joined: boolean;
  /** Also null when the change or the shared spend ran on an unpriced model. */
  dollars: number | null;
  tokens: number | null;
  launchToMergeSeconds: number | null;
  waitSeconds: number | null;
}

/** The merged changes in the window: every change, the joined count, and the summaries once the joined count reaches the minimum. */
export interface MergedChanges {
  changes: MergedChangeFigure[];
  status: "measured" | "insufficient" | "insufficient prices";
  joined: number;
  needed: number;
  /** The unpriced models, sorted, when the status is insufficient prices. */
  models?: string[];
  dollars?: Summary;
  tokens?: Summary;
}

/** One bucket of writer sessions: their cumulative tokens and dollars, never added to an idea. */
export interface WritingBucket {
  sessions: number;
  /** Raw tokens, counted for every model. */
  tokens: number;
  /** Null, with unpricedModels, when a session ran on a model the price table does not price. */
  dollars: number | null;
  unpricedModels?: string[];
}

/** The share of writer tokens attributed to an idea, or insufficient below the minimum writer sessions. */
export type AttributedShare =
  | { status: "measured"; share: number; sessions: number }
  | { status: "insufficient"; sessions: number; needed: number };

/**
 * Writer tokens by where they land (#1093, spec #1086): attributed to an idea (a stamped session,
 * or one whose pull request carries an idea), or one of the two unattributed buckets, which are
 * never added to an idea. Tokens and dollars are each session's cumulative to the window's end.
 */
export interface Writing {
  attributed: WritingBucket;
  /** Sessions whose linked pull request carries no idea. */
  noIdea: WritingBucket;
  /** Sessions with no pr.linked event. */
  noPullRequest: WritingBucket;
  /** Pull requests opened in the window with no pr.linked event: counted, never read as zero writing. */
  unjoinable: number;
  share: AttributedShare;
}

export interface CostWaitingOptions {
  /** The price table the dollars are read at. */
  prices: PriceTable;
  /** The smallest count a level is measured at; below it a level reads insufficient. */
  minimum: number;
  /** The weekly token ceiling in plan-weighted tokens; absent when the config names none. */
  weeklyTokenCeiling?: number | undefined;
  /** Where the 7 days of the per-agent shares end when the window has no end (#1048). */
  asOf?: Date | undefined;
}

export interface CostWaiting {
  agents: Record<AgentRow, AgentFigure>;
  /** The ceiling and the plan-weighted shares of it per agent (a rate), per merged change and per idea (sizes) (#1048). */
  ceilingShares: CeilingShares;
  ideas: IdeaFigure[];
  mergedChanges: MergedChanges;
  writing: Writing;
}
