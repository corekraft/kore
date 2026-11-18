import { describe, expect, it, vi } from "vitest";
import type { IdeaPane, TickPorts } from "./tick.js";
import { Tick } from "./tick.js";
import type { TickJudgment } from "./tick-judgment.js";
import type { TickNotifier } from "./tick-notify.js";

vi.mock("./idea-run.js", () => ({
  escalateStage: vi.fn(),
  judgeLaunch: vi.fn(),
  outcomeStage: vi.fn(),
  precheckStage: vi.fn(),
  reviewStage: vi.fn(),
  sendBackStage: vi.fn(),
  writerLaunch: vi.fn(),
}));

const pane = (name: string, state: IdeaPane["state"]): IdeaPane => ({
  name,
  state,
});

/** An idea whose only writer pane finished and left no pull request, so the pass ends blocked. */
function blockedPorts(): TickPorts {
  return {
    queue: vi
      .fn()
      .mockResolvedValue([
        { kind: "idea", idea: "0001", issue: 11, since: "2026-11-16" },
      ]),
    panes: vi.fn().mockResolvedValue([pane("idea-0001-writer", "closed")]),
    delivery: vi.fn().mockResolvedValue({ merged: false }),
    workPlan: vi.fn().mockResolvedValue(undefined),
  } as unknown as TickPorts;
}

describe("Tick.pass with a notifier", () => {
  it("hands each step of the pass to the notifier and returns the same steps", async () => {
    const notifier = { notify: vi.fn().mockResolvedValue(undefined) };
    const judgment = {
      consume: vi.fn().mockResolvedValue(undefined),
    } as unknown as TickJudgment;
    const tick = new Tick(
      blockedPorts(),
      new Map(),
      undefined,
      judgment,
      notifier as unknown as TickNotifier,
    );

    const steps = await tick.pass();

    expect(steps).toEqual([{ idea: "0001", issue: 11, step: "blocked" }]);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledWith({
      idea: "0001",
      issue: 11,
      step: "blocked",
    });
  });
});
