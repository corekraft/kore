import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdeaPane, TickPorts } from "./tick.js";
import { Tick } from "./tick.js";
import type { PassBounds, PassGate } from "./tick-bounds.js";
import {
  escalateStage,
  judgeLaunch,
  precheckStage,
  reviewStage,
  sendBackStage,
  writerLaunch,
} from "./idea-run.js";

vi.mock("./idea-run.js", () => ({
  escalateStage: vi.fn(),
  judgeLaunch: vi.fn(),
  outcomeStage: vi.fn(),
  precheckStage: vi.fn(),
  reviewStage: vi.fn(),
  sendBackStage: vi.fn(),
  writerLaunch: vi.fn(),
}));

const HEAD = "abcdef1234567890";
const TWO_IDEAS = [
  { kind: "idea", idea: "0001", issue: 11, since: "2026-11-16" },
  { kind: "idea", idea: "0002", issue: 12, since: "2026-11-16" },
];
const ONE_IDEA = [TWO_IDEAS[0]];

const pane = (name: string, state: IdeaPane["state"]): IdeaPane => ({
  name,
  state,
});

function ports(over: Partial<TickPorts> = {}): TickPorts {
  return {
    queue: vi.fn().mockResolvedValue(TWO_IDEAS),
    panes: vi.fn().mockResolvedValue([]),
    delivery: vi.fn().mockResolvedValue({ merged: false }),
    head: vi.fn().mockResolvedValue(HEAD),
    reviewPosted: vi.fn().mockResolvedValue(false),
    spawn: vi.fn().mockResolvedValue(undefined),
    workPlan: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sendBacks: vi
      .fn()
      .mockResolvedValue({ count: 1, model: "haiku", escalate: false }),
    ...over,
  } as unknown as TickPorts;
}

/** A gate that reads the given bounds and records the bound hits it is told of. */
function gate(bounds: PassBounds = { saver: false }) {
  return {
    read: vi.fn<PassGate["read"]>().mockResolvedValue(bounds),
    record: vi.fn<PassGate["record"]>().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
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
  vi.mocked(escalateStage).mockResolvedValue({ model: undefined } as never);
});

describe("Tick on AC power with the host clear", () => {
  it("starts every queued idea's writer in one pass: the whole unblocked frontier", async () => {
    const p = ports();
    const g = gate({ saver: false });

    expect(await new Tick(p, new Map(), g).pass()).toEqual([
      { idea: "0001", issue: 11, step: "spawn-writer" },
      { idea: "0002", issue: 12, step: "spawn-writer" },
    ]);
    expect(p.spawn).toHaveBeenCalledTimes(2);
    expect(g.record).not.toHaveBeenCalled();
  });
});

describe("Tick in saver mode on battery", () => {
  it("starts one pane per pass, holds the rest, and records a saver bound for each hold", async () => {
    const p = ports();
    const g = gate({ saver: true });

    expect(await new Tick(p, new Map(), g).pass()).toEqual([
      { idea: "0001", issue: 11, step: "spawn-writer" },
      { idea: "0002", issue: 12, step: "held", bound: "saver" },
    ]);
    expect(p.spawn).toHaveBeenCalledTimes(1);
    expect(g.record).toHaveBeenCalledTimes(1);
    expect(g.record).toHaveBeenCalledWith(12, "saver");
  });

  it("does not spend the pass's one start on a pane that only closes", async () => {
    const p = ports({
      panes: vi
        .fn()
        .mockImplementation((idea: string) =>
          Promise.resolve(
            idea === "0001" ? [pane("idea-0001-writer", "done")] : [],
          ),
        ),
    });
    const g = gate({ saver: true });

    expect(await new Tick(p, new Map(), g).pass()).toEqual([
      { idea: "0001", issue: 11, step: "close", pane: "idea-0001-writer" },
      { idea: "0002", issue: 12, step: "spawn-writer" },
    ]);
    expect(p.close).toHaveBeenCalledWith("idea-0001-writer");
    expect(p.spawn).toHaveBeenCalledTimes(1);
    expect(g.record).not.toHaveBeenCalled();
  });

  it("starts a held idea on the first pass that is not on battery", async () => {
    const p = ports({ queue: vi.fn().mockResolvedValue(TWO_IDEAS) });
    const g = gate({ saver: true });
    const tick = new Tick(p, new Map(), g);
    await tick.pass();
    vi.mocked(g.read).mockResolvedValue({ saver: false });

    const next = await tick.pass();

    expect(next.find((s) => s.idea === "0002")).toEqual({
      idea: "0002",
      issue: 12,
      step: "spawn-writer",
    });
  });
});

