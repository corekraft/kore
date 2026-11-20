import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  escalateStage,
  judgeLaunch,
  precheckStage,
  writerLaunch,
} from "./idea-run.js";
import {
  KEY,
  TICKET,
  WRITER_BRIEF,
  gate,
  on,
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

describe("Tick with the ticket flag off", () => {
  it("starts and reads nothing for a ticket", async () => {
    const panes = vi.fn();
    const p = ports({ ticketsOn: vi.fn().mockResolvedValue(false), panes });

    expect(await on(p).pass()).toEqual([]);
    expect(p.spawn).not.toHaveBeenCalled();
    expect(panes).not.toHaveBeenCalled();
  });
});

describe("Tick on a ticket", () => {
  it("starts the ticket's writer with the issue number and title in its brief", async () => {
    const p = ports();

    expect(await on(p).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "spawn-writer" },
    ]);
    expect(writerLaunch).toHaveBeenCalledWith(
      KEY,
      1419,
      undefined,
      undefined,
      WRITER_BRIEF,
    );
    expect(p.spawn).toHaveBeenCalledTimes(1);
  });

  it("starts no writer for a ticket labelled live-proof", async () => {
    const panes = vi.fn();
    const p = ports({
      panes,
      queue: vi.fn().mockResolvedValue([{ ...TICKET, labels: ["live-proof"] }]),
    });

    expect(await on(p).pass()).toEqual([]);
    expect(p.spawn).not.toHaveBeenCalled();
    expect(panes).not.toHaveBeenCalled();
  });

  it("starts no second writer when the ticket's writer already ran with no pull request", async () => {
    const p = ports({
      panes: vi.fn().mockResolvedValue([pane(`idea-${KEY}-writer`, "closed")]),
    });

    expect(await on(p).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "blocked" },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("closes a finished pane as its one step", async () => {
    const p = ports({
      panes: vi.fn().mockResolvedValue([pane(`idea-${KEY}-writer`, "done")]),
    });

    expect(await on(p).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "close", pane: `idea-${KEY}-writer` },
    ]);
    expect(p.close).toHaveBeenCalledWith(`idea-${KEY}-writer`);
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("reads no work plan and starts no judgment for a ticket", async () => {
    const workPlan = vi.fn();
    const p = ports({ workPlan });

    await on(p).pass();

    expect(workPlan).not.toHaveBeenCalled();
  });
});

describe("Tick on a ticket under the host bounds", () => {
  it("holds the start, and records the bound, when the load ceiling holds", async () => {
    const p = ports();
    const g = gate({ saver: false, hold: "load" });

    expect(await on(p, g).pass()).toEqual([
      { idea: KEY, issue: 1419, step: "held", bound: "load" },
    ]);
    expect(g.record).toHaveBeenCalledWith(1419, "load");
    expect(p.spawn).not.toHaveBeenCalled();
  });

  it("drops a ticket whose issue an idea in the same queue already works", async () => {
    const p = ports({
      queue: vi
        .fn()
        .mockResolvedValue([
          { kind: "idea", idea: "0052", issue: 1419, since: "2026-11-20" },
          TICKET,
        ]),
    });

    const steps = await on(p).pass();

    expect(steps.map((s) => s.idea)).toEqual(["0052"]);
  });
});
