import { readPlan, type PlanRead } from "./judgment-plan.js";
import { readPlanFromReport, type SessionReport } from "./judgment-report.js";
import { readSummary } from "./judgment-summary.js";

/** Where a finished judgment or reader left its answer: its report when an hc session wrote one, else its pane. */
export interface AnswerReads {
  /** The report a finished hc session wrote, read-only; undefined when it wrote none. */
  reportOf: (name: string) => Promise<SessionReport | undefined>;
  /** The finished pane's text, read-only. */
  paneText: (name: string) => Promise<string>;
}

/** A judgment's plan: the plan its report carries, else the plan markers its pane printed. */
export async function readPlanOf(
  reads: AnswerReads,
  name: string,
): Promise<PlanRead> {
  const report = await reads.reportOf(name);
  return report === undefined
    ? readPlan(await reads.paneText(name))
    : readPlanFromReport(report.plan);
}

/** A reader's answer: the report's summary as written, else the text between its pane's summary markers. */
export async function readSummaryOf(
  reads: AnswerReads,
  name: string,
): Promise<string> {
  const report = await reads.reportOf(name);
  return report === undefined
    ? readSummary(await reads.paneText(name))
    : report.summary;
}
