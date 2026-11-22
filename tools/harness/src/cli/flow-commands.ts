import {
  DEFAULT_COST,
  HARNESS_CONFIG,
  MIN_COMPLETED_IDEAS,
  buildReport,
  parseHarnessConfig,
  type FlowReport,
  type Scope,
  type ScopeOptions,
} from "../flow/index.js";
import { join } from "node:path";
import type { Command, CommandContext } from "../runtime/index.js";
import { reportHelp } from "./flow-report-help.js";
import {
  frictionLine,
  metricLine,
  advisorFigureLines,
  questionLines,
  reviewMissLines,
  reworkLines,
  perMergedChangeLines,
  costWaitingLines,
  finishLines,
  sendBackCategoryLines,
} from "./flow-lines.js";
import { writerTierReportLines } from "./flow-lines-tiers.js";
import {
  parseIdeas,
  parseWindowFlags,
  type Effort,
} from "./flow-commands-flags.js";
import { openLedger } from "./ledger-commands.js";

/** The documented `--json` shape (docs/guides/contributor.md, "Flow report"). */
interface Printed extends FlowReport {
  /** Ledger lines that were not valid events and were left out. */
  skippedLines: number;
}

interface Flags extends ScopeOptions {
  asOf: Date;
  minCompletedIdeas: number;
  /** From --trailing; the harness config, then five, decide when absent. */
  trailingIdeas?: number;
  /** From --host-days; seven when absent. */
  hostDays?: number;
  /** From --window-effort; the most common randomized effort when absent. */
  windowEffort?: Effort;
}

type Parsed = Flags | { error: string };

function parseFlags({ options, deps }: CommandContext): Parsed {
  const min = options["min-ideas"];
  let minCompletedIdeas = MIN_COMPLETED_IDEAS;
  if (min !== undefined) {
    minCompletedIdeas = typeof min === "string" ? Number(min) : Number.NaN;
    if (!/^\d+$/.test(String(min)) || minCompletedIdeas < 1) {
      return {
        error: `Invalid --min-ideas "${String(min)}". Use a whole number of at least 1.`,
      };
    }
  }
  const trailing = options["trailing"];
  const hostDays = options["host-days"];
  const bad = [
    ["trailing", trailing],
    ["host-days", hostDays],
  ].find(([, v]) => v !== undefined && !/^[1-9]\d{0,8}$/.test(String(v)));
  if (bad !== undefined) {
    return {
      error: `Invalid --${bad[0] as string} "${String(bad[1])}". Use a whole number of at least 1.`,
    };
  }
  const times = parseWindowFlags(options);
  if ("error" in times) {
    return times;
  }
  const { asOf, since, until, splitAt, windowEffort } = times;
  const idea =
    options.idea === undefined ? undefined : parseIdeas(options.idea);
  if (idea !== undefined && "error" in idea) {
    return idea;
  }
  return {
    asOf: asOf ?? deps.clock.now(),
    minCompletedIdeas,
    ...(trailing === undefined ? {} : { trailingIdeas: Number(trailing) }),
    ...(hostDays === undefined ? {} : { hostDays: Number(hostDays) }),
    ...(windowEffort === undefined ? {} : { windowEffort }),
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
    ...(splitAt === undefined ? {} : { splitAt }),
    ...(idea === undefined ? {} : { ideas: idea }),
  };
}

const seconds = (value: number) => `${Math.round(value)}s`;

function scopeLine({ since, until, ideas }: Scope): string {
  const range = [
    since === null ? undefined : `from ${since}`,
    until === null ? undefined : `until ${until}`,
  ].filter((part) => part !== undefined);
  const named = ideas === null ? [] : [`ideas ${ideas.join(", ")}`];
  const parts = [...range, ...named];
  return parts.length === 0
    ? "Covering the whole ledger"
    : `Covering ${parts.join(", ")}`;
}

const leadLine = ({
  ideas,
  medianSeconds,
  maxSeconds,
}: FlowReport["leadTime"]) =>
  medianSeconds === null || maxSeconds === null
    ? "Lead time: no completed ideas"
    : `Lead time: ${ideas.length} ideas, median ${seconds(medianSeconds)}, max ${seconds(maxSeconds)}`;

const percent = (rate: number) => `${Math.round(rate * 100)}%`;

/** The attribution, outcome and guard-block lines of the human report. */
function outcomeLines({
  attribution,
  outcomes,
  guardBlocks,
}: Printed): string[] {
  const { mainRed, reverts, liveRuns, ownerMinutes } = outcomes;
  return [
    attribution.since === null
      ? "Attribution: no stamped sessions yet, so nothing is measured"
      : `Attribution since ${attribution.since}: ${attribution.withIdea} of ${attribution.events} events with an idea, ${attribution.withIdeaAndStage} with a stage too; ${attribution.noRoleShare === null ? "no session events in range" : `${percent(attribution.noRoleShare)} of session events come from sessions with no role`}`,
    mainRed.rate === null
      ? "Main red: no check runs on main"
      : `Main red: ${mainRed.failed} of ${mainRed.runs} check runs on main (${percent(mainRed.rate)})`,
    `Reverts: ${reverts.reverts} of ${reverts.merged} merged changes`,
    liveRuns.rate === null
      ? "Live runs: no nightly runs"
      : `Live runs: ${liveRuns.passed} of ${liveRuns.runs} nightly runs passed (${percent(liveRuns.rate)})`,
    ownerMinutes.perMerged === null
      ? "Owner minutes per merged change: none recorded"
      : `Owner minutes per merged change: ${ownerMinutes.perMerged} (${ownerMinutes.minutes} over ${ownerMinutes.merged} merged; an upper bound while agents share the owner's login)`,
    guardBlocks.length === 0
      ? "Guard blocks: none"
      : `Guard blocks: ${guardBlocks.map((b) => `${b.rule} ${b.blocks}`).join(", ")}`,
  ];
}

