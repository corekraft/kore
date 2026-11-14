import { describe, expect, it, vi } from "vitest";
import * as flow from "./index.js";
import * as cost from "./cost.js";
import * as costConfig from "./cost-config.js";
import * as report from "./report.js";
import * as stages from "./stages.js";

vi.mock("./cost.js");
vi.mock("./cost-config.js");
vi.mock("./report.js");
vi.mock("./stages.js");

describe("flow barrel", () => {
  it("exposes exactly the runtime names the domain publishes", () => {
    expect(Object.keys(flow).sort()).toEqual(
      [
        "DEFAULT_COST",
        "GITHUB_STAGES",
        "HARNESS_CONFIG",
        "MIN_COMPLETED_IDEAS",
        "REPORT_VERSION",
        "STAGES",
        "buildReport",
        "parseHarnessConfig",
      ].sort(),
    );
  });

  it("re-exports the report's names unchanged", () => {
    expect(flow.REPORT_VERSION).toBe(report.REPORT_VERSION);
    expect(flow.buildReport).toBe(report.buildReport);
  });

  it("re-exports the cost defaults unchanged", () => {
    expect(flow.DEFAULT_COST).toBe(cost.DEFAULT_COST);
  });

  it("re-exports the harness config reader unchanged", () => {
    expect(flow.HARNESS_CONFIG).toBe(costConfig.HARNESS_CONFIG);
    expect(flow.parseHarnessConfig).toBe(costConfig.parseHarnessConfig);
  });

  it("re-exports the stage names unchanged", () => {
    expect(flow.GITHUB_STAGES).toBe(stages.GITHUB_STAGES);
    expect(flow.MIN_COMPLETED_IDEAS).toBe(stages.MIN_COMPLETED_IDEAS);
    expect(flow.STAGES).toBe(stages.STAGES);
  });
});
