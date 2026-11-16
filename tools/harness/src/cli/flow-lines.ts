import { SEND_BACK_CATEGORIES } from "../ledger/index.js";
import type { CostMetric, FlowReport } from "../flow/index.js";

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
