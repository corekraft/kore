import { HANDOVER_REASONS, SEND_BACK_CATEGORIES } from "../ledger/index.js";
import { writerArmLines } from "./flow-lines-writer-arms.js";
import {
  changes,
  writerDollarsLines,
  writerTierLines,
} from "./flow-lines-writer-cost.js";

export {
  writerDollarsLines,
  writerTierLines,
} from "./flow-lines-writer-cost.js";
import type { CostMetric, FlowReport } from "../flow/index.js";

/**
 * The main session's handovers in the range, by reason (#1036): the count with every
 * reason, or insufficient with why it is not read. Never a zero for a window not read.
 */
export function handoverLine(handovers: FlowReport["handovers"]): string {
  if (handovers.status === "insufficient") {
    return `Handovers from the main session: insufficient, ${handovers.reason}`;
  }
  const byReason = HANDOVER_REASONS.map(
    (reason) => `${reason} ${handovers.byReason[reason]}`,
  ).join(", ");
  return `Handovers from the main session: ${handovers.handovers} (${byReason})`;
}

/**
 * The compactions in the range (#1037): the total over the sessions seen and each session's
 * count, or insufficient with why it is not read. Never a zero for a window with no session.
 */
export function compactionLine(compactions: FlowReport["compactions"]): string {
  if (compactions.status === "insufficient") {
    return `Compactions: insufficient, ${compactions.reason}`;
  }
  const perSession = Object.entries(compactions.perSession)
    .map(([session, count]) => `${session} ${count}`)
    .join(", ");
  return `Compactions: ${compactions.compactions} over ${compactions.sessions} session(s) (${perSession})`;
}

/** One human line for a per-idea metric: its latest value against the trailing average, or why it has none. */
export function metricLine(
  label: string,
  metric: CostMetric,
  trailing: number,
) {
  if (metric.status === "insufficient history") {
    return `${label}: insufficient history, ${metric.closedIdeas} of ${metric.needed} closed ideas`;
  }
  const average = Math.round(metric.trailingAverage * 100) / 100;
  return `${label}: ${metric.currentIdea} ${metric.current}, average of the ${trailing} ideas before it ${average}${metric.worsened ? " (worsened)" : ""}`;
}

const REWORK_LABELS = {
  escalationsPerIdea: "Escalations per idea",
  sendBacksPerIdea: "Send-backs per idea",
  frictionPerIdea: "Friction events per idea",
} as const;

/** One line per rework metric, in the order the report lists them. */
export const reworkLines = (rework: FlowReport["rework"]) =>
  Object.entries(REWORK_LABELS).map(([key, label]) =>
    metricLine(
      label,
      rework[key as keyof typeof REWORK_LABELS],
      rework.trailingIdeas,
    ),
  );

type CategoryCounts = FlowReport["sendBackCategories"]["perPrHead"];

/** One line per scope: every category's count, the uncategorised count, and the share of other. */
function categoryLine(scope: string, counts: CategoryCounts): string {
  const byCategory = SEND_BACK_CATEGORIES.map(
    (c) => `${c} ${counts.byCategory[c]}`,
  ).join(", ");
  const share =
    counts.otherShare === null
      ? "no categorised send-backs"
      : `other ${Math.round(counts.otherShare * 100)}% of categorised${
          counts.otherOverThreshold
            ? `, over ${Math.round(counts.otherThreshold * 100)}%: the list may need an entry`
            : ""
        }`;
  return `Send-backs by category, ${scope}: ${byCategory}; uncategorised ${counts.uncategorised}; ${share}`;
}

/** The send-backs by category, per PR head and per merged change. */
export const sendBackCategoryLines = (
  categories: FlowReport["sendBackCategories"],
) => [
  categoryLine("per PR head", categories.perPrHead),
  categoryLine("per merged change", categories.perMergedChange),
];

/**
 * The owner questions per merged change, with the trailing average (#859). With
 * no merged change the line says how many questions there were, never a zero rate.
 */
