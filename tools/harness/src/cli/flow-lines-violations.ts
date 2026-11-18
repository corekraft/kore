// The principles-review violations by rule per writer tier for the flow report's text (#1051), with
// the same figures on each side of the split date when the report has one (#1047). Every share is
// printed with the count it comes from and the citations it is read over.

import type {
  FlowReport,
  TierViolations,
  ViolationsByRule,
} from "../flow/index.js";

const TITLE = "Review violations by rule";

const verdicts = (n: number) => `${n} failing verdict${n === 1 ? "" : "s"}`;

/** One row's text: its failing verdicts, each cited rule with its count over the citations, and the unlabelled verdicts. */
function rowText(row: TierViolations): string {
  const parts = [verdicts(row.failedVerdicts)];
  if (row.rules.length > 0) {
    const cited = row.rules.map(
      (r) =>
        `${r.rule} ${r.count} of ${row.citations} (${Math.round(r.share * 100)}%)`,
    );
    parts.push(`rules cited: ${cited.join(", ")}`);
  }
  if (row.unlabelled > 0) {
    parts.push(`${row.unlabelled} with no rule label`);
  }
  return parts.join("; ");
}

/** The violations by rule, one line per writer tier in tier order, then the unlinked row. */
export function violationLines({
  tiers,
  unlinked,
}: ViolationsByRule): string[] {
  return [
    ...Object.entries(tiers).map(
      ([tier, row]) => `${TITLE}, writer tier ${tier}: ${rowText(row)}`,
    ),
    `${TITLE}, unlinked row (no writer tier): ${rowText(unlinked)}`,
  ];
}

/**
 * The violation lines, then, when the report carries a split, the before side and the after side,
 * each under a header naming the date.
 */
export function violationReportLines({
  violationsByRule,
  violationsByRuleSplit,
}: Pick<FlowReport, "violationsByRule" | "violationsByRuleSplit">): string[] {
  if (violationsByRuleSplit === undefined) {
    return violationLines(violationsByRule);
  }
  const { at, before, after } = violationsByRuleSplit;
  const indented = (v: ViolationsByRule) =>
    violationLines(v).map((line) => `  ${line}`);
  return [
    ...violationLines(violationsByRule),
    `${TITLE} by writer tier, before ${at}:`,
    ...indented(before),
    `${TITLE} by writer tier, on or after ${at}:`,
    ...indented(after),
  ];
}
