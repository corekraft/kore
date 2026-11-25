import type { FlagRow, ProgressReport } from "./progress.js";

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md

const PROOF_TEXT: Record<FlagRow["proof"], string> = {
  "live-run": "live run recorded",
  "owner-waiver": "owner waiver only, not a live run",
  none: "no live run",
};

/** One flag's line: its on state, its proof, and any requirement it waits on. */
function rowLine(row: FlagRow): string {
  const waits =
    row.waitsOn.length === 0 ? "" : `, waits on ${row.waitsOn.join(", ")}`;
  return `  ${row.flag}: ${row.on ? "on" : "off"}, ${PROOF_TEXT[row.proof]}${waits}`;
}

/** A titled group of lines, or a line saying the group is empty. */
function group(title: string, lines: string[]): string[] {
  return [title, ...(lines.length === 0 ? ["  none."] : lines), ""];
}

/** The count line for one group: how many are on, and how many have a live run. */
function countLine(label: string, rows: FlagRow[]): string {
  const on = rows.filter((row) => row.on).length;
  const proven = rows.filter((row) => row.proof === "live-run").length;
  return `${label} on: ${on} of ${rows.length}, with a live run: ${proven}.`;
}

/** The line naming the next flag to prove, or saying why none is named. */
function nextLine(report: ProgressReport): string {
  if (report.next !== null) {
    return `Next flag to prove: ${report.next.flag} (${report.next.kind} flag).`;
  }
  const unproven = [...report.environmentFlags, ...report.features].some(
    (row) => row.proof !== "live-run",
  );
  return unproven
    ? "Next flag to prove: none; every flag still to prove waits on a flag that is off."
    : "Next flag to prove: none; every applicable flag has a live run.";
}

/** Prints the progress report as text, one line per flag and a summary (ADR 0148). */
export function renderProgress(report: ProgressReport): string {
  const production = report.production
    ? "yes, so an owner waiver is not proof (ADR 0147)"
    : "no";
  const lines = [
    `Flag progress for ${report.environment} (${report.path})`,
    `Production: ${production}.`,
    "",
    ...group(
      "Environment flags (activated, not counted as features):",
      report.environmentFlags.map(rowLine),
    ),
    ...group("Feature flags:", report.features.map(rowLine)),
    ...group(
      "Excluded:",
      report.excluded.map(
        (flag) => `  ${flag.flag}: ${flag.status}, ${flag.reason}`,
      ),
    ),
    countLine("Environment flags", report.environmentFlags),
    countLine("Feature flags", report.features),
    `Every applicable feature flag is on: ${report.everyApplicableFlagOn ? "yes" : "no"}.`,
    nextLine(report),
  ];
  return `${lines.join("\n")}\n`;
}
