import type { IdeaRecord } from "../idea/index.js";
import {
  GRILL_PREFIX,
  IDEA_MARKER,
  PAUSED_LABEL,
  READY_LABEL,
  SPEC_LABEL,
} from "./labels.js";

/** Why an open issue is kept out of the frontier. Each issue gets the first reason that applies. */
export type ExclusionReason =
  | "not-ready"
  | "assigned"
  | "paused"
  | "spec"
  | "blocked"
  | "sub-issue"
  | "grilling-source"
  | "idea-outcome"
  | "idea-missing";

/** The facts about one open issue that the frontier rule reads. */
export interface FrontierIssue {
  number: number;
  title: string;
  body: string;
  labels: readonly string[];
  /** How many people or bots are assigned. */
  assignees: number;
  /** How many open issues block this one. */
  openBlockers: number;
  /** How many sub-issues this one has; a parent is not a ticket. */
  subIssues: number;
  createdAt: string;
}

/**
 * The reason an open issue stays out of the frontier, or undefined when it is
 * queued. An idea issue is queued only while its idea record has no outcome;
 * `idea` is the record it mirrors, undefined when none matches.
 */
export function exclusionOf(
  issue: FrontierIssue,
  idea: IdeaRecord | undefined,
): ExclusionReason | undefined {
  if (!issue.labels.includes(READY_LABEL)) {
    return "not-ready";
  }
  if (issue.assignees > 0) {
    return "assigned";
  }
  if (issue.labels.includes(PAUSED_LABEL)) {
    return "paused";
  }
  if (issue.labels.includes(SPEC_LABEL)) {
    return "spec";
  }
  if (issue.openBlockers > 0) {
    return "blocked";
  }
  if (issue.subIssues > 0) {
    return "sub-issue";
  }
  const body = issue.body.trimStart();
  if (body.startsWith(GRILL_PREFIX)) {
    return "grilling-source";
  }
  if (body.startsWith(IDEA_MARKER)) {
    if (idea === undefined) {
      return "idea-missing";
    }
    if (idea.outcome !== undefined) {
      return "idea-outcome";
    }
  }
  return undefined;
}
