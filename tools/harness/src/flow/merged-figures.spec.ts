import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { mergedChangeFigures } from "./merged-figures.js";
import { mergedChangeLeadTime } from "./merged-lead-time.js";
import { mergedChangeSendBacks } from "./merged-send-backs.js";
import {
  mergedChangeStageTokens,
  tokensByStage,
} from "./merged-stage-tokens.js";
import { STAGES, type Stage } from "./stages.js";
import { mergedChangeTokens } from "./merged-tokens.js";

vi.mock("./merged-lead-time.js");
vi.mock("./merged-send-backs.js");
vi.mock("./merged-stage-tokens.js");
vi.mock("./merged-tokens.js");

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

beforeEach(() => {
  vi.mocked(mergedChangeTokens).mockReturnValue(TOKENS);
  vi.mocked(mergedChangeSendBacks).mockReturnValue(SEND_BACKS);
  vi.mocked(mergedChangeLeadTime).mockReturnValue(LEAD_TIME);
  vi.mocked(tokensByStage).mockReturnValue(BY_STAGE);
  vi.mocked(mergedChangeStageTokens).mockReturnValue(TOKENS);
});

describe("mergedChangeFigures: the figures over one window", () => {
  it("gives tokens, send-backs, lead time and tokens by stage over the same events, window and options", () => {
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
    expect(r).toEqual({
      tokensPerMergedChange: TOKENS,
      sendBacksPerMergedChange: SEND_BACKS,
      leadTimePerMergedChange: LEAD_TIME,
      tokensByStage: BY_STAGE,
      tokensByStagePerMergedChange: TOKENS,
    });
  });
});
