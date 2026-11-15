// evaluateIdea for a model-tier idea (#218): cost and judge send-backs are judged together.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdeaRecord } from "../idea/index.js";
import type { Concluded } from "../outcome/index.js";
import { recordOutcome } from "../outcome/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { evaluateIdea, type EvaluateContext } from "./evaluate.js";
import { judgeChange } from "./judge.js";
import { measureChange } from "./measure.js";
import { judgeTier } from "./tier.js";

vi.mock("../outcome/index.js");
vi.mock("./judge.js");
vi.mock("./measure.js");
vi.mock("./tier.js");

const COST = "metrics.tokensPerIdea";
const GUARD = "rework.sendBacksPerIdea";
const RECORD = {
  number: "0007",
  path: "docs/ideas/0007-cheaper.md",
  issue: "300",
  harness: {
    metric: COST,
    direction: "down",
    window: "7d",
    tier: { fields: ["model"], guardMetric: GUARD },
  },
} as IdeaRecord;
const EVENTS = [
  {
    kind: "pr.merged",
    idea: "#300",
    occurredAt: "2026-11-01T00:00:00.000Z",
    number: 55,
  },
] as LedgerEvent[];
const INPUT = {
  ref: "7",
  now: new Date("2026-11-08T00:00:00.000Z"),
  threshold: 0.1,
};
const JUDGEMENT = { result: "confirmed" as const, change: -0.3, reason: "r" };

function context(record: IdeaRecord = RECORD) {
  return {
    repo: { get: vi.fn(() => Promise.resolve(record)) },
    runner: { run: vi.fn() },
  } as unknown as EvaluateContext;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(measureChange).mockImplementation((_events, { metric }) =>
    metric === COST ? { before: 100, after: 70 } : { before: 2, after: 5 },
  );
  vi.mocked(judgeChange).mockReturnValue(JUDGEMENT);
  vi.mocked(judgeTier).mockReturnValue({
    result: "refuted",
    change: -0.3,
    reason: "cost fell but send-backs rose",
  });
  vi.mocked(recordOutcome).mockResolvedValue({ idea: "0007" } as Concluded);
});

describe("evaluateIdea for a tier idea", () => {
  it("measures both metrics over the same windows and records what judgeTier decides", async () => {
    const done = await evaluateIdea(context(), EVENTS, INPUT);
    const at = new Date("2026-11-01T00:00:00.000Z");
    expect(vi.mocked(measureChange).mock.calls.map((c) => c[1])).toEqual([
      { metric: COST, changedAt: at, windowDays: 7 },
      { metric: GUARD, changedAt: at, windowDays: 7 },
    ]);
    expect(judgeChange).toHaveBeenCalledWith({
      direction: "down",
      before: 2,
      after: 5,
      threshold: 0.1,
    });
    expect(done).toMatchObject({
      status: "recorded",
      result: "refuted",
      before: 100,
      after: 70,
      guard: { metric: GUARD, before: 2, after: 5 },
      changedByPr: 55,
    });
  });

  it("hands judgeTier the cost judgement and the send-backs judgement and figures", async () => {
    await evaluateIdea(context(), EVENTS, INPUT);
    expect(judgeTier).toHaveBeenCalledWith({
      cost: JUDGEMENT,
      guard: { judgement: JUDGEMENT, before: 2, after: 5 },
      guardMetric: GUARD,
    });
  });

  it("records both metrics' figures in the outcome summary", async () => {
    await evaluateIdea(context(), EVENTS, INPUT);
    expect(vi.mocked(recordOutcome).mock.calls[0]?.[2]).toEqual({
      kind: "experiment",
      source: "comparison",
      result: "refuted",
      evidence: `ledger flow metrics ${COST} and ${GUARD}: 7d before 2026-11-01T00:00:00.000Z against the 7d after`,
      summary: `${COST} went from 100 to 70 and ${GUARD} from 2 to 5 (expected cost down with send-backs not up, noise threshold 10%): cost fell but send-backs rose.`,
    });
  });

  it("measures only the cost metric for a harness idea with no tier", async () => {
    const harness = { metric: COST, direction: "down", window: "7d" };
    await evaluateIdea(
      context({ ...RECORD, harness } as IdeaRecord),
      EVENTS,
      INPUT,
    );
    expect(measureChange).toHaveBeenCalledTimes(1);
    expect(judgeTier).not.toHaveBeenCalled();
  });

  it("never records a second outcome on a rerun of a tier idea that already has one", async () => {
    const done = await evaluateIdea(
      context({ ...RECORD, outcome: "refuted" }),
      EVENTS,
      INPUT,
    );
    expect(done).toEqual({
      status: "already-recorded",
      idea: "0007",
      result: "refuted",
    });
    expect(measureChange).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
  });
});
