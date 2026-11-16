import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdeaPane, TickPorts } from "./tick.js";
import { Tick } from "./tick.js";
import {
  escalateStage,
  judgeLaunch,
  outcomeStage,
  precheckStage,
  reviewStage,
  sendBackStage,
  writerLaunch,
  type Measured,
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
const OUTCOME: Measured = {
  kind: "experiment",
  source: "live-run",
  result: "confirmed",
  evidence: "run 1",
  summary: "done",
};

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
    ...over,
  } as unknown as TickPorts;
}

const pane = (name: string, state: IdeaPane["state"]): IdeaPane => ({
  name,
  state,
});

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
});

describe("Tick before a pull request exists", () => {
  it("starts the idea's writer when nothing has run for it", async () => {
    const p = ports();

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "spawn-writer" },
    ]);
    expect(p.spawn).toHaveBeenCalledTimes(1);
    expect(p.spawn).toHaveBeenCalledWith({
      role: "writer",
      name: "idea-0001-writer",
      issue: 11,
      model: undefined,
    });
  });

  it("waits while a pane of the idea is running, and starts nothing", async () => {
    const p = ports({
      panes: vi.fn().mockResolvedValue([pane("idea-0001-writer", "running")]),
    });

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "waiting" },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
    expect(p.close).not.toHaveBeenCalled();
  });

  it("closes a pane that has finished, as the idea's one step this pass", async () => {
    const p = ports({
      panes: vi.fn().mockResolvedValue([pane("idea-0001-writer", "done")]),
    });

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "close", pane: "idea-0001-writer" },
    ]);
    expect(p.close).toHaveBeenCalledWith("idea-0001-writer");
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("reports the idea blocked, and starts no second writer, when its writer ended with no pull request", async () => {
    const p = ports({
      panes: vi.fn().mockResolvedValue([pane("idea-0001-writer", "closed")]),
    });

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "blocked" },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });
});

describe("Tick on an open pull request", () => {
  const open = { pr: 7, merged: false };

  it("runs the review first when no verdict is posted for the head", async () => {
    const p = ports({
      delivery: vi.fn().mockResolvedValue(open),
      reviewPosted: vi.fn().mockResolvedValue(false),
    });

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "review", pr: 7 },
    ]);
    expect(reviewStage).toHaveBeenCalledWith(p, 7);
    expect(precheckStage).not.toHaveBeenCalled();
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("sends the change back, and starts no judge, when the precheck fails on something the writer can fix", async () => {
    const p = ports({ delivery: vi.fn().mockResolvedValue(open) });
    vi.mocked(precheckStage).mockResolvedValue({
      sendBack: true,
      reason: "CI is red",
      category: "ci",
    } as never);

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "send-back", pr: 7 },
    ]);
    expect(sendBackStage).toHaveBeenCalledWith(p, 7, "CI is red", "ci");
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("starts the judge, named for the idea and the head, when the precheck passes", async () => {
    const p = ports({ delivery: vi.fn().mockResolvedValue(open) });

    expect(await new Tick(p).pass()).toEqual([
      {
        idea: "0001",
        issue: 11,
        step: "spawn-judge",
        pr: 7,
        pane: "idea-0001-judge-abcdef1",
      },
    ]);
    expect(p.spawn).toHaveBeenCalledWith({
      role: "judge",
      name: "idea-0001-judge-abcdef1",
      issue: 11,
    });
  });

  it("starts no second judge for a head whose judge has already run", async () => {
    const p = ports({
      delivery: vi.fn().mockResolvedValue(open),
      panes: vi
        .fn()
        .mockResolvedValue([pane("idea-0001-judge-abcdef1", "closed")]),
    });

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "awaiting-judge", pr: 7 },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });
});

describe("Tick on a merged pull request", () => {
  const merged = { pr: 7, merged: true };

  it("records the outcome it was given, which closes the idea", async () => {
    const p = ports({ delivery: vi.fn().mockResolvedValue(merged) });

    expect(await new Tick(p, new Map([["0001", OUTCOME]])).pass()).toEqual([
      { idea: "0001", issue: 11, step: "record-outcome", pr: 7 },
    ]);
    expect(outcomeStage).toHaveBeenCalledWith(p, "0001", OUTCOME);
  });

  it("waits for an outcome, recording none, when it was given none", async () => {
    const p = ports({ delivery: vi.fn().mockResolvedValue(merged) });

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "awaiting-outcome", pr: 7 },
    ]);
    expect(outcomeStage).not.toHaveBeenCalled();
  });
});

