// The metric names a harness idea's hypothesis may name: read from the flow report itself, so no second list can drift.
import { beforeEach, expect, test, vi } from "vitest";
import { flowMetricNames, metricPaths } from "./metric-names.js";
import { buildReport, type FlowReport } from "./report.js";

vi.mock("./report.js");

const REPORT = {
  version: 8,
  asOf: "2026-01-01T00:00:00.000Z",
  scope: { since: null, until: null, ideas: null },
  ideas: { total: 0, completed: 0 },
  minCompletedIdeas: 1,
  stages: [{ stage: "writing", waitingSeconds: 0 }],
  leadTime: { ideas: [], medianSeconds: null, maxSeconds: null },
  metrics: {
    trailingIdeas: 5,
    tokensPerIdea: { status: "insufficient history", closedIdeas: 0 },
  },
  bottleneck: null,
  outcomes: { mainRed: { runs: 0, failed: 0, rate: null } },
} as unknown as FlowReport;

beforeEach(() => {
  vi.mocked(buildReport).mockReturnValue(REPORT);
});

test("metric paths are the numeric and null leaves of the report, dotted, with a cost metric named whole", () => {
  expect(metricPaths(REPORT)).toEqual([
    "ideas.total",
    "ideas.completed",
    "leadTime.medianSeconds",
    "leadTime.maxSeconds",
    "metrics.trailingIdeas",
    "metrics.tokensPerIdea",
    "outcomes.mainRed.runs",
    "outcomes.mainRed.failed",
    "outcomes.mainRed.rate",
  ]);
});

test("the terminal source's readings are not hypothesis metrics until an idea names one", () => {
  expect(
    metricPaths({ ...REPORT, terminal: null } as unknown as FlowReport),
  ).not.toContain("terminal");
});

test("metric paths leave out the version, dates, scope and per-row lists, which are not measurements", () => {
  const paths = metricPaths(REPORT);
  for (const left of [
    "version",
    "asOf",
    "scope.since",
    "minCompletedIdeas",
    "stages",
    "bottleneck",
  ]) {
    expect(paths).not.toContain(left);
  }
});

test("the flow metric names come from a report built on an empty ledger", () => {
  expect(flowMetricNames()).toEqual(metricPaths(REPORT));
  expect(vi.mocked(buildReport).mock.calls).toEqual([
    [[], { asOf: new Date("2026-01-01T00:00:00.000Z"), minCompletedIdeas: 1 }],
  ]);
});
