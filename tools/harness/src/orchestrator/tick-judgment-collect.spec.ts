import { beforeEach, describe, expect, it, vi } from "vitest";
import { decide } from "./judgment-flow.js";
import { judgmentBrief } from "./judgment-briefs.js";
import { flowOf } from "./judgment-panes.js";
import { readSummary } from "./judgment-summary.js";
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

const ROUND = [
  pane("idea-0007-read-r1-q1", "done"),
  pane("idea-0007-read-r1-q2", "blocked"),
];

beforeEach(() => {
  primeMocks();
});

describe("TickJudgment.consume: collecting the readers", () => {
  it("collects the readers' summaries into a fresh judgment pane, then closes the readers", async () => {
    const p = ports({
      paneText: vi
        .fn()
        .mockImplementation((name: string) =>
          Promise.resolve(`text of ${name}`),
        ),
    });
    vi.mocked(flowOf).mockReturnValue(
      flow({
        decisions: [
          {
            ord: 1,
            retry: false,
            pane: pane("idea-0007-judgment-r1", "closed"),
          },
        ],
        rounds: [{ ord: 1, readers: ROUND }],
        readRounds: 1,
        nextOrd: 2,
      }),
    );

    const outcome = await new TickJudgment(p).consume(
      IDEA,
      ISSUE,
      [],
      admitted(),
    );

    expect(judgmentBrief).toHaveBeenCalledWith(
      IDEA,
      ISSUE,
      PR,
      {
        kind: "after-reads",
        summaries: [
          {
            name: "idea-0007-read-r1-q1",
            text: "S(text of idea-0007-read-r1-q1)",
          },
          {
            name: "idea-0007-read-r1-q2",
            text: "S(text of idea-0007-read-r1-q2)",
          },
        ],
      },
      "herdr",
    );
    expect(p.spawn).toHaveBeenCalledWith({
      role: "judgment",
      name: "idea-0007-judgment-r2",
      issue: ISSUE,
      brief: "JUDGMENT BRIEF",
    });
    expect(p.close).toHaveBeenCalledWith("idea-0007-read-r1-q1");
    expect(p.close).toHaveBeenCalledWith("idea-0007-read-r1-q2");
    expect(outcome).toEqual({
      step: "spawn-judgment",
      pane: "idea-0007-judgment-r2",
    });
  });
});

describe("TickJudgment.consume: closing the readers", () => {
  it("closes the readers only after the fresh pane is started, so a crash leaves them to collect again", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(
      flow({
        decisions: [
          {
            ord: 1,
            retry: false,
            pane: pane("idea-0007-judgment-r1", "closed"),
          },
        ],
        rounds: [{ ord: 1, readers: ROUND }],
        readRounds: 1,
        nextOrd: 2,
      }),
    );

    await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted());

    expect(vi.mocked(p.close).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(p.spawn).mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("waits while a reader of the round still runs, and reads nothing", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(
      flow({
        decisions: [
          {
            ord: 1,
            retry: false,
            pane: pane("idea-0007-judgment-r1", "closed"),
          },
        ],
        rounds: [
          { ord: 1, readers: [pane("idea-0007-read-r1-q1", "running")] },
        ],
        readRounds: 1,
        nextOrd: 2,
      }),
    );

    expect(
      await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted()),
    ).toBeUndefined();
    expect(p.paneText).not.toHaveBeenCalled();
    expect(p.spawn).not.toHaveBeenCalled();
  });
});

describe("TickJudgment.consume: holds and crash recovery", () => {
  it("holds the collection when admission holds it, and closes no reader", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(
      flow({
        decisions: [
          {
            ord: 1,
            retry: false,
            pane: pane("idea-0007-judgment-r1", "closed"),
          },
        ],
        rounds: [{ ord: 1, readers: ROUND }],
        readRounds: 1,
        nextOrd: 2,
      }),
    );

    const outcome = await new TickJudgment(p).consume(
      IDEA,
      ISSUE,
      [],
      vi.fn().mockResolvedValue("saver"),
    );

    expect(p.spawn).not.toHaveBeenCalled();
    expect(p.close).not.toHaveBeenCalled();
    expect(outcome).toEqual({ step: "held", bound: "saver" });
  });

  it("decides a pane that is finished and still open even when its round exists, so a crash mid-step reruns it", async () => {
    const p = ports();
    vi.mocked(flowOf).mockReturnValue(
      decidingFlow("done", {
        rounds: [{ ord: 1, readers: [pane("idea-0007-read-r1-q1", "done")] }],
        readRounds: 1,
      }),
    );
    vi.mocked(decide).mockReturnValue({ step: "work", work: [] });

    await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted());

    expect(p.close).toHaveBeenCalledWith("idea-0007-judgment-r1");
  });
});

describe("TickJudgment.consume: an hc judgment reads its readers from their reports", () => {
  it("takes each reader's answer from its report, with no summary markers, and briefs the judgment for hc", async () => {
    const p = ports({
      backend: "hc",
      reportOf: vi.fn(async (name: string) => ({
        summary: `answer of ${name}`,
      })),
    });
    vi.mocked(flowOf).mockReturnValue(
      flow({
        decisions: [
          {
            ord: 1,
            retry: false,
            pane: pane("idea-0007-judgment-r1", "closed"),
          },
        ],
        rounds: [{ ord: 1, readers: ROUND }],
        readRounds: 1,
        nextOrd: 2,
      }),
    );

    await new TickJudgment(p).consume(IDEA, ISSUE, [], admitted());

    expect(readSummary).not.toHaveBeenCalled();
    expect(p.paneText).not.toHaveBeenCalled();
    expect(judgmentBrief).toHaveBeenCalledWith(
      IDEA,
      ISSUE,
      PR,
      {
        kind: "after-reads",
        summaries: [
          {
            name: "idea-0007-read-r1-q1",
            text: "answer of idea-0007-read-r1-q1",
          },
          {
            name: "idea-0007-read-r1-q2",
            text: "answer of idea-0007-read-r1-q2",
          },
        ],
      },
      "hc",
    );
  });
});
