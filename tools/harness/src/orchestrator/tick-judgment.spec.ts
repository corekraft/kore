import { beforeEach, describe, expect, it, vi } from "vitest";
import { judgmentBrief } from "./judgment-briefs.js";
import { flowOf, type FlowPane } from "./judgment-panes.js";
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

beforeEach(() => {
  primeMocks();
});

describe("TickJudgment.begun", () => {
  it("reports a flow begun once a judgment pane exists, reading the idea's panes", () => {
    const panes: FlowPane[] = [pane("idea-0007-judgment-r1", "closed")];
    vi.mocked(flowOf).mockReturnValue(
      flow({
        decisions: [
          {
            ord: 1,
            retry: false,
            pane: pane("idea-0007-judgment-r1", "closed"),
          },
        ],
      }),
    );

    expect(new TickJudgment(ports()).begun(IDEA, panes)).toBe(true);
    expect(flowOf).toHaveBeenCalledWith(IDEA, panes);
  });

  it("reports no flow begun when the idea has no judgment or retry pane", () => {
    expect(new TickJudgment(ports()).begun(IDEA, [])).toBe(false);
  });
});

describe("TickJudgment.begin", () => {
  it("starts the first judgment pane with the start brief, stamped with its idea and issue", async () => {
    const p = ports();

    const outcome = await new TickJudgment(p).begin(
      IDEA,
      ISSUE,
      PR,
      3,
      admitted(),
    );

    expect(judgmentBrief).toHaveBeenCalledWith(IDEA, ISSUE, PR, {
      kind: "start",
      sendBacks: 3,
    });
    expect(p.spawn).toHaveBeenCalledWith({
      role: "judgment",
      name: "idea-0007-judgment-r1",
      issue: ISSUE,
      brief: "JUDGMENT BRIEF",
    });
    expect(outcome).toEqual({
      step: "spawn-judgment",
      pane: "idea-0007-judgment-r1",
    });
  });

  it("starts nothing and reports the bound when admission holds the start", async () => {
    const p = ports();

    const outcome = await new TickJudgment(p).begin(
      IDEA,
      ISSUE,
      PR,
      3,
      vi.fn().mockResolvedValue("load"),
    );

    expect(p.spawn).not.toHaveBeenCalled();
    expect(outcome).toEqual({ step: "held", bound: "load" });
  });
});

describe("TickJudgment.consume before a decision", () => {
  it("consumes nothing and calls no port when the idea has no judgment flow", async () => {
    const p = ports();

    expect(
      await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted()),
    ).toBeUndefined();
    expect(p.paneText).not.toHaveBeenCalled();
    expect(p.delivery).not.toHaveBeenCalled();
  });

  it("waits for a judgment pane still running, and reads its plan no earlier", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(decidingFlow("running"));

    expect(
      await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted()),
    ).toBeUndefined();
    expect(p.paneText).not.toHaveBeenCalled();
  });

  it("leaves a closed decision with no reader round to the caller, which closes nothing here", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(decidingFlow("closed"));

    expect(
      await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted()),
    ).toBeUndefined();
    expect(p.spawn).not.toHaveBeenCalled();
    expect(p.close).not.toHaveBeenCalled();
  });
});
