import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Watchdog } from "./watchdog.js";

const TIMEOUT = 1000;
const GRACE = 500;

let send: ReturnType<typeof vi.fn<(signal: string) => void>>;
let settled: ReturnType<typeof vi.fn<() => void>>;

function watchdog(timeoutMs = TIMEOUT): Watchdog {
  return new Watchdog({ timeoutMs, graceMs: GRACE, send, settled });
}

beforeEach(() => {
  vi.useFakeTimers();
  send = vi.fn<(signal: string) => void>();
  settled = vi.fn<() => void>();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Watchdog: the timeout", () => {
  it("sends SIGTERM exactly when the timeout passes, and not before", () => {
    watchdog();

    vi.advanceTimersByTime(TIMEOUT - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("SIGTERM");
  });

  it("never fires when the timeout is zero", () => {
    const dog = watchdog(0);

    vi.advanceTimersByTime(60_000);

    expect(send).not.toHaveBeenCalled();
    expect(dog.timedOut()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports its timeout, and marks the run timed out once it fires", () => {
    const dog = watchdog();

    expect(dog.timeoutMs).toBe(TIMEOUT);
    expect(dog.timedOut()).toBe(false);
    vi.advanceTimersByTime(TIMEOUT);
    expect(dog.timedOut()).toBe(true);
  });
});

describe("Watchdog: the grace period", () => {
  it("escalates to SIGKILL at the end of the grace period when the child is still running", () => {
    const dog = watchdog();

    vi.advanceTimersByTime(TIMEOUT + GRACE - 1);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);

    expect(send).toHaveBeenLastCalledWith("SIGKILL");
    expect(send).toHaveBeenCalledTimes(2);
    expect(dog.escalated()).toBe(true);
  });

  it("does not escalate when the child exits on SIGTERM within the grace period", () => {
    const dog = watchdog();

    vi.advanceTimersByTime(TIMEOUT);
    dog.noteExit();
    vi.advanceTimersByTime(GRACE);

    expect(send.mock.calls.map(([signal]) => signal)).toEqual([
      "SIGTERM",
      "SIGKILL",
    ]);
    expect(dog.escalated()).toBe(false);
  });

  it("settles only once the child has exited and the grace period is over", () => {
    const dog = watchdog();

    vi.advanceTimersByTime(TIMEOUT);
    dog.noteExit();
    expect(settled).not.toHaveBeenCalled();

    vi.advanceTimersByTime(GRACE);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(dog.escalated()).toBe(false);
  });

  it("does not settle while the child runs, even after the grace period", () => {
    watchdog();

    vi.advanceTimersByTime(TIMEOUT + GRACE);

    expect(send).toHaveBeenCalledWith("SIGKILL");
    expect(settled).not.toHaveBeenCalled();
  });

  it("settles at the exit when the grace period ended first, and the child was killed", () => {
    const dog = watchdog();

    vi.advanceTimersByTime(TIMEOUT + GRACE);
    expect(settled).not.toHaveBeenCalled();
    dog.noteExit();

    expect(settled).toHaveBeenCalledTimes(1);
    expect(dog.escalated()).toBe(true);
  });
});

describe("Watchdog: a child that finishes in time", () => {
  it("stops both clocks when cleared, so nothing is sent afterwards", () => {
    const dog = watchdog();

    dog.clear();
    vi.advanceTimersByTime(TIMEOUT + GRACE);

    expect(send).not.toHaveBeenCalled();
    expect(dog.timedOut()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
