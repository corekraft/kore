import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import {
  compactionCount,
  mainSessionFigures,
  mainSessionSetups,
} from "./main-session.js";
import { mergedChangeFigures } from "./merged-figures.js";
import { mergedChangeLeadTime } from "./merged-lead-time.js";
import { mergedChangeSendBacks } from "./merged-send-backs.js";
import {
  mergedChangeStageTokens,
  tokensByStage,
} from "./merged-stage-tokens.js";
import { NO_REVIEW_ROUNDS } from "./review-rounds.js";
import { NO_SEND_BACK_TIERS } from "./send-back-tiers.js";
import { STAGES, type Stage } from "./stages.js";
import {
  countsBefore,
  judgmentContexts,
  mergedChangeTokens,
  type JudgmentContexts,
} from "./merged-tokens.js";
import type { WriterArms } from "./writer-arms.js";
import { writerFiguresIn } from "./writer-figures.js";

vi.mock("./main-session.js");
vi.mock("./merged-lead-time.js");
vi.mock("./merged-send-backs.js");
vi.mock("./merged-stage-tokens.js");
vi.mock("./merged-tokens.js");
vi.mock("./writer-figures.js");

const NO_SCAN = {
  status: "insufficient",
  reason: "no retro scan recorded in the window",
} as const;

const MAIN_SESSION = {
  foregroundPollMinutesPerMerged: NO_SCAN,
  paneReadsPerFinishedPane: NO_SCAN,
  signedSendShare: NO_SCAN,
} as const;

const INSUFFICIENT = {
  status: "insufficient merged changes",
  merged: 0,
  needed: 5,
} as const;

const TOKENS = {
  trailingDays: 7,
  minMergedChanges: 5,
  current: INSUFFICIENT,
  trailingAverage: INSUFFICIENT,
} as const;

const SEND_BACKS = { ...TOKENS } as const;

const LEAD_TIME = {
  trailingDays: 7,
  minMergedChanges: 5,
  current: { ...INSUFFICIENT, measured: 0 },
  trailingAverage: { ...INSUFFICIENT, measured: 0 },
} as const;

const NO_STAGE_TOKENS = Object.fromEntries(
  STAGES.map((stage) => [stage, 0]),
) as Record<Stage, number>;
const BY_STAGE = { ...NO_STAGE_TOKENS, write: 300 };

const WRITER_COST = {
  pricesAsOf: "2026-11-16",
  trailingDays: 7,
  minMergedChanges: 5,
  current: INSUFFICIENT,
  trailingAverage: INSUFFICIENT,
} as const;

const ARM_SIDE = {
  tier: "claude-haiku-5-5",
  mergedChanges: 0,
  allInPerMergedChange: null,
  effort: {},
  blockedShare: null,
  sendBacksPerMergedChange: null,
  ownerMinutesPerMergedChange: null,
} as const;

const WRITER_ARMS: WriterArms = {
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
    haiku: ARM_SIDE,
    sonnet: { ...ARM_SIDE, tier: "claude-sonnet-5-5" },
  },
  strata: [],
};

const JUDGMENT_CONTEXTS: JudgmentContexts = {
  limit: 60_000,
  panes: 0,
  over: [],
};

beforeEach(() => {
  vi.mocked(judgmentContexts).mockReturnValue(JUDGMENT_CONTEXTS);
  // The writer dollars read the main session's token totals through countsBefore (#1041): none in these events.
  vi.mocked(countsBefore).mockReturnValue(new Map());
  vi.mocked(mergedChangeTokens).mockReturnValue(TOKENS);
  vi.mocked(mergedChangeSendBacks).mockReturnValue(SEND_BACKS);
  vi.mocked(mergedChangeLeadTime).mockReturnValue(LEAD_TIME);
  vi.mocked(tokensByStage).mockReturnValue(BY_STAGE);
  vi.mocked(mergedChangeStageTokens).mockReturnValue(TOKENS);
  vi.mocked(writerFiguresIn).mockReturnValue({
    writerCost: WRITER_COST,
    writerArms: WRITER_ARMS,
    sendBackTiers: NO_SEND_BACK_TIERS,
    reviewRounds: NO_REVIEW_ROUNDS,
  });
  vi.mocked(mainSessionFigures).mockReturnValue(MAIN_SESSION);
});