export function questionLines(q: FlowReport["ownerQuestions"]): string[] {
  if (q.perMerged === null) {
    return [
      `Owner questions: ${q.questions} with no merged change in this range`,
    ];
  }
  const average =
    q.trailingAverage === null
      ? "no merged change in the trailing days"
      : `average ${q.trailingAverage} over the trailing ${q.trailingDays} days`;
  return [
    `Owner questions per merged change: ${q.perMerged} (${q.questions} questions over ${q.merged} merged changes); ${average}${q.worsened ? " (worsened)" : ""}`,
  ];
}

/** The advisor's overturn figure against the refuting share, or that none was made (ADR 0120, #862). */
export function advisorLines(a: FlowReport["advisorQuality"]): string[] {
  if (a.perMade === null) {
    return [
      `Advisor decisions overturned: ${a.overturned} of ${a.made} made; none made in this range`,
    ];
  }
  return [
    `Advisor decisions overturned: ${a.perMade} (${a.overturned} of ${a.made} made), refuting above ${a.refutingShare}${a.refuted ? " (refuted)" : ""}`,
  ];
}

/** Owner-routed questions in total, the advisor's own count, and each owner signal's count (ADR 0120, #862). */
export function routeLines(r: FlowReport["ownerRoutes"]): string[] {
  const signals = Object.entries(r.bySignal)
    .map(([signal, count]) => `${signal} ${count}`)
    .join(", ");
  return [
    `Owner-routed questions: ${r.owner} (advisor-routed ${r.advisor}); by signal: ${signals}`,
  ];
}

/** The advisor, route and waiting lines of the report, in that order (ADR 0120, #862). */
export function advisorFigureLines(report: FlowReport): string[] {
  return [
    ...advisorLines(report.advisorQuality),
    ...routeLines(report.ownerRoutes),
    ...waitLines(report.waitingOnPerson),
    handoverLine(report.handovers),
    compactionLine(report.compactions),
  ];
}

/** The seconds questions waited on a person, apart from any stage's waiting, or that none was asked (ADR 0120, #862). */
export function waitLines(w: FlowReport["waitingOnPerson"]): string[] {
  if (w.questions === 0) {
    return ["Waiting on a person: no question asked in this range"];
  }
  return [
    `Waiting on a person: ${w.waitingSeconds}s over ${w.questions} question(s), ${w.answered} answered, ${w.unanswered} not; ${w.perQuestionSeconds}s per question`,
  ];
}

const ratePercent = (rate: number | null) =>
  rate === null ? "n/a" : `${Math.round(rate * 100)}%`;

/**
 * The passed-then-rule-break ratio and the found-violation share, each against its
 * trailing average (#851), then the re-reviews of a passed sample beside them (#852).
 */
export function reviewMissLines(m: FlowReport["reviewMisses"]): string[] {
  const r = m.resample;
  const resample =
    r.count === 0
      ? "Re-reviews of sampled passed reviews: no re-reviews in this range"
      : `Re-reviews of sampled passed reviews: ${r.found} of ${r.count} found a violation (${ratePercent(r.share)})`;
  return [...ratioLines(m), resample];
}

/** The ratio and share lines (#851). With no review in the range the line says so, never a rate. */
function ratioLines(m: FlowReport["reviewMisses"]): string[] {
  const left =
    m.unrecorded === 0
      ? ""
      : `; ${m.unrecorded} from before the verdict was recorded left out`;
  const passed = "Passed reviews later sent back for a rule break";
  if (m.reviews === 0) {
    return [
      `${passed}: no recorded reviews in this range${left}`,
      "Reviews that found a violation: no recorded reviews in this range",
    ];
  }
  const average = (value: number | null) =>
    value === null
      ? "no reviews in the trailing days"
      : `trailing average ${ratePercent(value)} over the trailing ${m.trailingDays} days`;
  const { passedRuleBreak: p, foundViolation: f } = m;
  return [
    `${passed}: ${p.count} of ${m.reviews} reviews (${ratePercent(p.ratio)}), ${average(p.trailingAverage)}${p.worsened ? " (worsened)" : ""}${left}`,
    `Reviews that found a violation: ${f.count} of ${m.reviews} (${ratePercent(f.share)}), ${average(f.trailingAverage)}`,
  ];
}

