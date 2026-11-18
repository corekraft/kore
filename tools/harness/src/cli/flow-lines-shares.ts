// The shares of the weekly token ceiling lines of the flow report (#1048, spec #1030): a rate per
// agent and a size per merged change and per idea, each under its own label and never in one
// column. A missing ceiling reads "not set", a level below the minimum count reads not read, and a
// model with no plan weight is named; the lines name no winner and no verdict.

import type { FlowReport } from "../flow/index.js";

type Shares = FlowReport["costWaiting"]["ceilingShares"];
type Reading = Shares["agents"]["rows"][keyof Shares["agents"]["rows"]];
type Level = Shares["agents"] | Shares["mergedChanges"] | Shares["ideas"];

/** A share as a percentage, or "not set"; "none" where a level has no median or p90. */
function percent(value: number | "not set" | null): string {
  if (value === null) {
    return "none";
  }
  return value === "not set"
    ? "not set"
    : `${Math.round(value * 10_000) / 100}%`;
}

/** What a level or unit that is not read says: its count against the minimum, or the unweighted models. */
function notRead(reading: Reading | Level, unit: string): string | undefined {
  if (reading.status === "insufficient weights") {
    return `not read, no plan weight for ${reading.models.join(", ")}`;
  }
  if (reading.status === "insufficient") {
    return "units" in reading && "needed" in reading
      ? `not read, ${reading.units} ${unit}(s), ${reading.needed} needed`
      : undefined;
  }
  return undefined;
}

/** A level's heading: its kind and label, then its sum, median and p90, or why it is not read. */
function levelLine(kind: string, level: Level, unit: string): string {
  const head = `  ${kind}, ${level.label}:`;
  if (level.status !== "measured") {
    return `${head} ${notRead(level, unit)}`;
  }
  return `${head} total ${percent(level.total)}, median ${percent(level.median)}, p90 ${percent(level.p90)}`;
}

/** A measured reading's text: the share under its label, the span or the main-session basis beside it. */
function measured(reading: Extract<Reading, { status: "measured" }>): string {
  const span =
    reading.spanSeconds === undefined
      ? ""
      : `, span ${reading.spanSeconds === null ? "none" : `${Math.round(reading.spanSeconds)}s`}`;
  const basis = reading.basis === undefined ? "" : ` (${reading.basis})`;
  return `${percent(reading.share)} ${reading.label}${span}${basis}`;
}

const rowLine = (name: string, reading: Reading, unit: string) =>
  `    ${name}: ${reading.status === "measured" ? measured(reading) : notRead(reading, unit)}`;

/** The lines of the shares: the ceiling, then the agent rate, the merged-change sizes and the idea sizes. */
export function shareLines(shares: Shares): string[] {
  const ceiling =
    shares.ceiling === "not set"
      ? "ceiling not set"
      : `ceiling ${shares.ceiling}`;
  return [
    `Shares of the weekly token ceiling (plan-weighted tokens; ${ceiling}):`,
    levelLine(
      `Per agent, a rate over the trailing ${shares.agents.days} days`,
      shares.agents,
      "role",
    ),
    ...Object.entries(shares.agents.rows).map(([name, reading]) =>
      rowLine(name, reading, "session"),
    ),
    levelLine("Per merged change, a size", shares.mergedChanges, "change"),
    ...shares.mergedChanges.rows.map(({ number, share }) =>
      share === null
        ? `    PR #${number}: not read, no writer launch joins it`
        : rowLine(`PR #${number}`, share, "change"),
    ),
    levelLine("Per idea, a size", shares.ideas, "idea"),
    ...shares.ideas.rows.map(({ idea, share }) =>
      rowLine(`Idea ${idea}`, share, "idea"),
    ),
  ];
}
