import { beforeEach, describe, expect, it, vi } from "vitest";
import { decide } from "./judgment-flow.js";
import { judgmentBrief, readerBrief } from "./judgment-briefs.js";
import { flowOf } from "./judgment-panes.js";
import { checkPlan, readPlan } from "./judgment-plan.js";
import {
  IDEA,
  ISSUE,
  PR,
  admitted,
  decidingFlow,
  flow,
  pane,
  ports,
  primeMocks,
} from "./tick-judgment.fixtures.js";
import { TickJudgment } from "./tick-judgment.js";

vi.mock("./judgment-flow.js", () => ({ decide: vi.fn() }));
vi.mock("./judgment-briefs.js", () => ({
  judgmentBrief: vi.fn(),
  readerBrief: vi.fn(),
}));
vi.mock("./judgment-panes.js", () => ({
  flowOf: vi.fn(),
  isFinished: vi.fn(),
  isOpen: vi.fn(),
  judgmentName: vi.fn(),
  readerName: vi.fn(),
  retryName: vi.fn(),
}));
vi.mock("./judgment-plan.js", () => ({
  checkNames: vi.fn(),
  checkPlan: vi.fn(),
  readPlan: vi.fn(),
}));
vi.mock("./judgment-summary.js", () => ({ readSummary: vi.fn() }));

const READS = [
  { question: "where is it", paths: ["a.ts"] },
  { question: "what is it", paths: ["b.ts"] },
];

beforeEach(() => {
  primeMocks();
});

describe("TickJudgment.consume: starting readers", () => {
  it("starts each reader before it closes the judgment pane that asked, so a crash leaves that pane to rerun", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(decidingFlow("done"));
    vi.mocked(decide).mockReturnValue({ step: "read", reads: READS });

    const outcome = await new TickJudgment(p).consume(
      IDEA,
      ISSUE,
      [],
      admitted(),
    );

    expect(outcome).toEqual({ step: "spawn-readers" });
    expect(readerBrief).toHaveBeenNthCalledWith(1, IDEA, ISSUE, READS[0]);
    expect(p.spawn).toHaveBeenNthCalledWith(1, {
      role: "reader",
      name: "idea-0007-read-r1-q1",
      issue: ISSUE,
      brief: "READER BRIEF",
    });
    expect(p.spawn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: "reader", name: "idea-0007-read-r1-q2" }),
    );
    expect(p.close).toHaveBeenCalledWith("idea-0007-judgment-r1");
    expect(vi.mocked(p.close).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(p.spawn).mock.invocationCallOrder[1] ?? Infinity,
    );
  });

  it("starts no reader its round already has when it decides again after a crash", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(
      decidingFlow("done", {
        rounds: [{ ord: 1, readers: [pane("idea-0007-read-r1-q1", "done")] }],
        readRounds: 1,
      }),
    );
    vi.mocked(decide).mockReturnValue({ step: "read", reads: READS });

    await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted());

    expect(p.spawn).toHaveBeenCalledTimes(1);
    expect(p.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ name: "idea-0007-read-r1-q2" }),
    );
  });
});

describe("TickJudgment.consume: the reads a decision may take", () => {
  it("decides on the reads already taken, not counting the round its own pane made", async () => {
    vi.mocked(flowOf).mockReturnValue(
      flow({
        decisions: [
          {
            ord: 1,
            retry: false,
            pane: pane("idea-0007-judgment-r1", "closed"),
          },
          { ord: 2, retry: false, pane: pane("idea-0007-judgment-r2", "done") },
        ],
        rounds: [
          { ord: 1, readers: [pane("idea-0007-read-r1-q1", "closed")] },
          { ord: 2, readers: [pane("idea-0007-read-r2-q1", "done")] },
        ],
        readRounds: 2,
        nextOrd: 3,
      }),
    );

    await new TickJudgment(ports()).consume(IDEA, ISSUE, [], admitted());

    expect(decide).toHaveBeenCalledWith(
      { readRounds: 1, refusals: 0 },
      { ok: true, plan: { kind: "stop", reason: "r" } },
    );
  });

  it("refuses a pane that printed no plan with the reason, and checks no plan", async () => {
    vi.mocked(flowOf).mockReturnValue(decidingFlow("done"));
    vi.mocked(readPlan).mockReturnValue({ ok: false, error: "no plan" });

    await new TickJudgment(ports()).consume(IDEA, ISSUE, [], admitted());

    expect(checkPlan).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledWith(
      { readRounds: 0, refusals: 0 },
      { ok: false, error: "no plan" },
    );
  });

  it("holds a read when admission holds it, leaving the judgment pane open", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(decidingFlow("done"));
    vi.mocked(decide).mockReturnValue({ step: "read", reads: READS });

    const outcome = await new TickJudgment(p).consume(
      IDEA,
      ISSUE,
      [],
      vi.fn().mockResolvedValue("live-run"),
    );

    expect(p.spawn).not.toHaveBeenCalled();
    expect(p.close).not.toHaveBeenCalled();
    expect(outcome).toEqual({ step: "held", bound: "live-run" });
  });
});

describe("TickJudgment.consume: retry, needs-info and work", () => {
  it("starts the one retry with the reason, then closes the refused pane", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(decidingFlow("done"));
    vi.mocked(decide).mockReturnValue({ step: "retry", reason: "bad item" });

    const outcome = await new TickJudgment(p).consume(
      IDEA,
      ISSUE,
      [],
      admitted(),
    );

    expect(judgmentBrief).toHaveBeenCalledWith(IDEA, ISSUE, PR, {
      kind: "retry",
      reason: "bad item",
    });
    expect(p.spawn).toHaveBeenCalledWith({
      role: "judgment",
      name: "idea-0007-retry-r2",
      issue: ISSUE,
      brief: "JUDGMENT BRIEF",
    });
    expect(p.close).toHaveBeenCalledWith("idea-0007-judgment-r1");
    expect(outcome).toEqual({
      step: "retry-judgment",
      pane: "idea-0007-retry-r2",
    });
  });

  it("labels the idea needs-info with the reason before it closes the pane, and starts nothing", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(decidingFlow("done"));
    vi.mocked(decide).mockReturnValue({
      step: "needs-info",
      reason: "still bad",
    });

    const outcome = await new TickJudgment(p).consume(
      IDEA,
      ISSUE,
      [],
      admitted(),
    );

    expect(p.needsInfo).toHaveBeenCalledWith(ISSUE, "still bad");
    expect(p.spawn).not.toHaveBeenCalled();
    expect(vi.mocked(p.close).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(p.needsInfo).mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(outcome).toEqual({ step: "needs-info" });
  });
});
