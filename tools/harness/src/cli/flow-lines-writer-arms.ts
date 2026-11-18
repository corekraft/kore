// The Haiku and Sonnet arms as flow report lines (#1012, spec #998): the overall figure, then one line
// per stratum, each with the difference and its interval, both arms' counts, mean, effort and guards.
// The figure reads Haiku at the window effort against Sonnet at the window effort, and a last line
// states the window effort and counts every launch left out by reason (#1069, spec #1065).
// A figure that cannot be read says so and is never a zero. The lines name no winner, margin or
// verdict: the deciding rule is the owner's, recorded on the idea.

import type { ArmRow, ArmSide, WriterArms } from "../flow/index.js";

const changes = (n: number) => `${n} merged change${n === 1 ? "" : "s"}`;

const money = (value: number) => `$${value}`;

/** A signed dollar figure: a negative difference reads as -$2.4667, not $-2.4667. */
const signed = (value: number) => (value < 0 ? `-$${-value}` : money(value));

const launches = (n: number, what: string) =>
  `${n} ${what.replace("launch", n === 1 ? "launch" : "launches")}`;

const readOrNot = (value: number | null) =>
  value === null ? "not read" : String(value);

/** An arm's effort mix as text: each effort with its count, or none where the arm has no change. */
function efforts(effort: Record<string, number>): string {
  const parts = Object.entries(effort).map(([name, n]) => `${name} ${n}`);
  return parts.length === 0 ? "none" : parts.join(", ");
}

/** One arm's counts, mean, effort and guards, as one sentence without its full stop. */
function sideText(name: string, side: ArmSide): string {
  const mean =
    side.allInPerMergedChange === null
      ? "not read"
      : money(side.allInPerMergedChange);
  return `${name}: ${changes(side.mergedChanges)}, mean all-in ${mean}, effort ${efforts(side.effort)}, blocked share ${readOrNot(side.blockedShare)}, send-backs per merged change ${readOrNot(side.sendBacksPerMergedChange)}, owner minutes per merged change ${readOrNot(side.ownerMinutesPerMergedChange)}`;
}

/** One row as a line: its difference and interval, or why it is not read. */
function rowLine(arms: WriterArms, row: ArmRow): string {
  const name = row.label === null ? "all merged changes" : `label ${row.label}`;
  const prefix = `Writer arms, ${name}:`;
  if (row.status === "insufficient merged changes") {
    return `${prefix} insufficient merged changes, Haiku ${row.haiku.mergedChanges} and Sonnet ${row.sonnet.mergedChanges} (${row.needed} needed in each arm); not read.`;
  }
  if (row.status === "insufficient prices") {
    return `${prefix} not read, no price for ${row.models.join(", ")}.`;
  }
  const at = arms.windowEffort.effort;
  const pct = Math.round(arms.confidence * 100);
  const interval = `${pct}% interval ${signed(row.interval.low)} to ${signed(row.interval.high)} (seed ${arms.seed})`;
  return `${prefix} Haiku at ${at} minus Sonnet at ${at} ${signed(row.difference)} all-in per merged change, ${interval}. ${sideText("Haiku", row.haiku)}. ${sideText("Sonnet", row.sonnet)}.`;
}

const SOURCE = {
  setting: "set with --window-effort",
  "most common": "not set, so the most common among randomized launches",
} as const;

/** The window effort, where it came from, and the launches left out of the arms by reason. */
function effortLine({ windowEffort, excluded }: WriterArms): string {
  const { effort, from } = windowEffort;
  const stated =
    effort === null || from === "none"
      ? "no window effort, not set and no randomized launch recorded an effort"
      : `window effort ${effort}, ${SOURCE[from]}`;
  const counts = [
    launches(
      excluded.differentEffort,
      "randomized launch at a different effort",
    ),
    launches(excluded.missingEffort, "launch with no recorded effort"),
    launches(excluded.notRandomized, "launch not randomized"),
  ];
  return `Writer arms: ${stated}. Left out of the arms and counted: ${counts.join(", ")}.`;
}

/**
 * The arms' lines: the overall figure, one line per stratum in label order, then how many arm
 * changes carry no label and so sit in the overall figure only.
 */
export function writerArmLines(arms: WriterArms): string[] {
  return [
    rowLine(arms, arms.overall),
    ...arms.strata.map((row) => rowLine(arms, row)),
    `Writer arms: ${changes(arms.unlabelled)} on an arm with no label recorded, in the overall figure only. The report gives no verdict; the deciding rule is the owner's, recorded on the idea.`,
    effortLine(arms),
  ];
}
