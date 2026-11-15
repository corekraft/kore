// What a request to change a guardrail's mode presents: four figures read from
// a retro-scan report. Counts only, never transcript text.
// Plan: infra/plans/12-self-improving-loop.md (Step 4).

import { GuardrailError, type Mode } from "./inventory.js";

/** Warnings an audit rule needs before its record can show it is safe to enforce. */
export const MIN_WARNINGS = 5;

export type Classification =
  "insufficient-evidence" | "promotable" | "not-promotable";

/** The retro scan's verdict on an audit rule; the scan and a request share this one rule. */
export function classifyAudit(
  warnings: number,
  heeded: number,
): Classification {
  if (warnings < MIN_WARNINGS) {
    return "insufficient-evidence";
  }
  return heeded === warnings ? "promotable" : "not-promotable";
}

/** The four summary figures. Null means the scan cannot measure it for that mode. */
export interface Evidence {
  fired: number;
  heeded: number | null;
  overridden: number | null;
  falsePositives: number;
  classification: Classification | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const count = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;

function auditRows(report: unknown): Record<string, unknown>[] | undefined {
  const rules = isRecord(report) ? report["rules"] : undefined;
  const rows = isRecord(rules) ? rules["audit"] : undefined;
  return Array.isArray(rows) ? rows.filter(isRecord) : undefined;
}

/**
 * Evidence for one rule from a retro-scan report. A rule in audit mode needs its
 * `rules.audit` row; an enforced rule is measured by the blocks in `guards`, and
 * a rule the scan saw no block of fired zero times.
 */
export function requestEvidence(
  report: unknown,
  rule: string,
  from: Mode,
  falsePositives: number,
): Evidence {
  const rows = auditRows(report);
  const guards = isRecord(report) ? report["guards"] : undefined;
  if (rows === undefined && !isRecord(guards)) {
    throw new GuardrailError(
      "The scan report is not a retro-scan report (no rules.audit or guards). Pass the JSON `harness hook retro-scan --strict` printed.",
    );
  }
  if (from === "enforce") {
    const seen = isRecord(guards) ? guards[rule] : undefined;
    return {
      fired: isRecord(seen) ? count(seen["blocks"]) : 0,
      heeded: null,
      overridden: null,
      falsePositives,
      classification: null,
    };
  }
  const row = rows?.find((r) => r["rule"] === rule);
  if (row === undefined) {
    throw new GuardrailError(
      `The scan report has no audit row for "${rule}", so there is no evidence to present. Run \`harness hook retro-scan --strict\` with the rule in audit mode, then pass its output with --scan.`,
    );
  }
  const fired = count(row["warnings"]);
  const heeded = count(row["heeded"]);
  return {
    fired,
    heeded,
    overridden: count(row["overridden"]),
    falsePositives,
    classification: classifyAudit(fired, heeded),
  };
}
