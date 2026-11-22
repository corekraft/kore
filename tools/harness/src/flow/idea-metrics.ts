import type { LedgerEvent } from "../ledger/index.js";
import {
  DEFAULT_COST,
  costMetrics,
  type CostMetrics,
  type CostOptions,
} from "./cost.js";

export type { CostMetrics, CostOptions };
export { DEFAULT_HOST_DAYS, hostPressure } from "./host-pressure.js";
export type { HostPressure } from "./host-pressure.js";
export { questionFigures, type QuestionFigures } from "./question-figures.js";
export { DEFAULT_QUESTION_DAYS, ownerQuestions } from "./owner-questions.js";
export type { OwnerQuestions } from "./owner-questions.js";
export { DEFAULT_REVIEW_DAYS, reviewMisses } from "./review-misses.js";
export type { ReviewMisses } from "./review-misses.js";
export { mergedChangeFigures, type ReportSettings } from "./merged-figures.js";
export type { MergedChangeFigures } from "./merged-figures.js";
export { tierShares } from "./tier-share.js";
export { guardBlocks, outcomes } from "./outcomes.js";
export { COST_KINDS, measureAttribution } from "./attribution-measure.js";
export type { GuardBlocks, Outcomes } from "./outcomes.js";
export {
  guardBlocksByRule,
  type GuardBlocksByRule,
} from "./guard-blocks-by-rule.js";
export type { Attribution } from "./attribution-measure.js";
export { unstampedSpawns } from "./unstamped-spawns.js";
export type { UnstampedSpawns } from "./unstamped-spawns.js";
export { finishDetection } from "./finish-detection.js";
export type { FinishDetection } from "./finish-detection.js";
export { stalledPanes, type StalledPanes } from "./stalled-panes.js";
import {
  categoryReport,
  type SendBackCategoryReport,
} from "./send-back-categories.js";
import {
  friction,
  qualifierWarnings,
  reworkMetrics,
  type Friction,
  type QualifierWarnings,
  type ReworkMetrics,
} from "./friction.js";
import { firstTime, time } from "./github-waits.js";
import { retroProposalsDropped } from "./retro-dropped.js";
import { inWindow, type Span } from "./scope.js";
import { median } from "./wip.js";

/** Seconds from each completed idea's first event to its outcome event. */
export interface LeadTime {
  ideas: { idea: string; seconds: number }[];
  /** Null when no idea has an outcome. */
  medianSeconds: number | null;
  maxSeconds: number | null;
}

export const firstClosed = (own: LedgerEvent[]) =>
  firstTime(own, (e) => e.kind === "issue.closed");

/** Each idea completed in the range, from its first event to its first issue.closed, with median and maximum. */
export function leadTime(
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
): LeadTime {
  const ideas: LeadTime["ideas"] = [];
  for (const [idea, own] of byIdea) {
    const outcome = firstClosed(own);
    if (outcome !== undefined && inWindow(window, outcome)) {
      const first = Math.min(...own.map(time));
      ideas.push({ idea, seconds: (outcome - first) / 1000 });
    }
  }
  ideas.sort((a, b) =>
    a.idea.localeCompare(b.idea, undefined, { numeric: true }),
  );
  const seconds = ideas.map((i) => i.seconds);
  return {
    ideas,
    medianSeconds: median(seconds),
    maxSeconds: seconds.length === 0 ? null : Math.max(...seconds),
  };
}

/** Lead time and the cost metrics of the covered ideas, as the report names them. */
export function ideaMetrics(
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
  cost: Partial<CostOptions> = {},
): { leadTime: LeadTime; metrics: CostMetrics } {
  return {
    leadTime: leadTime(byIdea, window),
    metrics: costMetrics(byIdea, window, { ...DEFAULT_COST, ...cost }),
  };
}

/** Rework per closed idea, and friction by source, as the report names them. */
export interface FrictionMetrics {
  /** Escalations, send-backs and friction per closed idea. */
  rework: ReworkMetrics;
  /** Friction events in range by source. */
  friction: Friction;
  /** Retro proposals the per-retro cap dropped in range. */
  retroProposalsDropped: number;
  /** Qualifier warnings over ideas filed in range, so a check that only warns still has a figure (#866). */
  qualifierWarnings: QualifierWarnings;
  /** Judge send-backs by category, per PR head and per merged change. */
  sendBackCategories: SendBackCategoryReport;
}

export function frictionMetrics(
  named: LedgerEvent[],
  byIdea: Map<string, LedgerEvent[]>,
  window: Span,
  cost: Partial<CostOptions> = {},
): FrictionMetrics {
  return {
    rework: reworkMetrics(byIdea, window, cost.trailingIdeas),
    friction: friction(named, window),
    retroProposalsDropped: retroProposalsDropped(named, window),
    qualifierWarnings: qualifierWarnings(named, window),
    sendBackCategories: categoryReport(
      named,
      byIdea,
      window,
      { ...DEFAULT_COST, ...cost }.minCategorisedSendBacks,
    ),
  };
}
