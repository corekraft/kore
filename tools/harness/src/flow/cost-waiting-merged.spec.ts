import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { mergedChangesIn } from "./cost-waiting-merged.js";
import { linkedAgents } from "./writer-join.js";
import { writerDollarsIn, type WriterDollars } from "./writer-attribution.js";

vi.mock("./writer-attribution.js", () => ({ writerDollarsIn: vi.fn() }));
vi.mock("./writer-join.js", () => ({ linkedAgents: vi.fn() }));
vi.mock("./cost-waiting-support.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cost-waiting-support.js")>()),
  tokenPricesOf: vi.fn(() => ({})),
}));
vi.mock("./github-waits.js", () => ({
  time: (event: LedgerEvent) => Date.parse(event.occurredAt),
  firstTime: (events: LedgerEvent[], match: (e: LedgerEvent) => boolean) =>
    events
      .filter(match)
      .map((e) => Date.parse(e.occurredAt))
      .sort((a, b) => a - b)[0],
}));

const MINUTE = 60_000;
const BASE = Date.parse("2026-11-18T10:00:00Z");
const at = (minute: number) => new Date(BASE + minute * MINUTE).toISOString();
const WINDOW: [number, number] = [BASE - MINUTE, BASE + 100 * MINUTE];
const ledger = (fields: Partial<LedgerEvent>) => fields as LedgerEvent;
const EVENTS: LedgerEvent[] = [
  ledger({ kind: "session.launch", agent: "idea-7-writer", occurredAt: at(0) }),
  ledger({ kind: "pr.opened", number: 100, occurredAt: at(5) }),
  ledger({ kind: "pr.merged", number: 100, occurredAt: at(30) }),
  ledger({ kind: "pr.merged", number: 101, occurredAt: at(50) }),
];

const attributed = (writer: number, reviewer: number): WriterDollars => ({
  changes: [
    { number: 100, tier: "haiku", writer, reviewer, unpriced: [] },
    {
      number: 101,
      tier: undefined,
      writer: undefined,
      reviewer: 0,
      unpriced: [],
    },
  ],
  shared: {
    judge: 0,
    orchestrate: 0,
    judgeUnpriced: [],
    orchestrateUnpriced: [],
    orchestrateBasis: { basis: "none", recordedModels: [], assumedTokens: 0 },
  },
  unmergedWriterSessions: 0,
});

const OPTIONS = { prices: {}, minimum: 1 };

describe("merged change rows: all-in figures and their times", () => {
  beforeEach(() => {
    vi.mocked(linkedAgents).mockReturnValue(new Map([[100, "idea-7-writer"]]));
    vi.mocked(writerDollarsIn)
      .mockReturnValueOnce(attributed(7, 1))
      .mockReturnValueOnce(attributed(3_000_000, 1_000_000));
  });

  it("reads each change's all-in dollars and tokens, its launch-to-merge and its open-to-merge seconds", () => {
    const merged = mergedChangesIn(EVENTS, WINDOW, OPTIONS);

    expect(merged.changes).toEqual([
      {
        number: 100,
        joined: true,
        dollars: 8,
        tokens: 4_000_000,
        launchToMergeSeconds: 1800,
        waitSeconds: 1500,
      },
      {
        number: 101,
        joined: false,
        dollars: null,
        tokens: null,
        launchToMergeSeconds: null,
        waitSeconds: null,
      },
    ]);
  });

  it("measures the joined changes' median and p90 once the joined count reaches the minimum", () => {
    const merged = mergedChangesIn(EVENTS, WINDOW, OPTIONS);

    expect(merged).toMatchObject({
      status: "measured",
      joined: 1,
      needed: 1,
      dollars: { total: 8, median: 8, p90: 8 },
      tokens: { total: 4_000_000, median: 4_000_000, p90: 4_000_000 },
    });
  });

  it("reads the merged changes as insufficient, with no summary, below the minimum joined", () => {
    const merged = mergedChangesIn(EVENTS, WINDOW, { prices: {}, minimum: 2 });

    expect(merged.status).toBe("insufficient");
    expect(merged).not.toHaveProperty("dollars");
    expect(merged.joined).toBe(1);
  });
});

describe("an unpriced model is named, never read as zero", () => {
  beforeEach(() => {
    vi.mocked(linkedAgents).mockReturnValue(new Map([[100, "idea-7-writer"]]));
  });

  const withUnpriced = (
    change: string[],
    judge: string[],
    orchestrate: string[],
  ): WriterDollars => {
    const base = attributed(7, 1);
    return {
      ...base,
      changes: base.changes.map((c) =>
        c.number === 100 ? { ...c, unpriced: change } : c,
      ),
      shared: {
        ...base.shared,
        judgeUnpriced: judge,
        orchestrateUnpriced: orchestrate,
      },
    };
  };
  const reading = (dollars: WriterDollars) => {
    vi.mocked(writerDollarsIn)
      .mockReset()
      .mockReturnValueOnce(dollars)
      .mockReturnValueOnce(attributed(3_000_000, 1_000_000));
    return mergedChangesIn(EVENTS, WINDOW, OPTIONS);
  };

  it("reads insufficient prices naming a joined change's model, with no summary and its dollars null", () => {
    const merged = reading(withUnpriced(["zeta"], [], []));

    expect(merged).toMatchObject({
      status: "insufficient prices",
      models: ["zeta"],
      joined: 1,
    });
    expect(merged).not.toHaveProperty("dollars");
    expect(merged).not.toHaveProperty("tokens");
    expect(merged.changes[0]?.dollars).toBeNull();
    expect(merged.changes[0]?.tokens).toBe(4_000_000);
  });

  it("names the shared judge and orchestrating models too, sorted and each once", () => {
    const merged = reading(withUnpriced(["b"], ["b", "a"], ["c"]));

    expect(merged).toMatchObject({
      status: "insufficient prices",
      models: ["a", "b", "c"],
    });
  });

  it("nulls every joined change's dollars when only the shared spend is unpriced", () => {
    const merged = reading(withUnpriced([], ["a"], []));

    expect(merged.status).toBe("insufficient prices");
    expect(merged.changes[0]?.dollars).toBeNull();
  });

  it("checks prices before the minimum, so too few joined changes still name the model", () => {
    vi.mocked(writerDollarsIn)
      .mockReset()
      .mockReturnValueOnce(withUnpriced(["zeta"], [], []))
      .mockReturnValueOnce(attributed(1, 1));

    const merged = mergedChangesIn(EVENTS, WINDOW, {
      prices: {},
      minimum: 5,
    });

    expect(merged.status).toBe("insufficient prices");
    expect(merged.models).toEqual(["zeta"]);
  });
});
