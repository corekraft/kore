import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergedChangeFigures,
  ownerQuestions,
  type MergedChangeFigures,
} from "./idea-metrics.js";
import { time } from "./github-waits.js";
import { buildReport } from "./report.js";
import { scopeOf, windowOf, inWindow } from "./scope.js";
import { STAGES, type Stage } from "./stages.js";
import { newLife } from "./toil.js";
import {
  ASOF,
  SCOPE,
  WINDOW,
  cover,
  ev,
  fakeLife,
  fakeTally,
  run,
} from "./report-support.js";

vi.mock("./github-waits.js");
vi.mock("./idea-metrics.js");
vi.mock("./select.js");
vi.mock("./scope.js");
vi.mock("./tally.js");
vi.mock("./toil.js");

const TOKENS = {
  trailingDays: 7,
  minMergedChanges: 5,
  current: { status: "insufficient merged changes", merged: 0, needed: 5 },
  trailingAverage: {
    status: "insufficient merged changes",
    merged: 0,
    needed: 5,
  },
} as const;

const SEND_BACKS = {
  trailingDays: 7,
  minMergedChanges: 5,
  current: { status: "insufficient merged changes", merged: 0, needed: 5 },
  trailingAverage: {
    status: "insufficient merged changes",
    merged: 0,
    needed: 5,
  },
} as const;

const LEAD_TIME = {
  trailingDays: 7,
  minMergedChanges: 5,
  current: {
    status: "insufficient merged changes",
    merged: 0,
    measured: 0,
    needed: 5,
  },
  trailingAverage: {
    status: "insufficient merged changes",
    merged: 0,
    measured: 0,
    needed: 5,
  },
} as const;

const NO_STAGE_TOKENS = Object.fromEntries(
  STAGES.map((stage) => [stage, 0]),
) as Record<Stage, number>;
const BY_STAGE = { ...NO_STAGE_TOKENS, write: 300 };

const NO_SCAN = {
  status: "insufficient" as const,
  reason: "no retro scan recorded in the window",
};

const FIGURES: MergedChangeFigures = {
  tokensPerMergedChange: TOKENS,
  sendBacksPerMergedChange: SEND_BACKS,
  leadTimePerMergedChange: LEAD_TIME,
  tokensByStage: BY_STAGE,
  tokensByStagePerMergedChange: TOKENS,
  judgmentContexts: { limit: 60_000, panes: 0, over: [] },
  writerCost: {
    pricesAsOf: "2026-11-16",
    trailingDays: 7,
    minMergedChanges: 5,
    current: { status: "insufficient merged changes", merged: 0, needed: 5 },
    trailingAverage: {
      status: "insufficient merged changes",
      merged: 0,
      needed: 5,
    },
  },
  mainSession: {
    foregroundPollMinutesPerMerged: NO_SCAN,
    paneReadsPerFinishedPane: NO_SCAN,
    signedSendShare: NO_SCAN,
  },
};

beforeEach(() => {
  vi.mocked(scopeOf).mockReturnValue(SCOPE);
  vi.mocked(windowOf).mockReturnValue(WINDOW);
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
  vi.mocked(newLife).mockReturnValue(fakeLife());
  vi.mocked(ownerQuestions).mockReturnValue({
    trailingDays: 7,
    questions: 0,
    merged: 0,
    perMerged: null,
    trailingAverage: null,
    worsened: false,
  });
  vi.mocked(mergedChangeFigures).mockReturnValue(FIGURES);
  cover(new Map());
  fakeTally();
});

describe("buildReport per-merged-change figures (#829, #830)", () => {
  it("reports the three figures the merged-change module computes over every named event and the window", () => {
    const named = [ev(1, "pr.merged", { number: 7 })];
    cover(new Map(), named);

    const r = run([]);

    expect(r.tokensPerMergedChange).toBe(TOKENS);
    expect(r.sendBacksPerMergedChange).toBe(SEND_BACKS);
    expect(r.leadTimePerMergedChange).toBe(LEAD_TIME);
    expect(r.tokensByStage).toBe(BY_STAGE);
    expect(r.tokensByStagePerMergedChange).toBe(TOKENS);
    expect(mergedChangeFigures).toHaveBeenCalledWith(
      named,
      WINDOW,
      expect.objectContaining({ asOf: ASOF }),
    );
  });

  it("passes the cost options through, so the configured minimum reaches every figure", () => {
    buildReport([], {
      asOf: ASOF,
      minCompletedIdeas: 1,
      cost: { minMergedChanges: 9 },
    });

    expect(mergedChangeFigures).toHaveBeenCalledWith(
      [],
      WINDOW,
      expect.objectContaining({ cost: { minMergedChanges: 9 } }),
    );
  });

  it("versions the report to 24, since the judgment panes joined it (#876)", () => {
    expect(run([]).version).toBe(26);
  });
});
