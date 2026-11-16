// Fixtures shared by the flow report unit spec. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { FlowReport } from "../flow/index.js";
import type { Ledger } from "../ledger/index.js";
import { contextWith } from "./command-support.js";
import { openLedger } from "./ledger-commands.js";

export const NOW = new Date("2026-01-02T03:04:05Z");
const ROOT = "/repo";

/** A command context with captured output, a fixed clock, and no config file in the checkout. */
export function contextOf(
  options: Record<string, string | boolean> = {},
  json = false,
) {
  const stdout = vi.fn();
  const stderr = vi.fn();
  const root = vi.fn().mockResolvedValue(ROOT);
  const exists = vi.fn().mockResolvedValue(false);
  const readFile = vi.fn();
  const context = contextWith(
    {
      clock: { now: () => NOW },
      root,
      fs: { exists, readFile },
      stdout,
      stderr,
    },
    options,
    json,
  );
  return { context, stdout, stderr, root, exists, readFile };
}

/** Makes the mocked ledger open with these events and this many skipped lines. */
export function ledgerOf(events: unknown[] = [], skipped = 0) {
  // The cast stands in for the ledger's file handling; the report reads only `list`.
  const ledger = {
    list: vi.fn().mockResolvedValue({ events, skipped }),
  } as unknown as Ledger;
  vi.mocked(openLedger).mockResolvedValue({ ledger });
}

/** Send-backs by category with none sent back. */
const emptyCategories = {
  byCategory: {
    declaration: 0,
    "pattern-mismatch": 0,
    "failed-check": 0,
    conflict: 0,
    "missing-proof": 0,
    "rule-break": 0,
    scope: 0,
    other: 0,
  },
  uncategorised: 0,
  otherShare: null,
  otherThreshold: 0.1,
  otherOverThreshold: false,
};

/** A report with nothing in it, so each human line is the one the report prints. */
export function emptyReport(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    asOf: "2026-01-02T03:04:05Z",
    scope: { since: null, until: null, ideas: null },
    ideas: { completed: 2, total: 3 },
    stages: [],
    leadTime: { ideas: [], medianSeconds: null, maxSeconds: null },
    metrics: {
      trailingIdeas: 5,
      tokensPerIdea: {
        status: "insufficient history",
        closedIdeas: 1,
        needed: 3,
      },
      sessionsPerIdea: {
        status: "insufficient history",
        closedIdeas: 1,
        needed: 3,
      },
    },
    rework: {
      trailingIdeas: 5,
      escalationsPerIdea: {
        status: "insufficient history",
        closedIdeas: 1,
        needed: 6,
      },
      sendBacksPerIdea: {
        status: "insufficient history",
        closedIdeas: 1,
        needed: 6,
      },
      frictionPerIdea: {
        status: "insufficient history",
        closedIdeas: 1,
        needed: 6,
      },
    },
    friction: { total: 0, sources: [], unknownKinds: 0 },
    sendBackCategories: {
      perPrHead: emptyCategories,
      perMergedChange: emptyCategories,
    },
    bottleneck: null,
    bottleneckNote: "No bottleneck yet.",
    unmappedEvents: 0,
    attribution: {
      since: null,
      events: 0,
      withIdea: 0,
      withIdeaAndStage: 0,
    },
    guardBlocks: [],
    outcomes: {
      mainRed: { rate: null, failed: 0, runs: 0 },
      reverts: { reverts: 0, merged: 0 },
      liveRuns: { rate: null, passed: 0, runs: 0 },
      ownerMinutes: { perMerged: null, minutes: 0, merged: 0 },
    },
    hostPressure: { trailingDays: 7, samples: 0, levels: [] },
    ...overrides,
    // The cast stands in for the fields the report prints but these tests never read.
  } as unknown as FlowReport;
}

/** Host pressure at two session counts: one with figures above their baseline, one with too little history. */
const POPULATED_HOST = {
  trailingDays: 7,
  samples: 5,
  levels: [
    {
      sessions: 3,
      platform: true,
      samples: 4,
      swap: {
        median: 4.25 * 1024 ** 3,
        peak: 6 * 1024 ** 3,
        baseline: {
          status: "ok",
          samples: 9,
          median: 2 * 1024 ** 3,
          spread: 1024 ** 3,
          worsened: true,
        },
      },
      load: {
        median: 3.456,
        peak: 9,
        baseline: {
          status: "ok",
          samples: 9,
          median: 3,
          spread: 2,
          worsened: false,
        },
      },
    },
    {
      sessions: 1,
      platform: false,
      samples: 1,
      swap: {
        median: null,
        peak: null,
        baseline: {
          status: "insufficient history",
          samples: 0,
          needed: 3,
        },
      },
      load: {
        median: 1,
        peak: 1,
        baseline: {
          status: "insufficient history",
          samples: 0,
          needed: 3,
        },
      },
    },
  ],
} as const;

/** The fixture for a report with every optional section filled in. */
export function populatedReport() {
  return emptyReport({
    scope: { since: "2026-01-01", until: "2026-02-01", ideas: ["#12"] },
    leadTime: { ideas: ["#12"], medianSeconds: 90, maxSeconds: 200 },
    metrics: {
      trailingIdeas: 3,
      tokensPerIdea: {
        currentIdea: "#12",
        current: 120,
        trailingAverage: 100.456,
        worsened: true,
      },
      sessionsPerIdea: {
        currentIdea: "#12",
        current: 2,
        trailingAverage: 2,
        worsened: false,
      },
    },
    attribution: {
      since: "2026-01-01",
      events: 10,
      withIdea: 8,
      withIdeaAndStage: 6,
    },
    outcomes: {
      mainRed: { rate: 0.5, failed: 1, runs: 2 },
      reverts: { reverts: 1, merged: 4 },
      liveRuns: { rate: 1, passed: 3, runs: 3 },
      ownerMinutes: { perMerged: 5, minutes: 20, merged: 4 },
    },
    guardBlocks: [{ rule: "push", blocks: 2 }],
    hostPressure: POPULATED_HOST,
    stages: [
      {
        stage: "review",
        activeSeconds: 60,
        waitingSeconds: 30,
        events: 4,
        wip: { peak: 2, average: 1.5 },
        toil: {
          startingSeconds: 1,
          stoppingSeconds: 2,
          waitingSeconds: 3,
          retryingSeconds: 4,
        },
      },
    ],
  });
}
