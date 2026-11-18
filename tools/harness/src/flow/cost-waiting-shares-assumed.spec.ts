import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { assumedPartIn } from "./cost-waiting-shares-assumed.js";
import { planPricesOf } from "./plan-prices.js";
import {
  orchestrateDollarsIn,
  type OrchestrateDollars,
} from "./writer-orchestrate.js";

// Everything outside the unit is mocked: the plan prices and the main session's dollars read at
// them, which are weighted tokens when the table is the plan table.
vi.mock("./plan-prices.js", () => ({ planPricesOf: vi.fn() }));
vi.mock("./writer-orchestrate.js", () => ({ orchestrateDollarsIn: vi.fn() }));

const PLAN_PRICES = { "plan-model": {} } as never;
const WEEK: [number, number] = [0, 7];
const EVENTS = [] as LedgerEvent[];

const dollars = (over: Partial<OrchestrateDollars>): OrchestrateDollars => ({
  recorded: 0,
  assumed: 0,
  recordedModels: [],
  assumedTokens: 0,
  assumedSessions: 0,
  unpriced: [],
  basis: "none",
  ...over,
});

beforeEach(() => {
  vi.mocked(planPricesOf).mockReturnValue(PLAN_PRICES);
});

describe("the main session's token totals with no recorded model", () => {
  it("reads the assumed part at the plan prices: its weighted tokens and the sessions that spent them", () => {
    vi.mocked(orchestrateDollarsIn).mockReturnValue(
      dollars({ assumed: 40, assumedTokens: 80, assumedSessions: 2 }),
    );

    expect(assumedPartIn(EVENTS, WEEK)).toEqual({
      sessions: 2,
      plan: 40,
      unweighted: [],
    });
    expect(orchestrateDollarsIn).toHaveBeenCalledWith(
      EVENTS,
      WEEK,
      PLAN_PRICES,
    );
  });

  it("is absent when no unread totals grew in the week, so a recorded row is not labelled assumed", () => {
    vi.mocked(orchestrateDollarsIn).mockReturnValue(
      dollars({ recorded: 9, recordedModels: ["model-a"], basis: "recorded" }),
    );

    expect(assumedPartIn(EVENTS, WEEK)).toBeUndefined();
  });

  it("names the models the plan does not weight, with the plan it could read", () => {
    vi.mocked(orchestrateDollarsIn).mockReturnValue(
      dollars({
        assumedTokens: 80,
        assumedSessions: 1,
        unpriced: ["claude-opus-5-5"],
      }),
    );

    expect(assumedPartIn(EVENTS, WEEK)).toEqual({
      sessions: 1,
      plan: 0,
      unweighted: ["claude-opus-5-5"],
    });
  });
});
