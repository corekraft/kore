// The writer cost lines of the flow report (#868, #1008, #1009): each tier's all-in dollars per merged
// change with its parts, the orchestrating model it assumes, the trailing average, and each tier's
// rework, owner minutes, request share and prompt size. Split out of flow-lines.ts to keep that file
// under its line limit; flow-lines.ts re-exports the two report-facing lines.

import type { FlowReport } from "../flow/index.js";

export const changes = (n: number) => `${n} merged change${n === 1 ? "" : "s"}`;

type OkWriterCost = Extract<
  FlowReport["writerCost"]["current"],
  { status: "ok" }
>;
type TierDollarLine = NonNullable<
  OkWriterCost["tiers"][string]["perMergedChangeDollars"]
>;

const money = (value: number) => `$${value}`;

/** A tier that a model the price table does not price ran in: named, not read, never a zero. */
const notReadForPrice = (name: string, models: string[]) =>
  `${name} not read: no price for ${models.join(", ")}`;

/** The tiers whose merged changes carry dollars or an unpriced model, each with its name, its changes and its figure. */
function pricedTiers(
  figure: OkWriterCost,
): { name: string; merged: number; dollars: TierDollarLine }[] {
  return Object.entries(figure.tiers).flatMap(([name, t]) =>
    t.perMergedChangeDollars === null
      ? []
      : [{ name, merged: t.mergedChanges, dollars: t.perMergedChangeDollars }],
  );
}

/** A figure's tiers as one line: each tier's mean with its parts and median, or the note that none is read. */
function tierDollarsText(figure: OkWriterCost): string {
  const tiers = pricedTiers(figure);
  if (tiers.length === 0) {
    return "no tier joined to a merged change, not read";
  }
  return tiers
    .map(({ name, merged, dollars: d }) =>
      "status" in d
        ? notReadForPrice(name, d.models)
        : `${name} ${money(d.allIn)} mean over ${changes(merged)}, median ${money(d.median)} (writer ${money(d.writer)}, reviewer ${money(d.reviewer)}, judge ${money(d.judge)}, orchestrate ${money(d.orchestrate)})`,
    )
    .join("; ");
}

/** The trailing average's line: each tier's mean, or that the trailing days are not read. */
function trailingDollarsLine(
  trailing: WriterCostTrailing,
  trailingDays: number,
): string {
  const label = "All-in cost per merged change, trailing average";
  if (trailing.status !== "ok") {
    return `${label}: no average: ${changes(trailing.merged)} in the trailing ${trailingDays} days (${trailing.needed} needed)`;
  }
  const means = pricedTiers(trailing)
    .map(({ name, dollars: d }) =>
      "status" in d
        ? notReadForPrice(name, d.models)
        : `${name} ${money(d.allIn)} mean`,
    )
    .join("; ");
  return `${label} over the ${trailingDays} days before: ${means || "no tier joined to a merged change, not read"}`;
}

type WriterCostTrailing = FlowReport["writerCost"]["trailingAverage"];

/**
 * All-in cost per merged change by first-launch tier (#1008): each tier's mean with its parts and
 * its median, the orchestrating model it assumes, and the trailing average. A figure that is not
 * read says so: a window below the minimum, or no tier joined to a change, is never a zero.
 */
export function writerDollarsLines(w: FlowReport["writerCost"]): string[] {
  const { current, trailingAverage, trailingDays, pricesAsOf } = w;
  if (current.status !== "ok") {
    return [
      `All-in cost per merged change: not read, ${changes(current.merged)} in this range (${current.needed} needed)`,
      trailingDollarsLine(trailingAverage, trailingDays),
    ];
  }
  const writers = current.unmergedWriterSessions;
  return [
    `All-in cost per merged change by first-launch tier (prices read ${pricesAsOf}): ${tierDollarsText(current)}; ${current.unjoinable} unjoinable; ${writers} writer session${writers === 1 ? "" : "s"} with no merged change, left out`,
    `Orchestrating dollars are priced at ${current.orchestrate.model}, an assumed main-session model, not a recorded one; the parts are means and do not sum to the median.`,
    trailingDollarsLine(trailingAverage, trailingDays),
  ];
}

/** A tier figure as text: its value, or not read when it is null, never a zero. */
const readOrNot = (value: number | null): string =>
  value === null ? "not read" : String(value);

/**
 * Each writer tier's rework, owner time, request share and first-request prompt size beside its cost
 * (#1009), one line per tier. A figure that is null says it is not read; a window below the minimum
 * merged changes says so once, and names the changes it has.
 */
export function writerTierLines(
  w: Pick<FlowReport["writerCost"], "current">,
): string[] {
  const { current } = w;
  if (current.status !== "ok") {
    return [
      `Writer tiers beyond cost: not read, ${changes(current.merged)} in this range (${current.needed} needed)`,
    ];
  }
  return Object.entries(current.tiers).map(([name, t]) =>
    t.sessions === 0
      ? `Writer tier ${name}: no writer session`
      : `Writer tier ${name}: ${t.sessions} writer session${t.sessions === 1 ? "" : "s"}; blocked share ${readOrNot(t.blockedShare)}; follow-ups per session ${readOrNot(t.followUpsPerSession)}; rework per merged change ${readOrNot(t.reworkPerMergedChange)}; owner minutes per merged change ${readOrNot(t.ownerMinutesPerMergedChange)}; over-100K share ${readOrNot(t.over100kShare)} of ${t.requests} requests; first-request prompt median ${readOrNot(t.firstPromptP50)} and p90 ${readOrNot(t.firstPromptP90)}`,
  );
}
