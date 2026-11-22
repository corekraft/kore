import { beforeEach, describe, expect, it, vi } from "vitest";
import { pieceBrief } from "./judgment-briefs.js";
import {
  judgeLaunch,
  precheckStage,
  reviewStage,
  writerLaunch,
} from "./idea-run.js";
import type { IdeaPane, TickPorts } from "./tick.js";
import { Tick } from "./tick.js";
import type { StoredPlan } from "./tick-plan-store.js";

vi.mock("./idea-run.js", () => ({
  escalateStage: vi.fn(),
  judgeLaunch: vi.fn(),
  outcomeStage: vi.fn(),
  precheckStage: vi.fn(),
  reviewStage: vi.fn(),
  sendBackStage: vi.fn(),
  writerLaunch: vi.fn(),
}));
vi.mock("./judgment-briefs.js", () => ({ pieceBrief: vi.fn() }));

const HEAD = "abcdef1234567890";

const DOCS = {
  role: "writer" as const,
  name: "docs",
  brief: "Document it.",
  files: ["docs/a.md"],
  after: [],
};
const TESTS = {
  role: "reader" as const,
  name: "tests",
  brief: "Check the tests.",
  files: ["tools/x.ts"],
  after: ["docs"],
};
const PLAN: StoredPlan = {
  schema: 1,
  idea: "0001",
  issue: 11,
  work: [DOCS, TESTS],
};

const pane = (name: string, state: IdeaPane["state"]): IdeaPane => ({
  name,
  state,
});

/** The ports one idea's pass reads; the piece stage reads the plan and the panes, and starts pieces. */
function ports(over: Partial<TickPorts> = {}): TickPorts {
  return {
    queue: vi
      .fn()
      .mockResolvedValue([
        { kind: "idea", idea: "0001", issue: 11, since: "2026-11-16" },
      ]),
    panes: vi.fn().mockResolvedValue([]),
    delivery: vi.fn().mockResolvedValue({ merged: false }),
    head: vi.fn().mockResolvedValue(HEAD),
    reviewPosted: vi.fn().mockResolvedValue(true),
    spawn: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sendBacks: vi
      .fn()
      .mockResolvedValue({ count: 1, model: "haiku", escalate: false }),
    workPlan: vi.fn().mockResolvedValue(PLAN),
    backend: "herdr",
    ...over,
  } as unknown as TickPorts;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(pieceBrief).mockReturnValue("PIECE BRIEF");
  vi.mocked(writerLaunch).mockImplementation(
    (idea, issue, model, name) =>
      ({
        role: "writer",
        name: name ?? `idea-${idea}-writer`,
        issue,
        model,
      }) as never,
  );
  vi.mocked(judgeLaunch).mockImplementation(
    (idea, _pr, issue, name) =>
      ({ role: "judge", name: name ?? `idea-${idea}-judge`, issue }) as never,
  );
  vi.mocked(precheckStage).mockResolvedValue({ sendBack: false });
  vi.mocked(reviewStage).mockResolvedValue(undefined);
});

describe("Tick starts the pieces of a persisted work plan", () => {
  it("starts the first piece in a pane named for it, briefed with the piece, in a worktree", async () => {
    const p = ports();

    expect(await new Tick(p).pass()).toEqual([
      {
        idea: "0001",
        issue: 11,
        step: "spawn-piece",
        pane: "idea-0001-piece-docs",
      },
    ]);
    expect(pieceBrief).toHaveBeenCalledWith("0001", 11, DOCS, "herdr");
    expect(p.spawn).toHaveBeenCalledWith({
      role: "writer",
      name: "idea-0001-piece-docs",
      issue: 11,
      brief: "PIECE BRIEF",
      worktree: true,
    });
  });

  it("briefs the piece for the hc backend the ports name, so it finishes with a report", async () => {
    const p = ports({ backend: "hc" });

    await new Tick(p).pass();

    expect(pieceBrief).toHaveBeenCalledWith("0001", 11, DOCS, "hc");
  });

  it("starts a reader piece without a worktree once the piece it waits for is closed", async () => {
    const p = ports({
      panes: vi
        .fn()
        .mockResolvedValue([pane("idea-0001-piece-docs", "closed")]),
    });

    expect(await new Tick(p).pass()).toEqual([
      {
        idea: "0001",
        issue: 11,
        step: "spawn-piece",
        pane: "idea-0001-piece-tests",
      },
    ]);
    expect(p.spawn).toHaveBeenCalledWith({
      role: "reader",
      name: "idea-0001-piece-tests",
      issue: 11,
      brief: "PIECE BRIEF",
    });
  });
});

describe("Tick waits on, stops at and hands on from a persisted work plan", () => {
  it("closes a finished piece pane first, and starts nothing after it in the same pass", async () => {
    const p = ports({
      panes: vi.fn().mockResolvedValue([pane("idea-0001-piece-docs", "done")]),
    });

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "close", pane: "idea-0001-piece-docs" },
    ]);
    expect(p.close).toHaveBeenCalledWith("idea-0001-piece-docs");
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("stops the plan at a blocked piece, closing nothing and starting nothing after it", async () => {
    const p = ports({
      panes: vi
        .fn()
        .mockResolvedValue([pane("idea-0001-piece-docs", "blocked")]),
    });

    expect(await new Tick(p).pass()).toEqual([
      {
        idea: "0001",
        issue: 11,
        step: "blocked",
        pane: "idea-0001-piece-docs",
      },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
    expect(p.close).not.toHaveBeenCalled();
  });

  it("holds a piece start while a host bound holds the pass, and records the bound it hit", async () => {
    const gate = {
      read: vi.fn().mockResolvedValue({ saver: false, hold: "load" }),
      record: vi.fn().mockResolvedValue(undefined),
    };
    const p = ports();

    expect(await new Tick(p, new Map(), gate).pass()).toEqual([
      { idea: "0001", issue: 11, step: "held", bound: "load" },
    ]);
    expect(gate.record).toHaveBeenCalledWith(11, "load");
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("hands the idea to the pull request flow once every piece has a closed pane", async () => {
    const p = ports({
      delivery: vi.fn().mockResolvedValue({ pr: 12, merged: false }),
      panes: vi
        .fn()
        .mockResolvedValue([
          pane("idea-0001-piece-docs", "closed"),
          pane("idea-0001-piece-tests", "closed"),
        ]),
    });

    expect(await new Tick(p).pass()).toEqual([
      {
        idea: "0001",
        issue: 11,
        step: "spawn-judge",
        pr: 12,
        pane: "idea-0001-judge-abcdef1",
      },
    ]);
    expect(p.spawn).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.stringContaining("piece") }),
    );
  });
});
