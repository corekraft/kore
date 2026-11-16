import type { SendBackCategory } from "../ledger/index.js";

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

/** What the orchestrator sends back: the reason the writer reads, and the category the ledger counts. */
export interface SendBack {
  reason: string;
  category: SendBackCategory;
}

/** One failure the reason names, with the category it counts as. */
interface Failure {
  text: string;
  category: SendBackCategory;
}

const PREFIX = "The precheck failed: ";

/** A failed check whose missing piece is proof the writer must supply, rather than a failing gate. */
const PROOF_CHECKS = new Set(["expandStep"]);

/**
 * Why the writer must fix the change, and its category, or undefined when the
 * judge should run. Only what the writer can fix counts: no valid declaration,
 * a failed check, a pattern mismatch. A check still pending or missing (CI
 * running, the review not yet posted) is the judge's to wait on, so it launches
 * as before. The category is the first failure the reason names.
 */
export function sendBackFor(report: PrecheckReport): SendBack | undefined {
  if (report.ok) {
    return undefined;
  }
  if (!report.declaration.ok) {
    return {
      reason: `${PREFIX}${report.declaration.reason ?? "no valid safety pattern is declared."}`,
      category: "declaration",
    };
  }
  const failures: Failure[] = Object.entries(report.checks ?? {})
    .filter(([, check]) => check.result === "fail")
    .map(([name, check]) => {
      const category: SendBackCategory = PROOF_CHECKS.has(name)
        ? "missing-proof"
        : "failed-check";
      const detail = check.detail === undefined ? "" : ` (${check.detail})`;
      return { text: `${name}: fail${detail}`, category };
    });
  if (report.patternMismatch !== undefined) {
    failures.push({
      text: `pattern mismatch: ${report.patternMismatch}`,
      category: "pattern-mismatch",
    });
  }
  const first = failures[0];
  return first === undefined
    ? undefined
    : {
        reason: `${PREFIX}${failures.map((f) => f.text).join("; ")}`,
        category: first.category,
      };
}
