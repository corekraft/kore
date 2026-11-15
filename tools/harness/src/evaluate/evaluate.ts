import { IdeaError } from "../idea/index.js";
import type { IdeaRecord } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { recordOutcome } from "../outcome/index.js";
import type { Concluded, Context, Result } from "../outcome/index.js";
import { judgeChange } from "./judge.js";
import { measureChange } from "./measure.js";

const DAY = 86_400_000;

/** What `recordOutcome` needs; the outcome tool is the only writer of an outcome. */
export type EvaluateContext = Context;

export interface EvaluateInput {
  ref: string;
  now: Date;
  /** Relative change counted as signal. */
  threshold: number;
  /** The PR that delivered the change, when the ledger cannot tie one to the idea's issue. */
  changedByPr?: number;
}

export type Evaluated =
  | {
      status: "recorded";
      idea: string;
      result: Result;
      before: number | null;
      after: number | null;
      concluded: Concluded;
      /** The merged PR that delivered the change, which a revert undoes. */
      changedByPr: number | undefined;
    }
  | { status: "too-early"; idea: string; evaluableAt: string }
  | { status: "already-recorded"; idea: string; result: string };

/** When the idea's change merged: the PR named, else the first merge for its issue. */
function mergedAt(
  events: LedgerEvent[],
  record: IdeaRecord,
  changedByPr: number | undefined,
): { at: Date; pr: number | undefined } {
  const number = /(\d+)\/?$/.exec(record.issue ?? "")?.[1];
  if (number === undefined) {
    throw new IdeaError(
      `${record.path} has no issue; run \`harness idea sync\` first, then rerun \`harness evaluate\`.`,
    );
  }
  const merges = events
    .filter(
      (e) =>
        e.kind === "pr.merged" &&
        (changedByPr === undefined
          ? e.idea === `#${number}`
          : e.number === changedByPr),
    )
    .map((e) => ({ at: Date.parse(e.occurredAt), pr: e.number }))
    .sort((a, b) => a.at - b.at);
  const first = merges[0];
  if (first === undefined) {
    throw new IdeaError(
      `No merged change is recorded in the ledger for issue #${number}; run \`harness ledger poll-github\`, or pass --changed-by-pr <number> for the PR that delivered it.`,
    );
  }
  return { at: new Date(first.at), pr: first.pr };
}

/**
 * After the measurement window, judges the hypothesis metric against the window
 * before the change and records the result through the outcome tool. It reverts
 * nothing, records nothing inside the window, and never replaces an outcome.
 */
export async function evaluateIdea(
  ctx: EvaluateContext,
  events: LedgerEvent[],
  { ref, now, threshold, changedByPr }: EvaluateInput,
): Promise<Evaluated> {
  const record = await ctx.repo.get(ref);
  if (record.harness === undefined) {
    throw new IdeaError(
      `${record.path} is not a harness idea, so it has no hypothesis to evaluate; only \`kind: harness\` ideas are evaluated.`,
    );
  }
  if (record.outcome !== undefined) {
    return {
      status: "already-recorded",
      idea: record.number,
      result: record.outcome,
    };
  }
  const { metric, direction, window } = record.harness;
  const windowDays = Number.parseInt(window, 10);
  const { at: changedAt, pr } = mergedAt(events, record, changedByPr);
  const evaluable = new Date(changedAt.getTime() + windowDays * DAY);
  if (now < evaluable) {
    return {
      status: "too-early",
      idea: record.number,
      evaluableAt: evaluable.toISOString(),
    };
  }
  const { before, after } = measureChange(events, {
    metric,
    changedAt,
    windowDays,
  });
  const { result, reason } = judgeChange({
    direction,
    before,
    after,
    threshold,
  });
  const figure = (value: number | null) => value ?? "none";
  const concluded = await recordOutcome(ctx, ref, {
    kind: "experiment",
    source: "comparison",
    result,
    evidence: `ledger flow metric ${metric}: ${window} before ${changedAt.toISOString()} against the ${window} after`,
    summary: `${metric} went from ${figure(before)} to ${figure(after)} (expected ${direction}, noise threshold ${Math.round(threshold * 1000) / 10}%): ${reason}.`,
  });
  return {
    status: "recorded",
    idea: record.number,
    result,
    before,
    after,
    concluded,
    changedByPr: pr,
  };
}
