import { beforeEach, describe, expect, it, vi } from "vitest";
import { decide } from "./judgment-flow.js";
import { flowOf } from "./judgment-panes.js";
import { checkNames, checkPlan } from "./judgment-plan.js";
import { readPlanOf } from "./judgment-read.js";
import {
  IDEA,
  ISSUE,
  admitted,
  decidingFlow,
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
}));
vi.mock("./judgment-read.js", () => ({
  readPlanOf: vi.fn(),
  readSummaryOf: vi.fn(),
}));

const WORK = {
  role: "writer" as const,
  name: "docs",
  brief: "Document the piece.",
  files: ["docs/guides/contributor.md"],
  after: [],
};

const WORK_PLAN = {
  ok: true as const,
  plan: { kind: "work" as const, work: [WORK] },
};

const REFUSED = {
  ok: false as const,
  error: "Session name is unusable; shorten it. The whole plan is refused.",
};

beforeEach(() => {
  vi.clearAllMocks();
  primeMocks();
  vi.mocked(flowOf).mockReturnValue(decidingFlow("done"));
  vi.mocked(checkPlan).mockReturnValue(WORK_PLAN);
  vi.mocked(readPlanOf).mockResolvedValue({ ok: true, raw: {} });
  vi.mocked(checkNames).mockImplementation((_idea, checked) => checked);
});

describe("TickJudgment.consume: the piece names of a checked plan", () => {
  it("checks the plan's piece names against the idea, before the decision is made", async () => {
    await new TickJudgment(ports()).consume(IDEA, ISSUE, [], admitted());

    expect(checkNames).toHaveBeenCalledWith(IDEA, WORK_PLAN);
  });

  it("sends a plan refused for its piece names to the decision as the refusal, and persists nothing", async () => {
    vi.mocked(checkNames).mockReturnValue(REFUSED);
    const p = ports();

    await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted());

    expect(decide).toHaveBeenCalledWith(
      { readRounds: 0, refusals: 0 },
      REFUSED,
    );
    expect(p.persistPlan).not.toHaveBeenCalled();
    expect(p.spawn).not.toHaveBeenCalled();
  });
});

describe("TickJudgment.consume: persisting the work plan", () => {
  it("persists a valid work plan, closes its decision, and starts no pane nor labels the idea", async () => {
    const p = ports();
    vi.mocked(decide).mockReturnValue({ step: "work", work: [WORK] });

    const outcome = await new TickJudgment(p).consume(
      IDEA,
      ISSUE,
      [],
      admitted(),
    );

    expect(p.persistPlan).toHaveBeenCalledWith(IDEA, ISSUE, [WORK]);
    expect(p.spawn).not.toHaveBeenCalled();
    expect(p.needsInfo).not.toHaveBeenCalled();
    expect(vi.mocked(p.close).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(p.persistPlan).mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(p.close).toHaveBeenCalledWith("idea-0007-judgment-r1");
    expect(outcome).toEqual({ step: "plan-recorded" });
  });

  it("leaves the decision open when persisting fails, so a rerun persists the plan again", async () => {
    const p = ports({
      persistPlan: vi.fn().mockRejectedValue(new Error("gh is down")),
    });
    vi.mocked(decide).mockReturnValue({ step: "work", work: [WORK] });

    await expect(
      new TickJudgment(p).consume(IDEA, ISSUE, [], admitted()),
    ).rejects.toThrow("gh is down");
    expect(p.close).not.toHaveBeenCalled();
  });
});

describe("TickJudgment.consume: a judgment's plan comes from its report", () => {
  it("checks the plan its report carries", async () => {
    const plan = { stop: { reason: "owner decides" } };
    const p = ports();
    vi.mocked(readPlanOf).mockResolvedValue({ ok: true, raw: plan });

    await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted());

    expect(readPlanOf).toHaveBeenCalledWith(p, "idea-0007-judgment-r1");
    expect(checkPlan).toHaveBeenCalledWith(plan);
  });
});
