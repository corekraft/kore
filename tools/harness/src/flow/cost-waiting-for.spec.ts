import { describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { costWaitingIn } from "./cost-waiting.js";
import { costWaitingFor } from "./cost-waiting-for.js";
import { MODEL_PRICES } from "./writer-prices.js";

// Everything outside the unit is mocked: the figures themselves. The published price table and
// the default minimum are constants and are real.
vi.mock("./cost-waiting.js", () => ({ costWaitingIn: vi.fn() }));

const EVENTS = [] as LedgerEvent[];
const WINDOW: [number, number] = [0, 10];

describe("the cost beside waiting figures read against the report's settings", () => {
  it("reads the figures at the published prices, the config's minimum, ceiling and as-of", () => {
    const asOf = new Date(5);

    costWaitingFor(EVENTS, WINDOW, {
      cost: { minMergedChanges: 3 },
      weeklyTokenCeiling: 900,
      asOf,
    });

    expect(costWaitingIn).toHaveBeenCalledWith(EVENTS, WINDOW, {
      prices: MODEL_PRICES,
      minimum: 3,
      weeklyTokenCeiling: 900,
      asOf,
    });
  });

  it("leaves the ceiling absent, which a report reads as not set and never as zero", () => {
    costWaitingFor(EVENTS, WINDOW, {});

    expect(costWaitingIn).toHaveBeenLastCalledWith(EVENTS, WINDOW, {
      prices: MODEL_PRICES,
      minimum: 5,
      weeklyTokenCeiling: undefined,
      asOf: undefined,
    });
  });
});
