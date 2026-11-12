import { IdeaError, outcomeSection, issueTarget } from "../idea/index.js";
import type { IdeaRecord, IdeaRepository } from "../idea/index.js";
import type { Clock, Runner } from "../runtime/index.js";
import {
  RESULTS,
  followUpOf,
  markerFor,
  renderSection,
  type Outcome,
  type Result,
} from "./model.js";
import { publishOutcome, type Published } from "./publish.js";

export interface Concluded {
  idea: string;
  result: Result;
  issue: string;
  followUp?: string;
  published: Published;
}

export interface Context {
  repo: IdeaRepository;
  runner: Runner;
  clock: Clock;
  root: string;
}

async function finish(
  ctx: Context,
  record: IdeaRecord,
  result: Result,
  target: { number: string; repo: string },
): Promise<Concluded> {
  let followUp: string | undefined;
  if (result !== "confirmed") {
    const next = followUpOf(record, result);
    followUp = (await ctx.repo.create(next.slug, next.idea)).record.path;
  }
  const section = outcomeSection(await ctx.repo.source(record)) ?? "";
  const comment = [
    markerFor(record),
    section,
    ...(followUp === undefined ? [] : [`Follow-up idea: ${followUp}`]),
  ].join("\n\n");
  const published = await publishOutcome(ctx.runner, ctx.root, target, {
    result,
    marker: markerFor(record),
    comment: `${comment}\n`,
  });
  return {
    idea: record.number,
    result,
    issue: `https://github.com/${target.repo}/issues/${target.number}`,
    ...(followUp === undefined ? {} : { followUp }),
    published,
  };
}

/** Writes the outcome into the idea, then publishes it: comment, label, close and any follow-up idea. */
export async function recordOutcome(
  ctx: Context,
  ref: string,
  outcome: Outcome,
): Promise<Concluded> {
  const record = await ctx.repo.get(ref);
  if (record.outcome !== undefined) {
    throw new IdeaError(
      `${record.path} already has an outcome (${record.outcome}); an outcome is recorded once. Run \`harness outcome close --idea ${record.number}\` to finish publishing it.`,
    );
  }
  // Resolved before the write, so an idea with no issue changes nothing.
  const target = await issueTarget(ctx.runner, ctx.root, record);
  const date = ctx.clock.now().toISOString().slice(0, 10);
  await ctx.repo.recordOutcome(
    record,
    outcome.result,
    renderSection(outcome, date),
  );
  return await finish(ctx, record, outcome.result, target);
}

/** Closes an idea's issue from its recorded outcome; refuses, with no gh call, when none is recorded. */
export async function closeOutcome(
  ctx: Context,
  ref: string,
): Promise<Concluded> {
  const record = await ctx.repo.get(ref);
  const recorded = record.outcome;
  if (recorded === undefined) {
    throw new IdeaError(
      `${record.path} has no recorded outcome, so its issue stays open. Run \`harness outcome record --idea ${record.number} --kind <experiment|usage|verification> --source <live-run|journal|eval-history|comparison> --evidence <reference> --result <confirmed|refuted|inconclusive> --summary <text>\`.`,
    );
  }
  const result = RESULTS.find((r) => r === recorded);
  if (
    result === undefined ||
    outcomeSection(await ctx.repo.source(record)) === undefined
  ) {
    throw new IdeaError(
      `${record.path} has an outcome line "${recorded}" that the outcome tool did not write (it needs one of ${RESULTS.join(", ")} and an ## Outcome section). Remove it and run \`harness outcome record --idea ${record.number}\`.`,
    );
  }
  const target = await issueTarget(ctx.runner, ctx.root, record);
  return await finish(ctx, record, result, target);
}
