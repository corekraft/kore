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
import type { Effort } from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
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
import { parseIdeas, parseWindowFlags } from "./flow-commands-flags.js";
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
  summary: `map ledger events to stages; per stage active, waiting, event counts, toil (starting, stopping, waiting, retrying), work in progress (peak and average ideas open), lead time (first event to outcome; median and max), tokens and sessions per closed idea with a trailing average over the N closed ideas before the latest and a worsened flag (--trailing N, default 5, else cost.trailingIdeas; thresholds in ${HARNESS_CONFIG}), and the bottleneck (--min-ideas N, default ${MIN_COMPLETED_IDEAS}; --as-of TIME; --since TIME (inclusive) and --until TIME (exclusive) clip time at those edges and count only ideas open then, with lead time only for ideas whose outcome falls inside; --split-at TIME (inside the range, a bound allowed) adds sendBackTiersSplit and reviewRoundsSplit, the send-backs per writer tier (sendBackTiers) and the review rounds per writer tier (reviewRounds) each read once over the time before TIME and once over the time from TIME on, so a change merged exactly at TIME is on the after side, with merged changes placed by their merge time and send-backs, failed review rounds and rework by the time each was recorded, and the report has no such keys and prints no such lines without it; --idea N|#N[,...] covers only those issues; --ledger PATH; --json is one object, version ${REPORT_VERSION}: version, asOf, scope, ideas, minCompletedIdeas, stages, leadTime, metrics, bottleneck, bottleneckNote, unmappedEvents, attribution (since sessions were stamped, over role-session events: events, with an idea, with an idea and a stage, and noRoleShare, the share of session events from sessions with no role or null when none), guardBlocks (blocks per rule), guardBlocksByRule (blocks per rule by name, every known rule a key with zero where none, #984), hostPressure (from host-sample events: median and peak swap bytes and load per live-session count, split by platform up or loop only, each against the median and spread of the same level over --host-days N days before the range, default 7, with a worsened flag; samples 0 and no levels when none were taken), ownerQuestions (owner.asked events per merged change in the range, with the same ratio over the 7 days before it as the trailing average and a worsened flag when above it; questions and merged counts; null per-merged when nothing merged), advisorQuality (decision.made events and advisor.overturned events in the range: made, overturned, perMade, null with no decision made, refutingShare and refuted; ADR 0120, #862), ownerRoutes (decision.routed events in the range: owner and advisor counts, and the owner-routed questions per signal, every owner signal present), waitingOnPerson (owner.asked questions in the range: questions, answered, unanswered, waitingSeconds and perQuestionSeconds, where a question waits until its pane or session next acts, or the as-of time), tokensPerMergedChange (tokens over merged changes in the range as current, and the same figure over the 7 days before it as trailingAverage; each is insufficient, never zero, below cost.minMergedChanges merged changes), sendBacksPerMergedChange (send-backs in the range over its merged changes, each PR head once, as current, and the same figure over the 7 days before it as trailingAverage; each is insufficient, never zero, below cost.minMergedChanges merged changes), compactions (session.compacted readings in the range, one per compaction of a session from its compact session start: compactions, sessions, and perSession with every session seen a key; insufficient, with its reason, when no session was recorded in the range, never zero; #1037), mainSessionSetups (the setup of each main-session stretch, read from the token.split readings of sessions with no role, one stretch per session and recorded model, and derived when the report reads, never written to the ledger and never typed: status ok with compactionCap (the compactionCap of ${HARNESS_CONFIG}, null when not set) and stretches, each with session, model, largestPrompt (the largest in its readings before the range ends) and label, which is control (the main-session model, claude-opus-5-5, with a largest prompt above the cap), early compaction (the same model with a largest prompt at or under the cap), Haiku (a Haiku model), not set for a stretch with a reading, whatever its model, when no cap is set, or insufficient with a reason for a model that is neither when a cap is set, and for a session with token totals and no reading, whatever the cap, whose model and largestPrompt are null; insufficient, with its reason, when no main-session reading is in the range; the text prints a Main-session setups line with the cap, then one line per stretch; #1046), handovers (the main session's sends that named a handover reason in the range, from session.send events with no sender role: handovers, merged, and byReason with every reason a key; insufficient, with its reason, when no send in the range names one or below cost.minMergedChanges merged changes, never zero; #1036), leadTimePerMergedChange (the median seconds from each merged change's pull request opening to its merge, as current with medianSeconds and measured, and the same median over the 7 days before it as trailingAverage; insufficient, never zero, below cost.minMergedChanges measured merged changes), tokensByStage (tokens spent in the range in each stage, every stage a key, zero where none), tokensByStagePerMergedChange (each stage's tokens over the merged changes in the range as current with perMerged, and the same over the 7 days before it as trailingAverage; insufficient, never zero, below cost.minMergedChanges merged changes), judgmentContexts (judgment panes launched in the range with a token reading in it, as panes, and over: the panes whose largest cumulative token count went above the 60k context limit, most tokens first, each with its session and idea; ADR 0121, #876), writerCost (writer tokens per merged change by launch tier, each tier's tokens weighted by its price in tools/harness/src/flow/writer-prices.ts, pinned on its date, with follow-ups per session and the blocked share beside each tier, the orchestrating tokens as orchestrate, and the same over the 7 days before the range as trailingAverage; each tier's perMergedChangeByTier is its weighted tokens over the merged changes joined to it (mergedChanges, null with none), a merged change joining to a tier by its pr.linked event's writer and that writer's first priced launch, or the earliest priced launch with that launch's idea, and unjoinable counts the merged changes that join to no tier, in no tier, never as zero; each tier's perMergedChangeDollars is its all-in dollars per merged change joined to it (writer, reviewer, judge and orchestrate means, their allIn sum, and the median of the per-change totals; null with none), the judge and orchestrate parts shared equally per merged change, with the orchestrating dollars priced per recorded model from token.split readings (orchestrate.recordedModels), and the token totals with no reading priced at the assumed model (orchestrate.model) at its input rate, a floor (orchestrate.assumedTokens); orchestrate.basis states which (recorded, assumed model, recorded and assumed model, or none), and unmergedWriterSessions counts writer sessions with no merged change; relaunchLimit states that a relaunch on a new session with no idea stamp takes that relaunch's tier, not the first launch's; insufficient, never zero, below cost.minMergedChanges merged changes; each tier also reads its rework per merged change (sends to its writer panes after a judge send-back of its change, #1009), its owner minutes per merged change, the share of its requests over 100K and its first-request prompt size's median and 90th percentile, each not read, never zero, where it joins no merged change; the terms Rework and Merged-change cost are defined in GLOSSARY.md), writerArms (the Haiku and Sonnet arms by first-launch tier, overall and per label a merged change carries at launch: Haiku minus Sonnet all-in dollars per merged change with a seeded percentile interval from a fixed seed and the interval level, each arm's merged changes, mean all-in, effort mix (the launch the change joins to) and guards (blocked share, send-backs and owner minutes per merged change), insufficient, never zero, below cost.minMergedChanges merged changes in either arm, and with no winner, margin or verdict; only randomized launches (the window's drawn Sonnet and control Haiku, by their tier reason) at the window effort are read, Haiku at that effort against Sonnet at that effort, and effort is never a stratum; windowEffort is the effort read, from --window-effort (one of low, medium, high, xhigh, max) or, when it is not given, the most common effort among randomized launches, with from naming which (setting, most common, none); excluded counts the merged changes whose first launch is left out, as differentEffort (randomized, at another effort), missingEffort (no recorded effort, including every launch from before effort was recorded) and notRandomized (hand-picked, escalated or overridden), each counted once, as missingEffort first, then notRandomized, then differentEffort; unlabelled counts arm changes with no label, in the overall figure only; #1012, #1069), sendBackTiers (judge send-backs by category per writer tier, each tier with its merged changes, its rework over them (rework per merged change, not read with none) and the count each is read over, then an unlinked row for the merged changes and send-backs that join to no tier, with no rework; a send-back joins to the tier its pull request's writer joins to, never by inference; #1045), reviewRounds (failed review rounds beside rework, and review coverage, per writer tier, then an unlinked row for the pull requests that join to no tier, in tiers and unlinked; each row has mergedChanges and failedReviewRounds, the judge send-backs and the principles-review verdicts with one or more violations recorded in the range, each PR head once, a send-back that names no pull request or head counting on its own, reported beside rework and never as rework; a tier row also has failedReviewRoundsPerMergedChange, and rework and reworkPerMergedChange as in sendBackTiers; every row has reviewedChanges, the merged changes with a principles-review verdict for their head, and reviewCoverage, reviewedChanges over mergedChanges; each rate is null, never zero, with no merged change, and the unlinked row has no rework and no rate of failed rounds; the ledger records no merge head, so a merged change's head is the newest head a verdict or a send-back names for it at or before its merge, and a verdict on an older head does not count for it; a change counts once however many verdicts it has; a round and a change join to the tier of the pull request's linked writer, never by inference; only counts and rates are read, never verdict text; the text prints a Failed review rounds and review coverage line per tier and for the unlinked row; #1050), tierShares (per role, launches by tier source: definition, escalation, override, and unknown for launches from before the source was recorded, with the override share over the launches that know their source), unstampedSpawns (spawns in range that named no idea: total, and withReason for those given a --no-idea reason; not friction), finishDetection (session.result events naming a pane, as results; detected, where a pane.finished (noticed: recorded by session wait) on the same pane falls within windowSeconds (300, a placeholder), and undetected, split into neverNoticed (no pane.finished was ever recorded on the pane) and late (one recorded outside the window or already used); medianLagSeconds over detected only; lagMinutes (samples, median and p90 in minutes over the detected and late finishes that have a lag, null with none), a reported reading and never a merge delay, #1090); stalledPanes (pane.stalled events recorded in the range as recorded; sessions whose last token.usage is more than silenceSeconds (900) before the as-of time or the window's end, with no RESULT since, as silentSessions (#1090); silent sessions with a background command open on their pane as backgroundExcluded, and silent sessions whose pane waits on an open reserved question as questionExcluded (#854)),qualifierWarnings (qualifier.warned events in the range as warnings, idea.filed events as filed, and warnings over filed as perFiled, null when no idea was filed; #866), retroProposalsDropped (retro proposals the cap of 5 per retro dropped, from retro.dropped events), outcomes (mainRed, reverts, liveRuns, ownerMinutes: figures agents do not write, from ci.main, ci.nightly, main.revert and owner.action events that ledger poll-github records), rework (escalationsPerIdea, sendBacksPerIdea, frictionPerIdea: the latest closed idea's count with a trailing average and a worsened flag, or insufficient history; followUpsPerWriterSession and mainFollowUpsPerWriterSession: orchestrator follow-ups per writer session from every sender, and from the main session alone, over the closed ideas with a writer session, in the same form; followUps: writerSessions in range and bySender, the follow-ups in range per sender (the main session, or a role), most first), sendBackCategories (judge send-backs by category, each category once per PR head, as perPrHead and perMergedChange; byCategory with every category of the send-back list; legacy, the send-backs recorded before 2026-11-16 when a category became required, neither uncategorised nor other and left out of the share; uncategorised, send-backs from 2026-11-16 on with no category; categorised, the sum of byCategory; otherShare, other over the categorised ones, null with none; minCategorised, cost.minCategorisedSendBacks (default 20, in ${HARNESS_CONFIG}); otherReading, insufficient below minCategorised categorised send-backs, never over or within, else over past otherThreshold (a placeholder, 0.1) or within; and otherOverThreshold, true only for over; a stored line with a category this build does not know counts in skippedLines), costWaiting (token cost beside waiting time, #1019: agents (each role's sessions with dollars, tokens and active and waiting seconds, each as median and p90), mergedChanges (all-in dollars and tokens per merged change and the seconds from the first writer launch to merge, each null where no writer launch joins the change (dollars are also null when the change, or the shared judge or orchestrating spend, ran on a model the price table does not price), and the seconds from opening to merge, null only where the ledger has no pr.opened or pr.merged event for it), ideas (dollars, tokens, lead time and outcome per idea, listed with no insufficient status, counting the sessions stamped with the idea and the writers whose linked pull request carries it, each writer charged once, to the idea on its earliest pr.linked event, or for a link from before the field to the idea the GitHub poll set from the pull request's closing references; an idea whose sessions ran on an unpriced model has null dollars and unpricedModels, its tokens still counted); writing (writer sessions with a token reading in the range, their cumulative tokens and dollars to the range's end, in attributed (stamped with an idea, or linked to a pull request that carries one), noIdea (linked to a pull request that carries no idea: none on its link, or no idea on a link from before the field and none from the poll) and noPullRequest (no pr.linked event), each with sessions, tokens and dollars, or null dollars with unpricedModels for an unpriced model; the two unattributed buckets are never added to an idea; unjoinable counts the pull requests opened in the range with no pr.linked event; share is the attributed tokens over all writer tokens, as share and sessions, or insufficient with sessions and needed below cost.minMergedChanges writer sessions, never zero; #1093); ceilingShares (#1048: the shares of the weekly token ceiling, weeklyTokenCeiling, a top-level key of ${HARNESS_CONFIG} beside cost, counted in plan-weighted tokens, each model's tokens times its price weight from tools/harness/src/flow/plan-tokens.ts; ceiling is that number, or "not set" when the key is absent, and every measured share, total, median and p90 then reads "not set", never zero, while a row or level that is not read still says why; the owner sets the value, and the weights approximate the plan's own; agents is a rate: each role's plan-weighted tokens in the 7 days ending where the window ends (as-of when it has no end) over the ceiling, labelled "of the weekly ceiling", with days 7 and one row per role; mergedChanges and ideas are sizes: a merged change's total plan-weighted tokens (its writer, its reviewer and its equal share of the judge and orchestrating spend; a null share where no writer launch joins it) or an idea's total (its stamped sessions and the writers whose pull request carries it) over one week's ceiling, labelled "of one week's ceiling", each row with spanSeconds beside the share (a change: first writer launch to merge; an idea: first to last event stamped with it, null with none), so a size is never read as a rate and the two are never in one column; each level has label, units, needed and status, and when measured total (its rows' shares summed, which may be above 100% because agents overlap in time), median and p90 over its rows' shares; a level is insufficient, never zero, below its minimum count (agents: one role read; mergedChanges and ideas: cost.minMergedChanges units), and a model with no plan weight is named as insufficient weights with models, checked first, for a level and for a row; a row has label and status measured with share, insufficient with units and needed (a role below cost.minMergedChanges sessions in the 7 days), or insufficient weights; the main-session row, orchestrate, adds the token totals of sessions with no recorded model, priced at the assumed model's input weight (a floor), and carries basis "assumed model" (or "recorded and assumed model" with a recorded model as well) until its model is recorded; the text prints a Shares of the weekly token ceiling block after the idea lines, with the ceiling, one line per level and one line per row; no winner and no verdict); agents (per role, below cost.minMergedChanges sessions) and mergedChanges are insufficient, never zero, below cost.minMergedChanges; both read insufficient prices, naming the models, when a model in them is not in the price table, checked before the minimum (the text prints "<role> not read: no price for <models>" for an agent and "insufficient prices (models)" for the merged-change line, an idea and a writing bucket; the text prints the writing share, the noIdea and noPullRequest buckets and the unjoinable count as four lines before the idea lines); and no winner or verdict), reviewMisses (reviews with a recorded verdict in the range, one per PR head, with unrecorded for those from before the findings count was recorded; passedRuleBreak: clean reviews whose PR a rule-break send-back later followed, as count and ratio over the reviews, with the same ratio over the trailing days before the range (7) as trailingAverage and a worsened flag; foundViolation: reviews that found at least one violation, as count and share, with the same share over the trailing days as trailingAverage; resample: re-reviews of sampled passed reviews in the window that read a verdict, as count, found (at least one violation) and share, with no trailing average (#852); a window with no review, and a trailing span with none, give null, never zero), friction (total, and events by hook rule, kore command or pane; unknownKinds are ignored and counted; from escalation, send-back, guard.block, guard.audit, kore.retry and pane.interrupted events), skippedLines)`,
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
