import { MIN_COMPLETED_IDEAS, buildReport } from "../flow/index.js";
import { readPlans } from "../plan/index.js";
import {
  COUNT_THRESHOLD,
  Retro,
  RetroError,
  metricsOf,
  type DueReport,
} from "../retro/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { loadCost } from "./flow-commands.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;
const USAGE = 2;

/** Prints an error as the command's message, plus a JSON object first under --json. */
function fail({ json, deps }: CommandContext, message: string, code: number) {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}\n` : ""}${message}\n`,
  );
  return code;
}

async function retroFor(context: CommandContext) {
  const opened = await openLedger(context);
  if ("error" in opened) {
    return { error: opened.error };
  }
  const { deps } = context;
  return {
    ledger: opened.ledger,
    retro: new Retro({
      ledger: opened.ledger,
      fs: deps.fs,
      clock: deps.clock,
      root: await deps.root(),
      readPlans: () => readPlans(deps),
    }),
  };
}

const since = (marker: string | null) =>
  marker === null ? "no recorded retro" : marker;

function describeDue(report: DueReport): string {
  const progress = `${report.closedIdeas} of ${COUNT_THRESHOLD} closed ideas since ${since(report.lastRetrospective)}`;
  if (!report.due) {
    return report.alreadyTriggered === undefined
      ? `No retro due: ${progress}.\n`
      : `No retro due: ${report.alreadyTriggered} already recorded in this window (${progress}).\n`;
  }
  const why =
    report.reason === "metric"
      ? `${report.metric ?? "a metric"} worsened`
      : `${COUNT_THRESHOLD} ideas closed`;
  const reason =
    report.reason === "metric" ? `metric:${report.metric}` : "count";
  return `Retro due: ${why} (${progress}). Run /retro, then \`harness retro record --reason ${reason}\`.\n`;
}

const due: Command = {
  summary:
    "read-only; say whether a retro is due from the ledger and the Last retrospective marker: reason count at the fifth idea closed since the last retro, or metric naming a trailing metric that worsened on an idea closed since; a reason already recorded in the window is not due again; starts no retro and writes nothing ([--json: due, reason, metric, closedIdeas, threshold, alreadyTriggered, lastRetrospective] [--ledger])",
  options: { ledger: "string" },
  async run(context) {
    const made = await retroFor(context);
    if ("error" in made) {
      return fail(context, made.error, FAILED);
    }
    const cost = await loadCost(context);
    if ("error" in cost) {
      return fail(context, cost.error, FAILED);
    }
    const { events } = await made.ledger.list({});
    const report = buildReport(events, {
      asOf: context.deps.clock.now(),
      minCompletedIdeas: MIN_COMPLETED_IDEAS,
      cost: cost.cost,
    });
    const result = await made.retro.due(metricsOf(report));
    context.deps.stdout(
      context.json ? `${JSON.stringify(result)}\n` : describeDue(result),
    );
    return 0;
  },
};

const record: Command = {
  summary:
    "append a retro-triggered event to the ledger and move the Last retrospective marker to its second, once per reason and window; refuses a malformed reason with nothing written; the retro itself is run by /retro, never by this command (--reason count|manual|metric:<name> [--json: reason, recordedAt, appended] [--ledger])",
  options: { reason: "string", ledger: "string" },
  async run(context) {
    const reason = context.options["reason"];
    if (typeof reason !== "string") {
      return fail(
        context,
        "Missing --reason; run `harness retro record --reason count|manual|metric:<name>`.",
        USAGE,
      );
    }
    const made = await retroFor(context);
    if ("error" in made) {
      return fail(context, made.error, FAILED);
    }
    try {
      const done = await made.retro.record(reason);
      context.deps.stdout(
        context.json
          ? `${JSON.stringify(done)}\n`
          : `Recorded retro (${done.reason}) at ${done.recordedAt}; the marker moved${done.appended ? "" : ", the ledger already held this reason"}.\n`,
      );
      return 0;
    } catch (error) {
      if (!(error instanceof RetroError)) {
        throw error;
      }
      return fail(context, error.message, FAILED);
    }
  },
};

export const retroCommands: Record<string, Command> = { due, record };
