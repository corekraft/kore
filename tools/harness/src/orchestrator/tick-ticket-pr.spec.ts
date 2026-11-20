import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  escalateStage,
  judgeLaunch,
  outcomeStage,
  precheckStage,
  reviewStage,
  sendBackStage,
  writerLaunch,
} from "./idea-run.js";
import {
  JUDGE_BRIEF,
  KEY,
  TICKET,
  WRITER_BRIEF,
  on,
  open,
  pane,
  ports,
} from "./tick-ticket.fixtures.js";

vi.mock("./idea-run.js", () => ({
  escalateStage: vi.fn(),
  judgeLaunch: vi.fn(),
  outcomeStage: vi.fn(),
  precheckStage: vi.fn(),
  reviewStage: vi.fn(),
  sendBackStage: vi.fn(),
  writerLaunch: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(writerLaunch).mockImplementation(
    (idea, issue, model, name, brief) =>
      ({
        role: "writer",
        name: name ?? `idea-${idea}-writer`,
        issue,
        model,
        brief,
      }) as never,
  );
  vi.mocked(judgeLaunch).mockImplementation(
    (idea, _pr, issue, name, brief) =>
      ({
        role: "judge",
        name: name ?? `idea-${idea}-judge`,
        issue,
        brief,
      }) as never,
  );
  vi.mocked(precheckStage).mockResolvedValue({ sendBack: false });
  vi.mocked(escalateStage).mockResolvedValue({
    escalated: true,
    model: "claude-sonnet-5-5",
  });
});

describe("Tick on a ticket's pull request", () => {
  it("runs the review first when no verdict is posted for the head", async () => {
    const p = ports({
      delivery: vi.fn().mockResolvedValue(open),
      reviewPosted: vi.fn().mockResolvedValue(false),
    });

    expect(await on(p).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "review", pr: 7 },
    ]);
    expect(reviewStage).toHaveBeenCalledWith(p, 7);
  });

  it("sends a failing change back and starts no judge", async () => {
    const p = ports({ delivery: vi.fn().mockResolvedValue(open) });
    vi.mocked(precheckStage).mockResolvedValue({
      sendBack: true,
      reason: "CI is red",
      category: "ci",
    } as never);

    expect(await on(p).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "send-back", pr: 7 },
    ]);
    expect(sendBackStage).toHaveBeenCalledWith(p, 7, "CI is red", "ci");
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("starts the judge, named for the ticket and head, with the title in its brief", async () => {
    const p = ports({ delivery: vi.fn().mockResolvedValue(open) });

    expect(await on(p).pass()).toEqual([
      {
        idea: KEY,
        issue: 1419,
        step: "spawn-judge",
        pr: 7,
        pane: `idea-${KEY}-judge-abcdef1`,
      },
    ]);
    expect(judgeLaunch).toHaveBeenCalledWith(
      KEY,
      7,
      1419,
      `idea-${KEY}-judge-abcdef1`,
      JUDGE_BRIEF,
    );
  });

  it("starts no second judge for a head whose judge already ran", async () => {
    const p = ports({
      delivery: vi.fn().mockResolvedValue(open),
      panes: vi
        .fn()
        .mockResolvedValue([pane(`idea-${KEY}-judge-abcdef1`, "closed")]),
    });

    expect(await on(p).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "awaiting-judge", pr: 7 },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });
});

describe("Tick on a ticket sent back", () => {
  it("relaunches the writer on the tier's model after a send-back, keyed on the head", async () => {
    const p = ports({
      queue: vi
        .fn()
        .mockResolvedValue([
          TICKET,
          { kind: "send-back", pr: 7, count: 2, since: "2026-11-20" },
        ]),
      delivery: vi.fn().mockResolvedValue(open),
    });

    expect(await on(p).pass()).toEqual([
      {
        idea: KEY,
        issue: 1419,
        step: "relaunch-writer",
        pr: 7,
        pane: `idea-${KEY}-writer-abcdef1`,
      },
    ]);
    expect(writerLaunch).toHaveBeenCalledWith(
      KEY,
      1419,
      "claude-sonnet-5-5",
      `idea-${KEY}-writer-abcdef1`,
      WRITER_BRIEF,
    );
  });

  it("starts no second relaunch for a head whose writer was already relaunched", async () => {
    const p = ports({
      queue: vi
        .fn()
        .mockResolvedValue([
          TICKET,
          { kind: "send-back", pr: 7, count: 2, since: "2026-11-20" },
        ]),
      delivery: vi.fn().mockResolvedValue(open),
      panes: vi
        .fn()
        .mockResolvedValue([pane(`idea-${KEY}-writer-abcdef1`, "closed")]),
    });

    expect(await on(p).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "blocked", pr: 7 },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("starts nothing at a third send-back, leaving the ticket to a person", async () => {
    const p = ports({
      queue: vi
        .fn()
        .mockResolvedValue([
          TICKET,
          { kind: "send-back", pr: 7, count: 3, since: "2026-11-20" },
        ]),
      delivery: vi.fn().mockResolvedValue(open),
      sendBacks: vi
        .fn()
        .mockResolvedValue({ count: 3, model: "x", escalate: true }),
    });

    expect(await on(p).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "needs-judgment", pr: 7 },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });
});

describe("Tick on a ticket's merged pull request", () => {
  it("records no outcome and starts nothing", async () => {
    const p = ports({
      delivery: vi.fn().mockResolvedValue({ pr: 7, merged: true }),
    });

    expect(await on(p).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "merged", pr: 7 },
    ]);
    expect(outcomeStage).not.toHaveBeenCalled();
    expect(p.spawn).not.toHaveBeenCalled();
  });
});
