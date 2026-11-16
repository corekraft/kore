import { describe, expect, it, vi } from "vitest";
import type { BoundReaders } from "./tick-bounds.js";
import { BOUND_LABELS, TickBounds } from "./tick-bounds.js";

function readers(over: Partial<BoundReaders> = {}): BoundReaders {
  return {
    power: vi.fn().mockResolvedValue("ac"),
    overLoad: vi.fn().mockReturnValue(false),
    leaseHeld: vi.fn().mockResolvedValue(false),
    ...over,
  };
}

describe("TickBounds on AC power with the host clear", () => {
  it("allows the whole frontier to start: no saver mode and no hold", async () => {
    expect(await new TickBounds(readers()).read()).toEqual({ saver: false });
  });
});

describe("TickBounds saver mode", () => {
  it("turns saver mode on when the host draws from its battery", async () => {
    const bounds = new TickBounds(
      readers({ power: vi.fn().mockResolvedValue("battery") }),
    );

    expect((await bounds.read()).saver).toBe(true);
  });

  it("treats a power source that cannot be read as battery, never as AC", async () => {
    const bounds = new TickBounds(
      readers({ power: vi.fn().mockResolvedValue("unknown") }),
    );

    expect((await bounds.read()).saver).toBe(true);
  });

  it("holds no pane for battery alone: saver mode narrows starts, it does not stop them", async () => {
    const bounds = new TickBounds(
      readers({ power: vi.fn().mockResolvedValue("battery") }),
    );

    expect(await bounds.read()).toEqual({ saver: true });
  });
});

describe("TickBounds holds", () => {
  it("holds every start while the host load is above the ceiling, even on AC", async () => {
    const bounds = new TickBounds(
      readers({ overLoad: vi.fn().mockReturnValue(true) }),
    );

    expect(await bounds.read()).toEqual({ saver: false, hold: "load" });
  });

  it("holds every start while a live run holds the host lease", async () => {
    const bounds = new TickBounds(
      readers({ leaseHeld: vi.fn().mockResolvedValue(true) }),
    );

    expect(await bounds.read()).toEqual({ saver: false, hold: "live-run" });
  });

  it("reports the load hold first when both the load and the lease hold", async () => {
    const bounds = new TickBounds(
      readers({
        overLoad: vi.fn().mockReturnValue(true),
        leaseHeld: vi.fn().mockResolvedValue(true),
      }),
    );

    expect((await bounds.read()).hold).toBe("load");
  });
});

describe("the labels a bound hit writes to the ledger", () => {
  it("fits the ledger's label rule of 1 to 100 characters with no control characters", () => {
    for (const label of Object.values(BOUND_LABELS)) {
      expect(label).toMatch(/^[^\p{Cc}]{1,100}$/u);
    }
  });
});