describe("mergedChangeFigures: the figures over one window", () => {
  it("gives tokens, send-backs, lead time, tokens by stage and writer cost over the same events, window and options", () => {
    const events: LedgerEvent[] = [];
    const window: [number, number] = [0, 10];
    const options = { asOf: new Date(0), cost: { minMergedChanges: 3 } };

    const r = mergedChangeFigures(events, window, options);

    expect(mergedChangeTokens).toHaveBeenCalledWith(events, window, options);
    expect(mergedChangeSendBacks).toHaveBeenCalledWith(events, window, options);
    expect(mergedChangeLeadTime).toHaveBeenCalledWith(events, window, options);
    expect(tokensByStage).toHaveBeenCalledWith(events, window);
    expect(mergedChangeStageTokens).toHaveBeenCalledWith(
      events,
      window,
      options,
    );
    expect(writerFiguresIn).toHaveBeenCalledWith(events, window, options);
    expect(mainSessionFigures).toHaveBeenCalledWith(
      events,
      window,
      options.cost,
    );
    expect(r).toEqual({
      tokensPerMergedChange: TOKENS,
      sendBacksPerMergedChange: SEND_BACKS,
      leadTimePerMergedChange: LEAD_TIME,
      tokensByStage: BY_STAGE,
      tokensByStagePerMergedChange: TOKENS,
      writerCost: WRITER_COST,
      writerArms: WRITER_ARMS,
      sendBackTiers: NO_SEND_BACK_TIERS,
      reviewRounds: NO_REVIEW_ROUNDS,
      mainSession: MAIN_SESSION,
      judgmentContexts: JUDGMENT_CONTEXTS,
      // The cost beside waiting figures are pinned in cost-waiting.spec.ts; here only their presence.
      costWaiting: expect.any(Object),
    });
  });

  it("names the judgment panes over the context limit from the same events and window (#876)", () => {
    const events: LedgerEvent[] = [];
    const window: [number, number] = [0, 10];

    const r = mergedChangeFigures(events, window, { asOf: new Date(0) });

    expect(judgmentContexts).toHaveBeenCalledWith(events, window);
    expect(r.judgmentContexts).toBe(JUDGMENT_CONTEXTS);
  });
});

describe("mergedChangeFigures: the compaction count (#1037)", () => {
  it("reads the compactions from the same events and window", () => {
    const events: LedgerEvent[] = [];
    const window: [number, number] = [0, 10];
    const counted = {
      status: "insufficient",
      reason: "no session recorded in the window",
    } as const;
    vi.mocked(compactionCount).mockReturnValue(counted);

    const r = mergedChangeFigures(events, window, { asOf: new Date(0) });

    expect(compactionCount).toHaveBeenCalledWith(events, window);
    expect(r.compactions).toBe(counted);
  });
});

describe("mergedChangeFigures: the main-session setup labels (#1046)", () => {
  it("reads the setups from the same events and window against the config's compaction cap", () => {
    const events: LedgerEvent[] = [];
    const window: [number, number] = [0, 10];
    const setups = {
      status: "insufficient",
      reason: "no main-session reading recorded in the window",
    } as const;
    vi.mocked(mainSessionSetups).mockReturnValue(setups);

    const r = mergedChangeFigures(events, window, {
      asOf: new Date(0),
      compactionCap: 80_000,
    });

    expect(mainSessionSetups).toHaveBeenCalledWith(events, window, 80_000);
    expect(r.mainSessionSetups).toBe(setups);
  });

  it("passes no cap when the config sets none, never a zero", () => {
    const events: LedgerEvent[] = [];

    mergedChangeFigures(events, [0, 10], { asOf: new Date(0) });

    expect(mainSessionSetups).toHaveBeenCalledWith(events, [0, 10], undefined);
  });
});
