import { describe, expect, it } from "vitest";
import { checkPlan } from "./judgment-plan.js";
import { readPlanFromReport } from "./judgment-report.js";

const PLAN = { stop: { reason: "The idea needs an owner decision." } };

describe("readPlanFromReport", () => {
  it("gives back the plan a judgment wrote to its plan file, as session report stored it", () => {
    const stored = JSON.stringify(PLAN, null, 2);

    const read = readPlanFromReport(stored);

    expect(read).toStrictEqual({ ok: true, raw: PLAN });
    expect(checkPlan(read.ok ? read.raw : undefined)).toStrictEqual({
      ok: true,
      plan: { kind: "stop", reason: "The idea needs an owner decision." },
    });
  });

  it("reads a plan piped in on stdin, which keeps the trailing newline a heredoc adds", () => {
    const stored = `${JSON.stringify(PLAN, null, 2)}\n`;

    expect(readPlanFromReport(stored)).toStrictEqual({ ok: true, raw: PLAN });
  });

  it("refuses a report with no plan, so nothing is started", () => {
    expect(readPlanFromReport(undefined)).toStrictEqual({
      ok: false,
      error:
        "The judgment session's report carries no plan; its brief must end with node skills/bin/harness.mjs session report --plan - and the plan on its stdin. Nothing was started; rerun the judgment session.",
    });
  });

  it("refuses a stored plan that is not JSON, naming the report field", () => {
    expect(readPlanFromReport("{ not json")).toStrictEqual({
      ok: false,
      error:
        "The judgment session's stored plan is not valid JSON; it must be one JSON object on the stdin of node skills/bin/harness.mjs session report --plan -. Nothing was started.",
    });
  });
});
