// Which writer launches the arm comparison reads (spec #1065, #1069): only randomized launches
// (the drawn Sonnet and the control Haiku the window records, spawn-experiment.ts) at the window
// effort. Every other launch is left out for one fixed reason, so the report can count it beside
// the figure. Effort is never a stratum: it is read here, once, for the whole comparison.

/** The tier reasons the window records on a randomized launch: the drawn one and the control. */
export const RANDOMIZED_REASONS = ["experiment", "experiment-control"] as const;

/** Why a launch is left out of the primary figure; the names are fixed, never free text. */
export const EXCLUSIONS = [
  "differentEffort",
  "missingEffort",
  "notRandomized",
] as const;
export type Exclusion = (typeof EXCLUSIONS)[number];

/** What is read of a launch: the reason its tier was recorded with and the effort it ran at. */
export interface LaunchRecord {
  tierReason?: string | undefined;
  effort?: string | undefined;
}

/** Where the window effort came from: the explicit setting, the most common randomized effort, or nowhere. */
export type WindowEffortFrom = "setting" | "most common" | "none";

export interface WindowEffort {
  effort: string | null;
  from: WindowEffortFrom;
}

/** Whether the window drew or controlled this launch, as opposed to a hand-picked, escalated or overridden one. */
export function isRandomized({ tierReason }: LaunchRecord): boolean {
  return RANDOMIZED_REASONS.some((reason) => reason === tierReason);
}

/**
 * The reason a launch is left out of the primary figure, or undefined when it is in. A launch with
 * no recorded effort is a missing effort first, so every launch from before effort was recorded
 * reads as one; then a launch the window did not randomize; then a randomized one at another
 * effort. With no window effort, nothing is at it.
 */
export function exclusionOf(
  launch: LaunchRecord,
  windowEffort: string | null,
): Exclusion | undefined {
  if (launch.effort === undefined) {
    return "missingEffort";
  }
  if (!isRandomized(launch)) {
    return "notRandomized";
  }
  return launch.effort === windowEffort ? undefined : "differentEffort";
}

/**
 * The window effort: the explicit setting when given, else the most common effort among randomized
 * launches that recorded one (a tie goes to the first effort by name), else none.
 */
export function windowEffortOf(
  launches: LaunchRecord[],
  given: string | undefined,
): WindowEffort {
  if (given !== undefined) {
    return { effort: given, from: "setting" };
  }
  const counts = new Map<string, number>();
  for (const launch of launches) {
    if (isRandomized(launch) && launch.effort !== undefined) {
      counts.set(launch.effort, (counts.get(launch.effort) ?? 0) + 1);
    }
  }
  const [top] = [...counts].sort(
    ([a, an], [b, bn]) => bn - an || a.localeCompare(b),
  );
  return top === undefined
    ? { effort: null, from: "none" }
    : { effort: top[0], from: "most common" };
}
