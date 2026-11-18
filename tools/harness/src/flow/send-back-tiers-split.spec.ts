import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { splitFiguresAt } from "./date-split.js";
import {
  NO_SEND_BACK_TIERS,
  sendBackTiersIn,
  type SendBackTiers,
} from "./send-back-tiers.js";
import { sendBackTiersSplitIn } from "./send-back-tiers-split.js";
import type { Span } from "./scope.js";
import { MODEL_PRICES } from "./writer-prices.js";

vi.mock("./date-split.js");
vi.mock("./send-back-tiers.js");

const SPAN: Span = [0, 1000];
const CUT = new Date("2026-11-16T00:00:00Z");
const EVENTS: LedgerEvent[] = [];

const figures = (mergedChanges: number): SendBackTiers => ({
  tiers: {},
  unlinked: { ...NO_SEND_BACK_TIERS.unlinked, mergedChanges },
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("sendBackTiersSplitIn: the send-backs per writer tier on each side of a date (#1047)", () => {
  it("adds nothing without a split date, so the report is exactly what it was", () => {
    expect(sendBackTiersSplitIn(EVENTS, SPAN, undefined, 7)).toEqual({});
    expect(splitFiguresAt).not.toHaveBeenCalled();
    expect(sendBackTiersIn).not.toHaveBeenCalled();
  });

  it("reads the tier figures over each side of the date and carries both under sendBackTiersSplit", () => {
    const before: Span = [0, 500];
    const after: Span = [500, 1000];
    vi.mocked(splitFiguresAt).mockImplementation((_span, _at, read) => ({
      at: "2026-11-16T00:00:00.000Z",
      before: read(before),
      after: read(after),
    }));
    vi.mocked(sendBackTiersIn).mockImplementation((_events, side) =>
      figures(side === before ? 1 : 2),
    );

    expect(sendBackTiersSplitIn(EVENTS, SPAN, CUT, 7)).toEqual({
      sendBackTiersSplit: {
        at: "2026-11-16T00:00:00.000Z",
        before: figures(1),
        after: figures(2),
      },
    });
    expect(splitFiguresAt).toHaveBeenCalledWith(
      SPAN,
      CUT,
      expect.any(Function),
    );
    expect(sendBackTiersIn).toHaveBeenCalledWith(
      EVENTS,
      before,
      Object.keys(MODEL_PRICES),
      7,
    );
    expect(sendBackTiersIn).toHaveBeenCalledWith(
      EVENTS,
      after,
      Object.keys(MODEL_PRICES),
      7,
    );
  });
});
