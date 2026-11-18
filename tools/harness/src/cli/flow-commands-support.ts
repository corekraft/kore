// Fixtures shared by the flow report unit spec. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import {
  emptyLeadTimePerMergedChange,
  emptyWriterArms,
} from "./flow-commands-merged-support.js";
import { STAGES, type FlowReport } from "../flow/index.js";
import type { Ledger } from "../ledger/index.js";
import { EMPTY_ADVISOR, POPULATED_ADVISOR } from "./flow-advisor-support.js";
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

/** Send-backs by category with none sent back, for one scope of the report. */
const emptyCategories = {
  byCategory: {
    declaration: 0,
    "pattern-mismatch": 0,
    "failed-check": 0,
    conflict: 0,
    "missing-proof": 0,
    "rule-break": 0,
    scope: 0,
    "wrong-statement": 0,
    other: 0,
  },
  uncategorised: 0,
  otherShare: null,
  otherThreshold: 0.1,
  otherOverThreshold: false,
};

/** Send-backs by category for both scopes of the report, with none sent back. */
const emptyCategoryReport = {
  perPrHead: emptyCategories,
  perMergedChange: emptyCategories,
};

/** Review misses with no review in the range, so neither figure is read. */
const NO_REVIEWS = {
  trailingDays: 7,
  reviews: 0,
  unrecorded: 0,
  passedRuleBreak: {
    count: 0,
    ratio: null,
    trailingAverage: null,
    worsened: false,
  },
  foundViolation: { count: 0, share: null, trailingAverage: null },
  resample: { count: 0, found: 0, share: null },
};

/** Tokens per merged change with no merged change in either span, so neither figure is read. */
const emptyTokensPerMergedChange = {
  trailingDays: 7,
  minMergedChanges: 5,
  current: { status: "insufficient merged changes", merged: 0, needed: 5 },
  trailingAverage: {
    status: "insufficient merged changes",
    merged: 0,
    needed: 5,
  },
};

/** A per-idea rework metric with too little history to compare. */
const INSUFFICIENT_REWORK = {
  status: "insufficient history",
  closedIdeas: 1,
  needed: 6,
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
      escalationsPerIdea: INSUFFICIENT_REWORK,
      sendBacksPerIdea: INSUFFICIENT_REWORK,
      frictionPerIdea: INSUFFICIENT_REWORK,
      followUpsPerWriterSession: INSUFFICIENT_REWORK,
      mainFollowUpsPerWriterSession: INSUFFICIENT_REWORK,
      followUps: { writerSessions: 0, bySender: [] },
    },
    friction: { total: 0, sources: [], unknownKinds: 0 },
    sendBackCategories: emptyCategoryReport,
    bottleneck: null,
    bottleneckNote: "No bottleneck yet.",
    unmappedEvents: 0,
    attribution: {
      since: null,
      events: 0,
      withIdea: 0,
      withIdeaAndStage: 0,
      noRoleShare: null,
    },
    guardBlocks: [],
    outcomes: {
      mainRed: { rate: null, failed: 0, runs: 0 },
      reverts: { reverts: 0, merged: 0 },
      liveRuns: { rate: null, passed: 0, runs: 0 },
      ownerMinutes: { perMerged: null, minutes: 0, merged: 0 },
    },
    hostPressure: { trailingDays: 7, samples: 0, levels: [] },
    ownerQuestions: {
      trailingDays: 7,
      questions: 0,
      merged: 0,
      perMerged: null,
      trailingAverage: null,
      worsened: false,
    },
    ...EMPTY_ADVISOR,
    tokensPerMergedChange: emptyTokensPerMergedChange,
    sendBacksPerMergedChange: emptyTokensPerMergedChange,
    leadTimePerMergedChange: emptyLeadTimePerMergedChange,
    writerCost: { pricesAsOf: "2026-11-17", ...emptyTokensPerMergedChange },
    writerArms: emptyWriterArms,
    tokensByStage: Object.fromEntries(STAGES.map((stage) => [stage, 0])),
    tokensByStagePerMergedChange: emptyTokensPerMergedChange,
    reviewMisses: NO_REVIEWS,
    handovers: { status: "insufficient", reason: "no handover source" },
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

/** Review misses with reviews in the range and a trailing average, for the populated fixture. */
const POPULATED_REVIEWS = {
  trailingDays: 7,
  reviews: 4,
  unrecorded: 0,
  passedRuleBreak: {
    count: 1,
    ratio: 0.25,
    trailingAverage: 0.1,
    worsened: true,
  },
  foundViolation: { count: 2, share: 0.5, trailingAverage: 0.2 },
  resample: { count: 3, found: 1, share: 0.3333 },
};

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
      noRoleShare: 0.25,
    },
    outcomes: {
      mainRed: { rate: 0.5, failed: 1, runs: 2 },
      reverts: { reverts: 1, merged: 4 },
      liveRuns: { rate: 1, passed: 3, runs: 3 },
      ownerMinutes: { perMerged: 5, minutes: 20, merged: 4 },
    },
    guardBlocks: [{ rule: "push", blocks: 2 }],
    reviewMisses: POPULATED_REVIEWS,
    hostPressure: POPULATED_HOST,
    ownerQuestions: {
      trailingDays: 7,
      questions: 6,
      merged: 4,
      perMerged: 1.5,
      trailingAverage: 1,
      worsened: true,
    },
    ...POPULATED_ADVISOR,
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
