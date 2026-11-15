import type { CostMetric } from "../flow/index.js";
import type { IdeaRecord } from "../idea/index.js";
import { tierRefusal } from "./qualify-tier.js";

/** Safety patterns that are one revertible change with no data or external state migration. */
const REVERSIBLE: readonly string[] = [
  "no-behaviour-change",
  "feature-flagged",
  "dark-launched",
  "branch-by-abstraction",
];

const GUARDRAIL_ENFORCE = /guardrail[\s\S]*enforce|enforce[\s\S]*guardrail/i;

export interface QualifyInput {
  /** Every metric path the flow report names. */
  known: readonly string[];
  /** The report's trailing metrics by path, each with enough history or not. */
  trailing: Readonly<Record<string, CostMetric>>;
}

export type Verdict = { approve: boolean; reason: string };

const refuse = (why: string): Verdict => ({
  approve: false,
  reason: `Left for a person: ${why}`,
});

/** The first reason an idea may not approve itself, or the reason it qualifies. Pure: the same idea and report always give the same verdict. */
export function qualify(idea: IdeaRecord, input: QualifyInput): Verdict {
  if (idea.harness === undefined) {
    return refuse(
      "this is not a harness idea (no kind: harness hypothesis of metric, direction and window).",
    );
  }
  if (!REVERSIBLE.includes(idea.safetyPattern)) {
    return refuse(
      `safety pattern ${idea.safetyPattern} is not one revertible change; it migrates data or external state. Only ${REVERSIBLE.slice(0, -1).join(", ")} and ${REVERSIBLE.at(-1)} count as reversible.`,
    );
  }
  const text = [idea.title, idea.summary, idea.expectedOutcome].join("\n");
  if (GUARDRAIL_ENFORCE.test(text)) {
    return refuse(
      "it moves a guardrail to enforce, and enforcement needs a person's decision (audit before enforce).",
    );
  }
  const { metric } = idea.harness;
  if (!input.known.includes(metric)) {
    return refuse(
      `${metric} is not a metric of the flow report (see \`harness flow report --json\`).`,
    );
  }
  const found = input.trailing[metric];
  if (found === undefined) {
    return refuse(
      `${metric} is in the flow report but has no trailing average to compare against.`,
    );
  }
  if (found.status !== "ok") {
    return refuse(
      `${metric} has too little history for a trailing average (${found.closedIdeas} closed ideas, ${found.needed} needed).`,
    );
  }
  const tier = tierRefusal(idea.harness, input);
  if (tier !== undefined) {
    return refuse(tier);
  }
  const edit =
    idea.harness.tier === undefined
      ? ""
      : ", a frontmatter edit of model or effort measured on cost and judge send-backs together";
  return {
    approve: true,
    reason: `Auto-approved: one revertible change (safety pattern ${idea.safetyPattern}, no data or external state migration${edit}), and ${metric} is in the flow report with a trailing average to measure against.`,
  };
}
