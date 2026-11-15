interface Check {
  result: string;
  detail?: string;
}

/** The part of `judge precheck --json` the orchestrator reads. */
export interface PrecheckReport {
  pr: number;
  ok: boolean;
  declaration: { ok: boolean; reason?: string };
  checks?: Record<string, Check>;
  patternMismatch?: string;
}

const PREFIX = "The precheck failed: ";

/**
 * Why the writer must fix the change, or undefined when the judge should run.
 * Only what the writer can fix counts: no valid declaration, a failed check, a
 * pattern mismatch. A check still pending or missing (CI running, the review
 * not yet posted) is the judge's to wait on, so it launches as before.
 */
export function sendBackReason(report: PrecheckReport): string | undefined {
  if (report.ok) {
    return undefined;
  }
  if (!report.declaration.ok) {
    return `${PREFIX}${report.declaration.reason ?? "no valid safety pattern is declared."}`;
  }
  const failures = Object.entries(report.checks ?? {})
    .filter(([, check]) => check.result === "fail")
    .map(
      ([name, check]) =>
        `${name}: fail${check.detail === undefined ? "" : ` (${check.detail})`}`,
    );
  if (report.patternMismatch !== undefined) {
    failures.push(`pattern mismatch: ${report.patternMismatch}`);
  }
  return failures.length === 0 ? undefined : `${PREFIX}${failures.join("; ")}`;
}
