import type { PlanRead } from "./judgment-plan.js";

/** What a finished hc session wrote: its summary, and the plan its report carries when it named one. */
export interface SessionReport {
  summary: string;
  plan?: string;
}

/**
 * The plan a judgment session stored with its report (session report --plan), parsed as the tick parses a pane's
 * plan. The report's plan is the text its session put on stdin, so the object comes back exactly as the judgment wrote it.
 */
export function readPlanFromReport(plan: string | undefined): PlanRead {
  if (plan === undefined) {
    return {
      ok: false,
      error:
        "The judgment session's report carries no plan; its brief must end with node skills/bin/harness.mjs session report --plan - and the plan on its stdin. Nothing was started; rerun the judgment session.",
    };
  }
  try {
    return { ok: true, raw: JSON.parse(plan) as unknown };
  } catch {
    return {
      ok: false,
      error:
        "The judgment session's stored plan is not valid JSON; it must be one JSON object on the stdin of node skills/bin/harness.mjs session report --plan -. Nothing was started.",
    };
  }
}
