import { describe, expect, it, vi } from "vitest";
import { BranchStepNotifier } from "./tick-branch-notice.js";
import { Tick, type TickPorts } from "./tick.js";

/** A queue with two ideas, each with a running writer, so a pass only waits and never starts a step of its own. */
function ports(): TickPorts {
  return {
    queue: vi.fn().mockResolvedValue([
      { kind: "idea", idea: "0034", issue: 34 },
      { kind: "idea", idea: "0035", issue: 35 },
    ]),
    panes: vi
      .fn()
      .mockImplementation(async (idea: string) => [
        { name: `idea-${idea}-writer`, state: "running" },
      ]),
  } as unknown as TickPorts;
}

/** The attended-pane notifier is a no-op here; the branch check is the one under test. */
function notifierWith(
  check: (idea: string, issue: number) => Promise<unknown>,
) {
  return new BranchStepNotifier(
    { notify: vi.fn().mockResolvedValue(undefined) },
    {
      check: check as (
        idea: string,
        issue: number,
      ) => Promise<string | undefined>,
    },
  );
}

describe("Tick.pass with a branch notice check", () => {
  it("puts the notice a check reports on the step of the idea it concerns", async () => {
    const check = vi
      .fn()
      .mockImplementation(async (idea: string) =>
        idea === "0034" ? "Branch update notice sent" : undefined,
      );
    const tick = new Tick(
      ports(),
      new Map(),
      undefined,
      undefined,
      notifierWith(check),
    );

    const steps = await tick.pass();

    expect(steps).toEqual([
      {
        idea: "0034",
        issue: 34,
        step: "waiting",
        notice: "Branch update notice sent",
      },
      { idea: "0035", issue: 35, step: "waiting" },
    ]);
  });

  it("checks each queued idea once per pass, with its issue", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const tick = new Tick(
      ports(),
      new Map(),
      undefined,
      undefined,
      notifierWith(check),
    );

    await tick.pass();

    expect(check).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenNthCalledWith(1, "0034", 34);
    expect(check).toHaveBeenNthCalledWith(2, "0035", 35);
  });

  it("gives a step no notice field when the check reports nothing", async () => {
    const tick = new Tick(
      ports(),
      new Map(),
      undefined,
      undefined,
      notifierWith(vi.fn().mockResolvedValue(undefined)),
    );

    const steps = await tick.pass("0034");

    expect(steps[0]).not.toHaveProperty("notice");
  });
});
