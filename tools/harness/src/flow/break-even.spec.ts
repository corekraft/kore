import { beforeEach, describe, expect, it, vi } from "vitest";
import { breakEvenIn } from "./break-even.js";
import { reworkByChange } from "./change-rework.js";
import {
  tierDollarsIn,
  writerDollarsIn,
  type MergedChangeDollars,
  type TierDollars,
  type WriterDollars,
} from "./writer-attribution.js";
import { median } from "./wip.js";

vi.mock("./change-rework.js");
vi.mock("./wip.js");
vi.mock("./writer-attribution.js");

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const SPAN: [number, number] = [0, 1000];
const MINIMUM = 3;

/** A merged change joined to a tier whose own part (writer plus reviewer) is `own` dollars. */
const change = (
  number: number,
  tier: string | undefined,
  own: number,
): MergedChangeDollars => ({
  number,
  tier,
  writer: tier === undefined ? undefined : own,
  reviewer: 0,
  unpriced: [],
});

/** The dollars of a span: the given changes and a shared part of `shared` dollars over all of them. */
const dollars = (
  changes: MergedChangeDollars[],
  shared = 0,
): WriterDollars => ({
  changes,
  shared: {
    judge: shared,
    orchestrate: 0,
    judgeUnpriced: [],
    orchestrateUnpriced: [],
    orchestrateBasis: {
      basis: "none",
      recordedModels: [],
      assumedTokens: 0,
    },
  },
  unmergedWriterSessions: 0,
});

const tierDollars = (middle: number): TierDollars => ({
  writer: 0,
  reviewer: 0,
  judge: 0,
  orchestrate: 0,
  allIn: 0,
  median: middle,
});

/** The median of numbers, as the wip module reads it, mocked here as a plain middle value. */
const plainMedian = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};

function read(
  changes: MergedChangeDollars[],
  rework: [number, number][],
  sonnetMedian = 1,
  shared = 0,
) {
  vi.mocked(writerDollarsIn).mockReturnValue(dollars(changes, shared));
  vi.mocked(reworkByChange).mockReturnValue(new Map(rework));
  vi.mocked(tierDollarsIn).mockImplementation((_dollars, tier) =>
    tier === SONNET ? tierDollars(sonnetMedian) : tierDollars(0),
  );
  return breakEvenIn([], SPAN, MINIMUM);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(median).mockImplementation(plainMedian);
});

const SONNETS = [
  change(21, SONNET, 1),
  change(22, SONNET, 1),
  change(23, SONNET, 1),
];
const FEW_HAIKU = [change(11, HAIKU, 0.25), change(12, HAIKU, 0.25)];
const ENOUGH_HAIKU = [
  ...FEW_HAIKU,
  change(13, HAIKU, 0.25),
  change(14, HAIKU, 1),
];

describe("breakEvenIn: the rework rounds per merged change at which Haiku's median cost reaches Sonnet's (#1051)", () => {
  it("divides the gap between Sonnet's median and Haiku's no-rework median by what one rework round adds", () => {
    // Haiku with no rework: 0.25, 0.25, 0.25 (median 0.25); with one round: 1.0 (median 1.0).
    // One round adds 0.75; Sonnet's median is 0.75 above the no-rework median: break-even 1.
    const haikus = [
      change(11, HAIKU, 0.25),
      change(12, HAIKU, 0.25),
      change(13, HAIKU, 0.25),
      change(14, HAIKU, 1),
    ];

    const figure = read([...haikus, ...SONNETS], [[14, 1]], 1);

    expect(figure).toEqual({
      status: "ok",
      needed: MINIMUM,
      haiku: {
        tier: HAIKU,
        mergedChanges: 4,
        noRework: { changes: 3, median: 0.25 },
        oneRound: { changes: 1, median: 1 },
      },
      sonnet: { tier: SONNET, mergedChanges: 3, median: 1 },
      costPerReworkRound: 0.75,
      reworkRoundsPerMergedChange: 1,
    });
  });

  it("adds each change's share of the judge and orchestrating spend to its own dollars before taking medians", () => {
    const haikus = [
      change(11, HAIKU, 0.25),
      change(12, HAIKU, 0.25),
      change(13, HAIKU, 0.25),
      change(14, HAIKU, 1),
    ];
    // Seven changes share 7 dollars: 1 dollar each.
    const figure = read([...haikus, ...SONNETS], [[14, 1]], 2, 7);

    expect(figure).toMatchObject({
      status: "ok",
      haiku: {
        noRework: { median: 1.25 },
        oneRound: { median: 2 },
      },
    });
  });
});