/** The friction total with its sources, and how many unknown record kinds were ignored. */
export function frictionLine({
  total,
  sources,
  unknownKinds,
}: FlowReport["friction"]) {
  const ignored =
    unknownKinds === 0 ? "" : `; ${unknownKinds} unknown kind(s) ignored`;
  return total === 0
    ? `Friction: none${ignored}`
    : `Friction: ${total} (${sources.map((s) => `${s.source} ${s.events}`).join(", ")})${ignored}`;
}

/**
 * Send-backs per merged change over the range, with the trailing average (#830). A
 * figure below the minimum merged changes says it is not read, never a zero.
 */
export function sendBacksPerMergedChangeLine(
  s: FlowReport["sendBacksPerMergedChange"],
): string {
  const { current, trailingAverage, trailingDays } = s;
  const now =
    current.status === "ok"
      ? `${current.perMerged} (${current.sendBacks} send-backs over ${changes(current.merged)})`
      : `not read, ${changes(current.merged)} in this range (${current.needed} needed)`;
  const before =
    trailingAverage.status === "ok"
      ? `average ${trailingAverage.perMerged} over the trailing ${trailingDays} days`
      : `no average: ${changes(trailingAverage.merged)} in the trailing ${trailingDays} days (${trailingAverage.needed} needed)`;
  return `Send-backs per merged change: ${now}; ${before}`;
}

/**
 * The median lead time per merged change over the range, with the trailing average
 * (#830), and how many merged changes had a measured opening. Never a zero when unread.
 */
export function leadTimePerMergedChangeLine(
  l: FlowReport["leadTimePerMergedChange"],
): string {
  const { current, trailingAverage, trailingDays } = l;
  const measured = (f: { merged: number; measured: number }) =>
    `${f.measured} of ${changes(f.merged)} measured`;
  const now =
    current.status === "ok"
      ? `${current.medianSeconds}s median (${measured(current)})`
      : `not read, ${measured(current)} in this range (${current.needed} needed)`;
  const before =
    trailingAverage.status === "ok"
      ? `average ${trailingAverage.medianSeconds}s over the trailing ${trailingDays} days`
      : `no average: ${measured(trailingAverage)} in the trailing ${trailingDays} days (${trailingAverage.needed} needed)`;
  return `Lead time per merged change: ${now}; ${before}`;
}

/**
 * The tokens, send-backs and lead time per merged change, then the writer dollars per merged change
 * by tier (#1008), in the order the report names them.
 */
export const perMergedChangeLines = (
  report: Pick<
    FlowReport,
    | "tokensPerMergedChange"
    | "sendBacksPerMergedChange"
    | "leadTimePerMergedChange"
    | "writerCost"
    | "writerArms"
  >,
): string[] => [
  tokensPerMergedChangeLine(report.tokensPerMergedChange),
  sendBacksPerMergedChangeLine(report.sendBacksPerMergedChange),
  leadTimePerMergedChangeLine(report.leadTimePerMergedChange),
  ...writerDollarsLines(report.writerCost),
  ...writerTierLines(report.writerCost),
  ...writerArmLines(report.writerArms),
];

/**
 * Tokens per merged change over the range, with the trailing average (#829). A
 * figure below the minimum merged changes says it is not read, never a zero.
 */
export function tokensPerMergedChangeLine(
  t: FlowReport["tokensPerMergedChange"],
): string {
  const { current, trailingAverage, trailingDays } = t;
  const now =
    current.status === "ok"
      ? `${current.perMerged} (${current.tokens} tokens over ${changes(current.merged)})`
      : `not read, ${changes(current.merged)} in this range (${current.needed} needed)`;
  const before =
    trailingAverage.status === "ok"
      ? `average ${trailingAverage.perMerged} over the trailing ${trailingDays} days`
      : `no average: ${changes(trailingAverage.merged)} in the trailing ${trailingDays} days (${trailingAverage.needed} needed)`;
  return `Tokens per merged change: ${now}; ${before}`;
}
