import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TICK_LOOP_INTERVAL_MS,
  TickLoop,
  type LoopPorts,
} from "./tick-loop.js";

const OK = { stdout: "Idea 1: waiting.\n", stderr: "", code: 0 };
const THREW = { stdout: "", stderr: "TypeError: boom\n", code: 1 };

/** Fake ports, each its own spy, with one call log across all of them. */
function fakes(passes: Array<typeof OK | typeof THREW>, flags: boolean[] = []) {
  const calls: string[] = [];
  const queue = [...passes];
  const flagQueue = [...flags];
  const flagOn = vi.fn(async () => {
    calls.push("flag");
    return flagQueue.length === 0 ? true : (flagQueue.shift() as boolean);
  });
  const heartbeat = vi.fn(async () => {
    calls.push("heartbeat");
  });
  const stopped = vi.fn(async () => {
    calls.push("stopped");
  });
  const pass = vi.fn(async () => {
    calls.push("pass");
    return queue.shift() ?? OK;
  });
  const report = vi.fn();
  const updateFailed = vi.fn();
  const sleep = vi.fn(async () => {
    calls.push("sleep");
  });
  const ports: LoopPorts = {
    flagOn,
    updateFailed,
    heartbeat,
    stopped,
    pass,
    report,
    sleep,
  };
  return {
    ports,
    calls,
    updateFailed,
    flagOn,
    heartbeat,
    stopped,
    pass,
    report,
    sleep,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tick loop", () => {
  it("runs each pass as its own step and sleeps the interval between passes", async () => {
    const f = fakes([OK, OK]);

    const result = await new TickLoop(f.ports).run(2);

    expect(result).toEqual({ status: "limit", passes: 2 });
    expect(f.calls).toEqual([
      "flag",
      "heartbeat",
      "pass",
      "sleep",
      "flag",
      "heartbeat",
      "pass",
      "stopped",
    ]);
    expect(f.sleep).toHaveBeenCalledWith(TICK_LOOP_INTERVAL_MS);
  });

  it("keeps looping after a pass that throws, so one failed tick does not end the loop", async () => {
    const f = fakes([THREW, THREW, OK]);

    const result = await new TickLoop(f.ports).run(3);

    expect(result).toEqual({ status: "limit", passes: 3 });
    expect(f.pass).toHaveBeenCalledTimes(3);
    expect(f.report).toHaveBeenNthCalledWith(1, THREW);
    expect(f.report).toHaveBeenNthCalledWith(3, OK);
  });

  it("writes a heartbeat before every pass, so a gap shows a loop that stopped beating", async () => {
    const f = fakes([OK, OK, OK]);

    await new TickLoop(f.ports).run(3);

    expect(f.heartbeat).toHaveBeenCalledTimes(3);
  });

  it("writes the stop event once when the loop ends, even after a failed pass", async () => {
    const f = fakes([THREW]);

    await new TickLoop(f.ports).run(1);

    expect(f.stopped).toHaveBeenCalledTimes(1);
  });

  it("stops at the flag: a flag turned off mid-loop ends it after its stop event, and no pass runs", async () => {
    const f = fakes([OK], [true, false]);

    const result = await new TickLoop(f.ports).run(5);

    expect(result).toEqual({ status: "flag-off", passes: 1 });
    expect(f.pass).toHaveBeenCalledTimes(1);
    expect(f.calls.slice(-2)).toEqual(["flag", "stopped"]);
  });

  it("writes nothing when the flag is off from the start, so an off flag leaves no heartbeat", async () => {
    const f = fakes([], [false]);

    const result = await new TickLoop(f.ports).run(3);

    expect(result).toEqual({ status: "flag-off", passes: 0 });
    expect(f.heartbeat).not.toHaveBeenCalled();
    expect(f.pass).not.toHaveBeenCalled();
    expect(f.stopped).not.toHaveBeenCalled();
  });

  it("lets a failing heartbeat write end the loop, so a rejected ledger is never silent", async () => {
    const f = fakes([OK]);
    f.heartbeat.mockRejectedValueOnce(new Error("ledger"));

    await expect(new TickLoop(f.ports).run(1)).rejects.toThrow("ledger");
    expect(f.pass).not.toHaveBeenCalled();
  });
});

describe("tick loop update step", () => {
  it("runs the update after the flag check and before each pass", async () => {
    const f = fakes([OK, OK]);
    const update = vi.fn(async () => {
      f.calls.push("update");
    });

    await new TickLoop({ ...f.ports, update }).run(2);

    expect(f.calls).toEqual([
      "flag",
      "update",
      "heartbeat",
      "pass",
      "sleep",
      "flag",
      "update",
      "heartbeat",
      "pass",
      "stopped",
    ]);
  });

  it("keeps looping when the update throws, and reports it", async () => {
    const f = fakes([OK, OK]);
    const boom = new Error("git exploded");
    const update = vi.fn(async () => {
      throw boom;
    });

    const result = await new TickLoop({ ...f.ports, update }).run(2);

    expect(result).toEqual({ status: "limit", passes: 2 });
    expect(f.updateFailed).toHaveBeenCalledTimes(2);
    expect(f.updateFailed).toHaveBeenCalledWith(boom);
    expect(f.pass).toHaveBeenCalledTimes(2);
  });

  it("runs no update when the flag is off, so an off flag updates nothing", async () => {
    const f = fakes([], [false]);
    const update = vi.fn();

    await new TickLoop({ ...f.ports, update }).run(3);

    expect(update).not.toHaveBeenCalled();
  });
});
