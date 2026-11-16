import {
  DEFAULT_COST,
  HARNESS_CONFIG,
  MIN_COMPLETED_IDEAS,
  REPORT_VERSION,
  buildReport,
  parseHarnessConfig,
  type FlowReport,
  type Scope,
  type ScopeOptions,
} from "../flow/index.js";
import { join } from "node:path";
import { isTimestamp } from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import {
  frictionLine,
  metricLine,
  questionLines,
  reworkLines,
  sendBackCategoryLines,
  tokensPerMergedChangeLine,
} from "./flow-lines.js";
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
}

type Parsed = Flags | { error: string };

function parseTime(
  options: CommandContext["options"],
  name: string,
): Date | undefined | { error: string } {
  const given = options[name];
  if (given === undefined) {
    return undefined;
  }
  if (typeof given !== "string" || !isTimestamp(given)) {
    return {
      error: `Invalid --${name} "${String(given)}". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.`,
    };
  }
  return new Date(given);
}

/** `#12,13` to `["#12", "#13"]`; an error for anything that is not an issue number. */
function parseIdeas(given: string | boolean): string[] | { error: string } {
  const parts = typeof given === "string" ? given.split(",") : [""];
  const ideas = parts.map((part) => /^#?(\d+)$/.exec(part.trim())?.[1]);
  if (ideas.includes(undefined)) {
    return {
      error: `Invalid --idea "${String(given)}". Use issue numbers such as #12 or 12,13.`,
    };
  }
  return ideas.map((n) => `#${Number(n)}`);
}

type Times = { asOf?: Date; since?: Date; until?: Date } | { error: string };

function parseTimes(options: CommandContext["options"]): Times {
  const asOf = parseTime(options, "as-of");
  const since = parseTime(options, "since");
  const until = parseTime(options, "until");
  if (asOf !== undefined && "error" in asOf) {
    return asOf;
  }
  if (since !== undefined && "error" in since) {
    return since;
  }
  if (until !== undefined && "error" in until) {
    return until;
  }
  if (since !== undefined && until !== undefined && since > until) {
    return {
      error: `Invalid --since ${since.toISOString()}: it is after --until ${until.toISOString()}. Swap them.`,
    };
  }
  return {
    ...(asOf === undefined ? {} : { asOf }),
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
  };
}

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
  const times = parseTimes(options);
  if ("error" in times) {
    return times;
  }
  const { asOf, since, until } = times;
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
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
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
    frictionLine(report.friction),
    `Unmapped events: ${report.unmappedEvents}`,
    ...outcomeLines(report),
    ...hostLines(report),
    ...questionLines(report.ownerQuestions),
    tokensPerMergedChangeLine(report.tokensPerMergedChange),
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
  summary: `map ledger events to stages; per stage active, waiting, event counts, toil (starting, stopping, waiting, retrying), work in progress (peak and average ideas open), lead time (first event to outcome; median and max), tokens and sessions per closed idea with a trailing average over the N closed ideas before the latest and a worsened flag (--trailing N, default 5, else cost.trailingIdeas; thresholds in ${HARNESS_CONFIG}), and the bottleneck (--min-ideas N, default ${MIN_COMPLETED_IDEAS}; --as-of TIME; --since TIME (inclusive) and --until TIME (exclusive) clip time at those edges and count only ideas open then, with lead time only for ideas whose outcome falls inside; --idea N|#N[,...] covers only those issues; --ledger PATH; --json is one object, version ${REPORT_VERSION}: version, asOf, scope, ideas, minCompletedIdeas, stages, leadTime, metrics, bottleneck, bottleneckNote, unmappedEvents, attribution (since sessions were stamped, over role-session events: events, with an idea, with an idea and a stage, and noRoleShare, the share of session events from sessions with no role or null when none), guardBlocks (blocks per rule), hostPressure (from host-sample events: median and peak swap bytes and load per live-session count, split by platform up or loop only, each against the median and spread of the same level over --host-days N days before the range, default 7, with a worsened flag; samples 0 and no levels when none were taken), ownerQuestions (owner.asked events per merged change in the range, with the same ratio over the 7 days before it as the trailing average and a worsened flag when above it; questions and merged counts; null per-merged when nothing merged), tokensPerMergedChange (tokens over merged changes in the range as current, and the same figure over the 7 days before it as trailingAverage; each is insufficient, never zero, below cost.minMergedChanges merged changes), tierShares (per role, launches by tier source: definition, escalation, override, and unknown for launches from before the source was recorded, with the override share over the launches that know their source), unstampedSpawns (spawns in range that named no idea: total, and withReason for those given a --no-idea reason; not friction), retroProposalsDropped (retro proposals the cap of 5 per retro dropped, from retro.dropped events), outcomes (mainRed, reverts, liveRuns, ownerMinutes: figures agents do not write, from ci.main, ci.nightly, main.revert and owner.action events that ledger poll-github records), rework (escalationsPerIdea, sendBacksPerIdea, frictionPerIdea: the latest closed idea's count with a trailing average and a worsened flag, or insufficient history; followUpsPerWriterSession and mainFollowUpsPerWriterSession: orchestrator follow-ups per writer session from every sender, and from the main session alone, over the closed ideas with a writer session, in the same form; followUps: writerSessions in range and bySender, the follow-ups in range per sender (the main session, or a role), most first), sendBackCategories (judge send-backs by category, each category once per PR head, as perPrHead and perMergedChange; byCategory with every category of the send-back list, uncategorised for send-backs from before categories existed, otherShare over the categorised ones, and otherOverThreshold past its placeholder threshold), friction (total, and events by hook rule, kore command or pane; unknownKinds are ignored and counted; from escalation, send-back, guard.block, guard.audit, kore.retry and pane.interrupted events), skippedLines)`,
  options: {
    "min-ideas": "string",
    trailing: "string",
    "host-days": "string",
    "as-of": "string",
    since: "string",
    until: "string",
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
      }),
      skippedLines: skipped,
    };
    deps.stdout(json ? `${JSON.stringify(printed)}\n` : text(printed));
    return 0;
  },
};

export const flowCommands: Record<string, Command> = { report };
