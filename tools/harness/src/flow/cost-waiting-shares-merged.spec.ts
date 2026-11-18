import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { allInOf } from "./cost-waiting-merged.js";
import { levelOf, readingOf } from "./cost-waiting-shares.js";
import { mergedSharesIn } from "./cost-waiting-shares-merged.js";
import type { MergedChangeFigure } from "./cost-waiting-types.js";
import { planPricesOf } from "./plan-prices.js";
import {
  writerDollarsIn,
  type MergedChangeDollars,
  type WriterDollars,
} from "./writer-attribution.js";

// Everything outside the unit is mocked: the writer cost attribution read at the plan prices (its
// dollars are weighted tokens), the all-in sum of a change, and the share arithmetic.
vi.mock("./writer-attribution.js", () => ({ writerDollarsIn: vi.fn() }));
vi.mock("./cost-waiting-merged.js", () => ({ allInOf: vi.fn() }));
vi.mock("./plan-prices.js", () => ({ planPricesOf: vi.fn() }));
vi.mock("./cost-waiting-shares.js", () => ({
  readingOf: vi.fn(),
  levelOf: vi.fn(),
}));

const PLAN_PRICES = { "plan-model": {} } as never;
const WINDOW: [number, number] = [0, 10];
const OPTIONS = { prices: {}, minimum: 2, weeklyTokenCeiling: 100 };
const EVENTS = [] as LedgerEvent[];
const SIZE = "of one week's ceiling";

const figure = (
  number: number,
  over: Partial<MergedChangeFigure> = {},
): MergedChangeFigure => ({
  number,
  joined: true,
  dollars: 1,
  tokens: 1,
  launchToMergeSeconds: 3600,
  waitSeconds: 60,
  ...over,
});

const change = (
  number: number,
  over: Partial<MergedChangeDollars> = {},
): MergedChangeDollars => ({
  number,
  tier: "haiku",
  writer: 0,
  reviewer: 0,
  unpriced: [],
  ...over,
});

const attribution = (
  changes: MergedChangeDollars[],
  shared: Partial<WriterDollars["shared"]> = {},
): WriterDollars =>
  ({
    changes,
    shared: {
      judge: 0,
      orchestrate: 0,
      judgeUnpriced: [],
      orchestrateUnpriced: [],
      ...shared,
    },
    unmergedWriterSessions: 0,
  }) as WriterDollars;

beforeEach(() => {
  vi.mocked(planPricesOf).mockReturnValue(PLAN_PRICES);
  // The all-in weighted tokens of change N are N * 10 in this fake.
  vi.mocked(allInOf).mockImplementation((c) => c.number * 10);
  vi.mocked(readingOf).mockImplementation(
    (label, unit, { ceiling }) =>
      ({
        label,
        status: "measured",
        share: ceiling === undefined ? "not set" : unit.plan / ceiling,
        spanSeconds: unit.spanSeconds ?? null,
      }) as never,
  );
  vi.mocked(levelOf).mockImplementation(
    (label, units, { minimum }) =>
      ({
        label,
        status: "measured",
        units: units.length,
        needed: minimum,
        total: units.reduce((sum, u) => sum + u.plan, 0) / 100,
        median: null,
        p90: null,
      }) as never,
  );
});

describe("merged-change shares: a change's total weighted tokens over one week's ceiling", () => {
  it("reads two merged changes as a size, each with its launch-to-merge span beside the share", () => {
    vi.mocked(writerDollarsIn).mockReturnValue(
      attribution([change(2), change(3)]),
    );

    const shares = mergedSharesIn(EVENTS, WINDOW, OPTIONS, [
      figure(2, { launchToMergeSeconds: 600 }),
      figure(3),
    ]);

    expect(writerDollarsIn).toHaveBeenCalledWith(EVENTS, WINDOW, PLAN_PRICES);
    expect(shares.rows).toEqual([
      {
        number: 2,
        share: {
          label: SIZE,
          status: "measured",
          share: 0.2,
          spanSeconds: 600,
        },
      },
      {
        number: 3,
        share: {
          label: SIZE,
          status: "measured",
          share: 0.3,
          spanSeconds: 3600,
        },
      },
    ]);
    expect(levelOf).toHaveBeenCalledWith(
      SIZE,
      [
        { plan: 20, unweighted: [], spanSeconds: 600 },
        { plan: 30, unweighted: [], spanSeconds: 3600 },
      ],
      { ceiling: 100, minimum: 2 },
    );
    expect(shares).toMatchObject({ total: 0.5 });
  });

  it("gives a change no writer launch joins no share, never zero, and leaves it out of the level", () => {
    vi.mocked(writerDollarsIn).mockReturnValue(
      attribution([change(2), change(3, { writer: undefined })]),
    );

    const shares = mergedSharesIn(EVENTS, WINDOW, OPTIONS, [
      figure(2),
      figure(3, { joined: false, launchToMergeSeconds: null }),
    ]);

    expect(shares.rows[1]).toEqual({ number: 3, share: null });
    expect(levelOf).toHaveBeenCalledWith(
      SIZE,
      [{ plan: 20, unweighted: [], spanSeconds: 3600 }],
      { ceiling: 100, minimum: 2 },
    );
  });
});

describe("merged-change shares: a model with no plan weight and a missing ceiling are never a zero", () => {
  it("names a model with no plan weight in the change or in the shared judge and orchestrating spend", () => {
    vi.mocked(writerDollarsIn).mockReturnValue(
      attribution([change(2, { unpriced: ["own-mystery"] })], {
        judgeUnpriced: ["judge-mystery"],
        orchestrateUnpriced: ["main-mystery"],
      }),
    );

    mergedSharesIn(EVENTS, WINDOW, OPTIONS, [figure(2)]);

    expect(readingOf).toHaveBeenCalledWith(
      SIZE,
      {
        plan: 20,
        unweighted: ["own-mystery", "judge-mystery", "main-mystery"],
        spanSeconds: 3600,
      },
      { ceiling: 100 },
    );
  });

  it("passes no ceiling through when the config names none, so every share reads not set", () => {
    vi.mocked(writerDollarsIn).mockReturnValue(attribution([change(2)]));

    const shares = mergedSharesIn(
      EVENTS,
      WINDOW,
      { ...OPTIONS, weeklyTokenCeiling: undefined },
      [figure(2)],
    );

    expect(shares.rows[0]?.share).toMatchObject({ share: "not set" });
  });
});
