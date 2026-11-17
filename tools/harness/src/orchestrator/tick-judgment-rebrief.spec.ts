import { beforeEach, describe, expect, it, vi } from "vitest";
import { decide } from "./judgment-flow.js";
import { rebriefBrief } from "./judgment-briefs.js";
import { flowOf, isFinished, isOpen, rebriefName } from "./judgment-panes.js";
import { checkPlan, readPlan } from "./judgment-plan.js";
import {
  IDEA,
  ISSUE,
  admitted,
  decidingFlow,
  pane,
  ports,
} from "./tick-judgment.fixtures.js";
import { TickJudgment } from "./tick-judgment.js";

vi.mock("./judgment-flow.js", () => ({ decide: vi.fn() }));
vi.mock("./judgment-briefs.js", () => ({
  judgmentBrief: vi.fn(),
  readerBrief: vi.fn(),
  rebriefBrief: vi.fn(),
}));
vi.mock("./judgment-panes.js", () => ({
  flowOf: vi.fn(),
  isFinished: vi.fn(),
  isOpen: vi.fn(),
  judgmentName: vi.fn(),
  readerName: vi.fn(),
  rebriefName: vi.fn(),
  retryName: vi.fn(),
}));
vi.mock("./judgment-plan.js", () => ({
  checkPlan: vi.fn(),
  readPlan: vi.fn(),
}));
vi.mock("./judgment-summary.js", () => ({ readSummary: vi.fn() }));

const WRITER = {
  role: "writer" as const,
  name: "split-retry",
  brief: "Split the retry logic out first.",
  files: ["tools/harness/src/orchestrator/tick-judgment.ts"],
  after: [],
};

beforeEach(() => {
  vi.mocked(rebriefName).mockImplementation(
    (idea, ord) => `idea-${idea}-rebrief-r${ord}`,
  );
  vi.mocked(isOpen).mockImplementation((p) => p.state !== "closed");
  vi.mocked(isFinished).mockImplementation(
    (p) => p.state === "done" || p.state === "blocked",
  );
  vi.mocked(flowOf).mockReturnValue(decidingFlow("done"));
  vi.mocked(rebriefBrief).mockReturnValue("REBRIEF BRIEF");
  vi.mocked(readPlan).mockReturnValue({ ok: true, raw: {} });
  vi.mocked(checkPlan).mockReturnValue({
    ok: true,
    plan: { kind: "stop", reason: "r" },
  });
});

describe("TickJudgment.consume: a re-brief is one writer piece", () => {
  it("starts one writer on the re-brief, then closes the judgment pane that decided it", async () => {
    const p = ports();
    vi.mocked(decide).mockReturnValue({ step: "work", work: [WRITER] });

    const outcome = await new TickJudgment(p).consume(
      IDEA,
      ISSUE,
      [],
      admitted(),
    );

    expect(rebriefBrief).toHaveBeenCalledWith(IDEA, ISSUE, {
      brief: WRITER.brief,
      files: WRITER.files,
    });
    expect(p.spawn).toHaveBeenCalledWith({
      role: "writer",
      name: "idea-0007-rebrief-r1",
      issue: ISSUE,
      worktree: true,
      brief: "REBRIEF BRIEF",
    });
    expect(vi.mocked(p.close).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(p.spawn).mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(p.close).toHaveBeenCalledWith("idea-0007-judgment-r1");
    expect(p.needsInfo).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      step: "spawn-rebrief",
      pane: "idea-0007-rebrief-r1",
    });
  });

  it("starts nothing and closes nothing while a host bound holds the writer, so the decision waits", async () => {
    const p = ports();
    vi.mocked(decide).mockReturnValue({ step: "work", work: [WRITER] });

    const outcome = await new TickJudgment(p).consume(IDEA, ISSUE, [], () =>
      Promise.resolve("live-run" as const),
    );

    expect(p.spawn).not.toHaveBeenCalled();
    expect(p.close).not.toHaveBeenCalled();
    expect(outcome).toEqual({ step: "held", bound: "live-run" });
  });

  it("does not start the writer a second time after a crash left its pane in place, and closes the decision", async () => {
    const p = ports();
    vi.mocked(decide).mockReturnValue({ step: "work", work: [WRITER] });

    const outcome = await new TickJudgment(p).consume(
      IDEA,
      ISSUE,
      [pane("idea-0007-rebrief-r1", "done")],
      admitted(),
    );

    expect(p.spawn).not.toHaveBeenCalled();
    expect(p.close).toHaveBeenCalledWith("idea-0007-judgment-r1");
    expect(outcome).toEqual({
      step: "spawn-rebrief",
      pane: "idea-0007-rebrief-r1",
    });
  });
});

describe("TickJudgment.consume: work plans that stay work-planned", () => {
  it.each([
    [
      "a split into two pieces",
      [WRITER, { ...WRITER, name: "second-piece", after: ["split-retry"] }],
    ],
    ["a reader piece", [{ ...WRITER, role: "reader" as const }]],
    ["a piece that waits on another", [{ ...WRITER, after: ["other"] }]],
  ])(
    "keeps %s as work-planned: it starts nothing and labels nothing, for the owner to decide",
    async (_case, work) => {
      const p = ports();
      vi.mocked(decide).mockReturnValue({ step: "work", work });

      const outcome = await new TickJudgment(p).consume(
        IDEA,
        ISSUE,
        [],
        admitted(),
      );

      expect(p.spawn).not.toHaveBeenCalled();
      expect(p.needsInfo).not.toHaveBeenCalled();
      expect(p.close).toHaveBeenCalledWith("idea-0007-judgment-r1");
      expect(outcome).toEqual({ step: "work-planned" });
    },
  );
});
