import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeaError } from "../idea/index.js";
import type { IdeaRecord } from "../idea/index.js";
import type { Concluded } from "../outcome/index.js";
import { recordOutcome } from "../outcome/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { evaluateIdea, type EvaluateContext } from "./evaluate.js";
import { judgeChange } from "./judge.js";
import { measureChange } from "./measure.js";

vi.mock("../outcome/index.js");
vi.mock("./judge.js");
vi.mock("./measure.js");

const MERGED = "2026-11-01T00:00:00.000Z";
const RECORD = {
  number: "0007",
  path: "docs/ideas/0007-faster.md",
  issue: "https://github.com/corekraft/kore/issues/300",
  harness: {
    metric: "leadTime.medianSeconds",
    direction: "down",
    window: "7d",
  },
} as IdeaRecord;
const merged = (idea: string, occurredAt: string, number = 55) =>
  ({ kind: "pr.merged", idea, occurredAt, number }) as LedgerEvent;
const EVENTS = [
  merged("#299", "2026-10-01T00:00:00.000Z", 40),
  merged("#300", MERGED),
];
const AFTER_WINDOW = new Date("2026-11-08T00:00:00.000Z");
const INPUT = { ref: "7", now: AFTER_WINDOW, threshold: 0.1 };
const CONCLUDED = { idea: "0007", result: "confirmed" } as Concluded;

function context(record: Record<string, unknown> = {}) {
  const get = vi.fn(() => Promise.resolve({ ...RECORD, ...record }));
  const runner = { run: vi.fn() };
  return {
    ctx: { repo: { get }, runner } as unknown as EvaluateContext,
    get,
    runner,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(measureChange).mockReturnValue({ before: 100, after: 80 });
  vi.mocked(judgeChange).mockReturnValue({
    result: "confirmed",
    change: -0.2,
    reason: "moved down 20%",
  });
  vi.mocked(recordOutcome).mockResolvedValue(CONCLUDED);
});

describe("evaluateIdea", () => {
  it("records the judged result through the outcome tool as a comparison on the ledger", async () => {
    const { ctx } = context();
    const done = await evaluateIdea(ctx, EVENTS, INPUT);
    expect(done).toMatchObject({
      status: "recorded",
      idea: "0007",
      result: "confirmed",
      before: 100,
      after: 80,
      concluded: CONCLUDED,
    });
    expect(measureChange).toHaveBeenCalledWith(EVENTS, {
      metric: "leadTime.medianSeconds",
      changedAt: new Date(MERGED),
      windowDays: 7,
    });
    expect(judgeChange).toHaveBeenCalledWith({
      direction: "down",
      before: 100,
      after: 80,
      threshold: 0.1,
    });
    expect(recordOutcome).toHaveBeenCalledWith(ctx, "7", {
      kind: "experiment",
      source: "comparison",
      result: "confirmed",
      evidence:
        "ledger flow metric leadTime.medianSeconds: 7d before 2026-11-01T00:00:00.000Z against the 7d after",
      summary:
        "leadTime.medianSeconds went from 100 to 80 (expected down, noise threshold 10%): moved down 20%.",
    });
  });

  it("records refuted as refuted and issues nothing else, not even a revert", async () => {
    vi.mocked(judgeChange).mockReturnValue({
      result: "refuted",
      change: 0.3,
      reason: "moved up 30%",
    });
    const { ctx, runner } = context();
    const done = await evaluateIdea(ctx, EVENTS, INPUT);
    expect(done).toMatchObject({ status: "recorded", result: "refuted" });
    expect(recordOutcome).toHaveBeenCalledTimes(1);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("records inconclusive with the insufficient-history reason when the judge has no figure", async () => {
    vi.mocked(measureChange).mockReturnValue({ before: null, after: 80 });
    vi.mocked(judgeChange).mockReturnValue({
      result: "inconclusive",
      change: null,
      reason: "insufficient history",
    });
    const { ctx, runner } = context();
    const done = await evaluateIdea(ctx, EVENTS, INPUT);
    expect(done).toMatchObject({ status: "recorded", result: "inconclusive" });
    expect(vi.mocked(recordOutcome).mock.calls[0]?.[2].summary).toBe(
      "leadTime.medianSeconds went from none to 80 (expected down, noise threshold 10%): insufficient history.",
    );
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe("evaluateIdea timing and reruns", () => {
  it("records nothing before the window has elapsed and says when it can run", async () => {
    const { ctx } = context();
    const done = await evaluateIdea(ctx, EVENTS, {
      ...INPUT,
      now: new Date("2026-11-07T23:59:59.000Z"),
    });
    expect(done).toEqual({
      status: "too-early",
      idea: "0007",
      evaluableAt: "2026-11-08T00:00:00.000Z",
    });
    expect(measureChange).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("runs exactly when the window ends", async () => {
    const { ctx } = context();
    const done = await evaluateIdea(ctx, EVENTS, INPUT);
    expect(done.status).toBe("recorded");
  });

  it("never overwrites an outcome that is already recorded", async () => {
    const { ctx } = context({ outcome: "refuted" });
    const done = await evaluateIdea(ctx, EVENTS, INPUT);
    expect(done).toEqual({
      status: "already-recorded",
      idea: "0007",
      result: "refuted",
    });
    expect(measureChange).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
  });
});

describe("evaluateIdea refusals", () => {
  it("refuses an idea that is not a harness idea", async () => {
    const { ctx } = context({ harness: undefined });
    await expect(evaluateIdea(ctx, EVENTS, INPUT)).rejects.toThrow(
      new IdeaError(
        "docs/ideas/0007-faster.md is not a harness idea, so it has no hypothesis to evaluate; only `kind: harness` ideas are evaluated.",
      ),
    );
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("refuses an idea with no issue, since no merged change can be tied to it", async () => {
    const { ctx } = context({ issue: undefined });
    await expect(evaluateIdea(ctx, EVENTS, INPUT)).rejects.toThrow(
      "docs/ideas/0007-faster.md has no issue; run `harness idea sync` first, then rerun `harness evaluate`.",
    );
  });

  it("refuses when the ledger holds no merged change for the idea, naming --changed-by-pr", async () => {
    const { ctx } = context();
    await expect(
      evaluateIdea(ctx, [merged("#299", MERGED)], INPUT),
    ).rejects.toThrow(
      "No merged change is recorded in the ledger for issue #300; run `harness ledger poll-github`, or pass --changed-by-pr <number> for the PR that delivered it.",
    );
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("takes the merge of the named PR when --changed-by-pr is given", async () => {
    const { ctx } = context();
    await evaluateIdea(ctx, [merged("#12", "2026-10-20T00:00:00.000Z", 77)], {
      ...INPUT,
      changedByPr: 77,
    });
    expect(vi.mocked(measureChange).mock.calls[0]?.[1].changedAt).toEqual(
      new Date("2026-10-20T00:00:00.000Z"),
    );
  });

  it("measures from the first merge when the idea has several", async () => {
    const { ctx } = context();
    await evaluateIdea(
      ctx,
      [merged("#300", "2026-11-03T00:00:00.000Z"), merged("#300", MERGED)],
      INPUT,
    );
    expect(vi.mocked(measureChange).mock.calls[0]?.[1].changedAt).toEqual(
      new Date(MERGED),
    );
  });
});