const GIB = 1024 ** 3;
const gib = (bytes: number | null) =>
  bytes === null ? "n/a" : `${Math.round((bytes / GIB) * 10) / 10} GiB`;
const load = (value: number | null) =>
  value === null ? "n/a" : String(Math.round(value * 100) / 100);

/** One line per session count: the figures, then which of them rose above their baseline. */
function hostLines({ hostPressure }: Printed): string[] {
  if (hostPressure.samples === 0) {
    return ["Host pressure: no samples in this range"];
  }
  return [
    `Host pressure: ${hostPressure.samples} samples; flagged when above the median of the ${hostPressure.trailingDays} days before by more than their spread`,
    ...hostPressure.levels.map((level) => {
      const worse = (
        [
          ["swap", level.swap],
          ["load", level.load],
        ] as const
      )
        .filter(([, f]) => f.baseline.status === "ok" && f.baseline.worsened)
        .map(([name]) => name);
      return `  ${level.sessions} sessions, ${level.platform ? "platform up" : "loop only"}: ${level.samples} samples, swap median ${gib(level.swap.median)} peak ${gib(level.swap.peak)}, load median ${load(level.load.median)} peak ${load(level.load.peak)}${worse.length === 0 ? "" : ` (worsened: ${worse.join(", ")})`}`;
    }),
  ];
}

function text(report: Printed): string {
  const rows = report.stages.map((s) =>
    [
      s.stage.padEnd(15),
      `active ${seconds(s.activeSeconds)}`.padEnd(16),
      `waiting ${seconds(s.waitingSeconds)}`.padEnd(17),
      `${s.events} events`.padEnd(11),
      `wip peak ${s.wip.peak} avg ${s.wip.average}`.padEnd(20),
      `toil start ${seconds(s.toil.startingSeconds)} stop ${seconds(s.toil.stoppingSeconds)} wait ${seconds(s.toil.waitingSeconds)} retry ${seconds(s.toil.retryingSeconds)}`,
    ].join(" "),
  );
  const lines = [
    `Flow report as of ${report.asOf}: ${report.ideas.completed} of ${report.ideas.total} ideas completed`,
    scopeLine(report.scope),
    ...rows,
    leadLine(report.leadTime),
    metricLine(
      "Tokens per idea",
      report.metrics.tokensPerIdea,
      report.metrics.trailingIdeas,
    ),
    metricLine(
      "Sessions per idea",
      report.metrics.sessionsPerIdea,
      report.metrics.trailingIdeas,
    ),
    ...reworkLines(report.rework),
    ...sendBackCategoryLines(report.sendBackCategories),
    ...writerTierReportLines(report),
    ...reviewMissLines(report.reviewMisses),
    frictionLine(report.friction),
    ...finishLines(report),
    `Unmapped events: ${report.unmappedEvents}`,
    ...outcomeLines(report),
    ...hostLines(report),
    ...questionLines(report.ownerQuestions),
    ...advisorFigureLines(report),
    ...perMergedChangeLines(report),
    ...costWaitingLines(report.costWaiting),
    report.bottleneck === null
      ? (report.bottleneckNote ?? "No bottleneck.")
      : `Bottleneck: ${report.bottleneck.stage} (${Math.round(report.bottleneck.share * 100)}% of waiting)`,
  ];
  if (report.skippedLines > 0) {
    lines.push(`skipped ${report.skippedLines} malformed ledger line(s)`);
  }
  return `${lines.join("\n")}\n`;
}

/** The cost settings from the harness config; defaults when the checkout has none. */
export async function loadCost({ deps }: CommandContext) {
  const root = await deps.root().catch(() => undefined);
  const file = root === undefined ? undefined : join(root, HARNESS_CONFIG);
  if (file === undefined || !(await deps.fs.exists(file))) {
    return { cost: DEFAULT_COST };
  }
  return parseHarnessConfig(await deps.fs.readFile(file), HARNESS_CONFIG);
}

const report: Command = {
  help: reportHelp,
  summary:
    "print the flow report over a window: stage time, lead time, trailing metrics and the bottleneck; writes nothing",
  options: {
    "min-ideas": "string",
    trailing: "string",
    "host-days": "string",
    "window-effort": "string",
    "as-of": "string",
    since: "string",
    until: "string",
    "split-at": "string",
    idea: "string",
    ledger: "string",
  },
  async run(context) {
    const flags = parseFlags(context);
    const { deps, json } = context;
    const fail = (message: string, code: number) => {
      deps.stderr(
        json ? `${JSON.stringify({ error: message })}\n` : `${message}\n`,
      );
      return code;
    };
    if ("error" in flags) {
      return fail(flags.error, 2);
    }
    const cost = await loadCost(context);
    if ("error" in cost) {
      return fail(cost.error, 1);
    }
    const opened = await openLedger(context);
    if ("error" in opened) {
      return fail(opened.error, 1);
    }
    const { events, skipped } = await opened.ledger.list({});
    const printed: Printed = {
      ...buildReport(events, {
        ...flags,
        cost: {
          ...cost.cost,
          ...(flags.trailingIdeas === undefined
            ? {}
            : { trailingIdeas: flags.trailingIdeas }),
        },
        weeklyTokenCeiling:
          "weeklyTokenCeiling" in cost ? cost.weeklyTokenCeiling : undefined,
        compactionCap: "compactionCap" in cost ? cost.compactionCap : undefined,
      }),
      skippedLines: skipped,
    };
    deps.stdout(json ? `${JSON.stringify(printed)}\n` : text(printed));
    return 0;
  },
};

export const flowCommands: Record<string, Command> = { report };
