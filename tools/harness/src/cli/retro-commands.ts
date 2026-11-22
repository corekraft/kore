import { MIN_COMPLETED_IDEAS, buildReport } from "../flow/index.js";
import { readPlans } from "../plan/index.js";
import {
  COUNT_THRESHOLD,
  Retro,
  RetroError,
  metricsOf,
  type DueReport,
} from "../retro/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
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

const dueHelp: CommandHelp = {
  purpose:
    "Says whether a retro is due, and why: the closed ideas since the last retro reached five, or a trailing metric worsened on an idea closed since then. A reason already recorded in the window is not due again.",
  when: "Before a session runs a retro, or when a brief asks whether one is due.",
  whenNot:
    "To log that a retro ran: use retro record. To read the flow figures the answer is drawn from: use flow report.",
  flags: {
    ledger:
      "A ledger file to read, relative to the working directory; by default the shared ledger in the main checkout.",
  },
  examples: [
    {
      command: "harness retro due",
      shows:
        "whether a retro is due, the reason if so, and the closed ideas counted since the last retro",
    },
    {
      command: "harness retro due --json",
      shows:
        "the same answer as one object: due, closedIdeas, threshold and lastRetrospective, with reason and metric when a retro is due, and alreadyTriggered when a reason is already recorded in the window",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "the answer is printed, whether a retro is due or not",
    },
    {
      code: 1,
      meaning:
        "the ledger cannot be opened or the harness config is invalid; the message names the fix",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the ledger, the plans and the harness config; writes nothing",
  },
  seeAlso: ["retro record", "flow report"],
};

const due: Command = {
  help: dueHelp,
  summary:
    "say whether a retro is due, from the ledger and the Last retrospective marker; writes nothing",
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

const recordHelp: CommandHelp = {
  purpose:
    "Logs that a retro ran for a reason: appends a retro-triggered event to the ledger, once per reason in a window, and moves the Last retrospective marker in the harness plan to now, so the next window opens there.",
  when: "Right after a retro has run for a reason that retro due named: count, or a metric that worsened.",
  whenNot:
    "To ask whether a retro is due: use retro due. The retro itself is run by the /retro skill, never by this command.",
  flags: {
    reason:
      "The trigger: count, manual, or metric:<name> with the metric's name, such as metric:tokensPerIdea.",
    ledger:
      "A ledger file to append to, relative to the working directory; by default the shared ledger in the main checkout.",
  },
  examples: [
    {
      command: "harness retro record --reason count",
      shows:
        "the retro logged for the count reason, the time it was recorded, and that the marker moved",
    },
    {
      command: "harness retro record --reason metric:tokensPerIdea --json",
      shows:
        "the same record as one object: reason, recordedAt and appended, which is false when the window already held this reason",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the marker moved to now; the event was appended unless the window already held this reason",
    },
    {
      code: 1,
      meaning:
        "the reason is not count, manual or metric:<name>, the plan file is missing, or the ledger rejects the event; nothing is written when the reason or the plan is at fault",
    },
    {
      code: 2,
      meaning: "--reason is missing",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "appends a retro-triggered event to the ledger unless the window already holds this reason, then rewrites the Last retrospective line in the Retrospective marker section of infra/plans/3-agent-harness.md (adding the section when absent) on every run",
  },
  seeAlso: ["retro due", "flow report"],
};

const record: Command = {
  help: recordHelp,
  summary:
    "log that a retro ran for a reason, and move the Last retrospective marker to now",
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
