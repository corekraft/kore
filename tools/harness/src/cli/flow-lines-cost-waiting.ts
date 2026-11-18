// The token cost beside waiting time lines of the flow report (#1019): each agent role's dollars and
// tokens with their median and 90th percentile, the share of the weekly ceiling, then the merged pull
// requests, the writing buckets (#1093) and the ideas. A figure below the minimum count reads not read, and a model the price table
// does not price is named; the lines name no winner and no verdict.

import type { FlowReport } from "../flow/index.js";
import { writingLines } from "./flow-lines-writing.js";

type Cost = FlowReport["costWaiting"];
type Agent = Cost["agents"][keyof Cost["agents"]];

const money = (value: number) => `$${value}`;
const seconds = (value: number) => `${Math.round(value)}s`;

/** A figure's median and 90th percentile as text; "none" where a summary has no value. */
const spread = (
  median: number | null,
  p90: number | null,
  fmt: (n: number) => string,
) =>
  median === null || p90 === null
    ? "none"
    : `median ${fmt(median)}, p90 ${fmt(p90)}`;

/** One agent row as a line: measured with its figures, insufficient with its count, or unpriced and named. */
function agentLine(name: string, figure: Agent): string {
  if (figure.status === "insufficient prices") {
    return `${name} not read: no price for ${figure.models.join(", ")}`;
  }
  if (figure.status === "insufficient") {
    return `${name} not read: ${figure.sessions} session(s), ${figure.needed} needed`;
  }
  const share =
    figure.ceilingShare === "not set"
      ? "ceiling not set"
      : `${Math.round(figure.ceilingShare * 10_000) / 100}% of the weekly ceiling`;
  return [
    `${name}: ${figure.sessions} session(s)`,
    `dollars ${money(figure.dollars.total)} (${spread(figure.dollars.median, figure.dollars.p90, money)})`,
    `tokens ${figure.tokens.total} (${spread(figure.tokens.median, figure.tokens.p90, String)})`,
    `active ${spread(figure.activeSeconds.median, figure.activeSeconds.p90, seconds)}`,
    `waiting ${spread(figure.waitingSeconds.median, figure.waitingSeconds.p90, seconds)}`,
    share,
  ].join("; ");
}

/** The per-role lines, every role named, a role with no session named as not read. */
function agentLines(cost: Cost): string[] {
  return Object.entries(cost.agents).map(([name, figure]) =>
    agentLine(name, figure),
  );
}

/** The merged-change line: its all-in summaries, or the count joined and the minimum needed. */
function mergedLine(cost: Cost): string {
  const merged = cost.mergedChanges;
  if (merged.status === "insufficient prices") {
    return `Merged changes: insufficient prices (${(merged.models ?? []).join(", ")})`;
  }
  if (merged.status === "insufficient") {
    return `Merged changes: not read, ${merged.joined} joined (${merged.needed} needed)`;
  }
  return `Merged changes: ${merged.joined} joined; all-in dollars (${spread(merged.dollars?.median ?? null, merged.dollars?.p90 ?? null, money)}); tokens (${spread(merged.tokens?.median ?? null, merged.tokens?.p90 ?? null, String)})`;
}

/** The idea lines: each idea's dollars, tokens and lead time with its outcome, in idea order. */
function ideaLines(cost: Cost): string[] {
  return cost.ideas.map(
    (idea) =>
      `Idea ${idea.idea}: ${idea.dollars === null ? `insufficient prices (${(idea.unpricedModels ?? []).join(", ")})` : money(idea.dollars)}, ${idea.tokens} tokens, ${idea.outcome ?? "open"}${idea.leadTimeSeconds === null ? "" : `, lead ${Math.round(idea.leadTimeSeconds)}s`}`,
  );
}

/** The token cost beside waiting time lines: the headline, the agent rows, the merged changes, the writing buckets and the ideas. */
export function costWaitingLines(cost: Cost): string[] {
  return [
    "Token cost beside waiting time (#1019):",
    ...agentLines(cost).map((line) => `  ${line}`),
    `  ${mergedLine(cost)}`,
    ...writingLines(cost.writing).map((line) => `  ${line}`),
    ...ideaLines(cost).map((line) => `  ${line}`),
  ];
}