describe("Tick on a change that was sent back", () => {
  const sentBack = () => ({
    queue: vi.fn().mockResolvedValue([
      { kind: "idea", idea: "0001", issue: 11, since: "2026-11-16" },
      { kind: "send-back", pr: 7, count: 2, since: "2026-11-16" },
    ]),
    delivery: vi.fn().mockResolvedValue({ pr: 7, merged: false }),
  });

  it("relaunches the writer on the tier's model, named for the head it was sent back at", async () => {
    const p = ports(sentBack());
    vi.mocked(p.sendBacks).mockResolvedValue({
      count: 2,
      model: "claude-sonnet-5-5",
      escalate: true,
    });
    vi.mocked(escalateStage).mockResolvedValue({
      escalated: true,
      model: "claude-sonnet-5-5",
    });

    expect(await new Tick(p).pass()).toEqual([
      {
        idea: "0001",
        issue: 11,
        step: "relaunch-writer",
        pr: 7,
        pane: "idea-0001-writer-abcdef1",
      },
    ]);
    expect(p.spawn).toHaveBeenCalledWith({
      role: "writer",
      name: "idea-0001-writer-abcdef1",
      issue: 11,
      model: "claude-sonnet-5-5",
    });
  });

  it("starts no second writer for a head that already had its relaunch", async () => {
    const p = ports({
      ...sentBack(),
      panes: vi
        .fn()
        .mockResolvedValue([pane("idea-0001-writer-abcdef1", "closed")]),
    });

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "blocked", pr: 7 },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("leaves a third send-back to a judgment pane, which this tick does not start", async () => {
    const p = ports(sentBack());
    vi.mocked(p.sendBacks).mockResolvedValue({
      count: 3,
      model: "claude-sonnet-5-5",
      escalate: true,
    });

    expect(await new Tick(p).pass()).toEqual([
      { idea: "0001", issue: 11, step: "needs-judgment", pr: 7 },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });
});

describe("Tick across ideas and passes", () => {
  const two = () =>
    vi.fn().mockResolvedValue([
      { kind: "idea", idea: "0001", issue: 11, since: "2026-11-16" },
      { kind: "idea", idea: "0002", issue: 12, since: "2026-11-16" },
    ]);

  it("advances each idea by exactly one step in a pass", async () => {
    const p = ports({ queue: two() });

    const steps = await new Tick(p).pass();

    expect(steps.map((s) => [s.idea, s.step])).toEqual([
      ["0001", "spawn-writer"],
      ["0002", "spawn-writer"],
    ]);
    expect(p.spawn).toHaveBeenCalledTimes(2);
  });

  it("spawns nothing twice when the pass is rerun", async () => {
    const started: IdeaPane[] = [];
    const p = ports({
      queue: two(),
      panes: vi
        .fn()
        .mockImplementation((idea: string) =>
          Promise.resolve(
            started.filter((s) => s.name.startsWith(`idea-${idea}-`)),
          ),
        ),
      spawn: vi.fn().mockImplementation((launch: { name: string }) => {
        started.push(pane(launch.name, "running"));
        return Promise.resolve();
      }),
    });
    const tick = new Tick(p);

    await tick.pass();
    const rerun = await tick.pass();

    expect(p.spawn).toHaveBeenCalledTimes(2);
    expect(rerun.map((s) => s.step)).toEqual(["waiting", "waiting"]);
  });

  it("scopes a pass to one idea, leaving the others untouched", async () => {
    const p = ports({ queue: two() });

    expect(await new Tick(p).pass("0002")).toEqual([
      { idea: "0002", issue: 12, step: "spawn-writer" },
    ]);
    expect(p.spawn).toHaveBeenCalledTimes(1);
  });

  it("reports a scoped idea that is not queued, and does nothing", async () => {
    const p = ports({ queue: two() });

    expect(await new Tick(p).pass("0009")).toEqual([
      { idea: "0009", step: "not-queued" },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });
});
