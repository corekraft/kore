import { IdeaError } from "../idea/index.js";
import type { IdeaRecord } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { recordOutcome } from "../outcome/index.js";
import type { Concluded, Context, Result } from "../outcome/index.js";
import { judgeChange } from "./judge.js";
import { measureChange } from "./measure.js";
import { judgeTier } from "./tier.js";

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
      /** The send-backs a tier change was held against; absent for any other idea. */
      guard?: { metric: string; before: number | null; after: number | null };
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

const figure = (value: number | null) => value ?? "none";

type Hypothesis = NonNullable<IdeaRecord["harness"]>;

interface Judged {
  result: Result;
  before: number | null;
  after: number | null;
  guard?: { metric: string; before: number | null; after: number | null };
  evidence: string;
  summary: string;
}

/** The hypothesis metric judged on its own, or, for a tier change, held against send-backs too. */
function judgeIdea(
  events: LedgerEvent[],
  harness: Hypothesis,
  changedAt: Date,
  threshold: number,
): Judged {
  const { metric, direction, window, tier } = harness;
  const windowDays = Number.parseInt(window, 10);
  const { before, after } = measureChange(events, {
    metric,
    changedAt,
    windowDays,
  });
  const cost = judgeChange({ direction, before, after, threshold });
  const noise = `noise threshold ${Math.round(threshold * 1000) / 10}%`;
  const span = `${window} before ${changedAt.toISOString()} against the ${window} after`;
  if (tier === undefined) {
    return {
      result: cost.result,
      before,
      after,
      evidence: `ledger flow metric ${metric}: ${span}`,
      summary: `${metric} went from ${figure(before)} to ${figure(after)} (expected ${direction}, ${noise}): ${cost.reason}.`,
    };
  }
  const { guardMetric } = tier;
  const sent = measureChange(events, {
    metric: guardMetric,
    changedAt,
    windowDays,
  });
  const verdict = judgeTier({
    cost,
    guard: {
      judgement: judgeChange({ direction: "down", ...sent, threshold }),
      ...sent,
    },
    guardMetric,
  });
  return {
    result: verdict.result,
    before,
    after,
    guard: { metric: guardMetric, ...sent },
    evidence: `ledger flow metrics ${metric} and ${guardMetric}: ${span}`,
    summary: `${metric} went from ${figure(before)} to ${figure(after)} and ${guardMetric} from ${figure(sent.before)} to ${figure(sent.after)} (expected cost down with send-backs not up, ${noise}): ${verdict.reason}.`,
  };
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
  const { window } = record.harness;
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
  const judged = judgeIdea(events, record.harness, changedAt, threshold);
  const { before, after, result } = judged;
  const concluded = await recordOutcome(ctx, ref, {
    kind: "experiment",
    source: "comparison",
    result,
    evidence: judged.evidence,
    summary: judged.summary,
  });
  return {
    status: "recorded",
    idea: record.number,
    result,
    before,
    after,
    ...(judged.guard === undefined ? {} : { guard: judged.guard }),
    concluded,
    changedByPr: pr,
  };
}
