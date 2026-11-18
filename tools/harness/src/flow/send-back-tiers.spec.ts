import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEND_BACK_CATEGORIES,
  type Kind,
  type LedgerEvent,
  type SendBackCategory,
} from "../ledger/index.js";
import { sendBackTiersIn } from "./send-back-tiers.js";
import {
  sendBackCategories,
  type CategoryCounts,
} from "./send-back-categories.js";
import {
  linkedAgents,
  mergedTierJoins,
  pricedLaunches,
  tierOfLinked,
} from "./writer-join.js";
import { reworkSendsIn } from "./writer-tier-figures.js";

vi.mock("./send-back-categories.js");
vi.mock("./writer-join.js");
vi.mock("./writer-tier-figures.js");

const SPAN: [number, number] = [0, 1000];
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
const TIERS = [HAIKU, SONNET];
const MINIMUM = 7;
const WRITER_TIER: Record<string, string> = {
  "h-writer": HAIKU,
  "s-writer": SONNET,
};

const NONE = Object.fromEntries(
  SEND_BACK_CATEGORIES.map((c) => [c, 0]),
) as Record<SendBackCategory, number>;

/** Counts as the send-back categories module reads them: each send-back in its category, none without one. */
function countsOf(events: LedgerEvent[]): CategoryCounts {
  const byCategory = { ...NONE };
  let uncategorised = 0;
  for (const e of events) {
    if (e.category === undefined) {
      uncategorised += 1;
    } else {
      byCategory[e.category] += 1;
    }
  }
  return {
    byCategory,
    legacy: 0,
    uncategorised,
    otherThreshold: 0.1,
    categorised: 0,
    otherShare: null,
    minCategorised: MINIMUM,
    otherReading: "insufficient",
    otherOverThreshold: false,
  };
}
const EMPTY = countsOf([]);

let seq = 0;
/** A judge send-back on a pull request, or with no pull request when no number is given. */
function sendBack(
  number: number | undefined,
  category?: SendBackCategory,
): LedgerEvent {
  seq += 1;
  return {
    schema: 1,
    id: `sb${seq}`,
    source: "github",
    kind: "send-back" as Kind,
    occurredAt: new Date(100).toISOString(),
    recordedAt: new Date(100).toISOString(),
    ...(number === undefined ? {} : { number }),
    ...(category === undefined ? {} : { category }),
  };
}

/** Pull requests linked to writer sessions; each session joins to the tier WRITER_TIER names for it. */
function linkWriters(links: [number, string][]) {
  vi.mocked(linkedAgents).mockReturnValue(new Map(links));
  vi.mocked(tierOfLinked).mockImplementation(
    (_launches, agent) => WRITER_TIER[agent],
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(pricedLaunches).mockReturnValue([]);
  vi.mocked(linkedAgents).mockReturnValue(new Map());
  vi.mocked(tierOfLinked).mockReturnValue(undefined);
  vi.mocked(mergedTierJoins).mockReturnValue({
    joined: new Map(),
    numbers: new Map(),
    unjoinable: 0,
  });
  vi.mocked(reworkSendsIn).mockReturnValue(new Map());
  vi.mocked(sendBackCategories).mockImplementation(countsOf);
});

describe("send-backs by writer tier: a send-back counts on the tier its pull request joins to", () => {
  it("gives each send-back to the tier its pull request's writer joins to, and to no other tier", () => {
    linkWriters([
      [100, "h-writer"],
      [200, "s-writer"],
    ]);

    const tiers = sendBackTiersIn(
      [sendBack(100, "scope"), sendBack(200, "failed-check")],
      SPAN,
      TIERS,
      MINIMUM,
    ).tiers;

    expect(tiers[HAIKU]?.sendBacks.byCategory).toEqual({ ...NONE, scope: 1 });
    expect(tiers[SONNET]?.sendBacks.byCategory).toEqual({
      ...NONE,
      "failed-check": 1,
    });
  });

  it("reads every tier row and the unlinked row against the categorised send-back minimum it is given (#1094)", () => {
    linkWriters([[100, "h-writer"]]);

    sendBackTiersIn([sendBack(100), sendBack(300)], SPAN, TIERS, MINIMUM);

    // Two tier rows and the unlinked row: three reads, each against the minimum.
    expect(vi.mocked(sendBackCategories).mock.calls.map((c) => c[2])).toEqual([
      MINIMUM,
      MINIMUM,
      MINIMUM,
    ]);
  });

  it("counts a send-back with no category as uncategorised in its tier's row, never as another category", () => {
    linkWriters([[100, "h-writer"]]);

    const haiku = sendBackTiersIn([sendBack(100)], SPAN, TIERS, MINIMUM).tiers[
      HAIKU
    ];

    expect(haiku?.sendBacks).toEqual({ ...EMPTY, uncategorised: 1 });
  });
});

