// The shares of the weekly token ceiling (#1048, spec #1030): the shapes the flow report prints in
// text and in --json. Two kinds of share have two labels and are never in one column. A per-agent
// share is a rate, the role's plan-weighted tokens in the trailing 7 days over the ceiling. A
// merged-pull-request or idea share is a size, the unit's total plan-weighted tokens over one
// week's ceiling, with its span beside it. A missing ceiling reads "not set", a level or window
// below the minimum count reads insufficient, and a model with no plan weight is named; none of
// them is ever a zero.

import type { AgentRow } from "./cost-waiting-types.js";

/** The label of a per-agent share: a true weekly rate. */
export const RATE_LABEL = "of the weekly ceiling";
/** The label of a merged-pull-request or idea share: a size against one week's ceiling. */
export const SIZE_LABEL = "of one week's ceiling";

/** The days a per-agent rate is read over, ending where the report's window ends. */
export const RATE_DAYS = 7;

/** A share as a fraction of the ceiling (0.1 is 10%), or "not set" when the config names no ceiling. */
export type ShareValue = number | "not set";

/** One unit's share, with the label that says what it is a share of. */
export type ShareReading = { label: string } & (
  | {
      status: "measured";
      share: ShareValue;
      /** A size's span in seconds, first event to last; null where the unit has no event to span. */
      spanSeconds?: number | null;
      /** What the main-session row is read from when its model is not all recorded: "assumed model", or "recorded and assumed model". */
      basis?: string;
    }
  | { status: "insufficient"; units: number; needed: number }
  | { status: "insufficient weights"; models: string[] }
);

/** A level's sum of its rows' shares, and the median and 90th percentile over its units' shares. */
export type LevelShare = { label: string; units: number; needed: number } & (
  | {
      status: "measured";
      total: ShareValue;
      median: ShareValue | null;
      p90: ShareValue | null;
    }
  | { status: "insufficient" }
  | { status: "insufficient weights"; models: string[] }
);

export type AgentShares = LevelShare & {
  /** The days the rate covers, ending at the window's end (or as-of when it has none). */
  days: number;
  rows: Record<AgentRow, ShareReading>;
};

export type MergedChangeShares = LevelShare & {
  /** A merged change's share, null where no writer launch joins it (never zero). */
  rows: { number: number; share: ShareReading | null }[];
};

export type IdeaShares = LevelShare & {
  rows: { idea: string; share: ShareReading }[];
};

/** The ceiling and the shares of it at each level. */
export interface CeilingShares {
  /** The weekly ceiling in plan-weighted tokens, or "not set". */
  ceiling: number | "not set";
  agents: AgentShares;
  mergedChanges: MergedChangeShares;
  ideas: IdeaShares;
}