describe("Tick above the load ceiling", () => {
  it("starts nothing above the load ceiling, closes a finished pane, and records a load bound", async () => {
    const p = ports({
      panes: vi
        .fn()
        .mockImplementation((idea: string) =>
          Promise.resolve(
            idea === "0001" ? [pane("idea-0001-writer", "done")] : [],
          ),
        ),
    });
    const g = gate({ saver: false, hold: "load" });

    expect(await new Tick(p, new Map(), g).pass()).toEqual([
      { idea: "0001", issue: 11, step: "close", pane: "idea-0001-writer" },
      { idea: "0002", issue: 12, step: "held", bound: "load" },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
    expect(g.record.mock.calls).toEqual([[12, "load"]]);
  });
});

describe("Tick while a live run holds the lease", () => {
  it("sends no review and starts no judge while a live run holds the lease", async () => {
    const p = ports({
      queue: vi.fn().mockResolvedValue(ONE_IDEA),
      delivery: vi.fn().mockResolvedValue({ pr: 50, merged: false }),
    });
    const g = gate({ saver: false, hold: "live-run" });

    expect(await new Tick(p, new Map(), g).pass()).toEqual([
      { idea: "0001", issue: 11, step: "held", pr: 50, bound: "live-run" },
    ]);
    expect(reviewStage).not.toHaveBeenCalled();
    expect(p.spawn).not.toHaveBeenCalled();
    expect(g.record.mock.calls).toEqual([[11, "live-run"]]);
  });

  it("holds the judge pane while the precheck passes, and starts nothing", async () => {
    const p = ports({
      queue: vi.fn().mockResolvedValue(ONE_IDEA),
      delivery: vi.fn().mockResolvedValue({ pr: 50, merged: false }),
      reviewPosted: vi.fn().mockResolvedValue(true),
    });
    const g = gate({ saver: false, hold: "live-run" });

    expect(await new Tick(p, new Map(), g).pass()).toEqual([
      { idea: "0001", issue: 11, step: "held", pr: 50, bound: "live-run" },
    ]);
    expect(judgeLaunch).not.toHaveBeenCalled();
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("still sends a failing change back under a hold, because a send-back starts no pane", async () => {
    vi.mocked(precheckStage).mockResolvedValue({
      sendBack: true,
      reason: "no valid declaration",
      category: "declaration",
    } as never);
    const p = ports({
      queue: vi.fn().mockResolvedValue(ONE_IDEA),
      delivery: vi.fn().mockResolvedValue({ pr: 50, merged: false }),
      reviewPosted: vi.fn().mockResolvedValue(true),
    });
    const g = gate({ saver: false, hold: "load" });

    expect(await new Tick(p, new Map(), g).pass()).toEqual([
      { idea: "0001", issue: 11, step: "send-back", pr: 50 },
    ]);
    expect(sendBackStage).toHaveBeenCalledTimes(1);
    expect(p.spawn).not.toHaveBeenCalled();
    expect(g.record).not.toHaveBeenCalled();
  });

  it("starts a held idea's writer on the first pass the hold clears", async () => {
    const p = ports({ queue: vi.fn().mockResolvedValue(ONE_IDEA) });
    const g = gate({ saver: false, hold: "load" });
    const tick = new Tick(p, new Map(), g);
    expect(await tick.pass()).toEqual([
      { idea: "0001", issue: 11, step: "held", bound: "load" },
    ]);
    vi.mocked(g.read).mockResolvedValue({ saver: false });

    expect(await tick.pass()).toEqual([
      { idea: "0001", issue: 11, step: "spawn-writer" },
    ]);
    expect(p.spawn).toHaveBeenCalledTimes(1);
  });
});
