import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergedChangeFigures,
  ownerQuestions,
  type MergedChangeFigures,
} from "./idea-metrics.js";
import { costWaitingIn } from "./cost-waiting.js";
import { time } from "./github-waits.js";
import { NO_SEND_BACK_TIERS } from "./send-back-tiers.js";
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

const ARM_EMPTY = {
  tier: "claude-haiku-5-5",
  mergedChanges: 0,
  allInPerMergedChange: null,
  effort: {},
  blockedShare: null,
  sendBacksPerMergedChange: null,
  ownerMinutesPerMergedChange: null,
};

const FIGURES: MergedChangeFigures = {
  costWaiting: costWaitingIn([], [0, 1], { prices: {}, minimum: 1 }),
  sendBackTiers: NO_SEND_BACK_TIERS,
  tokensPerMergedChange: TOKENS,
  sendBacksPerMergedChange: SEND_BACKS,
  leadTimePerMergedChange: LEAD_TIME,
  tokensByStage: BY_STAGE,
  tokensByStagePerMergedChange: TOKENS,
  judgmentContexts: { limit: 60_000, panes: 0, over: [] },
  handovers: {
    status: "insufficient",
    reason: "no handover reason recorded in the window",
  },
  compactions: {
    status: "insufficient",
    reason: "no session recorded in the window",
  },
  mainSessionSetups: {
    status: "insufficient",
    reason: "no main-session reading recorded in the window",
  },
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
  writerArms: {
    seed: 20261117,
    resamples: 2000,
    confidence: 0.95,
    minMergedChanges: 5,
    unlabelled: 0,
    windowEffort: { effort: "high", from: "setting" },
    excluded: { differentEffort: 0, missingEffort: 0, notRandomized: 0 },
    overall: {
      label: null,
      status: "insufficient merged changes",
      needed: 5,
      haiku: ARM_EMPTY,
      sonnet: { ...ARM_EMPTY, tier: "claude-sonnet-5-5" },
    },
    strata: [],
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

  it("versions the report to 35, since the writing cost by idea joined costWaiting (#1093)", () => {
    expect(run([]).version).toBe(37);
  });
});
