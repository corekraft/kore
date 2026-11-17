import { describe, expect, it, vi } from "vitest";
import type { IdeaStep, StepName, Tick } from "./tick.js";
import { TICK_POLL_MS, runTicks } from "./tick-run.js";

const step = (name: StepName): IdeaStep[] => [
  { idea: "0001", issue: 11, step: name },
];

function ticks(...passes: StepName[]) {
  const pass = vi.fn();
  for (const name of passes) {
    pass.mockResolvedValueOnce(step(name));
  }
  return { pass } as unknown as Tick & { pass: typeof pass };
}

describe("runTicks with judgment steps", () => {
  it("runs through a judgment's pane starts and waits, and ends blocked once it stops for the owner", async () => {
    const tick = ticks(
      "spawn-judgment",
      "waiting",
      "spawn-readers",
      "waiting",
      "needs-info",
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    expect(await runTicks(tick, "0001", sleep)).toEqual({
      status: "blocked",
      rounds: 5,
    });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("ends blocked when a valid work plan is left for the owner, without sleeping", async () => {
    const tick = ticks("work-planned");
    const sleep = vi.fn().mockResolvedValue(undefined);

    expect(await runTicks(tick, "0001", sleep)).toEqual({
      status: "blocked",
      rounds: 1,
    });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("runTicks", () => {
  it("passes over the one idea until its outcome is recorded, sleeping only while a pane works", async () => {
    const tick = ticks(
      "spawn-writer",
      "waiting",
      "waiting",
      "close",
      "review",
      "spawn-judge",
      "waiting",
      "close",
      "record-outcome",
    );
    const sleep = vi.fn().mockResolvedValue(undefined);

    expect(await runTicks(tick, "0001", sleep)).toEqual({
      status: "outcome-recorded",
      rounds: 9,
    });
    expect(tick.pass).toHaveBeenCalledTimes(9);
    expect(tick.pass).toHaveBeenCalledWith("0001");
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(TICK_POLL_MS);
  });

  it.each([
    ["awaiting-outcome", "awaiting-outcome"],
    ["blocked", "blocked"],
    ["needs-judgment", "blocked"],
    ["awaiting-judge", "blocked"],
    ["not-queued", "not-queued"],
  ] as const)(
    "stops, without sleeping, when the idea reaches %s",
    async (reached, status) => {
      const tick = ticks("spawn-writer", reached);
      const sleep = vi.fn();

      expect(await runTicks(tick, "0001", sleep)).toEqual({
        status,
        rounds: 2,
      });
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it("waits through a held pass, as it waits on a working pane, and does not end the run", async () => {
    const tick = ticks("held", "held", "record-outcome");
    const sleep = vi.fn().mockResolvedValue(undefined);

    expect(await runTicks(tick, "0001", sleep)).toEqual({
      status: "outcome-recorded",
      rounds: 3,
    });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(TICK_POLL_MS);
  });

  it("gives up after the pass limit rather than polling forever", async () => {
    const pass = vi.fn().mockResolvedValue(step("waiting"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    expect(
      await runTicks({ pass } as unknown as Tick, "0001", sleep, 3),
    ).toEqual({ status: "gave-up", rounds: 3 });
    expect(pass).toHaveBeenCalledTimes(3);
  });
});
