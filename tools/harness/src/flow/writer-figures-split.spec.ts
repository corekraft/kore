import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { NO_SEND_BACK_TIERS } from "./send-back-tiers.js";
import { sendBackTiersSplitIn } from "./send-back-tiers-split.js";
import { writerArmsIn } from "./writer-arms.js";
import { mergedChangeWriterCost } from "./writer-cost.js";
import { writerFiguresIn } from "./writer-figures.js";
import type { Span } from "./scope.js";

vi.mock("./writer-arms.js");
vi.mock("./writer-cost.js");
vi.mock("./send-back-tiers-split.js");

const WINDOW: Span = [0, 1000];
const ASOF = new Date(1000);
const SPLIT_AT = new Date("2026-11-16T00:00:00Z");
const EVENTS: LedgerEvent[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sendBackTiersSplitIn).mockReturnValue({});
});

describe("writerFiguresIn: the split date reaches the tier figures (#1047)", () => {
  it("carries the split of the send-backs per writer tier beside the unsplit ones, read over the same events and window", () => {
    const sendBackTiersSplit = {
      at: SPLIT_AT.toISOString(),
      before: NO_SEND_BACK_TIERS,
      after: NO_SEND_BACK_TIERS,
    };
    vi.mocked(sendBackTiersSplitIn).mockReturnValue({ sendBackTiersSplit });

    const figures = writerFiguresIn(EVENTS, WINDOW, {
      asOf: ASOF,
      splitAt: SPLIT_AT,
    });

    expect(figures.sendBackTiersSplit).toBe(sendBackTiersSplit);
    expect(figures.sendBackTiers.unlinked.mergedChanges).toBe(0);
    expect(sendBackTiersSplitIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      SPLIT_AT,
      20,
    );
  });

  it("has no sendBackTiersSplit key when the split module gives none, so the figures keep the keys they had", () => {
    const figures = writerFiguresIn(EVENTS, WINDOW, { asOf: ASOF });

    expect("sendBackTiersSplit" in figures).toBe(false);
    expect(Object.keys(figures)).toEqual([
      "writerCost",
      "writerArms",
      "sendBackTiers",
      "reviewRounds",
    ]);
    expect(sendBackTiersSplitIn).toHaveBeenCalledWith(
      EVENTS,
      WINDOW,
      undefined,
      20,
    );
    expect(mergedChangeWriterCost).toHaveBeenCalledTimes(1);
    expect(writerArmsIn).toHaveBeenCalledTimes(1);
  });
});
