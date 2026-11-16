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

  it("gives up after the pass limit rather than polling forever", async () => {
    const pass = vi.fn().mockResolvedValue(step("waiting"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    expect(
      await runTicks({ pass } as unknown as Tick, "0001", sleep, 3),
    ).toEqual({ status: "gave-up", rounds: 3 });
    expect(pass).toHaveBeenCalledTimes(3);
  });
});