describe("unlinked row: a change with no writer link is in the unlinked row and in no tier", () => {
  it("puts a send-back on a pull request with no writer link in the unlinked row, and no tier's row", () => {
    vi.mocked(mergedTierJoins).mockReturnValue({
      joined: new Map(),
      numbers: new Map(),
      unjoinable: 1,
    });

    const result = sendBackTiersIn(
      [sendBack(300, "rule-break")],
      SPAN,
      TIERS,
      MINIMUM,
    );

    expect(result.unlinked.sendBacks.byCategory).toEqual({
      ...NONE,
      "rule-break": 1,
    });
    expect(result.tiers[HAIKU]?.sendBacks).toEqual(EMPTY);
    expect(result.tiers[SONNET]?.sendBacks).toEqual(EMPTY);
  });

  it("keeps a send-back with no pull request number in the unlinked row, never dropped", () => {
    const result = sendBackTiersIn(
      [sendBack(undefined, "other")],
      SPAN,
      TIERS,
      MINIMUM,
    );

    expect(result.unlinked.sendBacks.byCategory).toEqual({
      ...NONE,
      other: 1,
    });
  });

  it("counts the merged changes that join to no tier in the unlinked row, and in no tier's row", () => {
    vi.mocked(mergedTierJoins).mockReturnValue({
      joined: new Map(),
      numbers: new Map(),
      unjoinable: 2,
    });

    const result = sendBackTiersIn([], SPAN, TIERS, MINIMUM);

    expect(result.unlinked.mergedChanges).toBe(2);
    expect(result.tiers[HAIKU]?.mergedChanges).toBe(0);
  });

  it("gives the unlinked row no rework figure, since a send to a pane with no tier is not read", () => {
    const result = sendBackTiersIn([], SPAN, TIERS, MINIMUM);

    expect(result.unlinked).not.toHaveProperty("rework");
  });
});

describe("merged changes and rework of a tier: each figure with the count it is read over", () => {
  it("reads a tier's merged changes from the join, and its rework over them", () => {
    vi.mocked(mergedTierJoins).mockReturnValue({
      joined: new Map([[HAIKU, 2]]),
      numbers: new Map(),
      unjoinable: 0,
    });
    vi.mocked(reworkSendsIn).mockReturnValue(new Map([[HAIKU, 3]]));

    expect(sendBackTiersIn([], SPAN, TIERS, MINIMUM).tiers[HAIKU]).toEqual({
      mergedChanges: 2,
      sendBacks: EMPTY,
      rework: 3,
      reworkPerMergedChange: 1.5,
    });
  });

  it("reads a tier's rework per merged change as not read, never zero, while its rework count stays", () => {
    vi.mocked(reworkSendsIn).mockReturnValue(new Map([[SONNET, 1]]));

    expect(sendBackTiersIn([], SPAN, TIERS, MINIMUM).tiers[SONNET]).toEqual({
      mergedChanges: 0,
      sendBacks: EMPTY,
      rework: 1,
      reworkPerMergedChange: null,
    });
  });

  it("gives a tier with nothing in the span a row of zero counts, with its rate not read", () => {
    expect(sendBackTiersIn([], SPAN, TIERS, MINIMUM).tiers[HAIKU]).toEqual({
      mergedChanges: 0,
      sendBacks: EMPTY,
      rework: 0,
      reworkPerMergedChange: null,
    });
  });
});
