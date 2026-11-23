import { readPlanFromReport, type SessionReport } from "./judgment-report.js";
import type { PlanRead } from "./judgment-plan.js";

/** Where a finished judgment or reader left its answer: the report its hc session wrote. */
export interface AnswerReads {
  /** The report a finished hc session wrote, read-only; undefined when it wrote none. */
  reportOf: (name: string) => Promise<SessionReport | undefined>;
}

/** What a judgment's brief carries for a reader that wrote no report. */
export const NO_SUMMARY = "The reader wrote no report, so it left no summary.";

/** A judgment's plan: the plan its report carries. */
export async function readPlanOf(
  reads: AnswerReads,
  name: string,
): Promise<PlanRead> {
  return readPlanFromReport((await reads.reportOf(name))?.plan);
}

/** A reader's answer: the summary its report carries. */
export async function readSummaryOf(
  reads: AnswerReads,
  name: string,
): Promise<string> {
  return (await reads.reportOf(name))?.summary ?? NO_SUMMARY;
}
