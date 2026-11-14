import { afterEach, describe, expect, it, vi } from "vitest";
import { localDate, systemClock } from "./clock.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("systemClock.now", () => {
  it("returns the current time from the system clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
    expect(systemClock.now().toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });
});

describe("systemClock.sleep", () => {
  it("resolves only once the requested milliseconds have passed on the timer", async () => {
    vi.useFakeTimers();
    let resolved = false;
    const sleeping = systemClock.sleep(100).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(resolved).toBe(true);
  });
});

describe("localDate", () => {
  it("names the local calendar day as YYYY-MM-DD, zero-padded", () => {
    expect(localDate(new Date(2026, 0, 5, 9, 30))).toBe("2026-01-05");
  });

  it("names the last day of a year without rolling into the next one", () => {
    expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });
});
