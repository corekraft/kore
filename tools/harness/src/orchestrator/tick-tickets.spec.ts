import { beforeEach, describe, expect, it, vi } from "vitest";
import { writerLaunch } from "./idea-run.js";
import type { TickPorts } from "./tick.js";
import { Tick } from "./tick.js";

vi.mock("./idea-run.js", () => ({
  escalateStage: vi.fn(),
  judgeLaunch: vi.fn(),
  outcomeStage: vi.fn(),
  precheckStage: vi.fn(),
  reviewStage: vi.fn(),
  sendBackStage: vi.fn(),
  writerLaunch: vi.fn(),
}));

/** The ports a tick pass reads, with nothing running and nothing merged: the first step is a writer. */
function ports(queue: unknown[]) {
  return {
    queue: vi.fn().mockResolvedValue(queue),
    panes: vi.fn().mockResolvedValue([]),
    delivery: vi.fn().mockResolvedValue({ merged: false }),
    head: vi.fn().mockResolvedValue("abcdef1234567890"),
    reviewPosted: vi.fn().mockResolvedValue(true),
    spawn: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    sendBacks: vi
      .fn()
      .mockResolvedValue({ count: 1, model: "haiku", escalate: false }),
    workPlan: vi.fn().mockResolvedValue(undefined),
    ticketsOn: vi.fn().mockResolvedValue(false),
  } as unknown as TickPorts & { spawn: ReturnType<typeof vi.fn> };
}

const TICKET = {
  kind: "ticket",
  issue: 20,
  since: "2026-11-10",
  lane: "product",
  horizon: "next",
  labels: ["ready-for-agent"],
};

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
});

describe("Tick and the plain tickets the frontier queue lists, with the ticket flag off", () => {
  it("starts no plain ticket the queue lists, and advances the idea items in the order given", async () => {
    const p = ports([
      TICKET,
      { kind: "idea", idea: "0002", issue: 12, since: "2026-11-16" },
      { kind: "idea", idea: "0001", issue: 11, since: "2026-11-16" },
    ]);

    const steps = await new Tick(p).pass();

    expect(steps.map((s) => [s.idea, s.step])).toEqual([
      ["0002", "spawn-writer"],
      ["0001", "spawn-writer"],
    ]);
    expect(p.spawn).toHaveBeenCalledTimes(2);
  });

  it("reports a plain ticket scoped to it as not queued, and starts nothing for it", async () => {
    const p = ports([TICKET]);

    expect(await new Tick(p).pass("20")).toEqual([
      { idea: "20", step: "not-queued" },
    ]);
    expect(p.spawn).not.toHaveBeenCalled();
  });
});