describe("breakEvenIn: which changes are read", () => {
  it("reads only changes with exactly one rework round as the one-round group, not those with two", () => {
    const haikus = [
      change(11, HAIKU, 0.25),
      change(12, HAIKU, 0.25),
      change(13, HAIKU, 0.25),
      change(14, HAIKU, 1),
      change(15, HAIKU, 9),
    ];

    const figure = read(
      [...haikus, ...SONNETS],
      [
        [14, 1],
        [15, 2],
      ],
      1,
    );

    expect(figure).toMatchObject({
      haiku: { oneRound: { changes: 1, median: 1 } },
    });
  });

  it("does not give a change with no joined tier to either tier", () => {
    const haikus = [
      change(11, HAIKU, 0.25),
      change(12, HAIKU, 0.25),
      change(13, HAIKU, 0.25),
      change(14, HAIKU, 1),
    ];

    const figure = read(
      [...haikus, ...SONNETS, change(31, undefined, 50)],
      [[14, 1]],
      1,
    );

    expect(figure).toMatchObject({
      haiku: { mergedChanges: 4 },
      sonnet: { mergedChanges: 3 },
    });
  });

  it("rounds the break-even to four places", () => {
    const haikus = [
      change(11, HAIKU, 0.2),
      change(12, HAIKU, 0.2),
      change(13, HAIKU, 0.2),
      change(14, HAIKU, 0.5),
    ];

    const figure = read([...haikus, ...SONNETS], [[14, 1]], 0.4);

    expect(figure).toMatchObject({
      costPerReworkRound: 0.3,
      reworkRoundsPerMergedChange: 0.6667,
    });
  });
});

describe("breakEvenIn: when a tier has too few merged changes or cannot be priced", () => {
  it("reports a tier with fewer merged changes than the minimum as insufficient, with no break-even and no median", () => {
    const figure = read([...FEW_HAIKU, ...SONNETS], [[11, 1]]);

    expect(figure).toEqual({
      status: "insufficient merged changes",
      needed: MINIMUM,
      haiku: { tier: HAIKU, mergedChanges: 2 },
      sonnet: { tier: SONNET, mergedChanges: 3 },
    });
  });

  it("reports the Sonnet tier as insufficient when it is the one below the minimum", () => {
    const figure = read([...ENOUGH_HAIKU, change(21, SONNET, 1)], [[14, 1]]);

    expect(figure).toMatchObject({
      status: "insufficient merged changes",
      haiku: { mergedChanges: 4 },
      sonnet: { mergedChanges: 1 },
    });
  });

  it("reports a tier with no merged change as insufficient even when the minimum is zero", () => {
    vi.mocked(writerDollarsIn).mockReturnValue(dollars([]));
    vi.mocked(reworkByChange).mockReturnValue(new Map());

    expect(breakEvenIn([], SPAN, 0)).toMatchObject({
      status: "insufficient merged changes",
      haiku: { mergedChanges: 0 },
      sonnet: { mergedChanges: 0 },
    });
  });

  it("names the unpriced models and reads no break-even when a tier's dollars cannot be priced", () => {
    vi.mocked(writerDollarsIn).mockReturnValue(
      dollars([...ENOUGH_HAIKU, ...SONNETS]),
    );
    vi.mocked(reworkByChange).mockReturnValue(new Map([[14, 1]]));
    vi.mocked(tierDollarsIn).mockImplementation((_d, tier) =>
      tier === HAIKU
        ? { status: "insufficient prices", models: ["claude-x"] }
        : tierDollars(1),
    );

    expect(breakEvenIn([], SPAN, MINIMUM)).toEqual({
      status: "insufficient prices",
      models: ["claude-x"],
    });
  });
});

describe("breakEvenIn: why a break-even cannot be read from the medians", () => {
  it("says why when Haiku has no change without rework", () => {
    const figure = read(
      [...ENOUGH_HAIKU, ...SONNETS],
      [
        [11, 1],
        [12, 1],
        [13, 1],
        [14, 1],
      ],
    );

    expect(figure).toMatchObject({
      status: "not read",
      reason: "no Haiku change without rework",
      haiku: { noRework: { changes: 0, median: null } },
    });
  });

  it("says why when Haiku has no change with exactly one rework round", () => {
    const figure = read([...ENOUGH_HAIKU, ...SONNETS], []);

    expect(figure).toMatchObject({
      status: "not read",
      reason: "no Haiku change with one rework round",
      haiku: { oneRound: { changes: 0, median: null } },
    });
  });

  it("says why when a rework round does not add to Haiku's median cost, never dividing by zero", () => {
    const flat = [
      change(11, HAIKU, 0.5),
      change(12, HAIKU, 0.5),
      change(13, HAIKU, 0.5),
      change(14, HAIKU, 0.5),
    ];

    const figure = read([...flat, ...SONNETS], [[14, 1]]);

    expect(figure).toMatchObject({
      status: "not read",
      reason: "a rework round does not add to Haiku's median cost",
    });
    expect(figure).not.toHaveProperty("reworkRoundsPerMergedChange");
  });

  it("says why when Haiku's no-rework median is already above Sonnet's median, never a negative break-even", () => {
    const dear = [
      change(11, HAIKU, 3),
      change(12, HAIKU, 3),
      change(13, HAIKU, 3),
      change(14, HAIKU, 4),
    ];

    const figure = read([...dear, ...SONNETS], [[14, 1]], 1);

    expect(figure).toMatchObject({
      status: "not read",
      reason: "Haiku's median without rework is above Sonnet's median",
    });
    expect(figure).not.toHaveProperty("reworkRoundsPerMergedChange");
  });
});
